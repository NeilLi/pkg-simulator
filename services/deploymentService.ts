import { Deployment, DeploymentTarget } from '../types';

const API_BASE_URL = import.meta.env.VITE_DB_PROXY_URL || 'http://localhost:3001';

/** -----------------------------
 * Types
 * ------------------------------*/

export interface CreateDeploymentParams {
  snapshotId: number;
  target: DeploymentTarget;      // lane key part 1
  region?: string;               // lane key part 2 (defaults to 'global')
  percent: number;               // 0-100
  isActive?: boolean;            // defaults to true (forced false if percent=0)
  activatedBy?: string;          // defaults to 'system'
  deploymentKey?: string;        // explicit idempotency key (recommended)
  isRollback?: boolean;          // if true, percent may decrease
  validationRunId?: number;      // optional reference to validation run
  /** Optional: client-side monotonic guard (default true). */
  enforceMonotonicIncrease?: boolean;
  /** Optional: previous percent (if known) to validate rollbacks locally. */
  previousPercentHint?: number;
}

export interface DeploymentResponse {
  current: Deployment & { noop?: boolean };
  previous: Deployment | null;
}

export interface ActiveDeployment {
  target: DeploymentTarget;
  region: string;
  snapshot: string;
  snapshotId: number;
  percent: number;
  activatedAt: string;
  activatedBy: string;
}

export interface DeploymentCoverageRow {
  target: string;
  region: string;
  snapshotId: number;
  version: string;
  devicesOnSnapshot: number;
  devicesTotal: number;
}

export interface RolloutEvent {
  id: number;
  target: string;
  region: string;
  snapshotId: number;
  fromPercent: number | null;
  toPercent: number;
  isRollback: boolean;
  actor: string;
  validationRunId: number | null;
  createdAt: string;
}

/** -----------------------------
 * Internal helpers
 * ------------------------------*/

function clampPercent(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function normalizeRegion(region?: string): string {
  const r = (region || 'global').trim();
  return r.length ? r : 'global';
}

function assertValidTarget(target: unknown): asserts target is DeploymentTarget {
  if (!target || typeof target !== 'string') {
    throw new Error('Deployment target is required');
  }
}

function assertValidSnapshotId(snapshotId: unknown): asserts snapshotId is number {
  if (typeof snapshotId !== 'number' || snapshotId < 1 || !Number.isInteger(snapshotId)) {
    throw new Error('snapshotId must be a positive integer');
  }
}

/** Fetch with timeout + robust error parsing */
async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });

    const raw = await res.text();
    const tryJson = () => {
      try {
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    };

    if (!res.ok) {
      const parsed = tryJson();
      const message =
        (parsed && (parsed.error || parsed.message)) ||
        raw ||
        `HTTP ${res.status}: ${res.statusText}`;
      throw new Error(message);
    }

    const parsed = tryJson();
    // If server returned empty body, keep it safe:
    return (parsed ?? ({} as any)) as T;
  } finally {
    clearTimeout(t);
  }
}

/** -----------------------------
 * Commands
 * ------------------------------*/

/**
 * Create/update a deployment lane (target+region) idempotently.
 * This aligns with DB constraint: uq_pkg_deploy_lane(target, region).
 */
