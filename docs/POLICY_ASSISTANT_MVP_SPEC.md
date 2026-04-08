# Policy Assistant MVP Spec (pkg-simulator UI + Integration)

Date: 2026-04-08  
Status: Implementation-ready MVP UI spec

## 1) Goal

Ship a user-facing Policy Assistant for general users that:

- collects plain-language policy intent
- translates to typed policy contract fields
- runs deterministic preflight and scenario checks via SeedCore
- explains outcomes clearly before commit
- commits only after explicit human confirmation

The assistant remains advisory and does not directly authorize runtime actions.

## 2) New UI Surface

Add one new first-class page:

- `Policy Assistant`

Page role in product flow:

- sits before `Policy Studio`
- targets non-expert policy setup and review
- writes typed policy/trust preferences, not raw PKG rules

## 3) Exact File Changes (pkg-simulator)

### 3.1 Navigation and page wiring

- `appPages.ts`
  - add enum value: `POLICY_ASSISTANT = 'policy-assistant'`
  - include in `FEATURE_SEQUENCE` after `SEED_DATA` and before `POLICY_STUDIO`
  - add metadata label/description
  - assign group: `FeatureGroup.CREATION`

- `components/Layout.tsx`
  - map icon for `POLICY_ASSISTANT` (recommend `Shield` or `Bot`)

- `App.tsx`
  - import page component `PolicyAssistantPage`
  - add mapping entry in `PAGE_COMPONENTS`

### 3.2 New page and UI components

- `pages/PolicyAssistantPage.tsx` (new)
  - parent stepper orchestration
  - state for owner context, draft policy, trust preferences, scenario pack, results, commit status

- `components/policy-assistant/PolicyIntentStep.tsx` (new)
  - plain-language input form
  - action family selection
  - risk/approval preferences

- `components/policy-assistant/PolicyDraftStep.tsx` (new)
  - typed draft editor
  - diff block: previous active policy vs candidate draft

- `components/policy-assistant/PreflightStep.tsx` (new)
  - owner-context preflight result card
  - trust-gap and reason-code rendering

- `components/policy-assistant/ScenarioPackStep.tsx` (new)
  - batch simulation table
  - summary counters and per-scenario decision rows

- `components/policy-assistant/ReviewCommitStep.tsx` (new)
  - explicit confirmation checkbox
  - commit button
  - post-commit references (`policy_version`, `owner_context_hash`)

### 3.3 Service layer additions

- `services/seedcoreService.ts`
  - add typed request/response interfaces and methods:
  - `getTrustPreferences(ownerId)`
  - `upsertTrustPreferences(payload)`
  - `getOwnerPolicy(ownerId)` (new SeedCore endpoint)
  - `upsertOwnerPolicy(payload)` (new SeedCore endpoint)
  - `preflightOwnerContext(payload)` (new SeedCore endpoint)
  - `evaluatePolicyScenarioPack(payload)` (new SeedCore endpoint)

- `services/policyAssistantService.ts` (new)
  - UI-focused orchestration wrapper around `seedcoreService`
  - converts free-text intent into typed draft skeleton
  - builds scenario pack fixtures
  - handles commit sequence and rollback messaging

### 3.4 Local types

- `types.ts` or `types/policyAssistant.ts` (new)
  - `PolicyAssistantIntentInput`
  - `OwnerPolicyDraft`
  - `TrustPreferencesDraft`
  - `PolicyScenarioCase`
  - `PolicyScenarioResult`
  - `PolicyAssistantSessionState`

## 4) UX State Machine (Exact)

Implement these steps in order:

1. `Capture Intent`
2. `Draft Policy`
3. `Run Owner Preflight`
4. `Run Scenario Pack`
5. `Review And Commit`

Button behavior:

- `Next` disabled until current step required fields pass validation
- `Run Preflight` required before entering scenario step
- `Run Scenarios` required before entering commit step
- `Commit` disabled until confirmation checkbox is checked

## 5) API Call Sequence

### Step 1: Initialize

- `GET /api/v1/trust-preferences/{owner_id}`
- `GET /api/v1/owner-policies/{owner_id}` (new)

### Step 2: Draft validation

- local validation only (required fields, enums, numeric ranges)

### Step 3: Owner preflight

- `POST /api/v1/owner-context/preflight` (new)

### Step 4: Scenario pack

- `POST /api/v1/policy-assistant/scenario-pack/evaluate` (new)

### Step 5: Commit sequence

Execute in this order:

1. `POST /api/v1/trust-preferences`
2. `POST /api/v1/owner-policies` (new)

Failure policy:

- if trust preferences upsert succeeds but owner policy upsert fails, keep UI in partial-failure state and show exact retry payload
- do not silently retry commits with a new version id

## 6) Scenario Pack (MVP Defaults)

Hardcode six baseline scenarios in `policyAssistantService.ts`:

- safe low-value trusted merchant purchase
- high-value trusted merchant purchase
- blocked merchant purchase
- missing required evidence modality
- high-risk purchase requiring escalation
- publish action to unauthorized channel

Each scenario result row must show:

- `decision`
- `reason_code`
- `trust_gaps`
- `required_approvals`
- `triggering_policy_fields` (mapped in UI from reason/trust-gap taxonomy)

## 7) UI Rendering Rules

Policy explanation panel must separate:

- `Facts`
- `Inferences`

Each inference must reference at least one factual field path.

Risk language:

- use plain labels: `allow`, `block`, `needs approval`
- avoid internal-only terms in default view
- provide expandable technical detail panel for power users

## 8) Copy and User Safety Constraints

Display these fixed rules in the commit step:

- "This assistant is advisory."
- "Final runtime authorization still happens in SeedCore policy evaluation."
- "Simulation results are predictive and based on current policy snapshot and inputs."

Never show:

- "Guaranteed allowed in production"
- "Policy is irreversible/final forever"

## 9) Telemetry and Audit Fields (UI Emission)

Attach these metadata fields when committing:

- `assistant_run_id`
- `ui_version`
- `scenario_pack_version`
- `policy_intent_text_hash`

Persist under `metadata` in both trust-preference and owner-policy upserts.

## 10) Acceptance Criteria

MVP UI is complete when:

- new `Policy Assistant` page is reachable from sidebar
- a user can complete all 5 steps without touching raw rule authoring
- preflight and scenario results are visible before commit
- commit writes both trust preferences and owner policy successfully
- users can reopen the page and see previously saved active policy/trust values

## 11) Delivery Order

1. Add navigation and empty page shell.
2. Implement service methods in `seedcoreService.ts`.
3. Implement stepper flow with local state and validation.
4. Integrate owner preflight and scenario pack APIs.
5. Implement commit sequence and partial-failure handling.
6. Add UI tests for step gating and commit flow.

Companion backend contract spec:

- `/Users/ningli/project/seedcore/docs/development/policy_assistant_mvp_spec.md`
