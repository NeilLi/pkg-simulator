import {
  seedcoreService,
  OwnerPolicyRecord,
  OwnerPolicyUpsertRequest,
  TrustPreferencesRecord,
  TrustPreferencesUpsertRequest,
  OwnerContextPreflightResponse,
  EvaluatePolicyScenarioPackResponse,
} from './seedcoreService';
import {
  OwnerContextPreflightResult,
  OwnerPolicyDraft,
  PolicyAssistantIntentInput,
  PolicyScenarioCase,
  PolicyScenarioResult,
  TrustPreferencesDraft,
} from '../types/policyAssistant';

const DEFAULT_TRUSTED = ['trusted-mart', 'trusted-grocer'];
const DEFAULT_BLOCKED = ['scam-outlet'];

const toHash = async (text: string): Promise<string> => {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

const normalizeCsv = (text: string): string[] =>
  text
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const toUiDecision = (decision: string): PolicyScenarioResult['decision'] => {
  const normalized = String(decision || '').trim().toUpperCase();
  if (normalized === 'ALLOW') return 'allow';
  if (normalized === 'ESCALATE') return 'needs approval';
  if (normalized === 'ERROR') return 'error';
  return 'block';
};

class PolicyAssistantService {
  makeAssistantRunId(ownerId: string): string {
    return `pa_${ownerId}_${Date.now()}`;
  }

  buildDraftFromIntent(intent: PolicyAssistantIntentInput): {
    ownerPolicyDraft: OwnerPolicyDraft;
    trustPreferencesDraft: TrustPreferencesDraft;
  } {
    const blockedFromIntent = normalizeCsv(intent.blockedMerchantsText);
    const blocked = blockedFromIntent.length ? blockedFromIntent : DEFAULT_BLOCKED;
    const transactionLimit = intent.riskLevel === 'low' ? 300 : intent.riskLevel === 'medium' ? 1000 : 2500;
    const approvalThreshold = intent.riskLevel === 'low' ? 250 : intent.riskLevel === 'medium' ? 750 : 1500;

    return {
      ownerPolicyDraft: {
        owner_id: intent.ownerId,
        action_family: intent.actionFamily,
        allowed_merchants: DEFAULT_TRUSTED,
        blocked_merchants: blocked,
        transaction_limit: transactionLimit,
        required_evidence_modalities: ['receipt', 'device_attestation'],
        escalation_channel: 'human-review',
      },
      trustPreferencesDraft: {
        owner_id: intent.ownerId,
        approval_required_above_amount: approvalThreshold,
        high_risk_requires_manual_approval: intent.requiresApprovalForHighRisk,
        trusted_merchants: DEFAULT_TRUSTED,
        blocked_merchants: blocked,
      },
    };
  }

  buildScenarioPackDefaults(): { version: string; scenarios: PolicyScenarioCase[] } {
    return {
      version: 'mvp-v1',
      scenarios: [
        { scenario_id: 'safe_low_value_trusted', title: 'safe low-value trusted merchant purchase', action_type: 'purchase', merchant: 'trusted-mart', amount: 42, risk_score: 0.08, evidence_modalities: ['receipt', 'device_attestation'] },
        { scenario_id: 'high_value_trusted', title: 'high-value trusted merchant purchase', action_type: 'purchase', merchant: 'trusted-mart', amount: 2300, risk_score: 0.35, evidence_modalities: ['receipt', 'device_attestation'] },
        { scenario_id: 'blocked_merchant', title: 'blocked merchant purchase', action_type: 'purchase', merchant: 'scam-outlet', amount: 120, risk_score: 0.41, evidence_modalities: ['receipt', 'device_attestation'] },
        { scenario_id: 'missing_evidence', title: 'missing required evidence modality', action_type: 'purchase', merchant: 'trusted-grocer', amount: 60, risk_score: 0.18, evidence_modalities: ['receipt'] },
        { scenario_id: 'high_risk_escalation', title: 'high-risk purchase requiring escalation', action_type: 'purchase', merchant: 'trusted-mart', amount: 980, risk_score: 0.91, evidence_modalities: ['receipt', 'device_attestation'] },
        { scenario_id: 'unauthorized_publish_channel', title: 'publish action to unauthorized channel', action_type: 'publish', merchant: 'trusted-mart', amount: 10, risk_score: 0.62, evidence_modalities: ['device_attestation'], channel: 'unauthorized-public-feed' },
      ],
    };
  }

  async initialize(ownerId: string): Promise<{ trustPreferences: TrustPreferencesDraft | null; ownerPolicy: OwnerPolicyDraft | null }> {
    const [trustPreferences, ownerPolicy] = await Promise.all([
      seedcoreService.getTrustPreferences(ownerId),
      seedcoreService.getOwnerPolicy(ownerId),
    ]);
    return {
      trustPreferences: this.toTrustPreferencesDraft(trustPreferences),
      ownerPolicy: this.toOwnerPolicyDraft(ownerPolicy),
    };
  }

  async runPreflight(ownerPolicy: OwnerPolicyDraft, trustPreferences: TrustPreferencesDraft): Promise<OwnerContextPreflightResult> {
    const response: OwnerContextPreflightResponse = await seedcoreService.preflightOwnerContext({
      owner_id: ownerPolicy.owner_id,
      assistant_id: 'policy-assistant-ui',
      merchant_ref: trustPreferences.trusted_merchants[0] || undefined,
      declared_value_usd: trustPreferences.approval_required_above_amount || ownerPolicy.transaction_limit || undefined,
      required_modalities: ownerPolicy.required_evidence_modalities,
      available_modalities: ownerPolicy.required_evidence_modalities,
      observed_provenance_level: 'verified_attestation',
      risk_score: trustPreferences.high_risk_requires_manual_approval ? 0.9 : 0.35,
    });

    const reasonCode = response.predicted_policy_signals.reason_codes[0]
      || (response.ok ? 'owner_context_ready' : 'owner_context_requires_attention');

    const decision: OwnerContextPreflightResult['decision'] =
      response.delegation_check.valid === false
        ? 'block'
        : response.ok
          ? 'allow'
          : 'needs approval';

    const facts = [
      {
        path: 'owner_context_ref.creator_profile_ref.version',
        value: String((response.owner_context_ref as any)?.creator_profile_ref?.version || 'missing'),
      },
      {
        path: 'owner_context_ref.trust_preferences_ref.trust_version',
        value: String((response.owner_context_ref as any)?.trust_preferences_ref?.trust_version || 'missing'),
      },
      {
        path: 'predicted_policy_signals.missing_modalities',
        value: response.predicted_policy_signals.missing_modalities.join(', ') || 'none',
      },
    ];

    const inferences = response.predicted_policy_signals.trust_gap_codes.map((gap) => ({
      statement: `Predicted trust gap: ${gap}`,
      based_on_paths: ['predicted_policy_signals.trust_gap_codes'],
    }));

    return {
      decision,
      reason_code: reasonCode,
      trust_gaps: response.predicted_policy_signals.trust_gap_codes,
      required_approvals: response.delegation_check.issues,
      facts,
      inferences,
      owner_context_hash: response.owner_context_hash,
      technical_details: response as unknown as Record<string, unknown>,
    };
  }

  async runScenarioPack(
    ownerPolicy: OwnerPolicyDraft,
    trustPreferences: TrustPreferencesDraft,
    scenarios: PolicyScenarioCase[],
    scenarioPackVersion: string,
  ): Promise<PolicyScenarioResult[]> {
    const policyVersion = ownerPolicy.policy_version || 'v1';
    const response: EvaluatePolicyScenarioPackResponse = await seedcoreService.evaluatePolicyScenarioPack({
      owner_id: ownerPolicy.owner_id,
      policy_version: policyVersion,
      scenarios: scenarios.map((scenario) => this.toScenarioPackScenario(scenario, ownerPolicy, trustPreferences, scenarioPackVersion)),
    });

    return response.results.map((item) => ({
      scenario_id: item.scenario_id,
      decision: toUiDecision(item.decision),
      reason_code: item.reason_code,
      trust_gaps: item.trust_gaps,
      required_approvals: item.required_approvals,
      triggering_policy_fields: this.mapTriggeringFields(item.reason_code, item.trust_gaps),
    }));
  }

  async commit(payload: {
    trustPreferences: TrustPreferencesDraft;
    ownerPolicy: OwnerPolicyDraft;
    assistantRunId: string;
    uiVersion: string;
    scenarioPackVersion: string;
    intentText: string;
  }): Promise<{
    trustPreferencesResult: TrustPreferencesDraft;
    ownerPolicyResult?: OwnerPolicyDraft;
    partialFailure?: { failedStep: 'owner-policy-upsert'; retryPayload: OwnerPolicyUpsertRequest };
  }> {
    const policyIntentHash = await toHash(payload.intentText);
    const metadata = {
      assistant_run_id: payload.assistantRunId,
      ui_version: payload.uiVersion,
      scenario_pack_version: payload.scenarioPackVersion,
      policy_intent_text_hash: policyIntentHash,
    };

    const trustRequest = this.toTrustPreferencesUpsertRequest(payload.trustPreferences, metadata);
    const trustPreferencesResult = await seedcoreService.upsertTrustPreferences(trustRequest);
    const ownerPolicyRequest = this.toOwnerPolicyUpsertRequest(payload.ownerPolicy, payload.trustPreferences, metadata);

    try {
      const ownerPolicyResult = await seedcoreService.upsertOwnerPolicy(ownerPolicyRequest);
      return {
        trustPreferencesResult: this.toTrustPreferencesDraft(trustPreferencesResult) || payload.trustPreferences,
        ownerPolicyResult: this.toOwnerPolicyDraft(ownerPolicyResult) || payload.ownerPolicy,
      };
    } catch {
      return {
        trustPreferencesResult: this.toTrustPreferencesDraft(trustPreferencesResult) || payload.trustPreferences,
        partialFailure: {
          failedStep: 'owner-policy-upsert',
          retryPayload: ownerPolicyRequest,
        },
      };
    }
  }

  private toTrustPreferencesDraft(record: TrustPreferencesRecord | null): TrustPreferencesDraft | null {
    if (!record) return null;
    const blockedFromMetadata = Array.isArray((record.metadata as any)?.blocked_merchants)
      ? ((record.metadata as any).blocked_merchants as string[])
      : [];
    return {
      owner_id: record.owner_id,
      approval_required_above_amount: Number(record.high_value_step_up_threshold_usd || 0),
      high_risk_requires_manual_approval: typeof record.max_risk_score === 'number',
      trusted_merchants: record.merchant_allowlist || [],
      blocked_merchants: blockedFromMetadata,
      metadata: record.metadata,
    };
  }

  private toOwnerPolicyDraft(record: OwnerPolicyRecord | null): OwnerPolicyDraft | null {
    if (!record) return null;
    const allowRules = record.merchant_rules.filter((item) => item.disposition === 'ALLOW').map((item) => item.merchant);
    const denyRules = record.merchant_rules.filter((item) => item.disposition === 'DENY').map((item) => item.merchant);
    const spendControl = record.spend_controls[0];
    const metadata = (record.metadata || {}) as Record<string, unknown>;
    const requiredEvidenceModalities = Array.isArray(metadata.required_evidence_modalities)
      ? (metadata.required_evidence_modalities as string[])
      : [];

    return {
      owner_id: record.owner_id,
      policy_version: record.policy_version,
      action_family: record.approval_chains[0]?.action_family || 'purchase',
      allowed_merchants: allowRules,
      blocked_merchants: denyRules,
      transaction_limit: Number(spendControl?.per_transaction_limit || 0),
      required_evidence_modalities: requiredEvidenceModalities,
      escalation_channel: String(metadata.escalation_channel || 'human-review'),
      metadata: record.metadata,
    };
  }

  private toTrustPreferencesUpsertRequest(
    draft: TrustPreferencesDraft,
    metadata: Record<string, unknown>,
  ): TrustPreferencesUpsertRequest {
    return {
      owner_id: draft.owner_id,
      trust_version: 'v1',
      status: 'ACTIVE',
      max_risk_score: draft.high_risk_requires_manual_approval ? 0.85 : null,
      merchant_allowlist: uniqueStrings(draft.trusted_merchants),
      required_provenance_level: 'verified_attestation',
      required_evidence_modalities: ['receipt', 'device_attestation'],
      high_value_step_up_threshold_usd: draft.approval_required_above_amount,
      updated_by: 'policy_assistant',
      metadata: {
        ...metadata,
        blocked_merchants: uniqueStrings(draft.blocked_merchants),
        high_risk_requires_manual_approval: draft.high_risk_requires_manual_approval,
      },
    };
  }

  private toOwnerPolicyUpsertRequest(
    draft: OwnerPolicyDraft,
    trustPreferences: TrustPreferencesDraft,
    metadata: Record<string, unknown>,
  ): OwnerPolicyUpsertRequest {
    const merchantRules = [
      ...uniqueStrings(draft.allowed_merchants).map((merchant) => ({ merchant, disposition: 'ALLOW' as const })),
      ...uniqueStrings(draft.blocked_merchants).map((merchant) => ({ merchant, disposition: 'DENY' as const })),
    ];

    return {
      owner_id: draft.owner_id,
      policy_id: 'owner-policy-default',
      policy_version: draft.policy_version || 'v1',
      status: 'ACTIVE',
      default_disposition: 'DENY',
      allowed_categories: [],
      denied_categories: [],
      spend_controls: [
        {
          scope: 'global',
          currency: 'USD',
          per_transaction_limit: draft.transaction_limit,
          step_up_threshold: trustPreferences.approval_required_above_amount,
        },
      ],
      merchant_rules: merchantRules,
      publishing_rules: [],
      approval_chains: [
        {
          action_family: draft.action_family,
          threshold_type: 'DECLARED_VALUE_USD',
          threshold_value: trustPreferences.approval_required_above_amount || draft.transaction_limit,
          required_approval_count: 1,
          approver_roles: ['owner'],
          step_up_on_risk_score: trustPreferences.high_risk_requires_manual_approval ? 0.85 : null,
        },
      ],
      delegated_assistants: [],
      updated_by: 'policy_assistant',
      metadata: {
        ...metadata,
        escalation_channel: draft.escalation_channel,
        required_evidence_modalities: uniqueStrings(draft.required_evidence_modalities),
      },
    };
  }

  private toScenarioPackScenario(
    scenario: PolicyScenarioCase,
    ownerPolicy: OwnerPolicyDraft,
    trustPreferences: TrustPreferencesDraft,
    scenarioPackVersion: string,
  ) {
    const now = new Date();
    const requestedAt = now.toISOString();
    const validUntil = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const idBase = `${ownerPolicy.owner_id}-${scenario.scenario_id}-${now.getTime()}`;
    return {
      scenario_id: scenario.scenario_id,
      label: scenario.title,
      request: {
        contract_version: 'seedcore.agent_action_gateway.v1' as const,
        request_id: `req-${idBase}`,
        requested_at: requestedAt,
        idempotency_key: `idem-${idBase}`,
        policy_snapshot_ref: ownerPolicy.policy_version || 'v1',
        principal: {
          agent_id: 'policy-assistant-ui',
          role_profile: ownerPolicy.action_family || 'purchase',
          session_token: `session-${ownerPolicy.owner_id}`,
          owner_id: ownerPolicy.owner_id,
          delegation_ref: `delegation-${ownerPolicy.owner_id}`,
          hardware_fingerprint: {
            fingerprint_id: `fp-${ownerPolicy.owner_id}`,
            public_key_fingerprint: 'seedcore-policy-assistant-fingerprint',
          },
        },
        workflow: {
          type: 'restricted_custody_transfer' as const,
          action_type: scenario.action_type.toUpperCase(),
          valid_until: validUntil,
        },
        asset: {
          asset_id: `asset-${scenario.scenario_id}`,
          product_ref: scenario.merchant,
          provenance_hash: '0000000000000000000000000000000000000000000000000000000000000000',
          declared_value_usd: scenario.amount,
          from_zone: 'origin',
          to_zone: scenario.channel || 'destination',
        },
        approval: {
          approval_envelope_id: `approval-${scenario.scenario_id}`,
          expected_envelope_version: scenarioPackVersion,
        },
        authority_scope: {
          scope_id: `scope-${scenario.scenario_id}`,
          asset_ref: `asset-${scenario.scenario_id}`,
          product_ref: scenario.merchant,
          expected_to_zone: scenario.channel || 'destination',
          facility_ref: 'policy-assistant-sim',
        },
        telemetry: {
          observed_at: requestedAt,
          current_zone: scenario.channel || 'destination',
          evidence_refs: scenario.evidence_modalities.map((item) => `evidence:${item}`),
          max_allowed_age_seconds: 300,
        },
        security_contract: {
          hash: 'policy-assistant-sim-contract',
          version: 'v1',
        },
        options: {
          debug: false,
          no_execute: true,
        },
      },
    };
  }

  private mapTriggeringFields(reasonCode: string, trustGaps: string[]): string[] {
    const mapped = new Set<string>();
    if (reasonCode.includes('merchant')) mapped.add('blocked_merchants');
    if (reasonCode.includes('evidence')) mapped.add('required_evidence_modalities');
    if (reasonCode.includes('risk')) mapped.add('high_risk_requires_manual_approval');
    if (reasonCode.includes('amount')) mapped.add('approval_required_above_amount');
    if (trustGaps.some((x) => x.includes('channel'))) mapped.add('escalation_channel');
    return mapped.size ? Array.from(mapped) : ['action_family'];
  }
}

export const policyAssistantService = new PolicyAssistantService();
