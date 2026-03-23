# SeedCore PKG Alignment Refactor

## Why the current control plane feels wrong

`pkg-simulator` still models PKG as:

1. propose local rules
2. build a local snapshot
3. run local validation
4. promote/deploy

Latest SeedCore treats PKG more like a runtime contract:

1. snapshot compileability
2. active runtime readiness
3. authz-graph materialization
4. snapshot-vs-snapshot compare
5. parity / governance safety checks
6. reload/activation correctness

That means the simulator currently mixes:

- simulator-only UX and linting
- DB authoring
- runtime truth

when those should be separate lanes.

## Main mismatches

### Validation is still local-first

Current `ControlPlane.tsx` uses:

- `runValidationAgent(...)`
- `validateRulesWithDigitalTwin(...)`

Those are fine as supplemental checks, but they are no longer the canonical PKG gate.

The latest SeedCore-native gate is:

- `POST /api/v1/pkg/snapshots/{id}/compile-rules`
- `POST /api/v1/pkg/snapshots/compare`
- `GET /api/v1/pkg/status`
- `GET /api/v1/pkg/authz-graph/status`
- `POST /api/v1/pkg/reload`

### Proposal semantics are too free-form

The latest SeedCore runtime needs proposals to eventually materialize:

- concrete rule conditions/emissions
- explicit deny/quarantine behavior
- authz graph edge manifests
- rollout-safe compare behavior

Narrative proposal items like “allow Ray actor caching” are architecture notes, not policy changes.

### Snapshot-scoped metadata is incomplete in simulator DB

We already saw this with subtask catalogs:

- active/base snapshot may be `3`
- only snapshot `1` has subtask-type rows in simulator DB

The simulator must expect DB metadata drift and surface it, not assume every snapshot has a complete local catalog.

## Recommended refactor shape

### Lane A: SeedCore runtime truth

This should become the blocking deployment lane:

1. compile candidate snapshot
2. compare candidate vs baseline
3. verify PKG runtime status
4. verify authz graph status
5. reload/activate when needed

### Lane B: Simulator advisory checks

Keep these, but make them secondary:

1. digital twin compatibility
2. UI-oriented proposal linting
3. completeness checks
4. prompt hygiene

## Control plane changes to aim for

### Evolution

Keep the proposal UI, but generate policy semantics, not runtime architecture claims.

### Build

Keep local draft assembly, but treat it as a candidate snapshot authoring step.

### Validate

Replace local-first validation as the primary gate with:

1. compile candidate
2. compare baseline vs candidate on representative `task_facts`
3. show compare summary and behavior drift
4. show runtime/authz-graph readiness

### Deploy

Gate deployment on:

- compile success
- compare acceptance
- runtime readiness
- reload/activation success

## First refactor slice implemented

Added a typed SeedCore compare client to:

- `services/seedcoreService.ts`

New method:

- `seedcoreService.comparePKGSnapshots(...)`

This is the right primitive to wire into `ControlPlane` next, replacing local-only validation as the primary blocker.
