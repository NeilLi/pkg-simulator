/**
 * Temporal Policy Service (Step 6)
 * 
 * Purpose: Enable time-aware policies using Migration 016 temporal facts.
 * Rules can leverage valid_from/valid_to fields to create "Stay-Aware" policies
 * that understand the guest's journey timeline.
 * 
 * Architecture:
 * - Temporal Facts: Facts with valid_from/valid_to windows
 * - Temporal Fixtures: Mock scenarios for testing (e.g., "guest checks out in 30 minutes")
 * - Time-Aware Evaluation: Policy evaluation considers current time and fact validity windows
 */

import { Fact, Rule, Snapshot } from "../types";

export interface TemporalFixture {
  name: string;
  description: string;
  currentTime: string; // ISO timestamp
  facts: Array<{
    subject: string;
    predicate: string;
    object: any;
    validFrom: string; // ISO timestamp
    validTo?: string; // ISO timestamp (null = indefinite)
    namespace?: string; // Optional namespace (defaults to "hotel" if not specified)
  }>;
  expectedBehavior: string; // Description of what should happen
}

export interface TemporalEvaluationContext {
  currentTime: string; // ISO timestamp
  facts: Fact[];
  tags: Record<string, string>;
  signals: Record<string, number | string>;
}

/**
 * Example temporal fixtures for testing stay-aware policies
 */