export async function createOrUpdateDeployment(
  params: CreateDeploymentParams
): Promise<DeploymentResponse> {
  assertValidSnapshotId(params.snapshotId);
  assertValidTarget(params.target);

  const region = normalizeRegion(params.region);
  const percent = clampPercent(params.percent);

  // Default isActive: true unless percent==0
  const isActive = percent > 0 ? (params.isActive ?? true) : false;

  // Optional client-side guardrail: monotonic increase unless rollback
  const enforceMonotonic = params.enforceMonotonicIncrease ?? true;
  if (enforceMonotonic && !params.isRollback && typeof params.previousPercentHint === 'number') {
    if (percent < params.previousPercentHint) {
      throw new Error(
        `Percent decrease blocked (${params.previousPercentHint}% → ${percent}%). Set isRollback=true to allow.`
      );
    }
  }

  // Strongly recommended: stable idempotency key per "run" (e.g., runId)
  const deploymentKey = (params.deploymentKey || 'default').trim() || 'default';
  const activatedBy = (params.activatedBy || 'system').trim() || 'system';

  const data = await fetchJson<{
    current: any;
    previous: any | null;
  }>(`${API_BASE_URL}/api/deployments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Safe even if server ignores it; helps if you later add middleware support.
      'X-Idempotency-Key': deploymentKey,
    },
    body: JSON.stringify({
      snapshotId: params.snapshotId,
      target: params.target,
      region,
      percent,
      isActive,
      activatedBy,
      deploymentKey,
      isRollback: params.isRollback || false,
      validationRunId: params.validationRunId,
    }),
  });

  return {
    current: {
      id: data.current.id,
      snapshotId: data.current.snapshotId,
      target: data.current.target,
      region: data.current.region,
      percent: data.current.percent,
      isActive: data.current.isActive,
      activatedAt: data.current.activatedAt,
      activatedBy: data.current.activatedBy,
      deploymentKey: data.current.deploymentKey,
      validationRunId: data.current.validationRunId,
      noop: !!data.current.noop,
    },
    previous: data.previous
      ? {
          id: data.previous.id,
          snapshotId: data.previous.snapshotId,
          target: data.previous.target,
          region: data.previous.region,
          percent: data.previous.percent,
          isActive: data.previous.isActive,
          activatedAt: data.previous.activatedAt,
          activatedBy: data.previous.activatedBy,
          deploymentKey: data.previous.deploymentKey,
          validationRunId: data.previous.validationRunId,
        }
      : null,
  };
}

/**
 * Fetch deployments.
 * - activeOnly=true matches your current UI expectation
 */
export async function getDeployments(activeOnly: boolean = true): Promise<Deployment[]> {
  const q = new URLSearchParams({ active_only: String(activeOnly) });
  const data = await fetchJson<any[]>(`${API_BASE_URL}/api/deployments?${q.toString()}`);

  return data.map((row: any) => ({
    id: row.id,
    snapshotId: row.snapshotId,
    target: row.target,
    region: row.region,
    percent: row.percent,
    isActive: row.isActive,
    activatedAt: row.activatedAt,
    activatedBy: row.activatedBy,
    deploymentKey: row.deploymentKey,
    validationRunId: row.validationRunId,
  }));
}

/**
 * Live system state (already in your service): active deployments resolved w/ snapshot version.
 */
export async function getActiveDeployments(): Promise<ActiveDeployment[]> {
  return await fetchJson<ActiveDeployment[]>(`${API_BASE_URL}/api/deployments/active`);
}

/** -----------------------------
 * NEW: Reads that match your DB upgrades
 * ------------------------------*/

/**
 * Coverage view: pkg_deployment_coverage
 * Shows intent (deployments) vs reality (device_versions).
 */
export async function getDeploymentCoverage(): Promise<DeploymentCoverageRow[]> {
  const data = await fetchJson<any[]>(`${API_BASE_URL}/api/deployments/coverage`);
  return data.map((r: any) => ({
    target: r.target,
    region: r.region,
    snapshotId: r.snapshotId,
    version: r.version,
    devicesOnSnapshot: Number(r.devicesOnSnapshot ?? r.devices_on_snapshot ?? 0),
    devicesTotal: Number(r.devicesTotal ?? r.devices_total ?? 0),
  }));
}

/**
 * Rollout audit: pkg_rollout_events
 * Useful for canary history / timeline widgets.
 */
export async function getRolloutEvents(params?: {
  target?: DeploymentTarget;
  region?: string;
  limit?: number;
}): Promise<RolloutEvent[]> {
  const q = new URLSearchParams();
  if (params?.target) q.set('target', params.target);
  if (params?.region) q.set('region', normalizeRegion(params.region));
  if (params?.limit) q.set('limit', String(params.limit));

  const url = `${API_BASE_URL}/api/deployments/events${q.toString() ? `?${q.toString()}` : ''}`;
  const data = await fetchJson<any[]>(url);

  return data.map((e: any) => ({
    id: e.id,
    target: e.target,
    region: e.region,
    snapshotId: e.snapshotId ?? e.snapshot_id,
    fromPercent: e.fromPercent ?? e.from_percent ?? null,
    toPercent: e.toPercent ?? e.to_percent ?? 0,
    isRollback: !!(e.isRollback ?? e.is_rollback),
    actor: e.actor ?? e.activatedBy ?? 'system',
    validationRunId: e.validationRunId ?? e.validation_run_id ?? null,
    createdAt: e.createdAt ?? e.created_at,
  }));
}

/** -----------------------------
 * Convenience helpers (optional but useful in ControlPlane)
 * ------------------------------*/

/** Stable lane key for local maps/caches. */
export function laneKey(target: DeploymentTarget, region?: string): string {
  return `${target}::${normalizeRegion(region)}`;
}

/** One-liner rollback helper */
export async function rollbackDeploymentLane(args: {
  snapshotId: number;
  target: DeploymentTarget;
  region?: string;
  activatedBy?: string;
  deploymentKey?: string;
  validationRunId?: number;
}): Promise<DeploymentResponse> {
  return createOrUpdateDeployment({
    snapshotId: args.snapshotId,
    target: args.target,
    region: args.region,
    percent: 0,
    isRollback: true,
    isActive: false,
    activatedBy: args.activatedBy,
    deploymentKey: args.deploymentKey,
    validationRunId: args.validationRunId,
    enforceMonotonicIncrease: false,
  });
}
