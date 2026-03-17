# SeedCore Runtime Simulator

This project is a local simulator for the SeedCore product definition: a zero-trust runtime that governs AI-advised actions, Governed Agents, actuator endpoints, operator approvals, and replayable custody state.

The simulator focuses on:

- deny-by-default policy evaluation before release or movement
- Governed Agent and actuator orchestration across runtime zones
- custody memory, playback evidence, and temporal facts
- promotion, validation, canary deployment, and rollback workflows
- scenario generation for ingress, vault, transfer, quarantine, and infrastructure events

## Runtime Model

The current baseline scenario models four operational zones:

- `INGRESS` for source claims, scans, telemetry, and intake events
- `VAULT` for sealed inventory, release windows, and dual approval
- `TRANSFER` for robotic handoff and controlled movement
- `QUARANTINE` for anomaly containment and exception recovery

## Run Locally

Prerequisites:

- Node.js 20+
- optional PostgreSQL access through the local DB proxy
- optional Gemini API key for AI-assisted seed generation and authoring

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Run the DB proxy alongside the app:

```bash
npm run dev:all
```

If you use Gemini-backed features, set one of these in your environment:

- `GEMINI_API_KEY`
- `VITE_GEMINI_API_KEY`
- `API_KEY`

The database proxy URL defaults to `http://localhost:3011`.

## Main Surfaces

- `Initialization`: bootstrap the governed runtime baseline
- `Knowledge Graph`: inspect facts, zones, systems, and custody relationships
- `Unified Memory`: inspect event, knowledge, and playback memory
- `Mission Seeds`: generate governed requests and runtime incident scenarios
- `Policy Studio`: author facts and rules for PKG snapshots
- `Simulator`: dry-run tags, signals, and emissions before deployment
- `Governance Cockpit`: monitor perception, temporal validity, and digital twin output
- `Control Plane`: evolve, validate, compile, and deploy snapshots
- `Dashboard`: inspect runtime posture, deployments, and validation history

## Notes

- The repository still contains some older PKG or design-governance helper services. The active simulator path is being aligned around the SeedCore runtime model first.
- Database-backed pages rely on the proxy in [`server/db-proxy.js`](/Users/ningli/project/pkg-simulator/server/db-proxy.js).
- During the `pkg-simulator` phase, policy-management authority is not enforced at the app-login layer. The simulator assumes a trusted operator context for policy authoring and testing, while authentication and role-based authorization for policy editing, approval, and promotion are deferred to the production control plane.
