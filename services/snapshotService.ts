import { Snapshot, PkgEnv } from '../types';

const API_BASE_URL = import.meta.env.VITE_DB_PROXY_URL || 'http://localhost:3001';

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

/**
 * Create a new snapshot
 */
export async function createSnapshot(params: CreateSnapshotParams): Promise<Snapshot> {
  const response = await fetch(`${API_BASE_URL}/api/snapshots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: params.version,
      env: params.env || PkgEnv.PROD,
      entrypoint: params.entrypoint || 'data.pkg',
      schemaVersion: params.schemaVersion || '1',
      checksum: params.checksum || '0'.repeat(64),
      sizeBytes: params.sizeBytes || 0,
      signature: params.signature || null,
      notes: params.notes || null,
      isActive: params.isActive || false,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to create snapshot: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    id: data.id,
    version: data.version,
    env: data.env as PkgEnv,
    isActive: data.isActive,
    checksum: data.checksum,
    sizeBytes: data.sizeBytes,
    createdAt: data.createdAt,
    notes: data.notes,
  };
}

/**
 * Clone an existing snapshot (copies all rules, subtask types, conditions, emissions)
 */
export async function cloneSnapshot(sourceId: number, params: CloneSnapshotParams): Promise<Snapshot> {
  const response = await fetch(`${API_BASE_URL}/api/snapshots/${sourceId}/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: params.version,
      env: params.env || undefined,
      notes: params.notes || undefined,
      isActive: params.isActive || false,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to clone snapshot: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    id: data.id,
    version: data.version,
    env: data.env as PkgEnv,
    isActive: data.isActive,
    checksum: data.checksum,
    sizeBytes: data.sizeBytes,
    createdAt: data.createdAt,
    notes: data.notes,
  };
}

/**
 * Generate a version string based on existing snapshots
 */
export function generateVersion(baseName: string, existingVersions: string[]): string {
  // Extract version numbers from existing versions
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

  // Increment patch version
  return `${baseName}-v${maxMajor}.${maxMinor}.${maxPatch + 1}`;
}
