import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, GitMerge, ShieldAlert, Terminal,
  ArrowRight, CheckCircle, XCircle, Loader2, Play, RotateCcw,
  Server, Radio, Edit, Pause, Clock
} from 'lucide-react';

import { getSnapshots, getRules, getSubtaskTypes, getDeployments, clearCache } from '../mockData';
import { EvolutionProposal, AgentLog, Snapshot, ValidationRun, Rule, PkgEnv, SubtaskType, Deployment, DeploymentTarget, UnifiedMemoryItem, PkgRelation } from '../types';

import {
  proposeEvolution,
  buildSnapshotFromProposal,
  runValidationAgent,
  calculateCanaryStep,
  promoteToWasm,
} from '../services/agentSystem';
import { generateEvolutionPlan } from '../services/geminiService';
import { validateRulesWithDigitalTwin } from '../services/digitalTwinService';

import { createSnapshot } from '../services/snapshotService';
import { createRule } from '../services/ruleService';
import { createOrUpdateDeployment, rollbackDeploymentLane, getRolloutEvents } from '../services/deploymentService';
import { seedcoreService, TrackingEvent } from '../services/seedcoreService';
import { fetchUnifiedMemory } from '../services/database';
import { cloneSubtaskTypes } from '../services/subtaskTypeService';

const APP_TRACKING_ID = 'pkg-simulator';
const APP_TRACKING_SUBJECT_TYPE = 'application';
const EFFECTIVE_TRACKING_EVENT_TYPES = [
  'policy_decision_recorded',
  'runtime_incident_detected',
  'policy_implementation_reported',
] as const;

const SEVERITY_SCORES: Record<string, number> = {
  critical: 4,
  high: 3,
  error: 3,
  warning: 2,
  warn: 2,
  escalated: 2,
  rejected: 2,
  denied: 2,
  blocked: 2,
  normal: 1,
  info: 0,
  ok: 0,
  improved: 0,
};

