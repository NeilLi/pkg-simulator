import { Deployment, DeploymentTarget } from '../types';

const API_BASE_URL = import.meta.env.VITE_DB_PROXY_URL || 'http://localhost:3001';

export interface CreateDeploymentParams {
  snapshotId: number;
  target: DeploymentTarget;
  region?: string; // defaults to 'global'
  percent: number; // 0-100
  isActive?: boolean; // defaults to true (will be forced to false if percent=0)
  activatedBy?: string; // defaults to 'system'
  deploymentKey?: string; // defaults to 'default' (for explicit idempotency)
  isRollback?: boolean; // if true, allows percent to decrease
  validationRunId?: number; // optional reference to validation run
}

export interface DeploymentResponse {
  current: Deployment & { noop?: boolean }; // Include optional no-op flag
  previous: Deployment | null;
}

export async function createOrUpdateDeployment(
  params: CreateDeploymentParams
): Promise<DeploymentResponse> {
  const response = await fetch(`${API_BASE_URL}/api/deployments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      snapshotId: params.snapshotId,
      target: params.target,
      region: params.region || 'global',
      percent: params.percent,
      isActive: params.isActive,
      activatedBy: params.activatedBy || 'system',
      deploymentKey: params.deploymentKey || 'default',
      isRollback: params.isRollback || false,
      validationRunId: params.validationRunId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error || errorText;
    } catch {
      errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`;
    }
    throw new Error(`Failed to create/update deployment: ${errorMessage}`);
  }

  const data = await response.json();
  
  return {
    current: {
      id: data.current.id,
      snapshotId: data.current.snapshotId,
      target: data.current.target,
      region: data.current.region,
      percent: data.current.percent,
      isActive: data.current.isActive,
      activatedAt: data.current.activatedAt,
      deploymentKey: data.current.deploymentKey,
      validationRunId: data.current.validationRunId,
      noop: data.current.noop || false, // Include no-op flag
    },
    previous: data.previous ? {
      id: data.previous.id,
      snapshotId: data.previous.snapshotId,
      target: data.previous.target,
      region: data.previous.region,
      percent: data.previous.percent,
      isActive: data.previous.isActive,
      activatedAt: data.previous.activatedAt,
    } : null,
  };
}

export async function getDeployments(activeOnly: boolean = true): Promise<Deployment[]> {
  const response = await fetch(`${API_BASE_URL}/api/deployments?active_only=${activeOnly}`);
  
  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error || errorText;
    } catch {
      errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`;
    }
    throw new Error(`Failed to fetch deployments: ${errorMessage}`);
  }

  const data = await response.json();
  return data.map((row: any) => ({
    id: row.id,
    snapshotId: row.snapshotId,
    target: row.target,
    region: row.region,
    percent: row.percent,
    isActive: row.isActive,
    activatedAt: row.activatedAt,
    deploymentKey: row.deploymentKey,
    validationRunId: row.validationRunId,
  }));
}

// Enhancement C: Get active deployments (live system state)
export interface ActiveDeployment {
  target: DeploymentTarget;
  region: string;
  snapshot: string;
  snapshotId: number;
  percent: number;
  activatedAt: string;
  activatedBy: string;
}

export async function getActiveDeployments(): Promise<ActiveDeployment[]> {
  const response = await fetch(`${API_BASE_URL}/api/deployments/active`);
  
  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error || errorText;
    } catch {
      errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`;
    }
    throw new Error(`Failed to fetch active deployments: ${errorMessage}`);
  }

  return await response.json();
}
