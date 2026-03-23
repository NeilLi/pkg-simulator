import {
  EvolutionProposal,
  Rule,
  Snapshot,
  ValidationRun,
  Deployment,
  PkgEnv,
  SubtaskType,
  PkgConditionType,
  PkgEngine,
  PkgOperator,
  PkgRelation,
} from '../types';
import { generateEvolutionPlan } from './geminiService';
import { seedcoreService } from './seedcoreService';

const INFRASTRUCTURE_KEYWORDS = [
  'infrastructure',
  'vault',
  'transfer corridor',
  'transfer-corridor',
  'dual approval',
  'route drift',
  'stale telemetry',
  'custodian proof',
  'lineage',
];

const LOCAL_VERSION_BUMP = (baseVersion: string) => `${baseVersion || 'v1.0.0'}-local-${Date.now()}`;

function normalizeSubtaskCatalog(subtaskTypes: SubtaskType[] | undefined) {
  const names = new Set((subtaskTypes || []).map(subtask => subtask.name));
  return {
    has: (name: string) => names.has(name),
  };
}

function shouldUseDeterministicInfrastructureProposal(intent: string, baseSnapshot: Snapshot) {
  const haystack = `${intent} ${baseSnapshot.version} ${baseSnapshot.notes || ''}`.toLowerCase();
  return INFRASTRUCTURE_KEYWORDS.some(keyword => haystack.includes(keyword));
}

function edgeManifest(params: {
  source: string;
  target: string;
  operation: string;
  effect?: 'allow' | 'deny';
  conditions?: Record<string, unknown>;
}) {
  return {
    source_selector: params.source,
    target_selector: params.target,
    relationship: 'can',
    operation: params.operation,
    effect: params.effect || 'allow',
    conditions: params.conditions || {},
  };
}

