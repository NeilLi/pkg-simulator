# SeedCore Runtime Phase 1 Schema Proposal

This document defines the first-pass contract expansion needed to move SeedCore from generic governed execution into explicit owner-policy enforcement for commerce and publishing workflows.

## Goals

- preserve the existing `ActionIntent` and `PolicyCase` structure
- introduce domain contracts without breaking current custody flows
- make owner policy explicit instead of hiding it inside generic JSON blobs
- support simulator and API work with stable field names

## Authority Boundary

For `pkg-simulator`, "policy defines authority" refers to runtime/business authority over governed actions such as `PUBLISH`, `PURCHASE`, `LIST`, and `APPROVE`.

Application-layer authority over who may log in, author policy, approve policy changes, or promote snapshots is deferred for now. The simulator assumes a trusted operator context, and future authentication and RBAC should be implemented in the production control plane rather than folded into the policy schema itself.

## Core Schema Additions

### 1. Action Families

Add domain action families alongside the current action types:

- `PUBLISH`
- `PURCHASE`
- `APPROVE`
- `LIST`
- `UNLIST`

These should be treated as governed business actions, not advisory annotations.

### 2. Domain Context Attached To Intent

Extend the action/resource context with optional, typed business fields:

- `owner_id`
- `product_id`
- `listing_id`
- `transaction_id`
- `category`
- `amount`
- `currency`
- `merchant`
- `marketplace`
- `channel`
- `counterparty`

Current custody fields such as `asset_id`, `target_zone`, and `provenance_hash` stay valid.

### 3. First-Class Policy Objects

Introduce explicit policy models instead of relying on open-ended `delegation`, `risk`, and `custody` dictionaries for business policy.

#### OwnerPolicy

Represents the owner's delegated operating policy.

Suggested fields:

- `owner_id`
- `policy_id`
- `policy_version`
- `status`
- `default_disposition`
- `allowed_categories`
- `denied_categories`
- `spend_controls`
- `merchant_rules`
- `publishing_rules`
- `approval_chains`
- `delegated_assistants`

#### SpendControl

Represents budget and transaction limits.

Suggested fields:

- `scope`
- `category`
- `currency`
- `per_transaction_limit`
- `daily_limit`
- `weekly_limit`
- `monthly_limit`
- `remaining_budget`
- `step_up_threshold`

#### MerchantTrustRule

Represents merchant or marketplace trust posture.

Suggested fields:

- `merchant`
- `marketplace`
- `disposition`
- `required_provenance`
- `max_amount`
- `allowed_categories`
- `blocked_reason`

#### PublishingAuthorityRule

Represents channel-specific publishing authority.

Suggested fields:

- `channel`
- `content_type`
- `product_category`
- `disposition`
- `max_publish_value`
- `requires_review`
- `required_approvals`

#### ApprovalChain

Represents deterministic approval requirements by action family.

Suggested fields:

- `action_family`
- `threshold_type`
- `threshold_value`
- `required_approval_count`
- `approver_roles`
- `step_up_on_risk_score`
- `step_up_on_amount`

## Digital Twin Expansion

The current `TwinSnapshot` shape is reusable, but these twin classes should become first-class:

### OwnerTwin

- owner identity
- delegation status
- active policy reference
- budget status
- trust preferences

### ProductTwin

- product identity
- category
- provenance summary
- allowed channels
- lifecycle status

### ListingTwin

- listing identity
- channel
- publication status
- owner/product linkage
- moderation or compliance flags

### TransactionTwin

- transaction identity
- merchant
- amount/currency
- authorization state
- settlement or dispute state

## Governance Mapping

The new schema should drive deterministic checks in this order:

1. baseline runtime checks
   - TTL
   - principal identity
   - security contract version
   - source registration approval
   - twin freshness and lockouts
2. owner-policy checks
   - category allow or deny
   - spend limit and remaining budget
   - merchant or marketplace trust rule
   - channel publishing authority
   - action-specific approval chain
3. cognitive or advisory overlays
   - risk-driven step-up recommendations
   - evidence gaps
   - escalation guidance

## Suggested Deny Codes

Add domain-specific deny and escalation codes:

- `category_denied`
- `budget_exhausted`
- `amount_exceeds_limit`
- `merchant_blocked`
- `marketplace_blocked`
- `channel_not_authorized`
- `approval_required`
- `approval_threshold_not_met`
- `listing_twin_stale`
- `transaction_twin_stale`

## Backward-Compatible Migration

### Existing Shape

Today, business meaning is inferred from:

- `TwinSnapshot.delegation`
- `TwinSnapshot.risk`
- `TwinSnapshot.custody`
- `TwinSnapshot.provenance`

### Migration Approach

1. keep those fields intact
2. add typed policy objects beside them
3. hydrate the typed policy objects from the old dictionaries where needed
4. migrate APIs and fixtures to prefer typed fields
5. retire implicit business policy only after test coverage is complete

## Proposed File Targets In SeedCore

When implementation starts in the `seedcore` repo, these are the likely touchpoints:

- `src/seedcore/models/action_intent.py`
- `src/seedcore/models/twins.py` or a new policy-domain models module
- `src/seedcore/coordinator/core/governance.py`
- `src/seedcore/api/routers/pkg_router.py`
- `tests/test_action_intent.py`
- new governance policy tests for owner-policy decisions

## Acceptance Criteria

Phase 1 is complete when:

- domain action families exist as first-class values
- owner policy is modeled explicitly
- product, listing, and transaction twins have stable schemas
- governance can emit domain-specific deny codes
- simulator and API payloads can describe publish and purchase cases without hospitality-specific predicates
