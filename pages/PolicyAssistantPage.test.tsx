import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockPolicyAssistantService } = vi.hoisted(() => ({
  mockPolicyAssistantService: {
    makeAssistantRunId: vi.fn(() => 'pa_owner-001_fixed'),
    initialize: vi.fn(async () => ({ trustPreferences: null, ownerPolicy: null })),
    buildDraftFromIntent: vi.fn(() => ({
      ownerPolicyDraft: {
        owner_id: 'owner-001',
        policy_version: 'v1',
        action_family: 'purchase',
        allowed_merchants: ['trusted-mart'],
        blocked_merchants: ['scam-outlet'],
        transaction_limit: 1000,
        required_evidence_modalities: ['receipt', 'device_attestation'],
        escalation_channel: 'human-review',
      },
      trustPreferencesDraft: {
        owner_id: 'owner-001',
        approval_required_above_amount: 750,
        high_risk_requires_manual_approval: true,
        trusted_merchants: ['trusted-mart'],
        blocked_merchants: ['scam-outlet'],
      },
    })),
    buildScenarioPackDefaults: vi.fn(() => ({
      version: 'mvp-v1',
      scenarios: [
        {
          scenario_id: 'safe_low_value_trusted',
          title: 'safe low-value trusted merchant purchase',
          action_type: 'purchase',
          merchant: 'trusted-mart',
          amount: 42,
          risk_score: 0.08,
          evidence_modalities: ['receipt', 'device_attestation'],
        },
      ],
    })),
    runPreflight: vi.fn(async () => ({
      decision: 'allow',
      reason_code: 'owner_context_ready',
      trust_gaps: [],
      required_approvals: [],
      facts: [],
      inferences: [],
      owner_context_hash: 'ctx_hash_from_backend',
      technical_details: {},
    })),
    runScenarioPack: vi.fn(async () => ([
      {
        scenario_id: 'safe_low_value_trusted',
        decision: 'allow',
        reason_code: 'ok',
        trust_gaps: [],
        required_approvals: [],
        triggering_policy_fields: ['action_family'],
      },
    ])),
    commit: vi.fn(async () => ({
      trustPreferencesResult: {
        owner_id: 'owner-001',
        approval_required_above_amount: 750,
        high_risk_requires_manual_approval: true,
        trusted_merchants: ['trusted-mart'],
        blocked_merchants: ['scam-outlet'],
      },
      ownerPolicyResult: {
        owner_id: 'owner-001',
        policy_version: 'v2',
        action_family: 'purchase',
        allowed_merchants: ['trusted-mart'],
        blocked_merchants: ['scam-outlet'],
        transaction_limit: 1000,
        required_evidence_modalities: ['receipt', 'device_attestation'],
        escalation_channel: 'human-review',
      },
    })),
  },
}));

vi.mock('../services/policyAssistantService', () => ({
  policyAssistantService: mockPolicyAssistantService,
}));

import { PolicyAssistantPage } from './PolicyAssistantPage';

describe('PolicyAssistantPage flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPolicyAssistantService.makeAssistantRunId.mockReturnValue('pa_owner-001_fixed');
    mockPolicyAssistantService.initialize.mockResolvedValue({ trustPreferences: null, ownerPolicy: null });
  });

  it('enforces step gating and uses backend owner_context_hash through commit', async () => {
    render(<PolicyAssistantPage />);

    const nextButton = screen.getByRole('button', { name: 'Next' });
    expect(nextButton).toBeDisabled();

    fireEvent.change(document.querySelector('textarea')!, {
      target: { value: 'Allow trusted purchases with escalation for risky cases' },
    });
    expect(nextButton).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Generate Draft' }));
    fireEvent.click(nextButton);
    fireEvent.click(nextButton);

    expect(nextButton).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Run Preflight' }));
    await waitFor(() => expect(screen.getByText(/Reason code:/)).toBeInTheDocument());
    expect(nextButton).toBeEnabled();

    fireEvent.click(nextButton);
    expect(nextButton).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Run Scenarios' }));
    await waitFor(() => expect(screen.getByText('safe_low_value_trusted')).toBeInTheDocument());
    expect(nextButton).toBeEnabled();

    fireEvent.click(nextButton);
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm I want to commit/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));

    await waitFor(() => expect(screen.getByText(/Commit succeeded:/)).toBeInTheDocument());
    expect(screen.getByText('ctx_hash_from_backend')).toBeInTheDocument();
  });
});
