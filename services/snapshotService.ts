import { Snapshot, PkgEnv } from '../types';

const API_BASE_URL = import.meta.env.VITE_DB_PROXY_URL || 'http://localhost:3001';

/** -----------------------------
 * Types (backward compatible)
 * ------------------------------*/
export interface CreateSnapshotParams {
  version: string;
  env?: PkgEnv;
  entrypoint?: string;
  schemaVersion?: string;
  checksum?: string;
  sizeBytes?: number;
  signature?: string;
  notes?: string;
  isActive?: boolean;
}

export interface CloneSnapshotParams {
  version: string;
  env?: PkgEnv;
  notes?: string;
  isActive?: boolean;
}

export interface UpdateSnapshotParams {
  artifactFormat?: 'native' | 'wasm';
  checksum?: string;
  sizeBytes?: number;
  stage?: string;
  notes?: string;
}

/** -----------------------------
 * Internal helpers
 * ------------------------------*/

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

class ApiError extends Error {
  status?: number;
  url?: string;
  details?: unknown;
  constructor(message: string, opts?: { status?: number; url?: string; details?: unknown }) {
    super(message);
    this.name = 'ApiError';
    this.status = opts?.status;
    this.url = opts?.url;
    this.details = opts?.details;
  }
}

function isJsonResponse(contentType: string | null): boolean {
  return !!contentType && contentType.toLowerCase().includes('application/json');
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function safeReadJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function withTimeout(ms?: number): { signal?: AbortSignal; cancel?: () => void } {
  if (!ms || ms <= 0) return {};
  const controller = new AbortController();
  const t = window.setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cancel: () => window.clearTimeout(t),
  };
}

/**
 * One hardened request helper for the whole module.
 * - Handles JSON vs HTML errors (the “404 HTML page” problem we hit earlier)
 * - Adds optional timeouts
 * - Produces consistent error messages
 */
async function requestJson<T>(
  path: string,
  opts: {
    method?: HttpMethod;
    body?: unknown;
    timeoutMs?: number; // optional, non-breaking
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    ...(opts.headers ?? {}),
  };

  const hasBody = opts.body !== undefined;
  if (hasBody) headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';

  const timeout = withTimeout(opts.timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: hasBody ? JSON.stringify(opts.body) : undefined,
        signal: timeout.signal,
      });
    } catch (fetchError) {
      // Handle abort errors (timeout) - check this first
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        throw new ApiError(
          `Request timeout after ${opts.timeoutMs ?? 'default'}ms for ${path}`,
          { url },
        );
      }
      // Handle network errors (server down, CORS, connection refused, etc.)
      // "Failed to fetch" is a common TypeError thrown by fetch
      if (fetchError instanceof TypeError) {
        const message = fetchError.message.toLowerCase();
        if (message.includes('fetch') || message.includes('network') || message.includes('failed')) {
          // Check if it's a CORS error specifically
          const isCorsError = message.includes('cors') || 
                              (typeof window !== 'undefined' && window.location.origin !== 'http://localhost:3000');
          
          const errorMsg = isCorsError
            ? `CORS error: The server at ${url} is not allowing requests from ${typeof window !== 'undefined' ? window.location.origin : 'your origin'}. Check db-proxy CORS configuration.`
            : `Network error: Unable to reach server at ${url}. Is the db-proxy server running?`;
          
          throw new ApiError(errorMsg, { url, details: fetchError.message });
        }
      }
      // Re-throw other errors (including other TypeErrors that aren't network-related)
      throw fetchError;
    }

    const contentType = res.headers.get('content-type');

    if (!res.ok) {
      // Prefer JSON error payloads when present
      if (isJsonResponse(contentType)) {
        const err = await safeReadJson<{ error?: string; message?: string; details?: unknown }>(res);
        const message = err?.error || err?.message || `Request failed: ${res.status} ${res.statusText}`;
        throw new ApiError(message, { status: res.status, url, details: err?.details ?? err });
      }

      // Otherwise treat as text (HTML, plain text, etc.)
      const text = await safeReadText(res);
      const looksLikeHtml = /<!doctype html>|<html[\s>]/i.test(text);

      if (looksLikeHtml) {
        throw new ApiError(
          `Server returned HTML (likely 404/500). Endpoint may not exist: ${path}. Check db-proxy routes/server.`,
          { status: res.status, url, details: text.slice(0, 300) },
        );
      }

      throw new ApiError(text || `Request failed: ${res.status} ${res.statusText}`, {
        status: res.status,
        url,
        details: text,
      });
    }

    // OK response
    if (!isJsonResponse(contentType)) {
      // Still try to parse JSON if server forgot header; fallback to text error
      const text = await safeReadText(res);
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ApiError(`Expected JSON but got non-JSON response from ${path}`, {
          status: res.status,
          url,
          details: text.slice(0, 300),
        });
      }
    }

    const data = await safeReadJson<T>(res);
    if (data === null) {
      throw new ApiError(`Failed to parse JSON response from ${path}`, {
        status: res.status,
        url,
      });
    }
    return data;
  } finally {
    timeout.cancel?.();
  }
}