function deterministicInfrastructureProposal(
  intent: string,
  baseSnapshot: Snapshot,
  subtaskTypes: SubtaskType[] | undefined,
): EvolutionProposal {
  const available = normalizeSubtaskCatalog(subtaskTypes);
  const emissionsFor = (...items: Array<{ subtaskName: string; relationshipType: PkgRelation; params?: Record<string, unknown> }>) =>
    items.filter(item => available.has(item.subtaskName));

  const rules: Array<{ rationale: string; ruleData: Partial<Rule> }> = [
    {
      rationale: 'Require dual approval and provenance checks before high-value vault releases can move toward the transfer corridor.',
      ruleData: {
        ruleName: 'require_dual_approval_for_vault_transfer',
        priority: 30,
        engine: PkgEngine.WASM,
        conditions: [
          { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*vault.*' },
          { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*transfer.*' },
          { conditionType: PkgConditionType.SIGNAL, conditionKey: 'dual_approval_verified', operator: PkgOperator.LT, value: '1' },
        ],
        emissions: emissionsFor(
          { subtaskName: 'authorize_release_window', relationshipType: PkgRelation.GATE, params: { approvals_required: 2, zone: 'INFRASTRUCTURE' } },
          { subtaskName: 'dispatch_operator_review', relationshipType: PkgRelation.ORDERS, params: { queue: 'infrastructure_release', urgency: 'high' } },
          { subtaskName: 'notify_control_plane', relationshipType: PkgRelation.EMITS, params: { event: 'dual_approval_missing' } },
        ),
        metadata: {
          authz_graph: {
            edge_manifests: [
              edgeManifest({
                source: 'role_profile:ADMIN',
                target: 'zone:INFRASTRUCTURE',
                operation: 'RELEASE',
                effect: 'allow',
                conditions: { requires_dual_approval: true },
              }),
              edgeManifest({
                source: 'role_profile:RELEASE_MANAGER',
                target: 'resource:transfer_corridor',
                operation: 'TRANSFER',
                effect: 'allow',
                conditions: { requires_dual_approval: true },
              }),
            ],
          },
        },
      },
    },
    {
      rationale: 'Quarantine assets when route drift, stale telemetry, missing lineage, or missing custodian proof is detected.',
      ruleData: {
        ruleName: 'quarantine_infrastructure_route_or_telemetry_drift',
        priority: 20,
        engine: PkgEngine.WASM,
        conditions: [
          { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*infrastructure.*' },
          { conditionType: PkgConditionType.SIGNAL, conditionKey: 'route_drift', operator: PkgOperator.GTE, value: '0.5' } as any,
        ],
        emissions: emissionsFor(
          { subtaskName: 'quarantine_asset_lot', relationshipType: PkgRelation.EMITS, params: { reason: 'route_drift' } },
          { subtaskName: 'capture_playback_evidence', relationshipType: PkgRelation.EMITS, params: { evidence: 'route_drift' } },
          { subtaskName: 'sync_custody_memory', relationshipType: PkgRelation.EMITS, params: { trust_gap: 'route_drift' } },
        ),
      },
    },
    {
      rationale: 'Deny production billing and transfer-corridor access by default unless break-glass or release authority is explicitly satisfied.',
      ruleData: {
        ruleName: 'deny_sensitive_infrastructure_paths_without_authority',
        priority: 10,
        engine: PkgEngine.WASM,
        conditions: [
          { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*production.*' },
          { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*billing|transfer.*' },
        ],
        emissions: emissionsFor(
          { subtaskName: 'lock_zone_access', relationshipType: PkgRelation.GATE, params: { zone: 'INFRASTRUCTURE', reason: 'sensitive_path_protection' } },
          { subtaskName: 'notify_control_plane', relationshipType: PkgRelation.EMITS, params: { event: 'deny_sensitive_path' } },
        ),
        metadata: {
          authz_graph: {
            edge_manifests: [
              edgeManifest({
                source: 'role_profile:ADMIN',
                target: 'resource:production_billing',
                operation: 'TRANSFER',
                effect: 'deny',
              }),
              edgeManifest({
                source: 'role_profile:ROBOT_OPERATOR',
                target: 'resource:transfer_corridor',
                operation: 'TRANSFER',
                effect: 'deny',
              }),
            ],
          },
        },
      },
    },
    {
      rationale: 'Stabilize infrastructure when telemetry freshness or seal integrity falls below acceptable thresholds.',
      ruleData: {
        ruleName: 'stabilize_infrastructure_environment_on_stale_telemetry',
        priority: 40,
        engine: PkgEngine.WASM,
        conditions: [
          { conditionType: PkgConditionType.SIGNAL, conditionKey: 'telemetry_fresh', operator: PkgOperator.LT, value: '1' },
          { conditionType: PkgConditionType.SIGNAL, conditionKey: 'seal_integrity', operator: PkgOperator.LT, value: '0.95' },
        ],
        emissions: emissionsFor(
          { subtaskName: 'stabilize_environmental_controls', relationshipType: PkgRelation.EMITS, params: { zone: 'INFRASTRUCTURE' } },
          { subtaskName: 'dispatch_operator_review', relationshipType: PkgRelation.ORDERS, params: { reason: 'stale_telemetry_or_seal_risk' } },
          { subtaskName: 'capture_playback_evidence', relationshipType: PkgRelation.EMITS, params: { evidence: 'environmental_anomaly' } },
        ),
      },
    },
  ];

  return {
    id: `prop-${Date.now()}`,
    baseSnapshotId: baseSnapshot.id,
    newVersion: LOCAL_VERSION_BUMP(baseSnapshot.version),
    reason: `Local deterministic infrastructure upgrade generated from intent: ${intent}`,
    changes: rules.map(rule => ({
      action: 'CREATE' as const,
      rationale: rule.rationale,
      ruleData: rule.ruleData,
    })),
    status: 'PENDING',
    generatedAt: new Date().toISOString(),
  };
}

// --- Evolution Agent ---
export const proposeEvolution = async (
  intent: string,
  baseSnapshot: Snapshot,
  options?: {
    existingRules?: Rule[];
    subtaskTypes?: SubtaskType[];
  }
): Promise<EvolutionProposal | null> => {
  if (shouldUseDeterministicInfrastructureProposal(intent, baseSnapshot)) {
    return deterministicInfrastructureProposal(intent, baseSnapshot, options?.subtaskTypes);
  }

  // Simulate fetching context from vector DB
  const context = [
    { subject: 'system:seedcore', predicate: 'last_failure', object: 'none' }
  ];

  const proposal = await generateEvolutionPlan({
    intent,
    currentVersion: baseSnapshot.version,
    contextFacts: context,
    snapshot: baseSnapshot,
    existingRules: options?.existingRules,
    subtaskTypes: options?.subtaskTypes,
  });
  
  if (proposal) {
    proposal.baseSnapshotId = baseSnapshot.id;
    // Auto-fix version if AI didn't
    if (proposal.newVersion === baseSnapshot.version) {
      proposal.newVersion = `${baseSnapshot.version}-evolved`;
    }
  }
  return proposal;
};

// --- Snapshot Builder Agent ---
export const buildSnapshotFromProposal = (
  proposal: EvolutionProposal,
  baseRules: Rule[]
): { snapshot: Snapshot; newRules: Rule[] } => {
  const normalizeOperator = (raw: any) => {
    const normalized = String(raw ?? '').trim().toUpperCase();
    switch (normalized) {
      case 'EQ':
      case 'EQUALS':
        return '=';
      case 'NE':
      case 'NOT_EQUALS':
        return '!=';
      case 'GTE':
        return '>=';
      case 'LTE':
        return '<=';
      case 'GT':
        return '>';
      case 'LT':
        return '<';
      default:
        return normalized;
    }
  };

  const normalizeConditionType = (raw: any) => {
    const normalized = String(raw ?? '').trim().toUpperCase();
    switch (normalized) {
      case 'BASIC':
      case 'FIELD':
      case 'ATTRIBUTE':
        return 'VALUE';
      case 'METRIC':
      case 'BOOLEAN':
        return 'SIGNAL';
      case 'LABEL':
        return 'TAG';
      default:
        return normalized;
    }
  };

  const ensureConditionShape = (condition: any, ruleId: string) => ({
    ruleId,
    conditionType: normalizeConditionType(condition?.conditionType || ''),
    conditionKey: condition?.conditionKey || '',
    operator: normalizeOperator(condition?.operator || ''),
    value: condition?.value,
  });

  const ensureEmissionShape = (emission: any, ruleId: string) => ({
    ruleId,
    subtaskTypeId: emission?.subtaskTypeId || '',
    subtaskName: emission?.subtaskName || undefined,
    relationshipType: emission?.relationshipType || '',
    params: emission?.params,
  });

  const ensureRuleShape = (rule: Partial<Rule>, snapshotId: number): Rule => {
    const ruleId = rule.id || `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return {
      id: ruleId,
      snapshotId,
      ruleName: rule.ruleName || 'unnamed_rule',
      priority: typeof rule.priority === 'number' ? rule.priority : 100,
      engine: rule.engine || 'wasm',
      conditions: Array.isArray(rule.conditions)
        ? rule.conditions.map((condition) => ensureConditionShape(condition, ruleId))
        : [],
      emissions: Array.isArray(rule.emissions)
        ? rule.emissions.map((emission) => ensureEmissionShape(emission, ruleId))
        : [],
      disabled: typeof rule.disabled === 'boolean' ? rule.disabled : false,
      ruleSource: rule.ruleSource ?? null,
      compiledRule: rule.compiledRule ?? null,
      ruleHash: rule.ruleHash ?? null,
      metadata: rule.metadata ?? null,
    };
  };

  const newSnapshotId = Math.floor(Math.random() * 10000) + 100;
  
  // Generate a valid 64-character hex checksum for native format (placeholder - will be replaced on promotion)
  const timestamp = Date.now();
  const checksumBase = `${proposal.newVersion}-native-${timestamp}`;
  // Convert to hex and pad/truncate to exactly 64 characters
  let nativeChecksum = Array.from(checksumBase)
    .map(c => c.charCodeAt(0).toString(16))
    .join('')
    .padEnd(64, '0')
    .substring(0, 64);
  
  const snapshot: Snapshot = {
    id: newSnapshotId,
    version: proposal.newVersion,
    env: PkgEnv.PROD, // Default env
    stage: 'DRAFT',
    isActive: false,
    checksum: nativeChecksum,
    sizeBytes: 0, // calc later
    createdAt: new Date().toISOString(),
    notes: `AI Evolution: ${proposal.reason}`,
    parentId: proposal.baseSnapshotId,
    artifactFormat: 'native' // New drafts are created in native format
  };

  let newRules = baseRules
    .filter(r => r.snapshotId === proposal.baseSnapshotId)
    .map(r => ensureRuleShape({ ...r, snapshotId: newSnapshotId }, newSnapshotId));

  (proposal.changes || []).forEach(change => {
    if (change.action === 'CREATE' && change.ruleData) {
      newRules.push(
        ensureRuleShape(
          {
            ...change.ruleData,
            engine: change.ruleData.engine || 'wasm',
            snapshotId: newSnapshotId,
          },
          newSnapshotId
        )
      );
    } else if (change.action === 'DELETE' && change.ruleId) {
      newRules = newRules.filter(r => r.id !== change.ruleId);
    } else if (change.action === 'MODIFY' && change.ruleId && change.ruleData) {
      newRules = newRules.map(r => r.id === change.ruleId
        ? ensureRuleShape({ ...r, ...change.ruleData, snapshotId: newSnapshotId }, newSnapshotId)
        : r
      );
    }
  });

  snapshot.sizeBytes = JSON.stringify(newRules).length;

  return { snapshot, newRules };
};

// --- Validation Agent ---
export const runValidationAgent = async (snapshotId: number, rules: Rule[]): Promise<ValidationRun> => {
  // Simulate complex validation logic (Consistency check, Loop detection, etc.)
  await new Promise(resolve => setTimeout(resolve, 2000)); // Sim delay

  const snapshotRules = rules.filter(r => r.snapshotId === snapshotId);
  const conflict = snapshotRules.find(r => r.priority < 0); // Mock check
  
  const passed = snapshotRules.length;
  const failed = conflict ? 1 : 0;
  const success = failed === 0;

  return {
    id: Date.now(),
    snapshotId,
    startedAt: new Date(Date.now() - 2000).toISOString(),
    finishedAt: new Date().toISOString(),
    success,
    report: {
      passed,
      failed,
      conflicts: conflict ? [`Rule ${conflict.ruleName} has invalid priority`] : [],
      simulationScore: success ? 0.99 : 0.45
    }
  };
};

// --- Deployment Agent ---
// Monotonic canary step progression (strictly increasing, never returns same value)
const CANARY_STEPS = [1, 5, 10, 25, 50, 100];

export const calculateCanaryStep = (currentPercent: number): number => {
  // Find the next step that is strictly greater than current
  const idx = CANARY_STEPS.findIndex(s => s > currentPercent);
  // If no step is greater (current >= 100), return 100
  return idx === -1 ? 100 : CANARY_STEPS[idx];
};

// --- Snapshot Promotion Service ---
import { promoteSnapshot } from './snapshotService';

/**
 * Promote a native snapshot to WASM format
 * using the SeedCore compiler and only persist WASM metadata after success.
 */
export const promoteToWasm = async (
  snapshot: Snapshot,
  rules: Rule[]
): Promise<Snapshot> => {
  const compileResult = await seedcoreService.compilePKGRules(snapshot.id, {
    entrypoint: 'data.pkg.result'
  });
  const compiledCount = compileResult.compiled_count ?? compileResult.rules?.length ?? rules.length;
  console.log(`Compiled ${compiledCount} rules for snapshot ${snapshot.id}`);

  const compilationChecksum =
    compileResult.checksum ||
    compileResult.sha256 ||
    compileResult.artifact_hash ||
    compileResult.bundle_sha256;

  if (!compilationChecksum) {
    throw new Error(
      `Compilation succeeded but no artifact checksum was returned for snapshot ${snapshot.id}`
    );
  }

  const artifactSize = compileResult.size_bytes ?? compileResult.wasm_size_bytes;

  if (!artifactSize || artifactSize <= 0) {
    throw new Error(
      `Compilation succeeded but artifact size was missing for snapshot ${snapshot.id}`
    );
  }

  const promoted = await promoteSnapshot(snapshot.id, {
    checksum: compilationChecksum,
    sizeBytes: artifactSize,
    artifactFormat: 'wasm'
  });

  return {
    ...promoted,
    artifactReady: true,
    compiledRulesCount: compiledCount,
    totalRulesCount: rules.length,
  };
};
