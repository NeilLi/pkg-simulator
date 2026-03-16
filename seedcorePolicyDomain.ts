export type SeedCoreActionFamily =
  | 'PICK'
  | 'PLACE'
  | 'SCAN'
  | 'SEAL'
  | 'TRANSPORT'
  | 'RELEASE'
  | 'LOCK'
  | 'QUARANTINE'
  | 'PUBLISH'
  | 'PURCHASE'
  | 'APPROVE'
  | 'LIST'
  | 'UNLIST';

export type PolicyDisposition = 'allow' | 'deny' | 'escalate';

export type PolicyStatus = 'draft' | 'active' | 'suspended' | 'revoked';

export type BudgetWindow = 'transaction' | 'daily' | 'weekly' | 'monthly';

export type ApprovalThresholdType = 'amount' | 'risk_score' | 'category' | 'channel';

export type TwinFreshnessStatus = 'fresh' | 'stale' | 'unknown';

export interface SecurityContractRef {
  hash: string;
  version: string;
}

export interface IntentPrincipalContract {
  agentId: string;
  roleProfile: string;
  sessionToken: string;
}

export interface SpendControlContract {
  scope: BudgetWindow;
  category?: string;
  currency: string;
  perTransactionLimit?: number;
  dailyLimit?: number;
  weeklyLimit?: number;
  monthlyLimit?: number;
  remainingBudget?: number;
  stepUpThreshold?: number;
}

export interface MerchantTrustRuleContract {
  merchant?: string;
  marketplace?: string;
  disposition: PolicyDisposition;
  requiredProvenance?: string[];
  maxAmount?: number;
  allowedCategories?: string[];
  blockedReason?: string;
}

export interface PublishingAuthorityRuleContract {
  channel: string;
  contentType?: string;
  productCategory?: string;
  disposition: PolicyDisposition;
  maxPublishValue?: number;
  requiresReview?: boolean;
  requiredApprovals?: string[];
}

export interface ApprovalChainContract {
  actionFamily: SeedCoreActionFamily;
  thresholdType: ApprovalThresholdType;
  thresholdValue?: number | string;
  requiredApprovalCount: number;
  approverRoles: string[];
  stepUpOnRiskScore?: number;
  stepUpOnAmount?: number;
}

export interface OwnerPolicyContract {
  ownerId: string;
  policyId: string;
  policyVersion: string;
  status: PolicyStatus;
  defaultDisposition: PolicyDisposition;
  allowedCategories: string[];
  deniedCategories: string[];
  spendControls: SpendControlContract[];
  merchantRules: MerchantTrustRuleContract[];
  publishingRules: PublishingAuthorityRuleContract[];
  approvalChains: ApprovalChainContract[];
  delegatedAssistants: string[];
}

export interface IntentBusinessContextContract {
  ownerId?: string;
  productId?: string;
  listingId?: string;
  transactionId?: string;
  category?: string;
  amount?: number;
  currency?: string;
  merchant?: string;
  marketplace?: string;
  channel?: string;
  counterparty?: string;
}

export interface IntentResourceContract {
  assetId?: string;
  targetZone?: string;
  provenanceHash?: string;
  sourceRegistrationId?: string;
  registrationDecisionId?: string;
  businessContext?: IntentBusinessContextContract;
}

export interface IntentActionContract {
  type: SeedCoreActionFamily;
  parameters: Record<string, unknown>;
  securityContract: SecurityContractRef;
}

export interface ActionIntentContract {
  intentId: string;
  timestamp: string;
  validUntil: string;
  principal: IntentPrincipalContract;
  action: IntentActionContract;
  resource: IntentResourceContract;
}

export interface TwinFreshnessContract {
  status: TwinFreshnessStatus;
  observedAt?: string;
  maxAgeSeconds?: number;
}

export interface BaseTwinContract {
  twinType: string;
  twinId: string;
  freshness: TwinFreshnessContract;
  identity: Record<string, unknown>;
  conflicts: string[];
  lockouts: string[];
}

export interface OwnerTwinContract extends BaseTwinContract {
  twinType: 'owner';
  delegation: {
    revoked?: boolean;
    delegatedAssistants?: string[];
  };
  activePolicy?: OwnerPolicyContract;
  budget: {
    remainingByCurrency?: Record<string, number>;
    exhaustedCategories?: string[];
  };
  trust: {
    preferredChannels?: string[];
    blockedMerchants?: string[];
  };
}

export interface ProductTwinContract extends BaseTwinContract {
  twinType: 'product';
  product: {
    productId: string;
    category: string;
    lifecycleStatus?: string;
    allowedChannels?: string[];
  };
  provenance: {
    provenanceHash?: string;
    sourceRegistrationId?: string;
  };
}

export interface ListingTwinContract extends BaseTwinContract {
  twinType: 'listing';
  listing: {
    listingId: string;
    channel: string;
    status: string;
    ownerId?: string;
    productId?: string;
  };
  moderation: {
    flags?: string[];
    reviewState?: string;
  };
}

export interface TransactionTwinContract extends BaseTwinContract {
  twinType: 'transaction';
  transaction: {
    transactionId: string;
    merchant?: string;
    marketplace?: string;
    amount?: number;
    currency?: string;
    authorizationState?: string;
    settlementState?: string;
    disputeState?: string;
  };
}

export type PolicyTwinContract =
  | OwnerTwinContract
  | ProductTwinContract
  | ListingTwinContract
  | TransactionTwinContract;

export interface PolicyCaseContract {
  actionIntent: ActionIntentContract;
  policySnapshot?: string;
  ownerPolicy?: OwnerPolicyContract;
  relevantTwins: Record<string, PolicyTwinContract>;
  approvedSourceRegistrations: Record<string, string | null>;
  telemetrySummary: Record<string, unknown>;
  evidenceSummary: Record<string, unknown>;
}

export const SEEDCORE_OWNER_POLICY_DENY_CODES = [
  'category_denied',
  'budget_exhausted',
  'amount_exceeds_limit',
  'merchant_blocked',
  'marketplace_blocked',
  'channel_not_authorized',
  'approval_required',
  'approval_threshold_not_met',
  'listing_twin_stale',
  'transaction_twin_stale',
] as const;

export type SeedCoreOwnerPolicyDenyCode =
  typeof SEEDCORE_OWNER_POLICY_DENY_CODES[number];
