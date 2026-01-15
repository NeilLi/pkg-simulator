import {
  Snapshot, PkgEnv, Rule, PkgEngine, PkgConditionType,
  PkgOperator, PkgRelation, SubtaskType, Fact, UnifiedMemoryItem,
  Deployment, ValidationRun, Condition, Emission
} from '../types';

// API base URL for the database proxy server
const API_BASE_URL = import.meta.env.VITE_DB_PROXY_URL || 'http://localhost:3001';

// Helper to map database enums to TypeScript enums
function mapEnv(env: string): PkgEnv {
  switch (env.toLowerCase()) {
    case 'prod': return PkgEnv.PROD;
    case 'staging': return PkgEnv.STAGING;
    case 'dev': return PkgEnv.DEV;
    default: return PkgEnv.DEV;
  }
}

function mapEngine(engine: string): PkgEngine {
  return engine.toLowerCase() === 'native' ? PkgEngine.NATIVE : PkgEngine.WASM;
}

function mapConditionType(type: string): PkgConditionType {
  switch (type.toUpperCase()) {
    case 'TAG': return PkgConditionType.TAG;
    case 'SIGNAL': return PkgConditionType.SIGNAL;
    case 'VALUE': return PkgConditionType.VALUE;
    case 'FACT': return PkgConditionType.FACT;
    default: return PkgConditionType.TAG;
  }
}

function mapOperator(op: string): PkgOperator {
  switch (op) {
    case '=': return PkgOperator.EQUALS;
    case '!=': return PkgOperator.NOT_EQUALS;
    case '>=': return PkgOperator.GTE;
    case '<=': return PkgOperator.LTE;
    case '>': return PkgOperator.GT;
    case '<': return PkgOperator.LT;
    case 'EXISTS': return PkgOperator.EXISTS;
    case 'IN': return PkgOperator.IN;
    case 'MATCHES': return PkgOperator.MATCHES;
    default: return PkgOperator.EQUALS;
  }
}

function mapRelation(rel: string): PkgRelation {
  switch (rel.toUpperCase()) {
    case 'EMITS': return PkgRelation.EMITS;
    case 'ORDERS': return PkgRelation.ORDERS;
    case 'GATE': return PkgRelation.GATE;
    default: return PkgRelation.EMITS;
  }
}

// Fetch all snapshots
export async function fetchSnapshots(): Promise<Snapshot[]> {
  const response = await fetch(`${API_BASE_URL}/api/snapshots`);
  if (!response.ok) {
    throw new Error(`Failed to fetch snapshots: ${response.statusText}`);
  }
  const data = await response.json();
  return data.map((row: any) => ({
    id: row.id,
    version: row.version,
    env: mapEnv(row.env),
    isActive: row.isActive,
    checksum: row.checksum,
    sizeBytes: row.sizeBytes || 0,
    createdAt: row.createdAt,
    notes: row.notes || undefined,
    artifactFormat: (row.artifactFormat === 'native' || row.artifactFormat === 'wasm') 
      ? row.artifactFormat 
      : undefined,
  }));
}

// Fetch all subtask types
export async function fetchSubtaskTypes(): Promise<SubtaskType[]> {
  const response = await fetch(`${API_BASE_URL}/api/subtask-types`);
  if (!response.ok) {
    throw new Error(`Failed to fetch subtask types: ${response.statusText}`);
  }
  return await response.json();
}

// Fetch all rules with conditions and emissions
export async function fetchRules(): Promise<Rule[]> {
  const response = await fetch(`${API_BASE_URL}/api/rules`);
  if (!response.ok) {
    throw new Error(`Failed to fetch rules: ${response.statusText}`);
  }
  const data = await response.json();
  return data.map((row: any) => ({
    id: row.id,
    snapshotId: row.snapshotId,
    ruleName: row.ruleName,
    priority: row.priority,
    engine: mapEngine(row.engine),
    disabled: row.disabled,
    ruleSource: row.ruleSource || undefined,
    compiledRule: row.compiledRule || undefined,
    ruleHash: row.ruleHash || undefined,
    metadata: row.metadata || undefined,
    conditions: row.conditions.map((c: any) => ({
      ruleId: c.ruleId,
      conditionType: mapConditionType(c.conditionType),
      conditionKey: c.conditionKey,
      operator: mapOperator(c.operator),
      value: c.value || undefined,
    })),
    emissions: row.emissions.map((e: any) => ({
      ruleId: e.ruleId,
      subtaskTypeId: e.subtaskTypeId,
      subtaskName: e.subtaskName,
      relationshipType: mapRelation(e.relationshipType),
      params: e.params || undefined,
    })),
  }));
}

// Fetch all deployments
export async function fetchDeployments(activeOnly: boolean = false): Promise<Deployment[]> {
  const response = await fetch(`${API_BASE_URL}/api/deployments?active_only=${activeOnly}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch deployments: ${response.statusText}`);
  }
  return await response.json();
}

// Fetch all validation runs
export async function fetchValidationRuns(): Promise<ValidationRun[]> {
  const response = await fetch(`${API_BASE_URL}/api/validation-runs`);
  if (!response.ok) {
    throw new Error(`Failed to fetch validation runs: ${response.statusText}`);
  }
  return await response.json();
}

// Fetch facts (from facts table with PKG integration)
export async function fetchFacts(): Promise<Fact[]> {
  const response = await fetch(`${API_BASE_URL}/api/facts`);
  if (!response.ok) {
    throw new Error(`Failed to fetch facts: ${response.statusText}`);
  }
  return await response.json();
}

// Fetch unified memory from v_unified_cortex_memory view
export async function fetchUnifiedMemory(limit: number = 50): Promise<UnifiedMemoryItem[]> {
  const response = await fetch(`${API_BASE_URL}/api/unified-memory?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch unified memory: ${response.statusText}`);
  }
  return await response.json();
}

// Test database connection
export async function testConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    return response.ok;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
}
