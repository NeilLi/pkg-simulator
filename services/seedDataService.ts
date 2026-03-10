import { GoogleGenAI } from '@google/genai';
import { getRuntimeZoneDefinition, RuntimeZoneId } from '../runtimeDomain';

const DEFAULT_DB_PROXY = 'http://localhost:3011';
const SYSTEM_INSTRUCTION = 'Return STRICT JSON only. No markdown. No extra keys.';

export type CustodySeedIntent = {
  assetId: string;
  assetClass: string;
  requestedAction: 'register_intake' | 'authorize_release' | 'start_transfer' | 'confirm_handoff' | 'force_quarantine';
  zone: Exclude<RuntimeZoneId, 'INFRASTRUCTURE' | 'MIXED'>;
  actorType: 'operator' | 'governed_agent' | 'robotic_handler' | 'partner_system';
  reason: string;
  provenanceState: 'verified' | 'partial' | 'unknown';
  sealState: 'sealed' | 'damaged' | 'broken';
  approvalMode: 'single' | 'dual' | 'emergency_override';
};

export type InfrastructureSeedIntent = {
  operation: 'scan_seal' | 'lock_access' | 'stabilize_environment' | 'route_robotic_handoff' | 'capture_playback';
  zone: Exclude<RuntimeZoneId, 'MIXED'>;
  endpoint: 'seal_scanner' | 'vault_door' | 'robotic_handler' | 'audit_archive' | 'environmental_controller';
  severity: 'normal' | 'high' | 'critical';
  description: string;
  anomaly: 'none' | 'route_drift' | 'identity_gap' | 'telemetry_loss' | 'seal_break';
};

export type SeedIntent = CustodySeedIntent | InfrastructureSeedIntent;

export type SeedResult = {
  intent: SeedIntent;
  policyDecision: any;
  eventMemoryId?: string;
  knowledgeMemoryId?: string;
  ticket?: {
    ticketId: string;
    title?: string;
    runId: string;
  };
  id?: string;
  title?: string;
  written?: boolean;
  appended?: boolean;
  stored?: boolean;
  allowed?: boolean;
  isSafety?: boolean;
  isInfra?: boolean;
  zone?: string;
};

export type SeedProfile = RuntimeZoneId;
export type MemoryWriteMode = 'dry_run' | 'event_working' | 'event_then_approve';

export type SeedOptions = {
  count: number;
  dbProxyUrl: string;
  includeKnowledgeBase?: boolean;
  profile?: SeedProfile;
  mode?: MemoryWriteMode;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
};

const CUSTODY_SEED_SCHEMA = {
  type: 'object',
  properties: {
    seeds: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          assetClass: { type: 'string' },
          requestedAction: {
            type: 'string',
            enum: ['register_intake', 'authorize_release', 'start_transfer', 'confirm_handoff', 'force_quarantine'],
          },
          zone: { type: 'string', enum: ['INGRESS', 'VAULT', 'TRANSFER', 'QUARANTINE'] },
          actorType: { type: 'string', enum: ['operator', 'governed_agent', 'robotic_handler', 'partner_system'] },
          reason: { type: 'string' },
          provenanceState: { type: 'string', enum: ['verified', 'partial', 'unknown'] },
          sealState: { type: 'string', enum: ['sealed', 'damaged', 'broken'] },
          approvalMode: { type: 'string', enum: ['single', 'dual', 'emergency_override'] },
        },
        required: [
          'assetId',
          'assetClass',
          'requestedAction',
          'zone',
          'actorType',
          'reason',
          'provenanceState',
          'sealState',
          'approvalMode',
        ],
      },
    },
  },
  required: ['seeds'],
};

const INFRASTRUCTURE_SEED_SCHEMA = {
  type: 'object',
  properties: {
    seeds: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['scan_seal', 'lock_access', 'stabilize_environment', 'route_robotic_handoff', 'capture_playback'] },
          zone: { type: 'string', enum: ['INGRESS', 'VAULT', 'TRANSFER', 'QUARANTINE', 'INFRASTRUCTURE'] },
          endpoint: { type: 'string', enum: ['seal_scanner', 'vault_door', 'robotic_handler', 'audit_archive', 'environmental_controller'] },
          severity: { type: 'string', enum: ['normal', 'high', 'critical'] },
          description: { type: 'string' },
          anomaly: { type: 'string', enum: ['none', 'route_drift', 'identity_gap', 'telemetry_loss', 'seal_break'] },
        },
        required: ['operation', 'zone', 'endpoint', 'severity', 'description', 'anomaly'],
      },
    },
  },
  required: ['seeds'],
};

