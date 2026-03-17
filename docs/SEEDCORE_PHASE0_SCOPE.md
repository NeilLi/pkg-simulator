# SeedCore Runtime Phase 0 Scope

This note locks the product boundary for the next round of SeedCore runtime work so schema, API, and simulator changes stay pointed at the same target.

## Scope Decision

### Platform Name

- `SeedCore` remains the runtime, control-plane, and repository identity.
- `pkg_simulator` remains a surface inside the platform for policy authoring, scenario design, and pre-deployment evaluation.
- "Policy assistant" refers to one operator-facing interface, not the product itself.

### System Boundary

SeedCore is the governed runtime between AI-generated intent and external execution. It owns:

- intent accountability contracts
- deterministic policy evaluation
- approval and escalation gating
- execution token issuance
- twin-state verification
- provenance and evidence replay

SeedCore does not become:

- a generic assistant shell
- a pure simulator detached from runtime contracts
- a domain-specific marketplace app

Those are operator surfaces or integrations around the runtime.

## Product Framing

### Runtime

The runtime goal is no longer just "govern release-style custody actions safely." It is:

> Govern owner-delegated publish, purchase, listing, unlisting, and approval actions with explicit policy contracts, replayable evidence, and deny-by-default execution.

### Simulator

`pkg_simulator` should evolve from a hospitality-flavored scenario app into a policy workbench that supports:

- authoring owner policy contracts
- testing commerce and publishing scenarios
- comparing policy outcomes across snapshots
- visualizing approval chains and evidence gaps
- inspecting twin-state inputs used by the PDP

For this simulator phase, the app may assume a trusted operator context. Login, user-role enforcement, and policy-management RBAC are intentionally out of scope here and belong to the future production control plane.

### Assistant Surface

The assistant layer should remain advisory. It may:

- help draft policies
- summarize policy outcomes
- propose intents
- explain deny codes and approval requirements

It may not authorize actions directly.

## Phase 0 Deliverables

### Deliverable 1: Runtime Vocabulary

The primary runtime action families for the next phase are:

- `PUBLISH`
- `PURCHASE`
- `APPROVE`
- `LIST`
- `UNLIST`

These are in addition to existing custody-oriented actions and should coexist during migration.

### Deliverable 2: Twin Expansion

SeedCore's runtime model should explicitly recognize these digital twin classes:

- owner
- assistant
- product
- listing
- transaction
- asset
- edge

### Deliverable 3: Policy Focus Areas

First-class owner policy must cover:

- category controls
- spend and budget controls
- merchant and marketplace trust rules
- publishing authority by channel
- approval chains by action type
- freshness and conflict checks for listing and transaction twins

## Non-Goals For This Phase

- renaming the `seedcore` package
- replacing the current governance engine with cognitive logic
- removing existing custody/release flows
- designing a full marketplace backend inside SeedCore
- implementing production authentication or RBAC for policy authoring and promotion

## Delivery Sequence

1. Define first-class policy contracts and twin schemas.
2. Extend governance evaluation with domain-specific deny codes and approval checks.
3. Replace simulator-era PKG request vocabulary with owner-policy and commerce/publishing scenarios.
4. Build out the simulator as a policy workbench against those contracts.

## Acceptance Criteria

Phase 0 is complete when the team can answer these questions consistently:

- What is SeedCore? A runtime and control plane.
- What is `pkg_simulator`? A policy authoring and scenario-testing surface.
- What is the assistant? An advisory interface.
- What domain are we expanding into? Owner delegation, commerce, publishing, and approvals.
- What stays true architecturally? AI proposes, accountable agents submit intent, policy decides, execution remains token-gated.