// ---------- helpers ----------
const mkId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function safeQuote(s: string, max = 240) {
  const t = (s || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function ruleSourceFromIntentOrStructure(intent?: string, rule?: Partial<Rule>) {
  const i = safeQuote(intent || '');
  if (i) return `Generated from: "${i}"`;

  // fallback: structure-based (best-effort)
  const conds = (rule?.conditions || [])
    .map(c => `${c.conditionKey} ${c.operator} ${c.value ?? 'EXISTS'}`)
    .join(' AND ');
  const ems = (rule?.emissions || [])
    .map(e => `${e.relationshipType} -> ${e.subtaskName || e.subtaskTypeId}`)
    .join(', ');
  if (conds || ems) return `Rule: When ${conds || '(conditions)'}, then ${ems || '(emissions)'}`;
  return 'Generated rule';
}

function collectRulePersistenceIssues(
  rules: Rule[],
  availableSubtaskTypes: SubtaskType[]
) {
  const availableNames = new Set(availableSubtaskTypes.map(st => st.name));
  const issues: string[] = [];

  rules.forEach((rule, ruleIndex) => {
    const label = rule.ruleName || `rule_${ruleIndex + 1}`;

    if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
      issues.push(`Rule "${label}" is missing conditions.`);
    }
    if (!Array.isArray(rule.emissions) || rule.emissions.length === 0) {
      issues.push(`Rule "${label}" is missing emissions.`);
    }

    (rule.conditions || []).forEach((condition, conditionIndex) => {
      if (!condition.conditionType) {
        issues.push(`Rule "${label}" condition ${conditionIndex + 1} is missing conditionType.`);
      }
      if (!condition.conditionKey?.trim()) {
        issues.push(`Rule "${label}" condition ${conditionIndex + 1} is missing conditionKey.`);
      }
      if (!condition.operator) {
        issues.push(`Rule "${label}" condition ${conditionIndex + 1} is missing operator.`);
      }
    });

    (rule.emissions || []).forEach((emission, emissionIndex) => {
      if (!emission.relationshipType) {
        issues.push(`Rule "${label}" emission ${emissionIndex + 1} is missing relationshipType.`);
      }
      if (!emission.subtaskTypeId && !emission.subtaskName) {
        issues.push(`Rule "${label}" emission ${emissionIndex + 1} is missing subtask mapping.`);
      }
      if (emission.subtaskName && !availableNames.has(emission.subtaskName)) {
        issues.push(`Rule "${label}" emission ${emissionIndex + 1} references unknown subtask "${emission.subtaskName}".`);
      }
    });
  });

  return issues;
}

function resolveUsableSubtaskTypes(
  allSubtaskTypes: SubtaskType[],
  preferredSnapshotId: number | null | undefined
) {
  const bySnapshot = preferredSnapshotId
    ? allSubtaskTypes.filter(st => st.snapshotId === preferredSnapshotId)
    : [];
  return bySnapshot.length > 0 ? bySnapshot : allSubtaskTypes;
}

const EMISSION_SUBTASK_ALIASES: Record<string, string> = {
  gate_approval_workflow: 'authorize_release_window',
  approval_gate: 'authorize_release_window',
  approval_workflow: 'authorize_release_window',
  operator_review: 'dispatch_operator_review',
  notify_operations: 'notify_control_plane',
  control_plane_notification: 'notify_control_plane',
  playback_evidence_capture: 'capture_playback_evidence',
  custody_memory_sync: 'sync_custody_memory',
  environmental_stabilization: 'stabilize_environmental_controls',
  stabilize_environment: 'stabilize_environmental_controls',
  zone_lockdown: 'lock_zone_access',
  quarantine_asset: 'quarantine_asset_lot',
  identity_provenance_verification: 'verify_identity_and_provenance',
  robotic_handoff_routing: 'route_robotic_handoff',
};

const DEFAULT_RELATIONSHIP_BY_SUBTASK: Record<string, PkgRelation> = {
  authorize_release_window: 'GATE',
  verify_identity_and_provenance: 'GATE',
  lock_zone_access: 'GATE',
  dispatch_operator_review: 'ORDERS',
  route_robotic_handoff: 'ORDERS',
  notify_control_plane: 'EMITS',
  quarantine_asset_lot: 'EMITS',
  capture_playback_evidence: 'EMITS',
  sync_custody_memory: 'EMITS',
  stabilize_environmental_controls: 'EMITS',
};

function canonicalizeName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function scoreSubtaskNameMatch(candidate: string, target: string) {
  if (!candidate || !target) return 0;
  if (candidate === target) return 100;
  const candidateTokens = new Set(candidate.split('_').filter(Boolean));
  const targetTokens = new Set(target.split('_').filter(Boolean));
  let overlap = 0;
  for (const token of candidateTokens) {
    if (targetTokens.has(token)) overlap += 1;
  }
  if (candidate.includes(target) || target.includes(candidate)) return overlap + 3;
  return overlap;
}

function resolveEmissionSubtaskName(
  subtaskName: string | undefined,
  availableSubtaskTypes: SubtaskType[]
) {
  if (!subtaskName) return undefined;
  const availableByCanonical = new Map(
    availableSubtaskTypes.map(st => [canonicalizeName(st.name), st.name] as const)
  );
  const canonical = canonicalizeName(subtaskName);
  if (availableByCanonical.has(canonical)) {
    return availableByCanonical.get(canonical);
  }
  const alias = EMISSION_SUBTASK_ALIASES[canonical];
  if (alias && availableByCanonical.has(canonicalizeName(alias))) {
    return alias;
  }

  let bestMatch: string | undefined;
  let bestScore = 0;
  for (const st of availableSubtaskTypes) {
    const score = scoreSubtaskNameMatch(canonical, canonicalizeName(st.name));
    if (score > bestScore) {
      bestScore = score;
      bestMatch = st.name;
    }
  }
  return bestScore >= 2 ? bestMatch : undefined;
}

function repairRulesForPersistence(
  rules: Rule[],
  availableSubtaskTypes: SubtaskType[]
) {
  return rules.map(rule => ({
    ...rule,
    emissions: (rule.emissions || []).map(emission => {
      const resolvedSubtaskName = resolveEmissionSubtaskName(emission.subtaskName, availableSubtaskTypes) || emission.subtaskName;
      const relationshipType = emission.relationshipType
        || (resolvedSubtaskName ? DEFAULT_RELATIONSHIP_BY_SUBTASK[resolvedSubtaskName] : undefined)
        || 'EMITS';
      return {
        ...emission,
        subtaskName: resolvedSubtaskName,
        relationshipType,
      };
    }),
  }));
}

function buildSnapshotNotes(params: {
  freeformNotes?: string | null;
  baseSnapshot?: Snapshot | null;
  artifactFormat?: 'native' | 'wasm';
  runId?: string;
}) {
  const payload: Record<string, any> = {
    created_by: 'pkg-simulator',
  };
  if (params.freeformNotes) payload.notes = params.freeformNotes;
  if (params.baseSnapshot?.id) payload.base_snapshot_id = params.baseSnapshot.id;
  if (params.baseSnapshot?.version) payload.base_snapshot_version = params.baseSnapshot.version;
  if (params.artifactFormat) payload.artifactFormat = params.artifactFormat;
  if (params.runId) payload.run_id = params.runId;
  return JSON.stringify(payload);
}

function pickBaseSnapshot(snaps: Snapshot[], baseId?: number | null) {
  if (baseId) {
    const found = snaps.find(s => s.id === baseId);
    if (found) return found;
  }
  // Prefer active PROD
  return snaps.find(s => s.env === PkgEnv.PROD && s.isActive) || snaps[0] || null;
}

function ensureUniqueSnapshotVersion(version: string, snapshots: Snapshot[]) {
  const trimmed = (version || '').trim();
  const existing = new Set(snapshots.map(snapshot => snapshot.version));
  if (trimmed && !existing.has(trimmed)) return trimmed;
  const fallbackBase = trimmed || 'v' + Date.now();
  return `${fallbackBase}-${Date.now()}`;
}

function matchesZoneMemory(memory: UnifiedMemoryItem, zone: string) {
  const upperZone = zone.toUpperCase();
  const category = (memory.category || '').toUpperCase();
  const metadataZone = String(memory.metadata?.zone || memory.metadata?.intent?.zone || '').toUpperCase();
  return category.includes(upperZone) || metadataZone === upperZone;
}

function summarizeIncidentMemories(zone: string, memories: UnifiedMemoryItem[]) {
  const incidents = memories.slice(0, 5);
  const anomalyCounts = new Map<string, number>();

  for (const memory of incidents) {
    const anomaly = memory.metadata?.intent?.anomaly;
    if (anomaly && anomaly !== 'none') {
      anomalyCounts.set(anomaly, (anomalyCounts.get(anomaly) || 0) + 1);
    }
  }

  const anomalySummary = Array.from(anomalyCounts.entries())
    .map(([name, count]) => `${name}=${count}`)
    .join(', ');

  const incidentLines = incidents.map((memory, index) => {
    const endpoint = memory.metadata?.intent?.endpoint || memory.metadata?.endpoint || 'unknown_endpoint';
    const severity = memory.metadata?.intent?.severity || memory.metadata?.severity || 'unknown';
    const content = safeQuote(memory.content || 'No incident details provided.', 160);
    return `${index + 1}. endpoint=${endpoint}; severity=${severity}; detail=${content}`;
  });

  return [
    `[Autonomous Incident Digest | Zone: ${zone}]`,
    anomalySummary ? `Observed anomalies: ${anomalySummary}` : 'Observed anomalies: none classified yet',
    'Recent infrastructure incidents:',
    ...incidentLines,
    'Requested policy evolution: tighten detection thresholds, auto-contain repeated anomalies, require operator review for critical endpoint instability, and preserve service continuity for healthy traffic.',
  ].join('\n');
}

function zoneTokens(zone: string) {
  return [
    zone,
    zone.toLowerCase(),
    zone.toUpperCase(),
    zone.replace(/_/g, ' '),
    zone.toLowerCase().replace(/_/g, ' '),
  ];
}

function eventContainsZoneValue(value: unknown, zone: string): boolean {
  if (value == null) return false;
  const haystack = typeof value === 'string' ? value : JSON.stringify(value);
  const normalized = haystack.toLowerCase();
  return zoneTokens(zone).some(token => normalized.includes(token.toLowerCase()));
}

function matchesZoneTrackingEvent(event: TrackingEvent, zone: string) {
  if (eventContainsZoneValue(event.subject_type, zone)) return true;
  if (eventContainsZoneValue(event.subject_id, zone)) return true;
  if (eventContainsZoneValue(event.event_type, zone)) return true;

  const payload = event.payload || {};
  const candidateFields = [
    payload.zone,
    payload.zone_id,
    payload.location,
    payload.location_context,
    payload.target,
    payload.endpoint,
    payload.intent?.zone,
    payload.metadata?.zone,
    payload.context?.zone,
  ];

  if (candidateFields.some(value => eventContainsZoneValue(value, zone))) {
    return true;
  }

  return eventContainsZoneValue(payload, zone);
}

function isEffectiveTrackingEvent(event: TrackingEvent) {
  return EFFECTIVE_TRACKING_EVENT_TYPES.includes(event.event_type as typeof EFFECTIVE_TRACKING_EVENT_TYPES[number]);
}

function isPolicyDenyEvent(event: TrackingEvent) {
  const payload = event.payload || {};
  const disposition = String(payload.disposition || payload.policy_decision?.disposition || '').toLowerCase();
  const status = String(payload.status || payload.policy_decision?.status || '').toLowerCase();
  const allowed = payload.allowed ?? payload.policy_decision?.allowed;
  return event.event_type === 'policy_decision_recorded'
    && (allowed === false || ['deny', 'denied', 'escalate', 'escalated', 'reject', 'rejected', 'blocked'].includes(disposition) || ['deny', 'denied', 'rejected', 'blocked', 'escalated'].includes(status));
}

function eventSeverityScore(event: TrackingEvent) {
  const payload = event.payload || {};
  const rawSeverity = String(
    payload.severity ||
    payload.priority ||
    payload.status ||
    payload.policy_decision?.status ||
    ''
  ).toLowerCase();
  return SEVERITY_SCORES[rawSeverity] ?? 0;
}

function eventRepeatCount(event: TrackingEvent) {
  const payload = event.payload || {};
  const count = payload.count ?? payload.repeat_count ?? payload.metadata?.count ?? payload.metadata?.repeat_count;
  return typeof count === 'number' && Number.isFinite(count) ? count : 1;
}

function rankTrackingEvents(events: TrackingEvent[]) {
  return [...events].sort((a, b) => {
    const denyDelta = Number(isPolicyDenyEvent(b)) - Number(isPolicyDenyEvent(a));
    if (denyDelta !== 0) return denyDelta;

    const severityDelta = eventSeverityScore(b) - eventSeverityScore(a);
    if (severityDelta !== 0) return severityDelta;

    const repeatDelta = eventRepeatCount(b) - eventRepeatCount(a);
    if (repeatDelta !== 0) return repeatDelta;

    return new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime();
  });
}

function summarizeTrackingEvents(zone: string, events: TrackingEvent[]) {
  const latestEvents = rankTrackingEvents(events).slice(0, 5);
  const typeCounts = new Map<string, number>();

  for (const event of latestEvents) {
    typeCounts.set(event.event_type, (typeCounts.get(event.event_type) || 0) + 1);
  }

  const eventTypeSummary = Array.from(typeCounts.entries())
    .map(([name, count]) => `${name}=${count}`)
    .join(', ');

  const eventLines = latestEvents.map((event, index) => {
    const payload = event.payload || {};
    const endpoint = payload.endpoint || payload.target || payload.location_context || payload.zone || 'unknown_endpoint';
    const severity = payload.severity || payload.priority || payload.status || 'unknown';
    const detailSource =
      payload.summary ||
      payload.message ||
      payload.reason ||
      payload.detail ||
      payload.description ||
      JSON.stringify(payload);
    const detail = safeQuote(String(detailSource || 'No event details provided.'), 160);

    return `${index + 1}. event_type=${event.event_type}; endpoint=${endpoint}; severity=${severity}; detail=${detail}`;
  });

  return [
    `[SeedCore Tracking Event Digest | Zone: ${zone}]`,
    eventTypeSummary ? `Observed event types: ${eventTypeSummary}` : 'Observed event types: none classified yet',
    'Highest-priority effective tracking events:',
    ...eventLines,
    'Requested policy evolution: tighten detection thresholds, auto-contain repeated anomalies, require operator review for critical endpoint instability, and preserve service continuity for healthy traffic.',
  ].join('\n');
}

export const ControlPlane: React.FC = () => {
  // Pipeline identity: prevents stale async steps from writing into a new run
  const [pipelineId, setPipelineId] = useState<string>(mkId());
  const pipelineIdRef = useRef(pipelineId);
  useEffect(() => { pipelineIdRef.current = pipelineId; }, [pipelineId]);

  // State for the pipeline
  const [intent, setIntent] = useState(
    'Upgrade the active INFRASTRUCTURE snapshot so vault-release flows require dual approval before entering the transfer corridor. Add explicit authz-graph edge manifests, deny protected corridor access by default, and quarantine route drift, stale telemetry, or missing lineage faster.'
  );
  
  // Zone-aware evolution
  const [selectedZone, setSelectedZone] = useState<string>('INFRASTRUCTURE');
  
  // Deployment target and temporal awareness
  const [deploymentTarget, setDeploymentTarget] = useState<DeploymentTarget>('router');
  const [deploymentDuration, setDeploymentDuration] = useState<number | null>(null); // Duration in hours, null = permanent
  const [deploymentExpiry, setDeploymentExpiry] = useState<string | null>(null); // ISO timestamp

  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [proposal, setProposal] = useState<EvolutionProposal | null>(null);

  const [draftSnapshot, setDraftSnapshot] = useState<Snapshot | null>(null);
  const [draftRules, setDraftRules] = useState<Rule[]>([]);
  const [candidateSnapshotId, setCandidateSnapshotId] = useState<number | null>(null);
  const [candidateSnapshotVersion, setCandidateSnapshotVersion] = useState<string | null>(null);
  const [runtimeActiveSnapshotId, setRuntimeActiveSnapshotId] = useState<number | null>(null);
  const [runtimeActiveSnapshotVersion, setRuntimeActiveSnapshotVersion] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationRun | null>(null);
  const [deploymentPercent, setDeploymentPercent] = useState<number>(0);

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [subtaskTypes, setSubtaskTypes] = useState<SubtaskType[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [rolloutEvents, setRolloutEvents] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Deployment management state
  const [editingDeployment, setEditingDeployment] = useState<Deployment | null>(null);
  const [editDeploymentPercent, setEditDeploymentPercent] = useState<number>(0);
  const [updatingDeployment, setUpdatingDeployment] = useState(false);
  const [deploymentMessage, setDeploymentMessage] = useState<string | null>(null);

  // Select base snapshot explicitly (prevents "wrong base" surprises)
  const [baseSnapshotId, setBaseSnapshotId] = useState<number | null>(null);

  // Keep the "run intent" stable for the whole run (avoids head-of-prompt mismatch)
  const [runIntent, setRunIntent] = useState<string>('');

  // Loaders
  const [isEvolving, setIsEvolving] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);

  // Optional: whether to persist rules into DB immediately on build
  const [persistRulesOnBuild, setPersistRulesOnBuild] = useState<boolean>(true);

  const baseSnapshot = useMemo(() => pickBaseSnapshot(snapshots, baseSnapshotId), [snapshots, baseSnapshotId]);
  const prodSnapshots = useMemo(() => snapshots.filter(s => s.env === PkgEnv.PROD), [snapshots]);
  
  // Option to deploy an existing snapshot directly (for first-time initialization)
  const [selectedSnapshotForDeployment, setSelectedSnapshotForDeployment] = useState<number | null>(null);
  const [isHydratingIntent, setIsHydratingIntent] = useState(false);
  const autoIntentRef = useRef('');

  const addLog = (agent: AgentLog['agent'], message: string, level: AgentLog['level'] = 'INFO', pid?: string) => {
    const effectivePid = pid || pipelineIdRef.current;

    setAgentLogs(prev => [{
      id: mkId(),
      agent,
      message,
      timestamp: new Date().toLocaleTimeString(),
      level,
      // Unified Memory Event (Tier A: event_working)
      // keep compat: AgentLog type doesn't have pipelineId, so we encode it in message or ignore
    }, ...prev.filter(x => x.id)]); // shallow stability
  };

  const hydrateIntentFromUnifiedMemory = async (zone: string) => {
    const memory = await fetchUnifiedMemory(200);
    const memoryMatches = memory.filter(item => item.memoryTier === 'event_working' && matchesZoneMemory(item, zone));

    if (memoryMatches.length === 0) {
      const fallback = `[SeedCore Tracking Event Digest | Zone: ${zone}]
No recent effective tracking events were found for this zone.
Requested policy evolution: keep current controls, but add log watchers, anomaly thresholds, and escalation hooks for future incidents.`;
      autoIntentRef.current = fallback;
      setIntent(fallback);
      addLog('EVOLUTION', `No recent incidents found for zone=${zone}; inserted monitoring-oriented fallback intent.`, 'WARN');
      return;
    }

    const nextIntent = summarizeIncidentMemories(zone, memoryMatches);
    autoIntentRef.current = nextIntent;
    setIntent(nextIntent);
    addLog('EVOLUTION', `Loaded ${Math.min(memoryMatches.length, 5)} fallback incident(s) from unified memory for zone=${zone}.`, 'SUCCESS');
  };

  const hydrateIntentFromMemory = async (zone: string, force = false) => {
    if (loadingData) return;

    const shouldReplace = force || !intent.trim() || intent === autoIntentRef.current;
    if (!shouldReplace) return;

    setIsHydratingIntent(true);
    addLog('EVOLUTION', `Hydrating incident log from SeedCore tracking events for zone=${zone}...`, 'INFO');

    try {
      const events = await seedcoreService.listEffectiveAppTrackingEvents(APP_TRACKING_ID, {
        subject_type: APP_TRACKING_SUBJECT_TYPE,
        subject_id: APP_TRACKING_ID,
        event_types: [...EFFECTIVE_TRACKING_EVENT_TYPES],
        limit: 50,
      });
      const matching = rankTrackingEvents(
        events.filter(event => isEffectiveTrackingEvent(event) && matchesZoneTrackingEvent(event, zone))
      );

      if (matching.length === 0) {
        addLog('EVOLUTION', `No zone-matched tracking events found for zone=${zone}; falling back to unified memory.`, 'WARN');
        await hydrateIntentFromUnifiedMemory(zone);
        return;
      }

      const nextIntent = summarizeTrackingEvents(zone, matching);
      autoIntentRef.current = nextIntent;
      setIntent(nextIntent);
      addLog('EVOLUTION', `Loaded ${Math.min(matching.length, 5)} recent tracking event(s) into the evolution prompt for zone=${zone}.`, 'SUCCESS');
    } catch (error: any) {
      addLog('EVOLUTION', `Failed to hydrate incident log from tracking events: ${error?.message || String(error)}. Falling back to unified memory.`, 'WARN');
      await hydrateIntentFromUnifiedMemory(zone);
    } finally {
      setIsHydratingIntent(false);
    }
  };

  const resetPipeline = () => {
    setProposal(null);
    setDraftSnapshot(null);
    setDraftRules([]);
    setCandidateSnapshotId(null);
    setCandidateSnapshotVersion(null);
    setValidationResult(null);
    setDeploymentPercent(0);
    setAgentLogs([]);
    setRunIntent('');
    const next = mkId();
    setPipelineId(next);
    addLog('EVOLUTION', `Pipeline reset (run=${next})`, 'INFO', next);
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        const [snaps, ruls, sts, deps, events, pkgStatus] = await Promise.all([
          getSnapshots(), 
          getRules(), 
          getSubtaskTypes(),
          getDeployments(false), // Get all deployments, not just active
          getRolloutEvents({ limit: 10 }).catch(() => []), // Optional: rollout events
          seedcoreService.getPKGStatus().catch(() => null as any),
        ]);
        setSnapshots(snaps);
        setRules(ruls);
        setSubtaskTypes(sts || []);
        setDeployments(deps || []);
        setRolloutEvents(events || []);
        setRuntimeActiveSnapshotId(pkgStatus?.snapshot_id ?? null);
        setRuntimeActiveSnapshotVersion(pkgStatus?.version ?? pkgStatus?.snapshot_version ?? null);

        // pick default base snapshot id (active prod preferred)
        const runtimeBase = pkgStatus?.snapshot_id ? snaps.find(s => s.id === pkgStatus.snapshot_id) : null;
        const base = runtimeBase || pickBaseSnapshot(snaps, null);
        setBaseSnapshotId(base?.id ?? null);

        // FIRST-TIME DETECTION: If no deployments exist, automatically select the first snapshot for deployment
        // This prevents creating a new snapshot when we should deploy the initialized one
        if ((deps || []).length === 0 && snaps.length > 0) {
          // Find the first snapshot (usually snapshot_id=1 from initialization)
          const firstSnapshot = snaps
            .filter(s => s.env === PkgEnv.PROD)
            .sort((a, b) => (a.id || 0) - (b.id || 0))[0]; // Sort by id, get first
          
          if (firstSnapshot) {
            setSelectedSnapshotForDeployment(firstSnapshot.id || null);
            // Set as draftSnapshot so it can be deployed
            // If snapshot is not WASM, treat it as 'native' so promotion button shows
            setDraftSnapshot({
              ...firstSnapshot,
              artifactFormat: firstSnapshot.artifactFormat === 'wasm' ? 'wasm' : 'native', // Treat undefined/null as 'native' for promotion
            });
            setDeploymentPercent(0);
            // Log first-time detection (addLog will be called after component mounts)
            setTimeout(() => {
              const runId = pipelineIdRef.current;
              const formatStatus = firstSnapshot.artifactFormat === 'wasm' 
                ? 'WASM format' 
                : firstSnapshot.artifactFormat === 'native'
                ? 'Native format (needs promotion)'
                : 'Unknown format (may need promotion)';
              addLog('DEPLOYMENT', `First-time detected: No deployments found. Selected snapshot ${firstSnapshot.version} (id=${firstSnapshot.id}, ${formatStatus})`, 'INFO', runId);
            }, 100);
          }
        }
      } catch (error) {
        console.error('Error loading control plane data:', error);
      } finally {
        setLoadingData(false);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    if (loadingData) return;
    hydrateIntentFromMemory(selectedZone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedZone, loadingData]);

  // Get active snapshot for deployment filtering
  // Priority: 1) Runtime-active snapshot from SeedCore, 2) Active PROD snapshot from DB, 3) Selected snapshot for deployment, 4) Draft snapshot
  const activeSnapshot = useMemo(() => {
    if (runtimeActiveSnapshotId) {
      const runtimeSnapshot = snapshots.find(s => s.id === runtimeActiveSnapshotId);
      if (runtimeSnapshot) return runtimeSnapshot;
    }

    const activeFromDb = snapshots.find(s => s.isActive && s.env === PkgEnv.PROD);
    if (activeFromDb) return activeFromDb;
    
    if (selectedSnapshotForDeployment) {
      const selected = snapshots.find(s => s.id === selectedSnapshotForDeployment);
      if (selected) return selected;
    }
    
    return draftSnapshot;
  }, [snapshots, draftSnapshot, selectedSnapshotForDeployment, runtimeActiveSnapshotId]);

  const activeSnapshotId = activeSnapshot?.id;

  // Filter deployments by active snapshot
  const snapshotDeployments = useMemo(() => {
    if (!activeSnapshotId) return [];
    return deployments.filter(d => d.snapshotId === activeSnapshotId);
  }, [deployments, activeSnapshotId]);

  // Deployment management functions
  const handleEditDeployment = (deployment: Deployment) => {
    setEditingDeployment(deployment);
    setEditDeploymentPercent(deployment.percent);
    setDeploymentMessage(null);
  };

  const handleCancelEdit = () => {
    setEditingDeployment(null);
    setEditDeploymentPercent(0);
    setDeploymentMessage(null);
  };

  const handleUpdateDeployment = async () => {
    if (!editingDeployment || !activeSnapshotId) return;

    setUpdatingDeployment(true);
    setDeploymentMessage(null);
    const runId = pipelineIdRef.current;

    try {
      const result = await createOrUpdateDeployment({
        snapshotId: activeSnapshotId,
        target: editingDeployment.target,
        region: editingDeployment.region,
        percent: editDeploymentPercent,
        isActive: editDeploymentPercent > 0,
        activatedBy: 'control-plane',
        deploymentKey: `control-plane-edit-${Date.now()}`,
        isRollback: editDeploymentPercent < editingDeployment.percent,
      });

      setDeploymentMessage(
        `✅ Deployment updated: ${editingDeployment.target} (${editingDeployment.region}) → ${editDeploymentPercent}%`
      );
      addLog('DEPLOYMENT', `Run ${runId}: Updated deployment ${editingDeployment.target} to ${editDeploymentPercent}%`, 'SUCCESS', runId);
      
      // Reload deployments
      const [deps, events] = await Promise.all([
        getDeployments(false),
        getRolloutEvents({ limit: 10 }).catch(() => []),
      ]);
      setDeployments(deps || []);
      setRolloutEvents(events || []);

      setTimeout(() => {
        handleCancelEdit();
        setDeploymentMessage(null);
      }, 2000);
    } catch (error: any) {
      setDeploymentMessage(`❌ Error: ${error.message || String(error)}`);
      addLog('DEPLOYMENT', `Run ${runId}: Failed to update deployment: ${error.message}`, 'ERROR', runId);
    } finally {
      setUpdatingDeployment(false);
    }
  };

  const handleRollbackDeployment = async (deployment: Deployment) => {
    if (!activeSnapshotId) return;

    setUpdatingDeployment(true);
    setDeploymentMessage(null);
    const runId = pipelineIdRef.current;

    try {
      await rollbackDeploymentLane({
        snapshotId: activeSnapshotId,
        target: deployment.target,
        region: deployment.region,
        activatedBy: 'control-plane',
        deploymentKey: `control-plane-rollback-${Date.now()}`,
      });

      setDeploymentMessage(
        `✅ Deployment rolled back: ${deployment.target} (${deployment.region})`
      );
      addLog('DEPLOYMENT', `Run ${runId}: Rolled back deployment ${deployment.target}`, 'WARN', runId);
      
      // Reload deployments
      const [deps, events] = await Promise.all([
        getDeployments(false),
        getRolloutEvents({ limit: 10 }).catch(() => []),
      ]);
      setDeployments(deps || []);
      setRolloutEvents(events || []);
      
      // Check if there are any active deployments left for this snapshot
      const activeDeploymentsForSnapshot = (deps || []).filter(
        d => d.snapshotId === activeSnapshotId && d.isActive && d.percent > 0
      );
      
      // If no active deployments remain, reset deployment-related UI state
      if (activeDeploymentsForSnapshot.length === 0) {
        setDeploymentPercent(0);
        setDeploymentExpiry(null);
        setDeploymentDuration(null);
        addLog('DEPLOYMENT', `Run ${runId}: All deployments rolled back. Reset deployment state.`, 'INFO', runId);
      }

      setTimeout(() => setDeploymentMessage(null), 3000);
    } catch (error: any) {
      setDeploymentMessage(`❌ Rollback failed: ${error.message || String(error)}`);
      addLog('DEPLOYMENT', `Run ${runId}: Failed to rollback deployment: ${error.message}`, 'ERROR', runId);
    } finally {
      setUpdatingDeployment(false);
    }
  };

  const handleDeactivateDeployment = async (deployment: Deployment) => {
    if (!activeSnapshotId) return;

    setUpdatingDeployment(true);
    setDeploymentMessage(null);
    const runId = pipelineIdRef.current;

    try {
      await createOrUpdateDeployment({
        snapshotId: activeSnapshotId,
        target: deployment.target,
        region: deployment.region,
        percent: 0,
        isActive: false,
        // Don't update activatedBy when deactivating - preserve original activation info
        activatedBy: undefined,
        deploymentKey: `control-plane-deactivate-${Date.now()}`,
        isRollback: true,
      });

      setDeploymentMessage(
        `✅ Deployment deactivated: ${deployment.target} (${deployment.region})`
      );
      addLog('DEPLOYMENT', `Run ${runId}: Deactivated deployment ${deployment.target}`, 'WARN', runId);
      
      // Reload deployments
      const [deps, events] = await Promise.all([
        getDeployments(false),
        getRolloutEvents({ limit: 10 }).catch(() => []),
      ]);
      setDeployments(deps || []);
      setRolloutEvents(events || []);
      
      // Check if there are any active deployments left for this snapshot
      const activeDeploymentsForSnapshot = (deps || []).filter(
        d => d.snapshotId === activeSnapshotId && d.isActive && d.percent > 0
      );
      
      // If no active deployments remain, reset deployment-related UI state
      if (activeDeploymentsForSnapshot.length === 0) {
        setDeploymentPercent(0);
        setDeploymentExpiry(null);
        setDeploymentDuration(null);
        addLog('DEPLOYMENT', `Run ${runId}: All deployments deactivated. Reset deployment state.`, 'INFO', runId);
      }

      setTimeout(() => setDeploymentMessage(null), 3000);
    } catch (error: any) {
      setDeploymentMessage(`❌ Deactivation failed: ${error.message || String(error)}`);
      addLog('DEPLOYMENT', `Run ${runId}: Failed to deactivate deployment: ${error.message}`, 'ERROR', runId);
    } finally {
      setUpdatingDeployment(false);
    }
  };

  // -------- Step 0: Initialize First Snapshot (when no snapshots exist) --------
  // NOTE: This should only be used when NO snapshots exist at all
  // If snapshots exist but no deployments, use the existing snapshot instead
  const handleInitializeFirstSnapshot = async () => {
    if (loadingData) return;

    const newRunId = mkId();
    setPipelineId(newRunId);
    pipelineIdRef.current = newRunId;

    setProposal(null);
    setDraftSnapshot(null);
    setDraftRules([]);
    setCandidateSnapshotId(null);
    setCandidateSnapshotVersion(null);
    setValidationResult(null);
    setDeploymentPercent(0);

    const intentForRun = intent.trim() || 'Initialize baseline policy snapshot for governed runtime operations';
    setRunIntent(intentForRun);

    setIsEvolving(true);
    addLog('EVOLUTION', `Run ${newRunId}: Initializing first snapshot from scratch...`, 'INFO', newRunId);

    try {
      // Create a minimal base snapshot for initialization
      const initialVersion = `v1.0.0-${Date.now()}`;
      const initialSnapshot: Snapshot = {
        id: 0, // Temporary, will be replaced when saved to DB
        version: initialVersion,
        env: PkgEnv.PROD,
        stage: 'DRAFT',
        isActive: false,
        checksum: '0'.repeat(64),
        sizeBytes: 0,
        createdAt: new Date().toISOString(),
        notes: buildSnapshotNotes({
          freeformNotes: `Initial snapshot: ${intentForRun}`,
          artifactFormat: 'native',
          runId: newRunId,
        }),
        artifactFormat: 'native'
      };

      // Generate evolution plan without a base (use empty version)
      const prop = await generateEvolutionPlan({
        intent: intentForRun,
        currentVersion: 'v0.0.0-initial',
        contextFacts: [],
        subtaskTypes: subtaskTypes,
      });
      
      if (!prop) {
        addLog('EVOLUTION', 'Failed to generate initial proposal. Check API Key.', 'ERROR', newRunId);
        setIsEvolving(false);
        return;
      }

      // Create proposal with initial snapshot as base
      const proposal: EvolutionProposal = {
        ...prop,
        id: `prop-${Date.now()}`,
        baseSnapshotId: 0, // No base snapshot for initialization
        status: 'PENDING',
        generatedAt: new Date().toISOString(),
        newVersion: ensureUniqueSnapshotVersion(prop.newVersion || initialVersion, snapshots)
      };

      // Build snapshot from proposal with empty base rules (no existing rules to copy)
      const { snapshot, newRules } = buildSnapshotFromProposal(proposal, []);
      const repairedInitialRules = repairRulesForPersistence(
        newRules,
        resolveUsableSubtaskTypes(subtaskTypes, proposal.baseSnapshotId)
      );
      const initialRuleIssues = collectRulePersistenceIssues(
        repairedInitialRules,
        resolveUsableSubtaskTypes(subtaskTypes, proposal.baseSnapshotId)
      );
      if (initialRuleIssues.length > 0) {
        throw new Error(
          `Initial proposal is incomplete and cannot be built: ${initialRuleIssues.slice(0, 3).join(' ')}${
            initialRuleIssues.length > 3 ? ` (+${initialRuleIssues.length - 3} more)` : ''
          }`
        );
      }

      // Save snapshot to database
      addLog('EVOLUTION', 'Saving initial snapshot to database...', 'INFO', newRunId);
      const savedSnapshot = await createSnapshot({
        version: snapshot.version,
        env: snapshot.env,
        checksum: snapshot.checksum,
        sizeBytes: snapshot.sizeBytes,
        notes: buildSnapshotNotes({
          freeformNotes: snapshot.notes,
          artifactFormat: 'native',
          runId: newRunId,
        }),
        isActive: false,
      });

      if (!savedSnapshot.id || savedSnapshot.id < 1) {
        throw new Error('Initial snapshot created but did not receive a valid database ID');
      }

      addLog('EVOLUTION', `Initial snapshot saved (id=${savedSnapshot.id}).`, 'SUCCESS', newRunId);

      const snapshotWithDbId: Snapshot = {
        ...snapshot,
        id: savedSnapshot.id,
        checksum: savedSnapshot.checksum,
        sizeBytes: savedSnapshot.sizeBytes,
        createdAt: savedSnapshot.createdAt,
      };
      setCandidateSnapshotId(savedSnapshot.id);
      setCandidateSnapshotVersion(savedSnapshot.version);

      const clonedInitialSubtasks = await cloneSubtaskTypes({
        sourceSnapshotId: proposal.baseSnapshotId,
        targetSnapshotId: savedSnapshot.id,
        existingSubtaskTypes: subtaskTypes,
      });
      if (clonedInitialSubtasks.length > 0) {
        setSubtaskTypes(prev => [...prev, ...clonedInitialSubtasks]);
      }

      // Attach saved snapshot id to all rules
      const rulesForDb = repairedInitialRules.map(r => ({
        ...r,
        snapshotId: savedSnapshot.id,
      }));

      // Persist rules to database
      if (persistRulesOnBuild && rulesForDb.length > 0) {
        addLog('EVOLUTION', `Persisting ${rulesForDb.length} initial rule(s) into DB...`, 'INFO', newRunId);
        
        for (const r of rulesForDb) {
          const ruleSource = ruleSourceFromIntentOrStructure(intentForRun, r);
          await createRule({
            snapshotId: savedSnapshot.id,
            ruleName: r.ruleName,
            priority: r.priority,
            engine: r.engine,
            ruleSource,
            metadata: r.metadata ?? null,
            conditions: r.conditions || [],
            emissions: (r.emissions || []).map(e => ({
              subtaskTypeId: e.subtaskTypeId || '',
              relationshipType: e.relationshipType,
              params: e.params || {}
            }))
          });
        }
        addLog('EVOLUTION', `Persisted ${rulesForDb.length} rule(s).`, 'SUCCESS', newRunId);
      }

      setDraftSnapshot(snapshotWithDbId);
      setDraftRules(rulesForDb);
      setProposal(proposal);
      
      // Reload snapshots to include the new one
      const updatedSnaps = await getSnapshots();
      setSnapshots(updatedSnaps);
      setBaseSnapshotId(savedSnapshot.id);

      addLog('EVOLUTION', `Initial snapshot created: ${snapshot.version}`, 'SUCCESS', newRunId);
    } catch (e: any) {
      addLog('EVOLUTION', `Initialization error: ${e?.message || String(e)}`, 'ERROR', newRunId);
      console.error('Initialization error:', e);
    } finally {
      if (pipelineIdRef.current === newRunId) setIsEvolving(false);
    }
  };

  // -------- Step 1: Evolution (Zone-Aware) --------
  const handleEvolution = async () => {
    if (loadingData) return;

    // new run starts here
    const newRunId = mkId();
    setPipelineId(newRunId);
    pipelineIdRef.current = newRunId;

    setProposal(null);
    setDraftSnapshot(null);
    setDraftRules([]);
    setCandidateSnapshotId(null);
    setCandidateSnapshotVersion(null);
    setValidationResult(null);
    setDeploymentPercent(0);

    const intentForRun = intent.trim();
    setRunIntent(intentForRun);

    setIsEvolving(true);
    addLog('EVOLUTION', `Run ${newRunId}: analyzing intent for zone=${selectedZone} + historical failures...`, 'INFO', newRunId);

    const base = pickBaseSnapshot(snapshots, baseSnapshotId);
    if (!base) {
      addLog('EVOLUTION', 'No snapshots available. Use "Initialize First Snapshot" to create one.', 'ERROR', newRunId);
      setIsEvolving(false);
      return;
    }

    addLog('EVOLUTION', `Base snapshot: ${base.version} (id=${base.id}, env=${base.env}, active=${base.isActive})`, 'INFO', newRunId);
    addLog('EVOLUTION', `Zone context: ${selectedZone} - Pulling zone-specific facts...`, 'INFO', newRunId);

    try {
      // Zone-aware evolution: Include zone context in intent
      const zoneContextualIntent = `[Zone: ${selectedZone}] ${intentForRun}`;
      const prop = await proposeEvolution(zoneContextualIntent, base, {
        existingRules: rules.filter(rule => rule.snapshotId === base.id),
        subtaskTypes: resolveUsableSubtaskTypes(subtaskTypes, base.id),
      });

      // ignore stale results
      if (pipelineIdRef.current !== newRunId) return;

      if (prop) {
        prop.newVersion = ensureUniqueSnapshotVersion(prop.newVersion, snapshots);
        setProposal(prop);
        addLog('EVOLUTION', `Generated proposal: ${prop.newVersion} (zone=${selectedZone})`, 'SUCCESS', newRunId);
      } else {
        addLog('EVOLUTION', 'Failed to generate proposal. Check API Key.', 'ERROR', newRunId);
      }
    } catch (e: any) {
      addLog('EVOLUTION', `Evolution error: ${e?.message || String(e)}`, 'ERROR', newRunId);
    } finally {
      if (pipelineIdRef.current === newRunId) setIsEvolving(false);
    }
  };

  // -------- Step 2: Build (create snapshot + optionally persist rules) --------
  const handleBuild = async () => {
    if (!proposal) return;

    const runId = pipelineIdRef.current;
    const buildBaseSnapshot = pickBaseSnapshot(snapshots, proposal.baseSnapshotId ?? baseSnapshotId);
    setIsBuilding(true);
    addLog('EVOLUTION', `Run ${runId}: building draft snapshot (Native)...`, 'INFO', runId);

    try {
      const { snapshot, newRules } = buildSnapshotFromProposal(proposal, rules);
      const baseSnapshotSubtaskTypes = resolveUsableSubtaskTypes(subtaskTypes, proposal.baseSnapshotId);
      const repairedRules = repairRulesForPersistence(newRules, baseSnapshotSubtaskTypes);
      const preflightIssues = collectRulePersistenceIssues(repairedRules, baseSnapshotSubtaskTypes);
      if (preflightIssues.length > 0) {
        throw new Error(
          `Generated proposal is incomplete and cannot be built: ${preflightIssues.slice(0, 3).join(' ')}${
            preflightIssues.length > 3 ? ` (+${preflightIssues.length - 3} more)` : ''
          }`
        );
      }

      // Save snapshot to database
      addLog('EVOLUTION', 'Saving snapshot to database...', 'INFO', runId);
      const savedSnapshot = await createSnapshot({
        version: snapshot.version,
        env: snapshot.env,
        checksum: snapshot.checksum,
        sizeBytes: snapshot.sizeBytes,
        notes: buildSnapshotNotes({
          freeformNotes: snapshot.notes,
          baseSnapshot: buildBaseSnapshot,
          artifactFormat: 'native',
          runId,
        }),
        isActive: false,
      });

      if (!savedSnapshot.id || savedSnapshot.id < 1) {
        throw new Error('Snapshot created but did not receive a valid database ID');
      }

      addLog('EVOLUTION', `Snapshot saved (id=${savedSnapshot.id}).`, 'SUCCESS', runId);

      const snapshotWithDbId: Snapshot = {
        ...snapshot,
        id: savedSnapshot.id,
        checksum: savedSnapshot.checksum,
        sizeBytes: savedSnapshot.sizeBytes,
        createdAt: savedSnapshot.createdAt,
        // keep artifactFormat if buildSnapshotFromProposal sets it
      };
      setCandidateSnapshotId(savedSnapshot.id);
      setCandidateSnapshotVersion(savedSnapshot.version);

      const clonedSubtasks = await cloneSubtaskTypes({
        sourceSnapshotId: proposal.baseSnapshotId,
        targetSnapshotId: savedSnapshot.id,
        existingSubtaskTypes: subtaskTypes,
      });
      if (clonedSubtasks.length > 0) {
        setSubtaskTypes(prev => [...prev, ...clonedSubtasks]);
      }

      // attach saved snapshot id to all rules
      const rulesForDb = repairedRules.map(r => ({
        ...r,
        snapshotId: savedSnapshot.id,
      }));

      // OPTIONAL but recommended: persist rules now, with stable ruleSource derived from runIntent
      if (persistRulesOnBuild) {
        addLog('EVOLUTION', `Persisting ${rulesForDb.length} rule(s) into DB...`, 'INFO', runId);

        for (const r of rulesForDb) {
          const ruleSource = ruleSourceFromIntentOrStructure(runIntent, r);

          // Map emissions: convert subtaskName to subtaskTypeId if needed
          const mappedEmissions = r.emissions.map((e, idx) => {
            let subtaskTypeId = e.subtaskTypeId;

            // If subtaskTypeId is missing but subtaskName exists, look it up
            if (!subtaskTypeId && e.subtaskName) {
              const found = baseSnapshotSubtaskTypes.find(st => st.name === e.subtaskName);
              if (found) {
                subtaskTypeId = found.id;
              } else {
                throw new Error(
                  `Rule "${r.ruleName}", emission ${idx + 1}: Could not find subtask type "${e.subtaskName}" for snapshot ${savedSnapshot.id}.`
                );
              }
            }

            if (!subtaskTypeId) {
              throw new Error(`Rule "${r.ruleName}", emission ${idx + 1}: subtaskTypeId is required.`);
            }

            return {
              subtaskTypeId,
              relationshipType: e.relationshipType,
              params: e.params,
            };
          });

          await createRule({
            snapshotId: savedSnapshot.id,
            ruleName: r.ruleName,
            priority: r.priority,
            engine: r.engine,
            ruleSource, // ✅ prevents prompt mismatch / empty source
            metadata: r.metadata ?? null,
            conditions: r.conditions.map(c => ({
              conditionType: c.conditionType,
              conditionKey: c.conditionKey,
              operator: c.operator,
              value: c.value,
            })),
            emissions: mappedEmissions,
          });
        }

        addLog('EVOLUTION', `Rules persisted successfully (snapshotId=${savedSnapshot.id}).`, 'SUCCESS', runId);
      } else {
        addLog('EVOLUTION', 'Rules kept in-memory (persistRulesOnBuild=false).', 'WARN', runId);
      }

      setDraftSnapshot(snapshotWithDbId);
      setDraftRules(rulesForDb);
      setValidationResult(null);

      addLog(
        'EVOLUTION',
        `Snapshot ${savedSnapshot.version} built in NATIVE format. Size: ${savedSnapshot.sizeBytes} bytes.`,
        'SUCCESS',
        runId
      );
    } catch (error: any) {
      setDraftSnapshot(null);
      setDraftRules([]);
      setCandidateSnapshotId(null);
      setCandidateSnapshotVersion(null);
      addLog('EVOLUTION', `Build failed: ${error?.message || String(error)}`, 'ERROR', runId);
    } finally {
      setIsBuilding(false);
    }
  };

  // -------- Step 3: Compile Rules (SeedCore API) --------
  const handleCompileRules = async (snapshotId?: number) => {
    const targetSnapshotId = snapshotId || draftSnapshot?.id;
    if (!targetSnapshotId || targetSnapshotId < 1) {
      const runId = pipelineIdRef.current;
      addLog('EVOLUTION', 'Cannot compile: Snapshot ID is required.', 'ERROR', runId);
      return;
    }

    setIsCompiling(true);
    const runId = pipelineIdRef.current;
    addLog('EVOLUTION', `Run ${runId}: Compiling rules for snapshot id=${targetSnapshotId} using SeedCore API...`, 'INFO', runId);

    try {
      const compileResult = await seedcoreService.compilePKGRules(targetSnapshotId, {
        entrypoint: 'data.pkg.result'
      });

      // Safely extract hash/checksum from response (handle different field names)
      const artifactHash = compileResult.artifact_hash || 
                         compileResult.sha256 || 
                         compileResult.checksum || 
                         compileResult.bundle_sha256 || 
                         'unknown';
      
      const shortHash = artifactHash !== 'unknown' 
        ? `${artifactHash.substring(0, 16)}...` 
        : 'N/A';

      addLog(
        'EVOLUTION',
        `Compiled ${compileResult.compiled_count} rules. Artifact hash: ${shortHash}`,
        'SUCCESS',
        runId
      );

      // Reload snapshots to get updated checksum/size if compilation updated them
      try {
        clearCache();
        const updatedSnaps = await getSnapshots();
        setSnapshots(updatedSnaps);
        
        // Update draftSnapshot if it's the one we compiled
        if (draftSnapshot && draftSnapshot.id === targetSnapshotId) {
          const reloadedSnapshot = updatedSnaps.find(s => s.id === targetSnapshotId);
          if (reloadedSnapshot) {
            setDraftSnapshot(reloadedSnapshot);
          }
        }
      } catch (reloadError) {
        console.warn('Failed to reload snapshots after compilation:', reloadError);
      }
    } catch (error: any) {
      let errorMessage = `Compilation failed: ${error?.message || String(error)}`;
      
      // Provide helpful error messages based on error type
      if (error.message?.includes('SNAPSHOT_NOT_FOUND')) {
        errorMessage = `Snapshot ${targetSnapshotId} not found in SeedCore backend`;
      } else if (error.message?.includes('COMPILATION_FAILED')) {
        errorMessage = 'WASM compilation failed - check OPA installation and SeedCore backend logs';
      } else if (error.message?.includes('SERVER_NOT_RUNNING')) {
        errorMessage = 'SeedCore backend is not running - ensure backend is started';
      }
      
      addLog('EVOLUTION', errorMessage, 'ERROR', runId);
      console.error('Compile error details:', { snapshotId: targetSnapshotId, error });
    } finally {
      setIsCompiling(false);
    }
  };

  const isSnapshotWasmReady = (snapshot?: Snapshot | null) =>
    Boolean(snapshot && snapshot.artifactFormat === 'wasm' && snapshot.artifactReady);

  // -------- Step 3: Promote --------
  const handlePromoteToWasm = async () => {
    if (!draftSnapshot) return;
    const runId = pipelineIdRef.current;

    if (!draftSnapshot.id || draftSnapshot.id < 1) {
      addLog('EVOLUTION', 'Cannot promote: Snapshot must be saved to DB first.', 'ERROR', runId);
      return;
    }

    setIsPromoting(true);
    const nativeSize = draftSnapshot.sizeBytes;
    const isRepromotion = draftSnapshot.artifactFormat === 'wasm';
    addLog('EVOLUTION', `Run ${runId}: ${isRepromotion ? 'repromoting' : 'promoting'} snapshot id=${draftSnapshot.id} to WASM...`, 'INFO', runId);

    try {
      const snapshotRules = draftRules.length > 0 ? draftRules : rules.filter(r => r.snapshotId === draftSnapshot.id);
      const promoted = await promoteToWasm(draftSnapshot, snapshotRules);

      setDraftSnapshot(promoted);
      addLog(
        'EVOLUTION',
        `${isRepromotion ? 'Repromoted' : 'Promoted'} to WASM. ${nativeSize.toLocaleString()} → ${promoted.sizeBytes.toLocaleString()} bytes.`,
        'SUCCESS',
        runId
      );
      
      // Reload snapshots from database to ensure artifactFormat is persisted and reflected in state
      try {
        // Clear cache to force fresh data from database
        clearCache();
        const updatedSnaps = await getSnapshots();
        setSnapshots(updatedSnaps);
        
        // Update draftSnapshot with the reloaded version to ensure consistency
        const reloadedSnapshot = updatedSnaps.find(s => s.id === promoted.id);
        if (reloadedSnapshot) {
          setDraftSnapshot(reloadedSnapshot);
        } else {
          // Fallback: use promoted snapshot if reloaded version not found
          setDraftSnapshot(promoted);
        }
      } catch (reloadError) {
        console.warn('Failed to reload snapshots after promotion:', reloadError);
        // Non-fatal: use promoted snapshot directly
        setDraftSnapshot(promoted);
      }
    } catch (error: any) {
      addLog('EVOLUTION', `Promote failed: ${error?.message || String(error)}`, 'ERROR', runId);
      console.error('Promote error details:', { snapshotId: draftSnapshot.id, error });
    } finally {
      setIsPromoting(false);
    }
  };

  // -------- Step 4: Validate (Digital Twin Critic Integration) --------
  const handleValidate = async () => {
    const runId = pipelineIdRef.current;

    if (!isSnapshotWasmReady(draftSnapshot)) {
      addLog('VALIDATION', 'Cannot validate: snapshot must be fully compiled to WASM first.', 'ERROR', runId);
      return;
    }

    setIsValidating(true);
    addLog('VALIDATION', `Run ${runId}: initializing Digital Twin Critic (hardware constraint validation)...`, 'INFO', runId);

    try {
      const snapshotRules = draftRules.length > 0 ? draftRules : rules.filter(r => r.snapshotId === draftSnapshot.id);
      
      // Integrate Digital Twin Critic for hardware constraint validation
      addLog('VALIDATION', `Checking hardware constraints (HVAC limits, elevator capacity, safety protocols)...`, 'INFO', runId);
      
      const digitalTwinResult = await validateRulesWithDigitalTwin(snapshotRules, draftSnapshot);
      
      // Also run standard validation for consistency checks
      const standardResult = await runValidationAgent(draftSnapshot.id, snapshotRules);
      
      // Normalize Digital Twin pass/fail locally to avoid false negatives from non-critical warnings.
      const criticalHardwareIssues = digitalTwinResult.issues.filter(i => i.severity === 'critical');
      const warningHardwareIssues = digitalTwinResult.issues.filter(i => i.severity === 'warning');
      const digitalTwinPassesGate = criticalHardwareIssues.length === 0;
      
      // Combine results: standard validation must pass and there must be no critical hardware issues.
      const combinedSuccess = digitalTwinPassesGate && standardResult.success;
      
      // Enhanced validation result with Digital Twin details
      const enhancedResult: ValidationRun = {
        ...standardResult,
        success: combinedSuccess,
        report: {
          ...standardResult.report,
          simulationScore: combinedSuccess ? (digitalTwinResult.validationScore * 100) : 0,
          conflicts: [
            ...(standardResult.report?.conflicts || []),
            ...(criticalHardwareIssues.map(i => 
              `[Hardware Constraint] ${i.ruleName || 'Unknown'}: ${i.issue}`
            ))
          ],
          // Digital Twin Critic fields (extended ValidationRun.report)
          digitalTwinIssues: digitalTwinResult.issues,
          hardwareConstraints: digitalTwinResult.hardwareConstraints,
        } as ValidationRun['report']
      };

      setValidationResult(enhancedResult);

      if (combinedSuccess) {
        addLog('VALIDATION', `Validation PASSED. Digital Twin Score: ${(digitalTwinResult.validationScore * 100).toFixed(1)}%`, 'SUCCESS', runId);
        addLog('VALIDATION', `Hardware constraints validated: All rules compatible with physical systems.`, 'SUCCESS', runId);
        if (warningHardwareIssues.length > 0) {
          addLog('VALIDATION', `Non-blocking hardware warnings: ${warningHardwareIssues.length}. Review recommendations before production rollout.`, 'WARN', runId);
        }
      } else {
        addLog('VALIDATION', `Validation FAILED. Critical hardware issues: ${criticalHardwareIssues.length}, Conflicts: ${standardResult.report?.conflicts?.length ?? 0}`, 'ERROR', runId);
        if (criticalHardwareIssues.length > 0) {
          addLog('VALIDATION', `Hardware constraint violations detected. Review Digital Twin report before deployment.`, 'ERROR', runId);
        }
      }
    } catch (e: any) {
      addLog('VALIDATION', `Validation error: ${e?.message || String(e)}`, 'ERROR', runId);
    } finally {
      setIsValidating(false);
    }
  };

  // -------- Step 5: Deploy --------
  const handleDeployStep = async () => {
    const runId = pipelineIdRef.current;
    
    // Determine which snapshot to deploy: selected existing snapshot OR draft snapshot
    const snapshotToDeploy = selectedSnapshotForDeployment 
      ? snapshots.find(s => s.id === selectedSnapshotForDeployment)
      : draftSnapshot;
    
    if (!snapshotToDeploy || !snapshotToDeploy.id) {
      addLog('DEPLOYMENT', 'Cannot deploy: No snapshot available. Select an existing snapshot or complete Evolution → Build.', 'ERROR', runId);
      return;
    }
    
    // For existing snapshots, check if they're WASM format (required for deployment)
    // If not WASM, automatically promote it first (for first-time deployment convenience)
    let finalSnapshotToDeploy = snapshotToDeploy;
    
    if (selectedSnapshotForDeployment && !isSnapshotWasmReady(snapshotToDeploy)) {
      // Check if this is a first-time deployment scenario (no deployments exist)
      const isFirstTimeDeployment = deployments.length === 0;
      
      if (isFirstTimeDeployment) {
        // Automatically promote to WASM for first-time deployment
        addLog('DEPLOYMENT', `Promoting snapshot ${snapshotToDeploy.version} to WASM format before deployment...`, 'INFO', runId);
        
        try {
          // Load rules for this snapshot
          const snapshotRules = rules.filter(r => r.snapshotId === snapshotToDeploy.id);
          
          // Promote to WASM
          const promoted = await promoteToWasm(snapshotToDeploy, snapshotRules);
          
          // Reload snapshots from database to ensure artifactFormat is persisted and reflected in state
          try {
            // Clear cache to force fresh data from database
            clearCache();
            const updatedSnaps = await getSnapshots();
            setSnapshots(updatedSnaps);
            
            // Find the reloaded promoted snapshot
            const reloadedPromoted = updatedSnaps.find(s => s.id === promoted.id);
            if (reloadedPromoted) {
              setDraftSnapshot(reloadedPromoted);
              setSelectedSnapshotForDeployment(reloadedPromoted.id);
              finalSnapshotToDeploy = reloadedPromoted;
            } else {
              // Fallback to promoted snapshot if reload fails
              setSnapshots(prev => prev.map(s => s.id === snapshotToDeploy.id ? promoted : s));
              setDraftSnapshot(promoted);
              setSelectedSnapshotForDeployment(promoted.id);
              finalSnapshotToDeploy = promoted;
            }
          } catch (reloadError) {
            console.warn('Failed to reload snapshots after automatic promotion:', reloadError);
            // Fallback: use promoted snapshot directly
            setSnapshots(prev => prev.map(s => s.id === snapshotToDeploy.id ? promoted : s));
            setDraftSnapshot(promoted);
            setSelectedSnapshotForDeployment(promoted.id);
            finalSnapshotToDeploy = promoted;
          }
          
          addLog('DEPLOYMENT', `Successfully promoted to WASM. Proceeding with deployment...`, 'SUCCESS', runId);
        } catch (error: any) {
          addLog('DEPLOYMENT', `Failed to promote snapshot: ${error?.message || String(error)}. Please promote manually.`, 'ERROR', runId);
          return;
        }
      } else {
        // Not first-time or not native format - require manual promotion
        addLog('DEPLOYMENT', `Cannot deploy: Snapshot ${snapshotToDeploy.version} is not backed by a compiled WASM artifact yet. Use the "Promote to WASM" button first.`, 'ERROR', runId);
        return;
      }
    }
    
    // Final check: ensure snapshot is backed by a real artifact
    if (!isSnapshotWasmReady(finalSnapshotToDeploy)) {
      addLog('DEPLOYMENT', `Cannot deploy: Snapshot must have a compiled WASM artifact.`, 'ERROR', runId);
      return;
    }
    
    const nextStep = calculateCanaryStep(deploymentPercent);
    
    // Fix 1: Guard against no-op deploys
    if (nextStep === deploymentPercent) {
      addLog(
        'DEPLOYMENT',
        `Run ${runId}: Canary rollout already at ${deploymentPercent}%. No change applied.`,
        'WARN',
        runId
      );
      return;
    }
    
    setDeploymentPercent(nextStep);
    
    try {
      // Persist deployment to database with selected target and temporal awareness
      const deploymentResult = await createOrUpdateDeployment({
        snapshotId: finalSnapshotToDeploy.id,
        target: deploymentTarget, // Use selected deployment target
        region: 'global',
        percent: nextStep,
        isActive: true,
        activatedBy: 'control-plane',
        deploymentKey: `control-plane-${deploymentTarget}-${Date.now()}`,
        isRollback: false,
      });
      
      // Log temporal awareness if duration is set
      if (deploymentDuration && deploymentExpiry) {
        addLog('DEPLOYMENT', `Temporary deployment: Will auto-rollback at ${new Date(deploymentExpiry).toLocaleString()}`, 'INFO', runId);
      }
      
      // Check for server-side no-op detection
      if (deploymentResult.current.noop) {
        addLog(
          'DEPLOYMENT',
          `Run ${runId}: Deployment no-op - already at ${nextStep}%`,
          'WARN',
          runId
        );
        return;
      }
      
      const prevPercent = deploymentResult.previous?.percent ?? deploymentPercent;
      const deploymentMsg = prevPercent > 0 && prevPercent !== nextStep
        ? `Run ${runId}: canary rollout increased from ${prevPercent}% to ${nextStep}% (deployment persisted)`
        : `Run ${runId}: canary rollout set to ${nextStep}% (deployment persisted)`;
      addLog('DEPLOYMENT', deploymentMsg, 'WARN', runId);

      if (nextStep === 100) {
        addLog('DEPLOYMENT', `Run ${runId}: full rollout complete. Snapshot ${snapshotToDeploy.version} deployed to PROD.`, 'SUCCESS', runId);
      }

      let runtimeConfirmed = false;
      try {
        await seedcoreService.reloadPKG();
        const pkgStatus = await seedcoreService.getPKGStatus();
        const runtimeId = pkgStatus?.snapshot_id ?? null;
        const runtimeVersion = pkgStatus?.version ?? pkgStatus?.snapshot_version ?? null;
        setRuntimeActiveSnapshotId(runtimeId);
        setRuntimeActiveSnapshotVersion(runtimeVersion);
        runtimeConfirmed = runtimeId === finalSnapshotToDeploy.id;

        if (runtimeConfirmed) {
          addLog(
            'DEPLOYMENT',
            `Run ${runId}: runtime confirmed active on snapshot ${runtimeVersion || finalSnapshotToDeploy.version} (id=${runtimeId}).`,
            'SUCCESS',
            runId
          );
        } else {
          addLog(
            'DEPLOYMENT',
            `Run ${runId}: deployment persisted, but runtime is still serving snapshot id=${runtimeId ?? 'unknown'}${runtimeVersion ? ` (${runtimeVersion})` : ''}.`,
            'ERROR',
            runId
          );
        }
      } catch (runtimeError: any) {
        addLog(
          'DEPLOYMENT',
          `Run ${runId}: deployment persisted, but runtime confirmation failed: ${runtimeError?.message || String(runtimeError)}`,
          'ERROR',
          runId
        );
      }

      // Reload deployments and snapshots to show the newly created deployment and updated active snapshot
      try {
        const [snaps, deps, events] = await Promise.all([
          getSnapshots(), // Reload snapshots to get updated is_active status
          getDeployments(false),
          getRolloutEvents({ limit: 10 }).catch(() => []),
        ]);
        setSnapshots(snaps);
        setDeployments(deps || []);
        setRolloutEvents(events || []);
        
        // Update activeSnapshotId if the deployed snapshot became active
        const newActiveSnapshot = runtimeConfirmed
          ? snaps.find(s => s.id === finalSnapshotToDeploy.id)
          : snaps.find(s => s.isActive && s.env === PkgEnv.PROD);
        if (runtimeConfirmed && newActiveSnapshot && newActiveSnapshot.id === finalSnapshotToDeploy.id) {
          // Clear selected snapshot since it's now active
          setSelectedSnapshotForDeployment(null);
        }
      } catch (reloadError) {
        console.warn('Failed to reload data after deployment:', reloadError);
      }
    } catch (error: any) {
      addLog('DEPLOYMENT', `Failed to persist deployment: ${error?.message || String(error)}`, 'ERROR', runId);
      console.error('Deployment error:', error);
      // Revert UI state if persistence fails
      setDeploymentPercent(deploymentPercent);
    }
  };

  return (
    <div className="h-full flex flex-col space-y-4">
      
      {/* Top Status Bar */}
      <div className="bg-slate-900 text-white p-4 rounded-lg flex items-center justify-between shadow-md">
        <div className="flex items-center space-x-3">
          <Bot className="text-indigo-400 h-6 w-6" />
          <div className="flex flex-col">
            <span className="font-semibold text-lg">Autonomous Control Plane</span>
            <span className="text-xs text-slate-400 font-mono">run={pipelineId}</span>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={resetPipeline}
            className="flex items-center text-xs px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700"
            title="Reset pipeline state"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </button>
        </div>
      </div>
      {loadingData && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">
          Loading snapshots and rules from the proxy server...
        </div>
      )}

      {/* Controls: Base snapshot + persist rules + Zone selector */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="text-xs text-gray-500">Base Snapshot (PROD):</div>
          <select
            value={baseSnapshotId ?? ''}
            onChange={(e) => setBaseSnapshotId(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            {prodSnapshots.map(s => (
              <option key={s.id} value={s.id}>
                {s.version} {s.isActive ? '★' : ''} · {s.stage} · id={s.id}
              </option>
            ))}
          </select>
          {baseSnapshot && (
            <div className="flex items-center gap-2">
              <div className="text-xs text-gray-500">
                Using: <span className="font-mono">{baseSnapshot.version}</span>
              </div>
            </div>
          )}
          {runtimeActiveSnapshotId && (
            <div className="text-xs text-emerald-700">
              Runtime Active: <span className="font-mono">{runtimeActiveSnapshotVersion || `id=${runtimeActiveSnapshotId}`}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-500">Zone:</div>
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="INGRESS">Event Ingress</option>
              <option value="VAULT">Vault Control</option>
              <option value="TRANSFER">Transfer Corridor</option>
              <option value="QUARANTINE">Quarantine Bay</option>
              <option value="INFRASTRUCTURE">Building Systems</option>
            </select>
          </div>
          
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={persistRulesOnBuild}
              onChange={(e) => setPersistRulesOnBuild(e.target.checked)}
            />
            Persist rules to DB during build (recommended)
          </label>
        </div>
      </div>

      {/* Main Pipeline Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        
        {/* COL 1: Evolution (Input -> Proposal) */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col">
          <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-700 flex items-center"><GitMerge className="w-4 h-4 mr-2 text-indigo-500"/> Policy Evolution</h3>
            <span className="text-xs font-mono bg-gray-200 px-2 py-1 rounded">AGENT-1</span>
          </div>
          <div className="p-4 flex-1 overflow-y-auto space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Policy Upgrade Intent / Incident Log
                <span className="ml-2 text-xs font-normal text-gray-500">(Zone: {selectedZone})</span>
              </label>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-gray-500">
                  Describe the failure, the target controls, and the graph/runtime behavior you want the next snapshot to enforce.
                </div>
                <button
                  type="button"
                  onClick={() => hydrateIntentFromMemory(selectedZone, true)}
                  disabled={loadingData || isHydratingIntent || isEvolving}
                  className="inline-flex items-center px-2 py-1 text-xs font-medium rounded border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {isHydratingIntent ? <Loader2 className="animate-spin mr-1 h-3 w-3"/> : <Radio className="mr-1 h-3 w-3"/>}
                  Load Recent Incidents
                </button>
              </div>
              <textarea
                className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm border p-3 h-32"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder={`For ${selectedZone}, describe: incident, affected assets/routes, required deny or quarantine behavior, approvals/evidence needed, and whether authz graph manifests must be added.`}
              />
              <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Strong prompts usually include: scope and zone, actors and resources, the unsafe path to block, the exact allow/deny/quarantine behavior to add, and any graph-manifest or audit expectations.
              </div>
              <div className="text-xs text-gray-500 mt-2">
                Run intent snapshot: <span className="font-mono">{runIntent ? safeQuote(runIntent, 80) : '(none yet)'}</span>
              </div>
              <div className="text-xs text-amber-600 mt-1">
                ℹ️ Zone-aware: Evolution Agent will pull zone-specific facts for {selectedZone} and try to preserve PDP parity, audit receipts, and deployability in the next snapshot.
              </div>
            </div>
            
            {snapshots.length === 0 ? (
              <div className="space-y-3">
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800">
                  <strong>No snapshots found.</strong> Initialize the first snapshot to get started.
                </div>
                <button 
                  onClick={handleInitializeFirstSnapshot}
                  disabled={loadingData || isEvolving}
                  className={`w-full flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${isEvolving ? 'bg-gray-400 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-700'}`}
                >
                  {isEvolving ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <Bot className="mr-2 h-4 w-4"/>}
                  Initialize First Snapshot
                </button>
              </div>
            ) : deployments.length === 0 ? (
              <div className="space-y-3">
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-800">
                  <strong>First-time deployment detected.</strong> Use the "Deploy Existing Snapshot" option in the Validation & Deployment column to deploy snapshot_id=1.
                </div>
                <div className="text-xs text-gray-500 text-center">
                  Evolution → Build creates new snapshots. For first-time, deploy the initialized snapshot instead.
                </div>
              </div>
            ) : (
              <button 
                onClick={handleEvolution}
                disabled={loadingData || isEvolving || !!proposal}
                className={`w-full flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${isEvolving || !!proposal ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
              >
                {isEvolving ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <Bot className="mr-2 h-4 w-4"/>}
                Analyze & Propose ({selectedZone})
              </button>
            )}

            {proposal && (
              <div className="mt-4 bg-indigo-50 border border-indigo-100 rounded-md p-4">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-bold text-indigo-800 uppercase">PROPOSAL GENERATED</span>
                  <span className="text-xs font-mono text-gray-500">{proposal.generatedAt}</span>
                </div>
                <h4 className="font-bold text-gray-900">{proposal.newVersion}</h4>
                <p className="text-sm text-gray-600 mt-1 mb-3">{proposal.reason}</p>
                <div className="space-y-2">
                   {(proposal.changes || []).map((c, i) => (
                     <div key={i} className="text-xs bg-white p-2 rounded border border-indigo-100">
                       <span className={`font-bold mr-2 ${c.action === 'DELETE' ? 'text-red-600' : 'text-green-600'}`}>{c.action}</span>
                       <span className="text-gray-500">{c.rationale}</span>
                     </div>
                   ))}
                </div>
                <div className="mt-4 flex space-x-2">
                   <button 
                     onClick={handleBuild}
                     disabled={!!draftSnapshot || isBuilding || !proposal}
                     className="flex-1 bg-indigo-600 text-white text-xs py-2 rounded hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
                   >
                     {isBuilding ? <Loader2 className="animate-spin mr-2 h-3 w-3"/> : null}
                     Approve & Build (Native)
                   </button>
                   <button
                    onClick={() => {
                      setProposal(null);
                      setDraftSnapshot(null);
                      setDraftRules([]);
                      setCandidateSnapshotId(null);
                      setCandidateSnapshotVersion(null);
                      setValidationResult(null);
                      setDeploymentPercent(0);
                      addLog('EVOLUTION', 'Proposal rejected; pipeline cleared (run intent preserved).', 'WARN');
                    }}
                    className="px-3 py-2 bg-white border border-gray-300 text-gray-700 text-xs rounded hover:bg-gray-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* COL 2: Promotion Pipeline (Native → WASM) */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col">
           <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-700 flex items-center"><GitMerge className="w-4 h-4 mr-2 text-purple-500"/> Promotion Pipeline</h3>
            <span className="text-xs font-mono bg-gray-200 px-2 py-1 rounded">AGENT-2</span>
          </div>
          <div className="p-4 flex-1 flex flex-col items-center justify-center space-y-6">
             {!draftSnapshot && (
               <div className="text-center text-gray-400">
                 <GitMerge className="h-12 w-12 mx-auto mb-2 opacity-20" />
                 <p className="text-sm">Waiting for built snapshot...</p>
               </div>
             )}

             {draftSnapshot && (
               <div className="w-full space-y-6">
                  {/* Snapshot Info */}
                  <div className={`border p-4 rounded-lg text-center ${
                    (draftSnapshot.artifactFormat === 'native' || !draftSnapshot.artifactFormat)
                      ? 'bg-amber-50 border-amber-200' 
                      : 'bg-purple-50 border-purple-200'
                  }`}>
                    <div className="text-xs font-bold uppercase mb-2">
                      {(draftSnapshot.artifactFormat === 'native' || !draftSnapshot.artifactFormat) ? 'NATIVE SNAPSHOT' : 'WASM SNAPSHOT'}
                    </div>
                    <div className="font-mono text-lg font-bold text-gray-900">{candidateSnapshotVersion || draftSnapshot.version}</div>
                    <div className="text-xs text-gray-600 mt-2">
                      Candidate snapshot id={candidateSnapshotId || draftSnapshot.id}
                    </div>
                    <div className="text-xs text-gray-600 mt-2">
                      Size: {draftSnapshot.sizeBytes.toLocaleString()} bytes
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Checksum: {draftSnapshot.checksum ? `${draftSnapshot.checksum.substring(0, 16)}...` : 'N/A'}
                    </div>
                  </div>

                  {/* Pipeline Visualizer */}
                  <div className="relative">
                    {/* Native Stage */}
                    <div className={`flex items-center justify-between p-4 rounded-lg border-2 mb-4 ${
                      draftSnapshot.artifactFormat === 'native'
                        ? 'bg-amber-50 border-amber-400'
                        : 'bg-gray-50 border-gray-200'
                    }`}>
                      <div className="flex items-center space-x-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          draftSnapshot.artifactFormat === 'native'
                            ? 'bg-amber-500 text-white'
                            : 'bg-gray-300 text-gray-600'
                        }`}>
                          {draftSnapshot.artifactFormat === 'wasm' ? <CheckCircle className="w-5 h-5" /> : '1'}
                        </div>
                        <div>
                          <div className="font-semibold text-sm">Native Format</div>
                          <div className="text-xs text-gray-500">Draft snapshot</div>
                        </div>
                      </div>
                      {(draftSnapshot.artifactFormat === 'native' || !draftSnapshot.artifactFormat) && (
                        <div className="text-xs bg-amber-200 text-amber-800 px-2 py-1 rounded">Current</div>
                      )}
                    </div>

                    {/* Arrow */}
                    <div className="flex justify-center mb-4">
                      <ArrowRight className={`w-6 h-6 ${
                        draftSnapshot.artifactFormat === 'wasm' ? 'text-purple-500' : 'text-gray-400'
                      }`} />
                    </div>

                    {/* WASM Stage */}
                    <div className={`flex items-center justify-between p-4 rounded-lg border-2 ${
                      draftSnapshot.artifactFormat === 'wasm'
                        ? 'bg-purple-50 border-purple-400'
                        : 'bg-gray-50 border-gray-200'
                    }`}>
                      <div className="flex items-center space-x-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          draftSnapshot.artifactFormat === 'wasm'
                            ? 'bg-purple-500 text-white'
                            : 'bg-gray-300 text-gray-600'
                        }`}>
                          {draftSnapshot.artifactFormat === 'wasm' ? <CheckCircle className="w-5 h-5" /> : '2'}
                        </div>
                        <div>
                          <div className="font-semibold text-sm">WASM Format</div>
                          <div className="text-xs text-gray-500">Compiled & optimized</div>
                        </div>
                      </div>
                      {draftSnapshot.artifactFormat === 'wasm' && (
                        <div className="text-xs bg-purple-200 text-purple-800 px-2 py-1 rounded">Complete</div>
                      )}
                    </div>
                  </div>

                  {/* Compile Rules Button (SeedCore API) */}
                  <button 
                    onClick={() => handleCompileRules(draftSnapshot.id)}
                    disabled={isCompiling || !draftSnapshot || !draftSnapshot.id}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg shadow flex items-center justify-center disabled:bg-gray-400 disabled:cursor-not-allowed font-medium text-sm"
                  >
                    {isCompiling ? (
                      <>
                        <Loader2 className="animate-spin mr-2 h-4 w-4" />
                        Compiling Rules...
                      </>
                    ) : (
                      <>
                        <Terminal className="h-4 w-4 mr-2" />
                        Compile Rules (SeedCore API)
                      </>
                    )}
                  </button>

                  {/* Promote/Repromote Button */}
                  <button 
                    onClick={handlePromoteToWasm}
                    disabled={isPromoting || !draftSnapshot}
                    className={`w-full text-white py-3 rounded-lg shadow flex items-center justify-center disabled:bg-gray-400 disabled:cursor-not-allowed font-medium ${
                      draftSnapshot.artifactFormat === 'wasm' 
                        ? 'bg-purple-500 hover:bg-purple-600' 
                        : 'bg-purple-600 hover:bg-purple-700'
                    }`}
                  >
                    {isPromoting ? (
                      <>
                        <Loader2 className="animate-spin mr-2 h-4 w-4" />
                        {draftSnapshot.artifactFormat === 'wasm' ? 'Recompiling to WASM...' : 'Compiling to WASM...'}
                      </>
                    ) : (
                      <>
                        <ArrowRight className="h-4 w-4 mr-2" />
                        {draftSnapshot.artifactFormat === 'wasm' ? 'Repromote to WASM' : 'Promote to WASM'}
                      </>
                    )}
                  </button>

                  {draftSnapshot.artifactFormat === 'wasm' && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                      <div className="text-sm font-semibold text-green-800">✓ Ready for Validation</div>
                      <div className="text-xs text-green-600 mt-1">
                        Snapshot compiled and optimized
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        You can repromote to regenerate compiled rules
                      </div>
                    </div>
                  )}
               </div>
             )}
          </div>
        </div>

        {/* COL 3: Validation & Deployment (WASM -> Production) */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col">
           <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-700 flex items-center"><ShieldAlert className="w-4 h-4 mr-2 text-emerald-500"/> Validation & Deployment</h3>
            <span className="text-xs font-mono bg-gray-200 px-2 py-1 rounded">AGENT-3</span>
          </div>
          <div className="p-4 flex-1 flex flex-col">
             
             {/* Option to deploy existing snapshot (for first-time initialization) */}
             {!draftSnapshot && snapshots.length > 0 && (
               <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                 <div className="text-xs font-semibold text-blue-800 mb-2">Deploy Existing Snapshot (Skip Evolution/Build)</div>
                 <select
                   value={selectedSnapshotForDeployment ?? ''}
                   onChange={(e) => {
                     const id = e.target.value ? Number(e.target.value) : null;
                     setSelectedSnapshotForDeployment(id);
                     if (id) {
                       const snap = snapshots.find(s => s.id === id);
                       if (snap) {
                         // Set as draftSnapshot so it can be deployed
                         // Treat undefined/null as 'native' so promotion button shows
                         setDraftSnapshot({
                           ...snap,
                           artifactFormat: snap.artifactFormat === 'wasm' ? 'wasm' : 'native',
                         });
                         setValidationResult(null);
                         setDeploymentPercent(0);
                         const runId = pipelineIdRef.current;
                         addLog('DEPLOYMENT', `Selected existing snapshot ${snap.version} (id=${snap.id}) for deployment`, 'INFO', runId);
                       }
                     } else {
                       setDraftSnapshot(null);
                       setSelectedSnapshotForDeployment(null);
                     }
                   }}
                   className="w-full px-2 py-1.5 border border-blue-300 rounded text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                 >
                   <option value="">Select snapshot to deploy...</option>
                   {prodSnapshots
                     .map(s => (
                       <option key={s.id} value={s.id}>
                         {s.version} {s.isActive ? '★' : ''} (id={s.id}) {isSnapshotWasmReady(s) ? '[WASM ready]' : s.artifactFormat === 'wasm' ? '[metadata only]' : '[native]'}
                       </option>
                     ))}
                 </select>
                 {selectedSnapshotForDeployment && (
                   <div className="mt-2 text-xs text-blue-700">
                     Selected: {snapshots.find(s => s.id === selectedSnapshotForDeployment)?.version}
                     <span className="ml-2 text-blue-600">(You can deploy without validation)</span>
                   </div>
                 )}
               </div>
             )}
             
             {!isSnapshotWasmReady(draftSnapshot) ? (
               <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                  <ShieldAlert className="h-12 w-12 mx-auto mb-2 opacity-20" />
                  <p className="text-sm text-center">
                    {!draftSnapshot 
                      ? 'Waiting for WASM snapshot...' 
                      : 'Snapshot must be compiled and backed by a WASM artifact before validation'}
                  </p>
               </div>
             ) : !validationResult ? (
               /* Validation Not Run Yet */
               <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                  <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-lg text-center w-full">
                    <div className="text-xs font-bold text-emerald-800 uppercase mb-1">WASM SNAPSHOT READY</div>
                    <div className="font-mono text-sm font-bold text-gray-900">{candidateSnapshotVersion || draftSnapshot.version}</div>
                    <div className="text-xs text-gray-500 mt-1">Candidate snapshot id={candidateSnapshotId || draftSnapshot.id}</div>
                    <div className="text-xs text-emerald-600 mt-2">
                      Size: {draftSnapshot.sizeBytes.toLocaleString()} bytes (compressed)
                    </div>
                  </div>

                  <button 
                    onClick={handleValidate}
                    disabled={isValidating || !draftSnapshot || draftSnapshot.artifactFormat !== 'wasm'}
                    className="w-full bg-emerald-600 text-white py-3 rounded-lg shadow hover:bg-emerald-700 flex items-center justify-center disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
                  >
                    {isValidating ? (
                      <>
                        <Loader2 className="animate-spin mr-2 h-4 w-4" />
                        Running Digital Twin Validation...
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="h-4 w-4 mr-2" />
                        Run Digital Twin Validation
                      </>
                    )}
                  </button>
               </div>
             ) : deploymentPercent === 0 ? (
               /* Validation Complete, Ready for Deployment */
               <div className="space-y-6">
                  {validationResult ? (
                    <div className={`border rounded-lg p-4 ${validationResult.success ? 'bg-white border-green-200' : 'bg-red-50 border-red-200'}`}>
                       <div className="flex items-center justify-between mb-4">
                          <span className="font-bold text-gray-700">Validation Report</span>
                          {validationResult.success ? <CheckCircle className="text-green-500"/> : <XCircle className="text-red-500"/>}
                       </div>
                       <div className="grid grid-cols-2 gap-4 text-center mb-4">
                          <div className="bg-gray-50 p-2 rounded">
                             <div className="text-xl font-bold text-gray-800">{validationResult.report?.passed}</div>
                             <div className="text-xs text-gray-500">Passed Checks</div>
                          </div>
                          <div className="bg-gray-50 p-2 rounded">
                             <div className="text-xl font-bold text-gray-800">{validationResult.report?.failed}</div>
                             <div className="text-xs text-gray-500">Failures</div>
                          </div>
                       </div>
                       {validationResult.report?.conflicts && validationResult.report.conflicts.length > 0 && (
                          <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
                             <div className="text-xs font-bold text-red-800 mb-2">Conflicts:</div>
                             <ul className="list-disc pl-5 text-xs text-red-700">
                                {validationResult.report.conflicts.map((c, i) => (
                                   <li key={i}>{c}</li>
                                ))}
                             </ul>
                          </div>
                       )}
                       {(validationResult.report as any)?.digitalTwinIssues && (validationResult.report as any).digitalTwinIssues.length > 0 && (
                          <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-4">
                             <div className="text-xs font-bold text-amber-800 mb-2">Digital Twin Issues:</div>
                             <ul className="list-disc pl-5 text-xs text-amber-700 space-y-1">
                                {(validationResult.report as any).digitalTwinIssues.map((issue: any, i: number) => (
                                   <li key={i}>
                                      <span className={`font-semibold ${issue.severity === 'critical' ? 'text-red-600' : issue.severity === 'warning' ? 'text-amber-600' : 'text-blue-600'}`}>
                                         [{issue.severity.toUpperCase()}]
                                      </span>
                                      {' '}
                                      {issue.ruleName ? `${issue.ruleName}: ` : ''}{issue.issue}
                                      {issue.recommendation && (
                                         <div className="ml-4 text-xs text-gray-600 mt-0.5">
                                            💡 {issue.recommendation}
                                         </div>
                                      )}
                                   </li>
                                ))}
                             </ul>
                          </div>
                       )}
                       {validationResult.success ? (
                          <div className="space-y-3">
                             {/* Deployment Target Selection */}
                             <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Deployment Target:</label>
                                <select
                                  value={deploymentTarget}
                                  onChange={(e) => setDeploymentTarget(e.target.value as DeploymentTarget)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                                >
                                  <option value="router">Router (Global)</option>
                                  <option value="INGRESS_PORTAL">Ingress Portal</option>
                                  <option value="VAULT_GATEWAY">Vault Gateway</option>
                                  <option value="TRANSFER_BAY_CONTROLLER">Transfer Bay Controller</option>
                                  <option value="QUARANTINE_LOCKER">Quarantine Locker</option>
                                  <option value="edge:robotic_handler">Robotic Handler</option>
                                  <option value="edge:seal_scanner">Seal Scanner</option>
                                  <option value="edge:door_controller">Door Controller</option>
                                </select>
                             </div>
                             
                             {/* Temporal Awareness: Duration/Expiry */}
                             <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Deployment Duration (hours, leave empty for permanent):</label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    min="0.5"
                                    step="0.5"
                                    value={deploymentDuration ?? ''}
                                    onChange={(e) => {
                                      const val = e.target.value ? Number(e.target.value) : null;
                                      setDeploymentDuration(val);
                                      if (val) {
                                        const expiry = new Date();
                                        expiry.setHours(expiry.getHours() + val);
                                        setDeploymentExpiry(expiry.toISOString());
                                      } else {
                                        setDeploymentExpiry(null);
                                      }
                                    }}
                                    placeholder="e.g., 2 (for 2 hours)"
                                    className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
                                  />
                                  {deploymentExpiry && (
                                    <span className="text-xs text-gray-500">
                                      Expires: {new Date(deploymentExpiry).toLocaleString()}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                  ℹ️ Temporary policies will auto-rollback after expiry
                                </div>
                             </div>
                             
                             <button 
                                onClick={() => handleDeployStep()}
                                disabled={!validationResult.success}
                                className="w-full bg-emerald-600 text-white py-2 rounded shadow hover:bg-emerald-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex justify-center items-center"
                             >
                                <ArrowRight className="h-4 w-4 mr-2" />
                                Proceed to Canary Deployment
                             </button>
                          </div>
                       ) : (
                          <div className="text-center text-red-700 text-sm font-semibold">
                             Validation Failed - Cannot Deploy
                             {validationResult.report && (validationResult.report as any).digitalTwinIssues && (
                                <div className="mt-2 text-xs text-red-600">
                                   {(validationResult.report as any).digitalTwinIssues.filter((i: any) => i.severity === 'critical').length} critical hardware constraint violation(s)
                                </div>
                             )}
                          </div>
                       )}
                    </div>
                  ) : selectedSnapshotForDeployment ? (
                    /* Deploy existing snapshot without validation */
                    <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
                       <div className="flex items-center justify-between mb-4">
                          <span className="font-bold text-gray-700">Deploy Existing Snapshot</span>
                          <CheckCircle className="text-blue-500"/>
                       </div>
                       <div className="text-sm text-gray-600 mb-4">
                          Ready to deploy: <span className="font-mono font-semibold">{candidateSnapshotVersion || draftSnapshot?.version}</span> <span className="text-xs text-gray-500">(id={candidateSnapshotId || draftSnapshot?.id})</span>
                       </div>
                       <div className="space-y-3">
                          {/* Deployment Target Selection for existing snapshot */}
                          <div>
                             <label className="block text-xs font-medium text-gray-700 mb-1">Deployment Target:</label>
                             <select
                               value={deploymentTarget}
                               onChange={(e) => setDeploymentTarget(e.target.value as DeploymentTarget)}
                               className="w-full px-3 py-2 border border-blue-300 rounded text-sm"
                             >
                               <option value="router">Router (Global)</option>
                               <option value="INGRESS_PORTAL">Ingress Portal</option>
                               <option value="VAULT_GATEWAY">Vault Gateway</option>
                               <option value="TRANSFER_BAY_CONTROLLER">Transfer Bay Controller</option>
                               <option value="QUARANTINE_LOCKER">Quarantine Locker</option>
                               <option value="edge:robotic_handler">Robotic Handler</option>
                               <option value="edge:seal_scanner">Seal Scanner</option>
                               <option value="edge:door_controller">Door Controller</option>
                             </select>
                          </div>
                          
                          {/* Temporal Awareness for existing snapshot */}
                          <div>
                             <label className="block text-xs font-medium text-gray-700 mb-1">Deployment Duration (hours, leave empty for permanent):</label>
                             <input
                               type="number"
                               min="0.5"
                               step="0.5"
                               value={deploymentDuration ?? ''}
                               onChange={(e) => {
                                 const val = e.target.value ? Number(e.target.value) : null;
                                 setDeploymentDuration(val);
                                 if (val) {
                                   const expiry = new Date();
                                   expiry.setHours(expiry.getHours() + val);
                                   setDeploymentExpiry(expiry.toISOString());
                                 } else {
                                   setDeploymentExpiry(null);
                                 }
                               }}
                               placeholder="e.g., 2 (for 2 hours)"
                               className="w-full px-3 py-2 border border-blue-300 rounded text-sm"
                             />
                          </div>
                          
                          <button 
                             onClick={() => handleDeployStep()}
                             className="w-full bg-emerald-600 text-white py-2 rounded shadow hover:bg-emerald-700 flex justify-center items-center"
                          >
                             <ArrowRight className="h-4 w-4 mr-2" />
                             Deploy Snapshot
                          </button>
                       </div>
                    </div>
                  ) : null}
               </div>
             ) : (
               /* Active Deployment */
               <div className="space-y-6">
                  <div className="text-center">
                     <div className="text-sm text-gray-500 mb-1">Target Version</div>
                     <div className="text-2xl font-bold text-indigo-600">{candidateSnapshotVersion || draftSnapshot?.version}</div>
                     <div className="text-xs text-gray-500 mt-1 font-mono">snapshot id={candidateSnapshotId || draftSnapshot?.id}</div>
                  </div>

                  <div className="relative pt-1">
                     <div className="flex mb-2 items-center justify-between">
                        <div className="text-right">
                           <span className="text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-indigo-600 bg-indigo-200">
                              {deploymentPercent}% Traffic
                           </span>
                        </div>
                     </div>
                     <div className="overflow-hidden h-4 mb-4 text-xs flex rounded bg-indigo-200">
                        <div style={{ width: `${deploymentPercent}%` }} className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-indigo-500 transition-all duration-500"></div>
                     </div>
                  </div>

                  <div className="bg-amber-50 border border-amber-200 p-4 rounded text-sm text-amber-800">
                     <p className="font-bold flex items-center mb-2"><Play className="h-3 w-3 mr-2"/> Live Metrics (Simulated)</p>
                     <ul className="list-disc pl-5 space-y-1 text-xs">
                        <li>Error Rate: 0.01% (Stable)</li>
                        <li>Latency: 45ms (Normal)</li>
                        <li>Rule Evaluations: 1,204/sec</li>
                     </ul>
                  </div>

                  {deploymentPercent < 100 ? (
                     <div className="flex space-x-3">
                        <button 
                          onClick={handleDeployStep} 
                          disabled={!validationResult || !validationResult.success}
                          className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2 rounded shadow disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                           Promote Stage
                        </button>
                        <button 
                          onClick={async () => {
                            const runId = pipelineIdRef.current;
                            if (!draftSnapshot || !draftSnapshot.id) return;
                            
                            try {
                              // Deactivate deployment on rollback (explicit rollback flag allows percent decrease)
                              await createOrUpdateDeployment({
                                snapshotId: draftSnapshot.id,
                                target: deploymentTarget,
                                region: 'global',
                                percent: 0,
                                isActive: false, // Will be forced to false anyway when percent=0
                                activatedBy: 'control-plane',
                                deploymentKey: `control-plane-rollback-${Date.now()}`,
                                isRollback: true, // Explicit rollback flag
                              });
                              setDeploymentPercent(0);
                              setDeploymentExpiry(null);
                              setDeploymentDuration(null);
                              addLog('DEPLOYMENT', `Run ${runId}: Deployment rolled back (set to 0% and deactivated)`, 'WARN', runId);
                            } catch (error: any) {
                              addLog('DEPLOYMENT', `Failed to rollback deployment: ${error?.message || String(error)}`, 'ERROR', runId);
                              // Still reset UI state
                              setDeploymentPercent(0);
                            }
                          }}
                          className="px-4 bg-red-100 text-red-700 hover:bg-red-200 rounded border border-red-200"
                        >
                           Rollback
                        </button>
                     </div>
                  ) : (
                     <div className="bg-green-100 text-green-800 p-4 rounded text-center font-bold border border-green-200">
                        Rollout Complete
                     </div>
                  )}
               </div>
             )}

          </div>
        </div>

      </div>

      {/* Deployment Management Section */}
      {activeSnapshotId ? (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-700 flex items-center gap-2">
              <Server className="h-5 w-5 text-indigo-600" />
              Active Nodes & Deployments Management
              <span className="text-xs font-normal text-gray-500">
                ({snapshotDeployments.length} deployment{snapshotDeployments.length !== 1 ? 's' : ''})
              </span>
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Manage deployments for snapshot: <span className="font-mono">{activeSnapshot?.version}</span>
            </p>
          </div>

          <div className="p-4">
            {deploymentMessage && (
              <div className={`mb-4 p-3 rounded text-sm ${
                deploymentMessage.startsWith('✅') 
                  ? 'bg-green-50 text-green-700 border border-green-200' 
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {deploymentMessage}
              </div>
            )}

            {snapshotDeployments.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <div className="text-sm mb-2">
                  No deployments for this snapshot. Deployments will appear here after deployment operations.
                </div>
                {draftSnapshot && draftSnapshot.artifactFormat === 'wasm' && !validationResult && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                    <strong>Next Step:</strong> Run Validation (click "Run Validation" button in the Validation & Deployment column)
                  </div>
                )}
                {validationResult && validationResult.success && deploymentPercent === 0 && (
                  <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded text-xs text-green-800">
                    <strong>Ready to Deploy:</strong> Click "Proceed to Canary Deployment" button in the Validation & Deployment column to create your first deployment
                  </div>
                )}
                <div className="text-xs text-gray-500 mt-3 space-y-1">
                  <p><strong>How to initialize deployments:</strong></p>
                  <ol className="list-decimal list-inside space-y-1 text-left max-w-md mx-auto">
                    <li>Complete the pipeline: Evolution → Build → Promote to WASM → Validate</li>
                    <li>After validation passes, click "Proceed to Canary Deployment"</li>
                    <li>Deployments will be created automatically and appear here</li>
                    <li>You can then edit, rollback, or deactivate them using the action buttons</li>
                  </ol>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {snapshotDeployments.map(dep => {
                  const snap = snapshots.find(s => s.id === dep.snapshotId);
                  const isEditing = editingDeployment?.id === dep.id;
                  
                  return (
                    <div key={dep.id} className={`p-4 rounded-lg border-2 ${
                      dep.isActive 
                        ? 'bg-green-50 border-green-200' 
                        : 'bg-gray-50 border-gray-200'
                    }`}>
                      {isEditing ? (
                        // Edit mode
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <Radio className={`h-4 w-4 ${dep.isActive ? 'text-green-500' : 'text-gray-300'}`} />
                              <span className="font-medium text-gray-700 capitalize">{dep.target}</span>
                              <span className="text-gray-400 text-xs">({dep.region})</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={editDeploymentPercent}
                              onChange={(e) => setEditDeploymentPercent(Math.max(0, Math.min(100, Number(e.target.value))))}
                              className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
                              disabled={updatingDeployment}
                            />
                            <span className="text-sm text-gray-500">%</span>
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={handleUpdateDeployment}
                              disabled={updatingDeployment}
                              className="flex-1 px-3 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {updatingDeployment ? 'Updating...' : 'Save'}
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              disabled={updatingDeployment}
                              className="px-3 py-2 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        // View mode
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2">
                              <Radio className={`h-4 w-4 ${dep.isActive ? 'text-green-500' : 'text-gray-300'}`} />
                              <span className="font-medium text-gray-700 capitalize">{dep.target}</span>
                              <span className="text-gray-400 text-xs">({dep.region})</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">{snap?.version}</span>
                              <span className={`font-bold ${
                                dep.percent === 100 ? 'text-green-600' :
                                dep.percent > 0 ? 'text-blue-600' : 'text-gray-600'
                              }`}>
                                {dep.percent ?? 0}%
                              </span>
                            </div>
                          </div>
                          {dep.isActive && (
                            <div className="flex items-center gap-2 mt-3">
                              <button
                                onClick={() => handleEditDeployment(dep)}
                                className="flex items-center gap-1 px-2 py-1 text-blue-600 hover:bg-blue-50 rounded text-xs"
                                title="Edit deployment"
                              >
                                <Edit className="h-3 w-3" />
                                Edit
                              </button>
                              {dep.percent > 0 && (
                                <button
                                  onClick={() => handleRollbackDeployment(dep)}
                                  className="flex items-center gap-1 px-2 py-1 text-amber-600 hover:bg-amber-50 rounded text-xs"
                                  title="Rollback deployment"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Rollback
                                </button>
                              )}
                              <button
                                onClick={() => handleDeactivateDeployment(dep)}
                                className="flex items-center gap-1 px-2 py-1 text-red-600 hover:bg-red-50 rounded text-xs"
                                title="Deactivate deployment"
                              >
                                <Pause className="h-3 w-3" />
                                Deactivate
                              </button>
                            </div>
                          )}
                          {dep.isActive && dep.activatedBy && dep.activatedBy !== 'system' && (
                            <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Activated by: {dep.activatedBy} at {new Date(dep.activatedAt).toLocaleString()}
                            </div>
                          )}
                          {!dep.isActive && dep.activatedBy && dep.activatedBy !== 'system' && (
                            <div className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Last activated by: {dep.activatedBy} at {new Date(dep.activatedAt).toLocaleString()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recent Rollout Events */}
            {rolloutEvents.length > 0 && (
              <div className="mt-6 pt-4 border-t border-gray-200">
                <div className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Recent Rollout Events
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {rolloutEvents.slice(0, 10).map((event, idx) => (
                    <div key={idx} className="text-xs text-gray-600 flex items-center justify-between p-2 bg-gray-50 rounded">
                      <div className="flex items-center gap-2">
                        <span className="capitalize font-medium">{event.target}</span>
                        <span className="text-gray-400">({event.region})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${
                          event.isRollback ? 'text-red-600' : 'text-green-600'
                        }`}>
                          {event.fromPercent !== null ? `${event.fromPercent}% → ` : ''}{event.toPercent}%
                        </span>
                        {event.isRollback && (
                          <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">ROLLBACK</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="text-xs text-gray-500">
                <strong>Note:</strong> Only one active deployment per (target, region) lane. 
                Updating a deployment will deactivate previous active deployments for the same lane.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-700 flex items-center gap-2">
              <Server className="h-5 w-5 text-indigo-600" />
              Active Nodes & Deployments Management
            </h3>
          </div>
          <div className="p-4">
            <div className="text-center py-8 text-gray-400">
              <div className="text-sm mb-2">
                No active snapshot selected. Deployments will appear here after deployment operations.
              </div>
              <div className="text-xs text-gray-500 mt-3 space-y-1">
                <p><strong>How to initialize deployments:</strong></p>
                <ol className="list-decimal list-inside space-y-1 text-left max-w-md mx-auto">
                  <li>Complete the pipeline: Evolution → Build → Promote to WASM → Validate</li>
                  <li>After validation passes, click "Proceed to Canary Deployment"</li>
                  <li>Deployments will be created automatically and appear here</li>
                  <li>You can then edit, rollback, or deactivate them using the action buttons</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Terminal Log - Unified Memory Events (Tier A: event_working) */}
      <div className="h-48 bg-slate-900 rounded-lg shadow-inner overflow-hidden flex flex-col">
        <div className="p-2 bg-slate-800 border-b border-slate-700 flex items-center space-x-2">
           <Terminal className="text-slate-400 h-4 w-4" />
           <span className="text-xs text-slate-400 font-mono">Agent Event Stream</span>
           <span className="text-xs text-slate-500 ml-2">(Unified Memory: Tier A - event_working)</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1">
          {agentLogs.length === 0 && <span className="text-slate-600 italic">System ready. Waiting for events...</span>}
          {agentLogs.map((log) => (
            <div key={log.id} className="flex space-x-3">
               <span className="text-slate-500">[{log.timestamp}]</span>
               <span className={`${
                 log.agent === 'EVOLUTION' ? 'text-indigo-400' :
                 log.agent === 'VALIDATION' ? 'text-emerald-400' : 'text-amber-400'
               } font-bold w-24`}>{log.agent}</span>
               <span className={`${
                 log.level === 'ERROR' ? 'text-red-400' : 
                 log.level === 'WARN' ? 'text-yellow-400' : 
                 log.level === 'SUCCESS' ? 'text-green-300' : 'text-slate-300'
               }`}>{log.message}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
