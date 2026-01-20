import { Fact } from '../types';

const API_BASE_URL = import.meta.env.VITE_DB_PROXY_URL || 'http://localhost:3011';

export interface CreateFactParams {
  // Required fields
  text: string; // Human-readable representation (required in new schema)
  namespace: string;
  
  // Optional structured triple (all or none)
  subject?: string;
  predicate?: string;
  object?: any; // Maps to object_data in DB
  
  // Optional metadata
  tags?: string[];
  metaData?: any; // JSONB
  
  // Temporal validity
  validFrom?: string;
  validTo?: string;
  
  // Governance fields
  snapshotId?: number;
  pkgRuleId?: string;
  pkgProvenance?: any; // JSONB
  validationStatus?: string;
  
  // Audit
  createdBy?: string;
}

/**
 * Generate text representation from structured triple if not provided
 */
function generateTextFromTriple(subject?: string, predicate?: string, object?: any): string {
  if (subject && predicate) {
    const objStr = typeof object === 'string' ? object : JSON.stringify(object);
    return `${subject} ${predicate} ${objStr}`;
  }
  return '';
}

/**
 * Create a new fact
 * 
 * The new schema requires:
 * - `text` field (required) - human-readable representation
 * - Either all structured fields (subject, predicate, object_data) or none
 * - Optional tags, meta_data, PKG governance fields
 */
export async function createFact(params: CreateFactParams): Promise<Fact> {
  // Generate text if not provided but structured triple exists
  const text = params.text || generateTextFromTriple(params.subject, params.predicate, params.object);
  
  if (!text || text.trim().length === 0) {
    throw new Error('text field is required. Provide either text directly or structured triple (subject, predicate, object).');
  }

  // Validate structured triple: all or none
  const hasStructured = params.subject || params.predicate || params.object;
  const hasAllStructured = params.subject && params.predicate && params.object !== undefined;
  
  if (hasStructured && !hasAllStructured) {
    throw new Error('Structured triple requires all fields: subject, predicate, and object must all be provided together.');
  }

  // Normalize namespace: trim and validate (prevent "ghost namespaces" like "hotel " or " hotel")
  const normalizedNamespace = (params.namespace || 'default').trim();
  if (!normalizedNamespace || normalizedNamespace.length === 0) {
    throw new Error('Namespace cannot be empty after trimming. Please provide a valid namespace.');
  }

  const response = await fetch(`${API_BASE_URL}/api/facts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Required
      text: text.trim(),
      namespace: normalizedNamespace, // Use normalized namespace (trimmed)
      
      // Structured triple (all or none)
      subject: params.subject || null,
      predicate: params.predicate || null,
      object_data: params.object !== undefined ? params.object : null,
      
      // Optional metadata
      tags: params.tags || [],
      meta_data: params.metaData || {},
      
      // Temporal validity
      valid_from: params.validFrom || null,
      valid_to: params.validTo || null,
      
      // Governance
      snapshot_id: params.snapshotId || null,
      pkg_rule_id: params.pkgRuleId || null,
      pkg_provenance: params.pkgProvenance || null,
      validation_status: params.validationStatus || null,
      
      // Audit
      created_by: params.createdBy || 'system',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to create fact: ${response.statusText}`);
  }

  const data = await response.json();
  
  // Map snake_case response to camelCase Fact interface
  return {
    id: data.id,
    snapshotId: data.snapshot_id,
    namespace: data.namespace,
    text: data.text,
    tags: data.tags || [],
    metaData: data.meta_data || {},
    subject: data.subject,
    predicate: data.predicate,
    object: data.object_data || data.object, // Support both field names for backward compatibility
    validFrom: data.valid_from,
    validTo: data.valid_to,
    pkgRuleId: data.pkg_rule_id,
    pkgProvenance: data.pkg_provenance,
    validationStatus: data.validation_status,
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    status: data.status, // Computed from views, may not always be present
  };
}