const parseJson = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Model returned invalid JSON.');
  }
};

const fetchJson = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || response.statusText);
  }
  return response.json();
};

const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
};

const loadActiveSnapshot = async (dbProxyUrl: string) => {
  const snapshots = await fetchJson(`${dbProxyUrl}/api/snapshots`);
  return snapshots.find((snapshot: any) => snapshot.isActive) || snapshots[0] || null;
};

const buildSeedPrompt = (
  count: number,
  profile: SeedProfile,
): { prompt: string; schema: any; infrastructureOnly: boolean } => {
  if (profile === 'INFRASTRUCTURE') {
    return {
      infrastructureOnly: true,
      schema: INFRASTRUCTURE_SEED_SCHEMA,
      prompt: `Generate ${count} SeedCore infrastructure events for a zero-trust runtime.
Scenarios must involve actuator endpoints, environmental controls, seal scanners, or playback capture.
Use zones INGRESS, VAULT, TRANSFER, QUARANTINE, or INFRASTRUCTURE.
Prefer realistic anomalies such as route drift, identity gaps, telemetry loss, or seal break.`,
    };
  }

  const zoneDef = getRuntimeZoneDefinition(profile === 'MIXED' ? undefined : profile);
  const zoneContext = zoneDef
    ? `${zoneDef.name}: ${zoneDef.mission}. Emphasis: ${zoneDef.emphasis}.`
    : 'Use a balanced mix of ingress, vault, transfer, and quarantine requests.';

  return {
    infrastructureOnly: false,
    schema: CUSTODY_SEED_SCHEMA,
    prompt: `Generate ${count} governed custody requests for the SeedCore runtime.
${zoneContext}
Each request must describe a high-value asset action where identity, provenance, seal state, and approvals matter.
Keep reasons concise and operational. Use varied asset classes such as sealed inventory, assay lot, vault case, or regulated sample.`,
  };
};

const buildPolicyContext = (intent: SeedIntent) => {
  if ('operation' in intent) {
    return {
      tags: [
        `zone=${intent.zone}`,
        'actuator',
        `endpoint=${intent.endpoint}`,
        `operation=${intent.operation}`,
        `severity=${intent.severity}`,
        ...(intent.anomaly !== 'none' ? [intent.anomaly, 'anomaly'] : ['healthy']),
      ],
      signals: {
        identity_verified: intent.anomaly === 'identity_gap' ? 0 : 1,
        route_drift: intent.anomaly === 'route_drift' ? 0.8 : 0,
        seal_integrity: intent.anomaly === 'seal_break' ? 0.3 : 0.99,
        release_window_open: intent.severity === 'critical' ? 0 : 1,
      },
      values: {
        zone: intent.zone,
        endpoint: intent.endpoint,
        operation: intent.operation,
      },
    };
  }

  return {
    tags: [
      `zone=${intent.zone}`,
      intent.requestedAction.includes('quarantine') ? 'quarantine' : intent.requestedAction.includes('transfer') ? 'transfer' : 'release',
      intent.assetClass.toLowerCase().replace(/\s+/g, '_'),
      intent.approvalMode === 'dual' ? 'high_value' : 'standard',
      'seal',
      'custody',
    ],
    signals: {
      identity_verified: intent.actorType === 'partner_system' && intent.provenanceState === 'unknown' ? 0 : 1,
      provenance_score: intent.provenanceState === 'verified' ? 1 : intent.provenanceState === 'partial' ? 0.6 : 0.2,
      seal_integrity: intent.sealState === 'sealed' ? 1 : intent.sealState === 'damaged' ? 0.7 : 0.2,
      release_window_open: intent.zone === 'VAULT' && intent.approvalMode !== 'single' ? 1 : intent.zone === 'VAULT' ? 0.5 : 1,
      route_drift: intent.zone === 'TRANSFER' && intent.sealState === 'broken' ? 0.7 : 0,
    },
    values: {
      zone: intent.zone,
      asset_id: intent.assetId,
      asset_class: intent.assetClass,
      requested_action: intent.requestedAction,
    },
  };
};