export const TEMPORAL_FIXTURES: TemporalFixture[] = [
  {
    name: "guest_checkout_soon",
    description: "Guest checks out in 30 minutes - should restrict long-running operations",
    currentTime: new Date().toISOString(),
    facts: [
      {
        subject: "guest:123",
        predicate: "checkout_time", // Will be matched as hotel:checkout_time (default namespace)
        object: { timestamp: new Date(Date.now() + 30 * 60 * 1000).toISOString() },
        validFrom: new Date().toISOString(),
        validTo: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
      {
        subject: "guest:123",
        predicate: "room",
        object: { roomNumber: "301" },
        validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        validTo: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
    ],
    expectedBehavior: "Design printing should be blocked or expedited (no long operations)",
  },
  {
    name: "guest_extended_stay",
    description: "Guest has extended stay - can allow complex designs",
    currentTime: new Date().toISOString(),
    facts: [
      {
        subject: "guest:456",
        predicate: "checkout_time",
        object: { timestamp: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() },
        validFrom: new Date().toISOString(),
        validTo: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
    expectedBehavior: "Complex designs allowed (sufficient time for completion)",
  },
  {
    name: "guest_checked_out",
    description: "Guest has already checked out - all operations blocked",
    currentTime: new Date().toISOString(),
    facts: [
      {
        subject: "guest:789",
        predicate: "checkout_time",
        object: { timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
        validFrom: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        validTo: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
    ],
    expectedBehavior: "All design operations should be blocked",
  },
];

/**
 * Filter facts by temporal validity at a given time
 */
export function getActiveFactsAtTime(facts: Fact[], currentTime: string): Fact[] {
  const now = new Date(currentTime);

  return facts.filter((fact) => {
    // If fact has no temporal window, it's always active
    if (!fact.validFrom && !fact.validTo) {
      return true;
    }

    const validFrom = fact.validFrom ? new Date(fact.validFrom) : null;
    const validTo = fact.validTo ? new Date(fact.validTo) : null;

    // Check if current time is within validity window
    if (validFrom && now < validFrom) {
      return false; // Not yet valid
    }

    if (validTo && now > validTo) {
      return false; // Expired
    }

    return true; // Active
  });
}

/**
 * Parse condition key to extract namespace and predicate
 * 
 * SeedCore Master Class: Namespace-aware fact matching prevents collisions
 * between different systems (hotel vs gym vs spa, etc.)
 * 
 * Supports formats:
 * - "namespace:predicate" (e.g., "hotel:checkout_time") - Recommended
 * - "predicate" (backward compatibility, defaults to "hotel" namespace)
 * 
 * Examples:
 * - "hotel:checkout_time" → matches facts with namespace="hotel", predicate="checkout_time"
 * - "gym:checkout_time" → matches facts with namespace="gym", predicate="checkout_time"
 * - "checkout_time" → matches facts with namespace="hotel", predicate="checkout_time" (default)
 * 
 * This ensures rules don't accidentally collide with facts from other systems.
 */
function parseFactConditionKey(conditionKey: string): { namespace: string; predicate: string } {
  const parts = conditionKey.split(":");
  if (parts.length === 2) {
    return { namespace: parts[0], predicate: parts[1] };
  }
  // Backward compatibility: if no namespace specified, default to "hotel"
  return { namespace: "hotel", predicate: conditionKey };
}

/**
 * Find fact matching namespace and predicate
 * SeedCore Master Class: Ensures rules don't accidentally collide with facts from other systems
 * Example: hotel:checkout_time vs gym:checkout_time are distinct
 */
function findFactByNamespaceAndPredicate(
  facts: Fact[],
  namespace: string,
  predicate: string
): Fact | undefined {
  return facts.find((f) => f.namespace === namespace && f.predicate === predicate);
}

/**
 * Evaluate policy rules with temporal awareness
 * Considers fact validity windows when evaluating conditions
 * 
 * SeedCore Master Class: Namespace-aware fact matching prevents collisions
 * between different systems (hotel vs gym vs spa, etc.)
 */
export function evaluateTemporalPolicy(
  rules: Rule[],
  context: TemporalEvaluationContext
): {
  allowed: boolean;
  reason: string;
  matchedRules: Array<{
    ruleId: string;
    ruleName: string;
    matchedAt: string;
    temporalFacts: Fact[];
  }>;
  blockingRules: Array<{
    ruleId: string;
    ruleName: string;
    reason: string;
  }>;
} {
  // Get active facts at current time
  const activeFacts = getActiveFactsAtTime(context.facts, context.currentTime);

  // Build evaluation context with temporal facts
  const evaluationContext = {
    tags: context.tags,
    signals: context.signals,
    facts: activeFacts,
    currentTime: context.currentTime,
  };

  const matchedRules: Array<{
    ruleId: string;
    ruleName: string;
    matchedAt: string;
    temporalFacts: Fact[];
  }> = [];

  const blockingRules: Array<{
    ruleId: string;
    ruleName: string;
    reason: string;
  }> = [];

  // Sort rules by priority
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    if (rule.disabled) continue;

    // Evaluate conditions with temporal facts (namespace-aware)
    const conditionResults = rule.conditions.map((condition) => {
      if (condition.conditionType === "FACT") {
        // Parse condition key to extract namespace and predicate
        const { namespace, predicate } = parseFactConditionKey(condition.conditionKey);
        
        // Find fact matching both namespace AND predicate
        const fact = findFactByNamespaceAndPredicate(activeFacts, namespace, predicate);
        
        // Evaluate based on operator
        if (condition.operator === "EXISTS") {
          return fact !== undefined;
        } else if (condition.operator === "=" && condition.value) {
          // Check if fact object matches value
          return fact !== undefined && String(fact.object) === condition.value;
        } else if (condition.operator === "!=" && condition.value) {
          return fact === undefined || String(fact.object) !== condition.value;
        }
        
        // Default: fact exists
        return fact !== undefined;
      }
      // Other condition types evaluated normally
      return true; // Simplified - full evaluation would go here
    });

    const allConditionsMatch = conditionResults.every((r) => r === true);

    if (allConditionsMatch) {
      // Collect temporal facts that matched this rule's conditions
      const matchedTemporalFacts = activeFacts.filter((f) =>
        rule.conditions.some((c) => {
          if (c.conditionType === "FACT") {
            const { namespace, predicate } = parseFactConditionKey(c.conditionKey);
            return f.namespace === namespace && f.predicate === predicate;
          }
          return false;
        })
      );

      // Check if rule has GATE emissions (blocking)
      const hasGate = rule.emissions.some((e) => e.relationshipType === "GATE");

      if (hasGate || rule.priority < 20) {
        blockingRules.push({
          ruleId: rule.id || "",
          ruleName: rule.ruleName,
          reason: hasGate
            ? `Rule "${rule.ruleName}" requires gate condition`
            : `High-priority rule "${rule.ruleName}" blocked the request`,
        });
      } else {
        matchedRules.push({
          ruleId: rule.id || "",
          ruleName: rule.ruleName,
          matchedAt: context.currentTime,
          temporalFacts: matchedTemporalFacts,
        });
      }
    }
  }

  const allowed = blockingRules.length === 0;

  return {
    allowed,
    reason: allowed
      ? `Allowed by policy (${matchedRules.length} rule(s) matched)`
      : blockingRules[0]?.reason || "Blocked by policy",
    matchedRules,
    blockingRules,
  };
}

/**
 * Test a rule against temporal fixtures
 */
export interface TemporalTestResult {
  fixtureName: string;
  passed: boolean;
  result: ReturnType<typeof evaluateTemporalPolicy>;
  issues?: string[];
}

export async function testRuleWithTemporalFixtures(
  rule: Rule,
  fixtures: TemporalFixture[],
  snapshot: Snapshot
): Promise<TemporalTestResult[]> {
  const results: TemporalTestResult[] = [];

  for (const fixture of fixtures) {
    // Convert fixture facts to Fact format
    // Support namespace-aware fixtures (e.g., gym:checkout_time vs hotel:checkout_time)
    const facts: Fact[] = fixture.facts.map((f) => {
      // Generate text representation from structured triple (required in new schema)
      const factText = `${f.subject} ${f.predicate} ${JSON.stringify(f.object || {})}`;
      
      return {
        id: `fixture-${fixture.name}-${f.subject}`,
        snapshotId: snapshot.id,
        text: factText, // Required field in new schema
        namespace: f.namespace || "hotel", // Use fixture namespace or default to "hotel"
        subject: f.subject,
        predicate: f.predicate,
        object: f.object,
        validFrom: f.validFrom,
        validTo: f.validTo,
        status: "active" as const,
      };
    });

    const context: TemporalEvaluationContext = {
      currentTime: fixture.currentTime,
      facts,
      tags: {},
      signals: {},
    };

    const result = evaluateTemporalPolicy([rule], context);

    // Check if result matches expected behavior
    const passed = result.allowed !== fixture.expectedBehavior.includes("blocked");

    results.push({
      fixtureName: fixture.name,
      passed,
      result,
      issues: passed ? undefined : [`Expected: ${fixture.expectedBehavior}, Got: ${result.reason}`],
    });
  }

  return results;
}
