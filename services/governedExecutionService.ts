import { getFacts, getSnapshots, getValidationRuns } from '../mockData';
import { Fact, Snapshot, ValidationRun } from '../types';

export interface ActionScenarioInput {
  label: string;
  description: string;
  tagsText: string;
  signalsText: string;
}

export interface ActionProposal {
  actionId: string;
  target: string;
  type: 'release' | 'transfer' | 'quarantine' | 'handoff' | 'access';
  reasoning: string;
  requestedBy: string;
  confidence: number;
}

export interface PolicyTrace {
  ruleName: string;
  outcome: 'allow' | 'deny' | 'require_control';
  rationale: string;
  evidence: string[];
  emissions: string[];
}

export interface DigitalTwinCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

export interface ExecutionToken {
  id: string;
  issuedAt: string;
  expiresAt: string;
  scope: string;
  signedDigest: string;
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  decision: 'ALLOWED' | 'BLOCKED';
  previousHash?: string;
  hash: string;
  evidence: string[];
}

export interface StageResult {
  key:
    | 'assistant_action'
    | 'policy_submission'
    | 'policy_evaluation'
    | 'token_issuance'
    | 'auditable_execution';
  title: string;
  status: 'completed' | 'blocked';
  detail: string;
}

export interface GovernedExecutionResult {
  scenario: {
    label: string;
    description: string;
    tags: string[];
    signals: Record<string, number | string>;
    values: Record<string, string>;
  };
  proposal: ActionProposal;
  snapshot?: Snapshot | null;
  policyTraces: PolicyTrace[];
  policyAllowed: boolean;
  policySummary: string;
  digitalTwinChecks: DigitalTwinCheck[];
  token?: ExecutionToken;
  audit: AuditRecord;
  stages: StageResult[];
  complianceSummary: string;
  controlsSatisfied: string[];
  controlsViolated: string[];
  activeFacts: Fact[];
}

type PolicyContext = {
  tags: string[];
  signals: Record<string, number | string>;
  values: Record<string, string>;
};

const DEFAULT_ROUTE_DRIFT_THRESHOLD = 0.5;
const DEFAULT_SEAL_INTEGRITY_MIN = 0.95;
const DEFAULT_TOKEN_TTL_MINUTES = 10;

const splitEntries = (text: string) =>
  text
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseSignals = (text: string): Record<string, number | string> => {
  return splitEntries(text).reduce<Record<string, number | string>>((acc, entry) => {
    const [rawKey, ...rawValueParts] = entry.split('=');
    if (!rawKey || rawValueParts.length === 0) return acc;
    const key = rawKey.trim();
    const rawValue = rawValueParts.join('=').trim();
    const numeric = Number(rawValue);
    acc[key] = Number.isNaN(numeric) ? rawValue : numeric;
    return acc;
  }, {});
};

const buildValuesFromTags = (tags: string[]) => {
  return tags.reduce<Record<string, string>>((acc, tag) => {
    const [rawKey, ...rawValueParts] = tag.split('=');
    if (!rawKey || rawValueParts.length === 0) return acc;
    acc[rawKey.trim()] = rawValueParts.join('=').trim();
    return acc;
  }, {});
};

const getNumericSignal = (signals: Record<string, number | string>, key: string, fallback = 0) => {
  const value = signals[key];
  return typeof value === 'number' ? value : Number(value ?? fallback) || fallback;
};

