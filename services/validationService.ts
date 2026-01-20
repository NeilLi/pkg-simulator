import { ValidationRun } from '../types';

const API_BASE_URL = import.meta.env.VITE_DB_PROXY_URL || 'http://localhost:3011';

export interface StartValidationRunResponse {
  id: number;
  startedAt: string;
}

export interface FinishValidationRunParams {
  id: number;
  success: boolean;
  report?: ValidationRun['report'];
}

/**
 * Start a validation run
 */
export async function startValidationRun(snapshotId: number): Promise<StartValidationRunResponse> {
  if (!snapshotId || snapshotId < 1) {
    throw new Error('snapshotId is required and must be positive');
  }

  const response = await fetch(`${API_BASE_URL}/api/validation-runs/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshotId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `Failed to start validation run: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Finish a validation run
 */
export async function finishValidationRun(params: FinishValidationRunParams): Promise<ValidationRun> {
  if (!params.id || params.id < 1) {
    throw new Error('id is required and must be positive');
  }

  if (params.success === undefined || params.success === null) {
    throw new Error('success is required (boolean)');
  }

  const response = await fetch(`${API_BASE_URL}/api/validation-runs/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: params.id,
      success: params.success,
      report: params.report || null,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `Failed to finish validation run: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Get validation runs for a snapshot (or all runs if snapshotId is not provided)
 */
export async function getValidationRuns(snapshotId?: number): Promise<ValidationRun[]> {
  const url = snapshotId
    ? `${API_BASE_URL}/api/validation-runs?snapshotId=${snapshotId}`
    : `${API_BASE_URL}/api/validation-runs`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch validation runs: ${response.statusText}`);
  }

  return await response.json();
}
