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

/**
 * Create a new rule
 */
export async function createRule(params: CreateRuleParams): Promise<Rule> {
  const response = await fetch(`${API_BASE_URL}/api/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snapshotId: params.snapshotId,
      ruleName: params.ruleName,
      priority: params.priority,
      engine: params.engine,
      ruleSource: params.ruleSource || null,
      conditions: params.conditions,
      emissions: params.emissions,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to create rule: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    id: data.id,
    snapshotId: data.snapshotId,
    ruleName: data.ruleName,
    priority: data.priority,
    engine: data.engine as PkgEngine,
    conditions: data.conditions || [],
    emissions: data.emissions || [],
    disabled: data.disabled || false,
    ruleSource: data.ruleSource,
    compiledRule: data.compiledRule,
    ruleHash: data.ruleHash,
    metadata: data.metadata,
  };
}
