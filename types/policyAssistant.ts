export type DecisionLabel = 'allow' | 'block' | 'needs approval' | 'error';

export interface PolicyAssistantIntentInput {
  ownerId: string;
  intentText: string;
  actionFamily: string;
  riskLevel: 'low' | 'medium' | 'high';
  requiresApprovalForHighRisk: boolean;
  blockedMerchantsText: string;
}

export interface OwnerPolicyDraft {
  owner_id: string;
  policy_version?: string;
  action_family: string;
  allowed_merchants: string[];
  blocked_merchants: string[];
  transaction_limit: number;
  required_evidence_modalities: string[];
  escalation_channel: string;
  metadata?: Record<string, unknown>;
}

export interface TrustPreferencesDraft {
  owner_id: string;
  approval_required_above_amount: number;
  high_risk_requires_manual_approval: boolean;
  trusted_merchants: string[];
  blocked_merchants: string[];
  metadata?: Record<string, unknown>;
}

export interface PolicyScenarioCase {
  scenario_id: string;
  title: string;
  action_type: string;
  merchant: string;
  amount: number;
  risk_score: number;
  evidence_modalities: string[];
  channel?: string;
}

export interface PolicyScenarioResult {
  scenario_id: string;
  decision: DecisionLabel;
  reason_code: string;
  trust_gaps: string[];
  required_approvals: string[];
  triggering_policy_fields: string[];
}

export interface OwnerContextPreflightResult {
  decision: DecisionLabel;
  reason_code: string;
  trust_gaps: string[];
  required_approvals: string[];
  facts: Array<{ path: string; value: string }>;
  inferences: Array<{ statement: string; based_on_paths: string[] }>;
  owner_context_hash?: string;
  technical_details?: Record<string, unknown>;
}

export interface PolicyAssistantSessionState {
  intent: PolicyAssistantIntentInput;
  ownerPolicyDraft: OwnerPolicyDraft;
  trustPreferencesDraft: TrustPreferencesDraft;
  scenarios: PolicyScenarioCase[];
  preflight?: OwnerContextPreflightResult;
  scenarioResults?: PolicyScenarioResult[];
  assistantRunId: string;
  uiVersion: string;
  scenarioPackVersion: string;
}