function normalizeSnapshot(data: any): Snapshot {
  // Keep compatibility with your current shape; allow extra fields to pass through safely.
  return {
    id: data.id,
    version: data.version,
    env: data.env as PkgEnv,
    stage: data.stage,
    isActive: data.isActive,
    checksum: data.checksum,
    sizeBytes: data.sizeBytes,
    createdAt: data.createdAt,
    notes: data.notes,
    artifactFormat: data.artifactFormat,
    parentId: data.parentId,
  };
}

/** -----------------------------
 * Existing exports (unchanged)
 * ------------------------------*/

/**
 * Create a new snapshot (unchanged signature)
 */
export async function createSnapshot(params: CreateSnapshotParams): Promise<Snapshot> {
  const payload = {
    version: params.version,
    env: params.env ?? PkgEnv.PROD,
    entrypoint: params.entrypoint ?? 'data.pkg',
    schemaVersion: params.schemaVersion ?? '1',
    // Compatibility: keep your existing behavior, but use ?? so "" doesn't get overwritten.
    checksum: params.checksum ?? '0'.repeat(64),
    sizeBytes: params.sizeBytes ?? 0,
    signature: params.signature ?? null,
    notes: params.notes ?? null,
    isActive: params.isActive ?? false,
  };

  const data = await requestJson<any>(`/api/snapshots`, { method: 'POST', body: payload });
  return normalizeSnapshot(data);
}

/**
 * Clone an existing snapshot (unchanged signature)
 */
export async function cloneSnapshot(sourceId: number, params: CloneSnapshotParams): Promise<Snapshot> {
  const payload = {
    version: params.version,
    // Preserve your semantics: omit when not provided
    env: params.env ?? undefined,
    notes: params.notes ?? undefined,
    isActive: params.isActive ?? false,
  };

  const data = await requestJson<any>(`/api/snapshots/${sourceId}/clone`, { method: 'POST', body: payload });
  return normalizeSnapshot(data);
}

/**
 * Generate a version string based on existing snapshots (unchanged)
 */
export function generateVersion(baseName: string, existingVersions: string[]): string {
  const versionPattern = new RegExp(`${baseName}-v(\\d+)\\.(\\d+)\\.(\\d+)`);
  let maxMajor = 0;
  let maxMinor = 0;
  let maxPatch = 0;

  for (const version of existingVersions) {
    const match = version.match(versionPattern);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      const patch = parseInt(match[3], 10);
      if (major > maxMajor) {
        maxMajor = major;
        maxMinor = minor;
        maxPatch = patch;
      } else if (major === maxMajor && minor > maxMinor) {
        maxMinor = minor;
        maxPatch = patch;
      } else if (major === maxMajor && minor === maxMinor && patch > maxPatch) {
        maxPatch = patch;
      }
    }
  }

  return `${baseName}-v${maxMajor}.${maxMinor}.${maxPatch + 1}`;
}

/**
 * Get a single snapshot by ID (unchanged signature)
 */
export async function getSnapshot(snapshotId: number): Promise<Snapshot | null> {
  try {
    const data = await requestJson<any>(`/api/snapshots/${snapshotId}`);
    return normalizeSnapshot(data);
  } catch (e) {
    // Keep your original behavior: return null for not found / errors
    console.error('Error fetching snapshot:', e);
    return null;
  }
}

/**
 * Promote a snapshot to WASM format (unchanged signature)
 */
