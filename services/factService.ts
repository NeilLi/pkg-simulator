import { Fact } from '../types';

const API_BASE_URL = import.meta.env.VITE_DB_PROXY_URL || 'http://localhost:3001';

export interface CreateFactParams {
  snapshotId?: number;
  namespace: string;
  subject: string;
  predicate: string;
  object: any;
  validFrom?: string;
  validTo?: string;
  createdBy?: string;
}

/**
 * Create a new fact
 */
export async function createFact(params: CreateFactParams): Promise<Fact> {
  const response = await fetch(`${API_BASE_URL}/api/facts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snapshotId: params.snapshotId || null,
      namespace: params.namespace || 'default',
      subject: params.subject,
      predicate: params.predicate,
      object: params.object || {},
      validFrom: params.validFrom || null,
      validTo: params.validTo || null,
      createdBy: params.createdBy || 'system',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to create fact: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    id: data.id,
    snapshotId: data.snapshotId,
    namespace: data.namespace,
    subject: data.subject,
    predicate: data.predicate,
    object: data.object || {},
    validFrom: data.validFrom,
    validTo: data.validTo,
    status: data.status || 'active',
    createdBy: data.createdBy,
  };
}
