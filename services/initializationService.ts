import { PkgConditionType, PkgEngine, PkgEnv, PkgOperator, PkgRelation } from '../types';
import { RUNTIME_ZONES } from '../runtimeDomain';

const API_BASE_URL = import.meta.env.VITE_DB_PROXY_URL || 'http://localhost:3011';
const BASELINE_NOTES = 'SeedCore Governed Runtime Baseline';
const BASELINE_NAMESPACE = 'seedcore';

interface InitializeResult {
  success: boolean;
  message: string;
  snapshotId?: number;
  created: {
    snapshots: number;
    subtaskTypes: number;
    rules: number;
    facts: number;
    governedFacts?: number;
  };
}

interface CreatedRule {
  id: string;
  name: string;
}

export interface PreferredOrganCleanupResult {
  includeGuestOverlays: boolean;
  audit: Array<{
    snapshotId: number;
    name: string;
    preferredOrgan: string;
  }>;
  updatedSubtaskTypes: Array<{
    snapshotId: number;
    name: string;
    newPreferredOrgan: string;
  }>;
  updatedGuestCapabilities: Array<{
    id: number;
    guestId: number | null;
    personaName: string | null;
    newPreferredOrgan: string;
  }>;
  guestCapabilitiesTableFound: boolean;
  remainingDeprecatedInActiveSnapshots: Array<{
    snapshotId: number;
    name: string;
    preferredOrgan: string;
  }>;
}

async function fetchJson(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || response.statusText);
  }
  return response.json();
}

