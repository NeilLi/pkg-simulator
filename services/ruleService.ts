import { Rule, PkgEngine, PkgConditionType, PkgOperator, PkgRelation } from '../types';

const API_BASE_URL = import.meta.env.VITE_DB_PROXY_URL || 'http://localhost:3001';

export interface CreateRuleParams {
  snapshotId: number;
  ruleName: string;
  priority: number;
  engine: PkgEngine;
  ruleSource?: string;
  conditions: Array<{
    conditionType: PkgConditionType;
    conditionKey: string;
    operator: PkgOperator;
    value?: string;
  }>;
  emissions: Array<{
    subtaskTypeId: string;
    relationshipType: PkgRelation;
    params?: any;
  }>;
}

function isValueRequired(op: PkgOperator): boolean {
  // Keep conservative: only operators that are clearly "no-value"
  const noValueOps = new Set<PkgOperator>([
    'EXISTS' as any,
    'NOT_EXISTS' as any,
  ]);
  return !noValueOps.has(op);
}

async function readErrorMessage(response: Response): Promise<string> {
  const ct = response.headers.get('content-type') || '';
  const base = `Failed to create rule: ${response.status} ${response.statusText}`;

  try {
    if (ct.includes('application/json')) {
      const err = await response.json();
      return err?.error || err?.message || base;
    }
    const text = await response.text();
    if (text.includes('<!DOCTYPE') || text.includes('<html')) {
      return `Server returned HTML (likely proxy route missing). Check /api/rules on db-proxy. (${response.status} ${response.statusText})`;
    }
    return text || base;
  } catch {
    return base;
  }
}

/**
 * Create a new rule
 */
export async function createRule(params: CreateRuleParams): Promise<Rule> {
  // ----- client-side validation (compat-safe: throws early) -----
  if (!params.snapshotId || params.snapshotId < 1) {
    throw new Error('snapshotId is required');
  }
  if (!params.ruleName?.trim()) {
    throw new Error('ruleName is required');
  }
  if (!Array.isArray(params.conditions) || params.conditions.length === 0) {
    throw new Error('At least one condition is required');
  }
  if (!Array.isArray(params.emissions) || params.emissions.length === 0) {
    throw new Error('At least one emission is required');
  }

  for (const [i, c] of params.conditions.entries()) {
    if (!c.conditionType) throw new Error(`conditions[${i}].conditionType is required`);
    if (!c.conditionKey?.trim()) throw new Error(`conditions[${i}].conditionKey is required`);
    if (!c.operator) throw new Error(`conditions[${i}].operator is required`);
    if (isValueRequired(c.operator) && (c.value === undefined || c.value === null || `${c.value}`.trim() === '')) {
      throw new Error(`conditions[${i}].value is required for operator ${String(c.operator)}`);
    }
  }

  for (const [i, e] of params.emissions.entries()) {
    if (!e.subtaskTypeId?.trim()) throw new Error(`emissions[${i}].subtaskTypeId is required`);
    if (!e.relationshipType) throw new Error(`emissions[${i}].relationshipType is required`);
    // ensure params is serializable
    if (e.params !== undefined) {
      try {
        JSON.stringify(e.params);
      } catch {
        throw new Error(`emissions[${i}].params must be JSON-serializable`);
      }
    }
  }

  const url = `${API_BASE_URL}/api/rules`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snapshotId: params.snapshotId,
      ruleName: params.ruleName.trim(),
      priority: params.priority ?? 100,
      engine: params.engine,
      ruleSource: params.ruleSource || null,
      conditions: params.conditions,
      emissions: params.emissions,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const data = await response.json();

  // normalize possible snake_case returns
  const compiledRule = data.compiledRule ?? data.compiled_rule ?? null;
  const ruleHash = data.ruleHash ?? data.rule_hash ?? null;

  return {
    id: data.id,
    snapshotId: data.snapshotId ?? data.snapshot_id,
    ruleName: data.ruleName ?? data.rule_name,
    priority: data.priority,
    engine: (data.engine as PkgEngine) ?? params.engine,
    conditions: data.conditions || [],
    emissions: data.emissions || [],
    disabled: data.disabled ?? false,
    ruleSource: data.ruleSource ?? data.rule_source ?? null,
    compiledRule,
    ruleHash,
    metadata: data.metadata ?? null,
  };
}