export async function promoteSnapshot(
  snapshotId: number,
  params: { checksum: string; sizeBytes: number; artifactFormat?: 'wasm' },
): Promise<Snapshot> {
  const payload = {
    checksum: params.checksum,
    sizeBytes: params.sizeBytes,
    artifactFormat: params.artifactFormat ?? 'wasm',
  };

  const data = await requestJson<any>(`/api/snapshots/${snapshotId}/promote`, { method: 'POST', body: payload });
  return normalizeSnapshot({ ...data, artifactFormat: data.artifactFormat ?? 'wasm' });
}

/**
 * Update an existing snapshot (unchanged signature)
 */
export async function updateSnapshot(snapshotId: number, params: UpdateSnapshotParams): Promise<Snapshot> {
  const data = await requestJson<any>(`/api/snapshots/${snapshotId}`, { method: 'PATCH', body: params });
  return normalizeSnapshot(data);
}

/** -----------------------------
 * New additions (non-breaking)
 * ------------------------------*/

/**
 * List snapshots. Useful for Control Plane and to compute "latest eligible".
 */
export async function listSnapshots(params?: {
  env?: PkgEnv;
  limit?: number;
  offset?: number;
  includeInactive?: boolean; // server-dependent; harmless if ignored
}): Promise<Snapshot[]> {
  const qs = new URLSearchParams();
  if (params?.env) qs.set('env', params.env);
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  if (params?.offset !== undefined) qs.set('offset', String(params.offset));
  if (params?.includeInactive !== undefined) qs.set('includeInactive', String(params.includeInactive));

  const path = `/api/snapshots${qs.toString() ? `?${qs.toString()}` : ''}`;
  const data = await requestJson<any[]>(path);
  return (data ?? []).map(normalizeSnapshot);
}

/**
 * Returns the currently active snapshot for an env (DB truth).
 */
export async function getActiveSnapshot(env: PkgEnv = PkgEnv.PROD): Promise<Snapshot | null> {
  try {
    // Prefer a dedicated endpoint if you have it:
    // const data = await requestJson<any>(`/api/snapshots/active?env=${env}`);
    // return normalizeSnapshot(data);

    // Fallback: list and find (works with existing APIs)
    const snaps = await listSnapshots({ env, limit: 100, includeInactive: true });
    return snaps.find(s => s.isActive) ?? null;
  } catch (e) {
    console.error('Error fetching active snapshot:', e);
    return null;
  }
}

/**
 * Explicit activation by snapshot ID (aligns with “only 1 active per env” rule).
 * This expects the backend to enforce unique-active-per-env atomically.
 *
 * If you don't have this endpoint yet, you can implement it server-side as:
 * POST /api/snapshots/:id/activate
 */
export async function activateSnapshot(snapshotId: number): Promise<Snapshot> {
  const data = await requestJson<any>(`/api/snapshots/${snapshotId}/activate`, { method: 'POST' });
  return normalizeSnapshot(data);
}

/**
 * Deactivate whatever is active for an env (optional convenience).
 * If backend doesn't support it, you can omit using this.
 */
export async function deactivateEnv(env: PkgEnv = PkgEnv.PROD): Promise<{ ok: boolean }> {
  // Expected backend: POST /api/snapshots/deactivate?env=prod
  const qs = new URLSearchParams({ env });
  return await requestJson<{ ok: boolean }>(`/api/snapshots/deactivate?${qs.toString()}`, { method: 'POST' });
}

/**
 * “Ensure latest active” helper:
 * - finds the newest snapshot in an env that matches an optional predicate
 * - activates it if it's not already active
 *
 * IMPORTANT: "latest" should generally mean "latest eligible" (validated/promoted), not just newest created_at.
 * You can plug your eligibility logic via the predicate.
 */
export async function ensureLatestActive(
  env: PkgEnv = PkgEnv.PROD,
  predicate: (s: Snapshot) => boolean = (s) => true,
): Promise<{ changed: boolean; active: Snapshot | null }> {
  const snaps = await listSnapshots({ env, limit: 200, includeInactive: true });

  // Sort by createdAt descending if present; fallback to id desc
  const sorted = [...snaps].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    if (tb !== ta) return tb - ta;
    return (b.id ?? 0) - (a.id ?? 0);
  });

  const candidate = sorted.find(predicate) ?? null;
  const current = snaps.find(s => s.isActive) ?? null;

  if (!candidate) return { changed: false, active: current };

  if (current?.id === candidate.id) {
    return { changed: false, active: current };
  }

  // Activate candidate (server should flip old active off atomically)
  const active = await activateSnapshot(candidate.id);
  return { changed: true, active };
}
