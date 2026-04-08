import { describe, expect, it, beforeEach, vi } from 'vitest';

const { mockSeedcoreService } = vi.hoisted(() => ({
  mockSeedcoreService: {
    getTrustPreferences: vi.fn(),
    getOwnerPolicy: vi.fn(),
    preflightOwnerContext: vi.fn(),
    evaluatePolicyScenarioPack: vi.fn(),
    upsertTrustPreferences: vi.fn(),
    upsertOwnerPolicy: vi.fn(),
  },
}));

vi.mock('./seedcoreService', () => ({
  seedcoreService: mockSeedcoreService,
}));

import { policyAssistantService } from './policyAssistantService';

describe('policyAssistantService.commit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('commits trust preferences before owner policy', async () => {
    mockSeedcoreService.upsertTrustPreferences.mockResolvedValue({
      owner_id: 'owner-001',
      trust_version: 'v1',
      status: 'ACTIVE',
      merchant_allowlist: ['trusted-mart'],
      required_evidence_modalities: ['receipt', 'device_attestation'],
      high_value_step_up_threshold_usd: 750,
      metadata: {},
    });
    mockSeedcoreService.upsertOwnerPolicy.mockResolvedValue({
      owner_id: 'owner-001',
      policy_id: 'owner-policy-default',
      policy_version: 'v1',
      status: 'ACTIVE',
      default_disposition: 'DENY',
      allowed_categories: [],
      denied_categories: [],
      spend_controls: [{ scope: 'global', currency: 'USD', per_transaction_limit: 1000 }],
      merchant_rules: [],
      publishing_rules: [],
      approval_chains: [],
      delegated_assistants: [],
      metadata: {},
    });

    await policyAssistantService.commit({
      trustPreferences: {
        owner_id: 'owner-001',
        approval_required_above_amount: 750,
        high_risk_requires_manual_approval: true,
        trusted_merchants: ['trusted-mart'],
        blocked_merchants: ['scam-outlet'],
      },
      ownerPolicy: {
        owner_id: 'owner-001',
        policy_version: 'v1',
        action_family: 'purchase',
        allowed_merchants: ['trusted-mart'],
        blocked_merchants: ['scam-outlet'],
        transaction_limit: 1000,
        required_evidence_modalities: ['receipt', 'device_attestation'],
        escalation_channel: 'human-review',
      },
      assistantRunId: 'pa_owner-001_123',
      uiVersion: 'policy-assistant-ui-mvp-v1',
      scenarioPackVersion: 'mvp-v1',
      intentText: 'allow low value trusted purchases',
    });

    expect(mockSeedcoreService.upsertTrustPreferences).toHaveBeenCalledTimes(1);
    expect(mockSeedcoreService.upsertOwnerPolicy).toHaveBeenCalledTimes(1);
    expect(
      mockSeedcoreService.upsertTrustPreferences.mock.invocationCallOrder[0],
    ).toBeLessThan(mockSeedcoreService.upsertOwnerPolicy.mock.invocationCallOrder[0]);
  });

  it('returns partial failure payload when owner-policy upsert fails', async () => {
    mockSeedcoreService.upsertTrustPreferences.mockResolvedValue({
      owner_id: 'owner-001',
      trust_version: 'v1',
      status: 'ACTIVE',
      merchant_allowlist: ['trusted-mart'],
      required_evidence_modalities: ['receipt', 'device_attestation'],
      high_value_step_up_threshold_usd: 750,
      metadata: {},
    });
    mockSeedcoreService.upsertOwnerPolicy.mockRejectedValue(new Error('boom'));

    const result = await policyAssistantService.commit({
      trustPreferences: {
        owner_id: 'owner-001',
        approval_required_above_amount: 750,
        high_risk_requires_manual_approval: true,
        trusted_merchants: ['trusted-mart'],
        blocked_merchants: ['scam-outlet'],
      },
      ownerPolicy: {
        owner_id: 'owner-001',
        policy_version: 'v1',
        action_family: 'purchase',
        allowed_merchants: ['trusted-mart'],
        blocked_merchants: ['scam-outlet'],
        transaction_limit: 1000,
        required_evidence_modalities: ['receipt', 'device_attestation'],
        escalation_channel: 'human-review',
      },
      assistantRunId: 'pa_owner-001_123',
      uiVersion: 'policy-assistant-ui-mvp-v1',
      scenarioPackVersion: 'mvp-v1',
      intentText: 'allow low value trusted purchases',
    });

    expect(result.partialFailure?.failedStep).toBe('owner-policy-upsert');
    expect(result.partialFailure?.retryPayload.owner_id).toBe('owner-001');
    expect(mockSeedcoreService.upsertTrustPreferences).toHaveBeenCalledTimes(1);
    expect(mockSeedcoreService.upsertOwnerPolicy).toHaveBeenCalledTimes(1);
  });
});
