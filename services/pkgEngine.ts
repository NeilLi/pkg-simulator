import { Rule, Condition, SimulationResult, PkgOperator, PkgConditionType, Fact, UnifiedMemoryItem } from '../types';

export interface SimulationContext {
  tags: Record<string, string>;
  signals: Record<string, number | string>;
  facts: Fact[];
  memory: UnifiedMemoryItem[];
}

export interface HydratedContext extends SimulationContext {
  hydrationLogs: string[];
}

// Emulates the "Semantic Context Hydration" process
export const hydrateContext = (
  rawTags: Record<string, string>,
  rawSignals: Record<string, any>,
  allFacts: Fact[],
  allMemory: UnifiedMemoryItem[]
): HydratedContext => {
  const hydrationLogs: string[] = [];
  hydrationLogs.push("Starting Semantic Context Hydration...");

  // 1. Identify Key Entities from input
  const entities = new Set<string>();
  if (rawTags['room']) entities.add(`room:${rawTags['room']}`);
  if (rawTags['guest_id']) entities.add(`guest:${rawTags['guest_id']}`);
  
  hydrationLogs.push(`Identified anchor entities: ${Array.from(entities).join(', ') || 'None'}`);

  // 2. Hydrate Facts (Temporal)
  const relevantFacts = allFacts.filter(f => {
    // Global facts or specific subject matches
    if (f.subject.startsWith('system:')) return true;
    if (entities.has(f.subject)) return true;
    return false;
  });
  hydrationLogs.push(`Hydrated ${relevantFacts.length} temporal facts from DB.`);

  // 3. Hydrate Unified Memory (Vector/Graph retrieval simulation)
  const relevantMemory = allMemory.filter(m => {
    // Tier 1: Include all active working memory (simplified)
    if (m.memoryTier === 'event_working') return true;
    
    // Tier 2: Graph connections
    if (m.memoryTier === 'knowledge_base') {
      const content = m.content.toLowerCase();
      // Simple keyword matching for simulation
      const matchesEntity = Array.from(entities).some(e => content.includes(e.split(':')[1]));
      const matchesSignal = Object.keys(rawTags).some(t => content.includes(rawTags[t]));
      return matchesEntity || matchesSignal;
    }
    
    return false; // Default exclude world memory unless specifically queried (omitted for sim simplicity)
  });
  hydrationLogs.push(`Hydrated ${relevantMemory.length} Unified Memory items (Working+Graph).`);

  return {
    tags: rawTags,
    signals: rawSignals,
    facts: relevantFacts,
    memory: relevantMemory,
    hydrationLogs
  };
};

const checkCondition = (condition: Condition, context: SimulationContext): boolean => {
  let actualValue: any = null;

  // 1. Resolve Value based on Type
  switch (condition.conditionType) {
    case PkgConditionType.TAG:
      actualValue = context.tags[condition.conditionKey];
      break;
    case PkgConditionType.SIGNAL:
      actualValue = context.signals[condition.conditionKey];
      break;
    case PkgConditionType.VALUE:
      actualValue = condition.conditionKey; // context lookup or literal
      break;
    case PkgConditionType.FACT:
      // Check if a fact exists with this predicate in the HYDRATED context
      const fact = context.facts.find(f => f.predicate === condition.conditionKey);
      actualValue = fact ? fact.object : undefined;
      break;
  }

  // 2. Evaluate Operator
  switch (condition.operator) {
    case PkgOperator.EXISTS:
      return actualValue !== undefined && actualValue !== null;
    case PkgOperator.EQUALS:
      return String(actualValue) === condition.value;
    case PkgOperator.NOT_EQUALS:
      return String(actualValue) !== condition.value;
    case PkgOperator.GT:
      return Number(actualValue) > Number(condition.value);
    case PkgOperator.LT:
      return Number(actualValue) < Number(condition.value);
    case PkgOperator.GTE:
      return Number(actualValue) >= Number(condition.value);
    case PkgOperator.LTE:
      return Number(actualValue) <= Number(condition.value);
    case PkgOperator.IN:
       return condition.value?.includes(String(actualValue)) || false;
    default:
      return false;
  }
};

export const runSimulation = (rules: Rule[], context: HydratedContext): SimulationResult[] => {
  const results: SimulationResult[] = [];

  // Sort by priority (asc - lower is higher priority in standard systems, but PKG says lower=higher)
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    if (rule.disabled) continue;

    const conditionResults = rule.conditions.map(c => checkCondition(c, context));
    const isSuccess = conditionResults.every(r => r === true);
    
    const logs: string[] = [];
    if (isSuccess) {
      logs.push(`[PKG] Rule "${rule.ruleName}" MATCHED.`);
    }

    results.push({
      ruleName: rule.ruleName,
      success: isSuccess,
      emissions: isSuccess ? rule.emissions : [],
      logs
    });
  }

  return results;
};