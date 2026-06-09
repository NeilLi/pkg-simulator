# SeedCore PDP Simulator Infrastructure Plan

Status: Planning baseline  
Scope: `pkg-simulator` as a SeedCore PDP workbench, not the production PDP

## Executive Direction

`pkg-simulator` should become the rehearsal surface for SeedCore's deterministic execution-governance runtime. It should prove, before production integration, that a governed request can be evaluated from a signed authority context, a policy snapshot, materialized trust context, and replayable evidence.

The simulator must preserve the SeedCore boundary:

- SeedCore is the trust runtime and control plane for AI actions in high-consequence environments.
- The simulator is a policy authoring, scenario design, and pre-deployment evaluation surface.
- The assistant remains advisory and does not authorize execution.
- Runtime authority stays token-gated and PDP-evaluated.

## Target PDP Model

The simulator should align future scenarios around this deterministic shape:

```text
Decision = f(Request, Signed Context, Policy Snapshot, Evidence, Materialized Context)
```

The purpose is not to build a pure ReBAC system. Relationship and ownership context can feed the local read view, but SeedCore's core problem is execution governance: bounded actions, approvals, telemetry freshness, delegation, custody, evidence, and replay.

## Architecture Triad

### 1. Authority Portability

Goal: model Biscuit-style authority envelopes without making token design depend on a remote database lookup at decision time.

Simulator work:

- Replace digest-shaped `ExecutionToken` examples with an explicit authority envelope contract.
- Include attenuations such as action family, asset scope, zone transition, approval envelope, valid-until time, no-execute flag, and evidence requirements.
- Add examples for delegation narrowing across assistant, operator, and governed-agent handoff.
- Add negative fixtures for missing approval envelope, wrong asset scope, expired envelope, and unsupported action family.

Production implication:

- SeedCore can later bind this envelope to real signatures and verification libraries while preserving the simulator's request shape.

### 2. Causal Freshness

Goal: model Zanzibar-style revision freshness as a local PDP precondition, without making ReBAC the core PDP engine.

Simulator work:

- Add authority freshness fields to scenario payloads:
  - `min_authority_revision`
  - `context_revision`
  - `policy_snapshot_hash`
  - `materialized_revision`
- Add stale-context scenarios where the PDP rejects an otherwise valid request.
- Add UI trace rows that distinguish policy deny, stale context, missing evidence, and local fail-closed behavior.
- Keep stale/out-of-bounds telemetry as upstream PDP preflight paths when buildable, while missing evidence should short-circuit locally.

Production implication:

- SeedCore gets a clear path to reject stale authority without distributed locks in the hot path.

### 3. CDC-Backed Local Context

Goal: evolve semantic hydration into a Trust Context Materializer prototype.

Simulator work:

- Treat facts, tracking events, tasks, and unified memory as projected read-view inputs.
- Add materialization metadata:
  - `source_event_id`
  - `source_sequence`
  - `projected_at`
  - `materializer_lag_ms`
  - `materialized_revision`
- Add scenarios for projection lag, missing projection, conflicting twin state, and outdated owner policy.
- Keep semantic retrieval as explanatory context, not authority by itself.

Production implication:

- SeedCore can use CDC to keep local read views hot while preserving deterministic replay and auditability.

## Workstreams

### Workstream A: Contracts

Define stable simulator-side contracts for:

- authority envelope
- freshness marker
- materialized context summary
- evidence bundle summary
- PDP decision trace

Acceptance criteria:

- Scenario inputs can express signed context, revision freshness, policy snapshot, telemetry, and evidence references.
- Decision outputs can explain allow, deny, escalate, quarantine, and stale-context outcomes without relying on prose-only reasons.

### Workstream B: Scenario Fixtures

Add scenario packs that exercise the PDP triad:

- clean allow with fresh authority and complete evidence
- stale authority revision
- missing evidence bundle
- expired approval envelope
- delegated assistant exceeding attenuated scope
- materializer lag beyond threshold
- policy snapshot mismatch
- local no-execute drill

Acceptance criteria:

- Each fixture has expected decision, reason code, obligations, and trace markers.
- Negative fixtures distinguish upstream PDP-backed denials from SDK-local fail-closed behavior.

### Workstream C: Control-Plane Gates

Promote SeedCore-native gates over local-only validation:

1. compile candidate policy snapshot
2. compare candidate against baseline scenarios
3. verify runtime status
4. verify authz/materializer status
5. reload or activate snapshot
6. deploy only after blocking gates pass

Acceptance criteria:

- Local digital-twin and assistant checks remain advisory.
- Compile, compare, runtime readiness, and reload become the primary deployment lane.

### Workstream D: Observability And Replay

Make every simulator decision replayable:

- request hash
- authority envelope hash
- policy snapshot hash
- materialized context revision
- evidence refs
- decision trace
- audit chain hash

Acceptance criteria:

- A blocked decision is as replayable as an allowed decision.
- Token issuance is withheld when policy, freshness, twin, or evidence checks fail.

## Near-Term Implementation Plan

1. Add contract types beside `seedcorePolicyDomain.ts` for authority envelopes, freshness markers, materialized context, and PDP traces.
2. Extend scenario-pack payloads to carry freshness and materialized-context metadata.
3. Add negative scenario fixtures for stale revision, missing evidence, and scope attenuation failure.
4. Update the Governance Cockpit or Simulator view to show trace categories: authority, freshness, policy, evidence, materializer, token.
5. Wire `comparePKGSnapshots` into the Control Plane validation path as the primary behavior-drift check.
6. Add tests for local fail-closed behavior and stale-context rejection.

## Non-Goals

- Do not turn the simulator into a production authorization service.
- Do not make ReBAC the PDP core.
- Do not let assistant output write evidence or authority surfaces directly.
- Do not treat LLM or digital-twin critique as runtime authority.
- Do not collapse missing evidence, stale context, and policy deny into one generic blocked state.

## Success Definition

This plan succeeds when `pkg-simulator` can run representative SeedCore PDP cases where:

- a portable authority envelope narrows the request,
- a freshness marker rejects stale context,
- a materialized local view supplies low-latency context,
- the policy snapshot decision is deterministic,
- token issuance happens only after all required gates pass,
- the full result is replayable from evidence and trace references.