const makeId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}`;
};

const simpleHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `0x${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const inferActionType = (tags: string[], signals: Record<string, number | string>): ActionProposal['type'] => {
  if (getNumericSignal(signals, 'seal_integrity', 1) < DEFAULT_SEAL_INTEGRITY_MIN) return 'quarantine';
  if (tags.some((tag) => tag.includes('transfer'))) return 'transfer';
  if (tags.some((tag) => tag.includes('handoff'))) return 'handoff';
  if (tags.some((tag) => tag.includes('release'))) return 'release';
  return 'access';
};

const buildProposal = (scenario: ActionScenarioInput, context: PolicyContext): ActionProposal => {
  const zone = context.values.zone || 'UNKNOWN';
  const actor = context.values.actor || 'ai_assistant';
  const actionType = inferActionType(context.tags, context.signals);
  const target =
    context.values.asset ||
    context.values.endpoint ||
    (zone !== 'UNKNOWN' ? `${zone.toLowerCase()}_runtime_surface` : 'runtime_surface');

  const confidencePenalty = Math.min(
    0.35,
    (getNumericSignal(context.signals, 'route_drift', 0) * 0.2) +
      (getNumericSignal(context.signals, 'identity_verified', 1) < 1 ? 0.2 : 0) +
      (getNumericSignal(context.signals, 'seal_integrity', 1) < DEFAULT_SEAL_INTEGRITY_MIN ? 0.15 : 0),
  );

  return {
    actionId: makeId('act'),
    target,
    type: actionType,
    requestedBy: actor,
    confidence: Math.max(0.5, 0.97 - confidencePenalty),
    reasoning: `${scenario.description} The assistant proposes a ${actionType} action for ${target} in ${zone} after checking identity, seal, route, and release-window telemetry.`,
  };
};

const selectRelevantFacts = (facts: Fact[], context: PolicyContext) => {
  const zone = (context.values.zone || '').toUpperCase();
  const relevantTags = new Set(context.tags.map((tag) => tag.toLowerCase()));

  return facts
    .filter((fact) => {
      const subject = fact.subject?.toLowerCase() || '';
      const factTags = (fact.tags || []).map((tag) => tag.toLowerCase());
      const matchesZone = zone ? subject.includes(zone.toLowerCase()) || factTags.some((tag) => tag.includes(zone.toLowerCase())) : false;
      const matchesPolicy =
        subject.startsWith('policy:') ||
        factTags.some((tag) => tag === 'policy' || relevantTags.has(tag));
      return matchesZone || matchesPolicy;
    })
    .slice(0, 8);
};

const deriveRouteDriftThreshold = (facts: Fact[]) => {
  const policyFact = facts.find((fact) => fact.subject === 'policy:route_drift_threshold');
  const value = typeof policyFact?.object === 'object' && policyFact.object ? (policyFact.object as any).routeDriftThreshold : undefined;
  return typeof value === 'number' ? value : DEFAULT_ROUTE_DRIFT_THRESHOLD;
};

const deriveRequiredApprovals = (facts: Fact[], context: PolicyContext) => {
  const highValuePolicy = facts.find((fact) => fact.subject === 'policy:high_value_release');
  const baseline = typeof highValuePolicy?.object === 'object' && highValuePolicy.object ? Number((highValuePolicy.object as any).approvals) || 2 : 2;
  return context.tags.includes('high_value') ? baseline : 1;
};

const evaluatePolicy = (context: PolicyContext, facts: Fact[]) => {
  const traces: PolicyTrace[] = [];
  const controlsSatisfied: string[] = [];
  const controlsViolated: string[] = [];

  const identityVerified = getNumericSignal(context.signals, 'identity_verified', 0);
  const provenanceScore = getNumericSignal(context.signals, 'provenance_score', 1);
  const sealIntegrity = getNumericSignal(context.signals, 'seal_integrity', 1);
  const releaseWindowOpen = getNumericSignal(context.signals, 'release_window_open', 0);
  const routeDrift = getNumericSignal(context.signals, 'route_drift', 0);
  const approvalCount = getNumericSignal(context.signals, 'approval_count', 1);
  const routeDriftThreshold = deriveRouteDriftThreshold(facts);
  const requiredApprovals = deriveRequiredApprovals(facts, context);

  if (identityVerified < 1) {
    traces.push({
      ruleName: 'deny_unknown_actor_release',
      outcome: 'deny',
      rationale: 'Identity verification is required before any release or actuator command is allowed.',
      evidence: ['identity_verified < 1'],
      emissions: ['lock_zone_access', 'dispatch_operator_review', 'notify_control_plane'],
    });
    controlsViolated.push('Verified identity missing');
  } else {
    controlsSatisfied.push('Verified identity present');
  }

  if (sealIntegrity < DEFAULT_SEAL_INTEGRITY_MIN) {
    traces.push({
      ruleName: 'quarantine_broken_seal',
      outcome: 'deny',
      rationale: 'Seal integrity below the policy minimum forces quarantine before movement.',
      evidence: [`seal_integrity=${sealIntegrity.toFixed(2)} < ${DEFAULT_SEAL_INTEGRITY_MIN}`],
      emissions: ['quarantine_asset_lot', 'capture_playback_evidence', 'sync_custody_memory'],
    });
    controlsViolated.push('Seal integrity below minimum');
  } else {
    controlsSatisfied.push('Seal integrity within allowed range');
  }

  if (context.tags.includes('high_value') || context.tags.includes('transfer')) {
    if (approvalCount < requiredApprovals || releaseWindowOpen < 1 || provenanceScore < 0.7) {
      traces.push({
        ruleName: 'require_dual_approval_for_high_value_transfer',
        outcome: 'require_control',
        rationale: 'High-value transfer requires release window, sufficient approvals, and provenance confidence.',
        evidence: [
          `approval_count=${approvalCount}`,
          `required_approvals=${requiredApprovals}`,
          `release_window_open=${releaseWindowOpen}`,
          `provenance_score=${provenanceScore.toFixed(2)}`,
        ],
        emissions: ['authorize_release_window', 'dispatch_operator_review'],
      });
      controlsViolated.push('High-value transfer controls incomplete');
    } else {
      controlsSatisfied.push('High-value approvals and release window satisfied');
    }
  }

  if (context.tags.includes('route') && routeDrift >= routeDriftThreshold) {
    traces.push({
      ruleName: 'quarantine_route_drift',
      outcome: 'deny',
      rationale: 'Route drift above threshold requires containment and quarantine.',
      evidence: [`route_drift=${routeDrift.toFixed(2)} >= ${routeDriftThreshold}`],
      emissions: ['lock_zone_access', 'quarantine_asset_lot', 'notify_control_plane'],
    });
    controlsViolated.push('Route drift exceeded threshold');
  } else if (context.tags.includes('route')) {
    controlsSatisfied.push('Route drift within digital twin threshold');
  }

  if (context.tags.includes('actuator') && identityVerified >= 1 && releaseWindowOpen >= 1) {
    traces.push({
      ruleName: 'route_robotic_handoff_under_policy',
      outcome: 'allow',
      rationale: 'Actuator handoff can proceed after identity, provenance, and window checks pass.',
      evidence: ['identity_verified >= 1', 'release_window_open >= 1'],
      emissions: ['verify_identity_and_provenance', 'route_robotic_handoff', 'capture_playback_evidence'],
    });
    controlsSatisfied.push('Actuator routing prerequisites satisfied');
  }

  const blockingTraces = traces.filter((trace) => trace.outcome !== 'allow');
  const policyAllowed = blockingTraces.length === 0;
  const policySummary = policyAllowed
    ? 'Policy engine approved the action with required controls satisfied.'
    : `Policy engine blocked the action because ${blockingTraces[0]?.rationale.toLowerCase()}`;

  return { traces, policyAllowed, policySummary, controlsSatisfied, controlsViolated };
};

const evaluateDigitalTwin = (context: PolicyContext, validations: ValidationRun[], facts: Fact[]) => {
  const latestConstraints =
    validations.find((validation) => validation.report?.hardwareConstraints)?.report?.hardwareConstraints || null;
  const checks: DigitalTwinCheck[] = [];
  const routeDrift = getNumericSignal(context.signals, 'route_drift', 0);
  const payloadKg = getNumericSignal(context.signals, 'payload_kg', 1);
  const requestedTransition = context.values.transition || `${context.values.zone || 'UNKNOWN'}->${context.values.destination || 'TRANSFER'}`;
  const approvalCount = getNumericSignal(context.signals, 'approval_count', 1);
  const requiredApprovals = deriveRequiredApprovals(facts, context);
  const routeDriftThreshold = deriveRouteDriftThreshold(facts);

  checks.push({
    name: 'Route Drift Constraint',
    status: routeDrift < routeDriftThreshold ? 'pass' : 'fail',
    detail: `Observed drift ${routeDrift.toFixed(2)} against threshold ${routeDriftThreshold.toFixed(2)}.`,
  });

  if (latestConstraints?.roboticHandler) {
    const allowedTransitions = latestConstraints.roboticHandler.allowedZoneTransitions || [];
    checks.push({
      name: 'Robotic Handler Envelope',
      status: payloadKg <= latestConstraints.roboticHandler.maxPayloadKg ? 'pass' : 'fail',
      detail: `Payload ${payloadKg} kg against max ${latestConstraints.roboticHandler.maxPayloadKg} kg.`,
    });
    checks.push({
      name: 'Twin Zone Transition',
      status: allowedTransitions.includes(requestedTransition) ? 'pass' : 'warn',
      detail: allowedTransitions.includes(requestedTransition)
        ? `${requestedTransition} is modeled in the digital twin.`
        : `${requestedTransition} is not explicitly modeled in the latest validation run.`,
    });
  } else {
    checks.push({
      name: 'Robotic Handler Envelope',
      status: 'warn',
      detail: 'No hardware constraints available from validation history.',
    });
  }

  checks.push({
    name: 'Approval Control Mirror',
    status: approvalCount >= requiredApprovals ? 'pass' : 'fail',
    detail: `Observed approvals ${approvalCount}; required approvals ${requiredApprovals}.`,
  });

  return checks;
};

export async function runGovernedExecutionScenario(
  input: ActionScenarioInput,
  previousAuditHash?: string,
): Promise<GovernedExecutionResult> {
  const tags = splitEntries(input.tagsText);
  const signals = parseSignals(input.signalsText);
  const values = buildValuesFromTags(tags);
  const context: PolicyContext = { tags, signals, values };

  const [snapshots, facts, validations] = await Promise.all([getSnapshots(), getFacts(), getValidationRuns()]);
  const snapshot = snapshots.find((item) => item.isActive) || snapshots[0] || null;
  const activeFacts = selectRelevantFacts(facts, context);
  const proposal = buildProposal(input, context);
  const { traces, policyAllowed, policySummary, controlsSatisfied, controlsViolated } = evaluatePolicy(context, activeFacts);
  const digitalTwinChecks = evaluateDigitalTwin(context, validations, activeFacts);
  const twinAllowed = digitalTwinChecks.every((check) => check.status !== 'fail');
  const allowed = policyAllowed && twinAllowed;
  const now = new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + DEFAULT_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
  const token = allowed
    ? {
        id: makeId('xtok'),
        issuedAt,
        expiresAt,
        scope: `${proposal.type}:${proposal.target}`,
        signedDigest: simpleHash(`${proposal.actionId}:${snapshot?.id || 'snapshotless'}:${issuedAt}`),
      }
    : undefined;

  const evidence = [
    `proposal=${proposal.actionId}`,
    `snapshot=${snapshot?.version || 'none'}`,
    ...traces.map((trace) => `${trace.ruleName}:${trace.outcome}`),
    ...digitalTwinChecks.map((check) => `${check.name}:${check.status}`),
  ];

  const auditPayload = JSON.stringify({
    previousAuditHash: previousAuditHash || null,
    decision: allowed ? 'ALLOWED' : 'BLOCKED',
    proposal,
    traces,
    digitalTwinChecks,
    token,
  });

  const audit: AuditRecord = {
    id: makeId('audit'),
    timestamp: issuedAt,
    decision: allowed ? 'ALLOWED' : 'BLOCKED',
    previousHash: previousAuditHash,
    hash: simpleHash(auditPayload),
    evidence,
  };

  const stages: StageResult[] = [
    {
      key: 'assistant_action',
      title: '1. AI Assistant Action',
      status: 'completed',
      detail: `${proposal.type.toUpperCase()} proposal for ${proposal.target} with ${(proposal.confidence * 100).toFixed(0)}% confidence.`,
    },
    {
      key: 'policy_submission',
      title: '2. Policy Engine',
      status: 'completed',
      detail: `Submitted to snapshot ${snapshot?.version || 'N/A'} with ${activeFacts.length} relevant governed facts attached.`,
    },
    {
      key: 'policy_evaluation',
      title: '3. Policy Evaluation',
      status: policyAllowed ? 'completed' : 'blocked',
      detail: policySummary,
    },
    {
      key: 'token_issuance',
      title: '4. ExecutionToken Issuance',
      status: allowed ? 'completed' : 'blocked',
      detail: allowed
        ? `ExecutionToken ${token?.id} issued for scope ${token?.scope}.`
        : 'ExecutionToken withheld because policy or digital twin checks failed.',
    },
    {
      key: 'auditable_execution',
      title: '5. Auditable Execution',
      status: allowed ? 'completed' : 'blocked',
      detail: allowed
        ? `Execution and evidence committed to immutable audit trail ${audit.id}.`
        : `Blocked decision and evidence committed to immutable audit trail ${audit.id}.`,
    },
  ];

  const complianceSummary = allowed
    ? 'Every required control passed. The action is auditable, verifiable, and compliant with the active policy baseline.'
    : 'The proposed action is fully auditable, but it is not compliant with the active policy baseline and cannot execute.';

  return {
    scenario: {
      label: input.label,
      description: input.description,
      tags,
      signals,
      values,
    },
    proposal,
    snapshot,
    policyTraces: traces,
    policyAllowed,
    policySummary,
    digitalTwinChecks,
    token,
    audit,
    stages,
    complianceSummary,
    controlsSatisfied,
    controlsViolated,
    activeFacts,
  };
}