const createRunId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `run_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
};

export const seedDataService = {
  async generateSeeds(options: SeedOptions): Promise<SeedResult[]> {
    checkAbort(options.signal);

    const apiKey = (process.env.API_KEY || process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY) as string;
    if (!apiKey) {
      throw new Error('No API key found. Set GEMINI_API_KEY, VITE_GEMINI_API_KEY, or API_KEY.');
    }

    const dbProxyUrl = options.dbProxyUrl || DEFAULT_DB_PROXY;
    const profile = options.profile || 'MIXED';
    const mode = options.mode || 'event_working';
    const { prompt, schema, infrastructureOnly } = buildSeedPrompt(options.count, profile);
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    });

    if (!response?.text) {
      throw new Error('No response from Gemini.');
    }

    const parsed = parseJson(response.text);
    const seeds: SeedIntent[] = parsed.seeds || [];
    const snapshot = await loadActiveSnapshot(dbProxyUrl);
    if (!snapshot) {
      throw new Error('No active snapshot available.');
    }

    const results: SeedResult[] = [];

    for (let index = 0; index < seeds.length; index += 1) {
      checkAbort(options.signal);

      const intent = seeds[index];
      const runId = createRunId();
      const isInfra = infrastructureOnly || 'operation' in intent;
      const zone = intent.zone;
      const title = isInfra
        ? `${intent.endpoint} ${intent.operation} @ ${intent.zone}`
        : `${intent.requestedAction} ${intent.assetClass} (${intent.assetId})`;
      const ticketId = isInfra ? `SC-INFRA-${runId.slice(0, 8)}` : `SC-CUSTODY-${runId.slice(0, 8)}`;
      const policyContext = buildPolicyContext(intent);
      const policyDecision = await fetchJson(`${dbProxyUrl}/api/policy/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: snapshot.id, context: policyContext }),
        signal: options.signal,
      });

      let eventMemoryId: string | undefined;
      let knowledgeMemoryId: string | undefined;

      if (mode !== 'dry_run' && policyDecision.allowed) {
        const eventMemory = await fetchJson(`${dbProxyUrl}/api/memory/append`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tier: 'event_working',
            category: isInfra ? `runtime_${intent.zone.toLowerCase()}_endpoint_event` : `runtime_${intent.zone.toLowerCase()}_custody_request`,
            content: isInfra ? intent.description : intent.reason,
            runId,
            metadata: {
              intent,
              snapshot,
              policyDecision,
              zone,
              ticket: { ticketId, title, runId },
            },
          }),
          signal: options.signal,
        });
        eventMemoryId = eventMemory.id;

        if (options.includeKnowledgeBase) {
          const knowledgeMemory = await fetchJson(`${dbProxyUrl}/api/memory/append`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tier: 'knowledge_base',
              category: isInfra ? `runtime_${intent.zone.toLowerCase()}_endpoint_ticket` : `runtime_${intent.zone.toLowerCase()}_custody_ticket`,
              content: ticketId,
              runId,
              metadata: {
                intent,
                snapshot,
                policyDecision,
                zone,
                ticket: { ticketId, title, runId },
              },
            }),
            signal: options.signal,
          });
          knowledgeMemoryId = knowledgeMemory.id;
        }
      }

      results.push({
        intent,
        policyDecision,
        eventMemoryId,
        knowledgeMemoryId,
        ticket: { ticketId, title, runId },
        id: ticketId,
        title,
        written: Boolean(eventMemoryId),
        appended: Boolean(eventMemoryId),
        stored: Boolean(knowledgeMemoryId),
        allowed: policyDecision.allowed,
        isSafety: zone === 'QUARANTINE' || (!isInfra && intent.sealState !== 'sealed'),
        isInfra,
        zone,
      });

      options.onProgress?.(index + 1, seeds.length);
    }

    return results;
  },
};