async function createRule(payload: Record<string, unknown>) {
  const result = await fetchJson(`${API_BASE_URL}/api/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return result.id as string;
}

export async function initializeGovernedRuntimeScenario(env: PkgEnv = PkgEnv.PROD): Promise<InitializeResult> {
  const created = {
    snapshots: 0,
    subtaskTypes: 0,
    rules: 0,
    facts: 0,
    governedFacts: 0,
  };

  try {
    const snapshots = await fetchJson(`${API_BASE_URL}/api/snapshots`);
    const existing = snapshots.find(
      (snapshot: any) => snapshot.notes?.includes(BASELINE_NOTES) && snapshot.env === env,
    );

    let snapshotId = existing?.id as number | undefined;
    if (snapshotId) {
      return {
        success: true,
        message: `SeedCore governed runtime baseline already exists for ${env.toUpperCase()}.`,
        snapshotId,
        created,
      };
    }

    if (!snapshotId) {
      const envSuffix = env === PkgEnv.PROD ? '' : `-${env}`;
      const snapshot = await fetchJson(`${API_BASE_URL}/api/snapshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: `runtime-baseline${envSuffix}-v1.0.0-${Date.now()}`,
          env,
          entrypoint: 'data.pkg',
          schemaVersion: '1',
          checksum: '0'.repeat(64),
          sizeBytes: 0,
          notes: `${BASELINE_NOTES} - ${env.toUpperCase()} environment`,
          isActive: true,
        }),
      });
      snapshotId = snapshot.id;
      created.snapshots += 1;
    }

    const subtaskTypes = [
      {
        name: 'verify_identity_and_provenance',
        defaultParams: {
          zone: null,
          requiredClaims: ['actor', 'asset', 'source', 'seal'],
          routing: { preferred_organ: 'utility_organ' },
        },
      },
      {
        name: 'authorize_release_window',
        defaultParams: {
          zone: null,
          dualApprovalRequired: true,
          routing: { preferred_organ: 'utility_organ' },
        },
      },
      {
        name: 'lock_zone_access',
        defaultParams: {
          zone: null,
          action: 'lock',
          timeout_ms: 5000,
          routing: { preferred_organ: 'physical_actuation_organ' },
        },
      },
      {
        name: 'dispatch_operator_review',
        defaultParams: {
          zone: null,
          urgency: 'high',
          routing: { preferred_organ: 'user_experience_organ' },
        },
      },
      {
        name: 'route_robotic_handoff',
        defaultParams: {
          zone: null,
          handoffType: 'transfer',
          routing: { preferred_organ: 'physical_actuation_organ' },
        },
      },
      {
        name: 'capture_playback_evidence',
        defaultParams: {
          zone: null,
          evidenceClass: 'custody_transition',
          routing: { preferred_organ: 'utility_organ' },
        },
      },
      {
        name: 'quarantine_asset_lot',
        defaultParams: {
          zone: 'QUARANTINE',
          containment: 'sealed',
          routing: { preferred_organ: 'physical_actuation_organ' },
        },
      },
      {
        name: 'sync_custody_memory',
        defaultParams: {
          memory_tier: 'event_working',
          operation: 'append',
          routing: { preferred_organ: 'utility_organ' },
        },
      },
      {
        name: 'notify_control_plane',
        defaultParams: {
          zone: null,
          priority: 'high',
          routing: { preferred_organ: 'user_experience_organ' },
        },
      },
      {
        name: 'stabilize_environmental_controls',
        defaultParams: {
          zone: null,
          target: 'vault',
          routing: { preferred_organ: 'utility_organ' },
        },
      },
    ];

    const subtaskIds: Record<string, string> = {};
    for (const subtask of subtaskTypes) {
      const result = await fetchJson(`${API_BASE_URL}/api/subtask-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshotId,
          name: subtask.name,
          defaultParams: subtask.defaultParams,
        }),
      });
      if (result?.id) {
        subtaskIds[subtask.name] = result.id;
        created.subtaskTypes += 1;
      }
    }

    const rules: CreatedRule[] = [];
    const addRule = async (payload: {
      ruleName: string;
      priority: number;
      ruleSource: string;
      conditions: Array<{
        conditionType: PkgConditionType;
        conditionKey: string;
        operator: PkgOperator;
        value?: string;
      }>;
      emissions: Array<{
        subtaskTypeId: string;
        relationshipType: PkgRelation;
        params?: Record<string, unknown>;
      }>;
    }) => {
      const id = await createRule({
        snapshotId,
        engine: PkgEngine.WASM,
        disabled: false,
        ...payload,
      });
      rules.push({ id, name: payload.ruleName });
      created.rules += 1;
      return id;
    };

    const denyUnknownActorRuleId = await addRule({
      ruleName: 'deny_unknown_actor_release',
      priority: 10,
      ruleSource:
        'Deny release when actor identity, approval state, or release contract is missing.',
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*release.*' },
        { conditionType: PkgConditionType.SIGNAL, conditionKey: 'identity_verified', operator: PkgOperator.LT, value: '1' },
      ],
      emissions: [
        { subtaskTypeId: subtaskIds.lock_zone_access, relationshipType: PkgRelation.GATE },
        { subtaskTypeId: subtaskIds.dispatch_operator_review, relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskIds.notify_control_plane, relationshipType: PkgRelation.EMITS },
      ],
    });

    const sealIntegrityRuleId = await addRule({
      ruleName: 'quarantine_broken_seal',
      priority: 12,
      ruleSource: 'Broken seals or provenance mismatches are quarantined before transfer.',
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*seal.*' },
        { conditionType: PkgConditionType.SIGNAL, conditionKey: 'seal_integrity', operator: PkgOperator.LT, value: '0.95' },
      ],
      emissions: [
        { subtaskTypeId: subtaskIds.quarantine_asset_lot, relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskIds.capture_playback_evidence, relationshipType: PkgRelation.EMITS },
        { subtaskTypeId: subtaskIds.sync_custody_memory, relationshipType: PkgRelation.EMITS },
      ],
    });

    const approvalRuleId = await addRule({
      ruleName: 'require_dual_approval_for_high_value_transfer',
      priority: 20,
      ruleSource: 'High-value transfers require dual approval and a valid release window.',
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*high_value.*' },
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*transfer.*' },
      ],
      emissions: [
        { subtaskTypeId: subtaskIds.authorize_release_window, relationshipType: PkgRelation.GATE },
        { subtaskTypeId: subtaskIds.dispatch_operator_review, relationshipType: PkgRelation.ORDERS },
      ],
    });

    const roboticRoutingRuleId = await addRule({
      ruleName: 'route_robotic_handoff_under_policy',
      priority: 30,
      ruleSource: 'Only route actuator handoff after identity, provenance, and window checks pass.',
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*actuator.*' },
        { conditionType: PkgConditionType.SIGNAL, conditionKey: 'identity_verified', operator: PkgOperator.GTE, value: '1' },
        { conditionType: PkgConditionType.SIGNAL, conditionKey: 'release_window_open', operator: PkgOperator.GTE, value: '1' },
      ],
      emissions: [
        { subtaskTypeId: subtaskIds.verify_identity_and_provenance, relationshipType: PkgRelation.GATE },
        { subtaskTypeId: subtaskIds.route_robotic_handoff, relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskIds.capture_playback_evidence, relationshipType: PkgRelation.EMITS },
      ],
    });

    const anomalyRuleId = await addRule({
      ruleName: 'quarantine_route_drift',
      priority: 18,
      ruleSource: 'Route drift, wrong-zone movement, or telemetry loss immediately trigger containment.',
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*route.*' },
        { conditionType: PkgConditionType.SIGNAL, conditionKey: 'route_drift', operator: PkgOperator.GTE, value: '0.5' },
      ],
      emissions: [
        { subtaskTypeId: subtaskIds.lock_zone_access, relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskIds.quarantine_asset_lot, relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskIds.notify_control_plane, relationshipType: PkgRelation.EMITS },
      ],
    });

    const playbackRuleId = await addRule({
      ruleName: 'archive_custody_transition_playback',
      priority: 40,
      ruleSource: 'Successful handoffs must write playback evidence and custody memory immediately.',
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*handoff.*' },
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*success.*' },
      ],
      emissions: [
        { subtaskTypeId: subtaskIds.capture_playback_evidence, relationshipType: PkgRelation.EMITS },
        { subtaskTypeId: subtaskIds.sync_custody_memory, relationshipType: PkgRelation.EMITS },
      ],
    });

    const climateRuleId = await addRule({
      ruleName: 'stabilize_sensitive_storage_environment',
      priority: 35,
      ruleSource: 'Sensitive storage lots may require environmental stabilization before access.',
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*vault.*' },
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*environment.*' },
      ],
      emissions: [{ subtaskTypeId: subtaskIds.stabilize_environmental_controls, relationshipType: PkgRelation.ORDERS }],
    });

    const zoneFacts = RUNTIME_ZONES.map((zone) => ({
      subject: `zone:${zone.id}`,
      predicate: 'hasRuntimeSurface',
      object: {
        name: zone.name,
        mission: zone.mission,
        emphasis: zone.emphasis,
      },
      tags: ['zone', ...zone.tags],
      pkgRuleId:
        zone.id === 'QUARANTINE'
          ? anomalyRuleId
          : zone.id === 'VAULT'
            ? approvalRuleId
            : zone.id === 'TRANSFER'
              ? roboticRoutingRuleId
              : denyUnknownActorRuleId,
    }));

    const systemFacts = [
      {
        subject: 'system:identity_verifier',
        predicate: 'hasCapabilities',
        object: {
          capabilities: ['credential_check', 'role_check', 'dual_approval_check'],
          controlType: 'policy_gate',
        },
        tags: ['system', 'identity', 'policy', 'approval'],
        pkgRuleId: denyUnknownActorRuleId,
      },
      {
        subject: 'system:seal_scanner',
        predicate: 'hasCapabilities',
        object: {
          capabilities: ['seal_verification', 'tamper_detection', 'confidence_scoring'],
          controlType: 'sensor',
        },
        tags: ['system', 'seal', 'scanner', 'telemetry'],
        pkgRuleId: sealIntegrityRuleId,
      },
      {
        subject: 'system:robotic_handler',
        predicate: 'hasCapabilities',
        object: {
          capabilities: ['vault_pick', 'handoff_transfer', 'quarantine_drop'],
          controlType: 'actuator',
        },
        tags: ['system', 'robotic', 'actuator', 'handoff'],
        pkgRuleId: roboticRoutingRuleId,
      },
      {
        subject: 'system:vault_door_controller',
        predicate: 'hasCapabilities',
        object: {
          capabilities: ['fail_secure_lock', 'timed_release', 'zone_isolation'],
          controlType: 'actuator',
        },
        tags: ['system', 'vault', 'door', 'access'],
        pkgRuleId: approvalRuleId,
      },
      {
        subject: 'system:playback_archive',
        predicate: 'hasCapabilities',
        object: {
          capabilities: ['custody_replay', 'evidence_packaging', 'audit_export'],
          controlType: 'memory',
        },
        tags: ['system', 'playback', 'audit', 'memory'],
        pkgRuleId: playbackRuleId,
      },
    ];

    const policyFacts = [
      {
        subject: 'policy:high_value_release',
        predicate: 'requiresControls',
        object: {
          approvals: 2,
          releaseWindowMinutes: 15,
          identityVerified: true,
          provenanceVerified: true,
        },
        tags: ['policy', 'high_value', 'release', 'transfer'],
        pkgRuleId: approvalRuleId,
      },
      {
        subject: 'policy:route_drift_threshold',
        predicate: 'hasConstraint',
        object: {
          routeDriftThreshold: 0.5,
          telemetryLossSeconds: 15,
          action: 'quarantine',
        },
        tags: ['policy', 'route', 'anomaly', 'quarantine'],
        pkgRuleId: anomalyRuleId,
      },
      {
        subject: 'asset_class:sealed_inventory',
        predicate: 'hasCustodyRequirements',
        object: {
          requireSealIntegrity: true,
          requirePlaybackEvidence: true,
          requireOperatorWitness: false,
        },
        tags: ['asset', 'sealed', 'custody'],
        pkgRuleId: sealIntegrityRuleId,
      },
    ];

    const allFacts = [...zoneFacts, ...systemFacts, ...policyFacts];
    const now = new Date().toISOString();

    for (const fact of allFacts) {
      await fetchJson(`${API_BASE_URL}/api/facts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `${fact.subject} ${fact.predicate} ${JSON.stringify(fact.object)}`,
          snapshot_id: snapshotId,
          namespace: BASELINE_NAMESPACE,
          subject: fact.subject,
          predicate: fact.predicate,
          object_data: fact.object,
          tags: fact.tags,
          meta_data: {
            source: 'initialization',
            created_at: now,
          },
          valid_from: now,
          valid_to: null,
          pkg_rule_id: fact.pkgRuleId,
          pkg_provenance: {
            rule: rules.find((rule) => rule.id === fact.pkgRuleId)?.name || 'unknown',
            source: 'initialization',
            engine: 'wasm',
          },
          validation_status: 'trusted',
          created_by: 'pkg-engine',
        }),
      });
      created.facts += 1;
      created.governedFacts += 1;
    }

    return {
      success: true,
      message: `Initialized SeedCore governed runtime baseline for ${env.toUpperCase()}.`,
      snapshotId,
      created,
    };
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || String(error),
      created,
    };
  }
}

export const initializeHotelScenario = initializeGovernedRuntimeScenario;

export async function cleanupPreferredOrgans(
  options: { includeGuestOverlays?: boolean } = {}
): Promise<PreferredOrganCleanupResult> {
  return fetchJson(`${API_BASE_URL}/api/admin/cleanup-preferred-organs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      includeGuestOverlays: options.includeGuestOverlays === true,
    }),
  });
}
