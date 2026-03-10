/**
 * Temporal Policy Service (Step 6)
 * 
 * Purpose: Enable time-aware policies using temporal facts.
 * Rules can leverage valid_from/valid_to fields to create release-window-aware
 * and custody-aware policies for the governed runtime.
 * 
 * Architecture:
 * - Temporal Facts: Facts with valid_from/valid_to windows
 * - Temporal Fixtures: Mock scenarios for testing release windows and quarantines
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
    namespace?: string; // Optional namespace (defaults to "seedcore" if not specified)
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
 * Example temporal fixtures for testing release-window-aware policies
 */
export const TEMPORAL_FIXTURES: TemporalFixture[] = [
  {
    name: "vault_release_window_open",
    description: "A vault release is valid for the next 15 minutes.",
    currentTime: new Date().toISOString(),
    facts: [
      {
        subject: "policy:high_value_release",
        predicate: "release_window",
        object: { timestamp: new Date(Date.now() + 15 * 60 * 1000).toISOString() },
        validFrom: new Date().toISOString(),
        validTo: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
      {
        subject: "asset:lot_42",
        predicate: "in_zone",
        object: { zone: "VAULT" },
        validFrom: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        validTo: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
    ],
    expectedBehavior: "Release can proceed if identity and approval checks pass.",
  },
  {
    name: "transfer_route_drift_active",
    description: "A transfer route anomaly is active during movement.",
    currentTime: new Date().toISOString(),
    facts: [
      {
        subject: "transfer:route_alpha",
        predicate: "route_drift",
        object: { score: 0.8 },
        validFrom: new Date().toISOString(),
        validTo: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
    ],
    expectedBehavior: "Transfer should be blocked and asset moved to quarantine.",
  },
  {
    name: "expired_release_window",
    description: "A release window has expired and must deny movement.",
    currentTime: new Date().toISOString(),
    facts: [
      {
        subject: "policy:high_value_release",
        predicate: "release_window",
        object: { timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
        validFrom: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        validTo: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
    ],
    expectedBehavior: "All release operations should be blocked",
  },
];

/**
 * Filter facts by temporal validity at a given time
 * 
 * SeedCore Master Class: Governed facts (with pkg_rule_id) must have valid_from set
 * to be active. This ensures governed facts are properly tracked by the PKG engine.
 * 
 * Consistent with InitializationPage.tsx governance pattern:
 * - Governed facts (pkg_rule_id != null) should have valid_from set (defaults to now())
 * - Governed facts are active if valid_from <= currentTime AND (valid_to IS NULL OR valid_to > currentTime)
 */
export function getActiveFactsAtTime(facts: Fact[], currentTime: string): Fact[] {
  const now = new Date(currentTime);

  return facts.filter((fact) => {
    // Governed facts (with pkg_rule_id) must have valid_from set to be active
    // This ensures consistency with InitializationPage governance pattern
    if (fact.pkgRuleId && !fact.validFrom) {
      // Governed fact without valid_from is not active (should have been set during creation)
      return false;
    }

    // If fact has no temporal window, it's always active (ungoverned facts)
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
 * between different systems (seedcore vs external partner, etc.)
 * 
 * Supports formats:
 * - "namespace:predicate" (e.g., "seedcore:release_window") - Recommended
 * - "predicate" (backward compatibility, defaults to "seedcore" namespace)
 * 
 * Examples:
 * - "seedcore:release_window" → matches facts with namespace="seedcore", predicate="release_window"
 * - "partner:release_window" → matches facts with namespace="partner", predicate="release_window"
 * - "release_window" → matches facts with namespace="seedcore", predicate="release_window" (default)
 * 
 * This ensures rules don't accidentally collide with facts from other systems.
 */
function parseFactConditionKey(conditionKey: string): { namespace: string; predicate: string } {
  const parts = conditionKey.split(":");
  if (parts.length === 2) {
    return { namespace: parts[0], predicate: parts[1] };
  }
  // Backward compatibility: if no namespace specified, default to "seedcore"
  return { namespace: "seedcore", predicate: conditionKey };
}

/**
 * Find fact matching namespace and predicate
 * SeedCore Master Class: Ensures rules don't accidentally collide with facts from other systems
 * Example: seedcore:release_window vs partner:release_window are distinct
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
 * between different systems (seedcore vs partner vs facility, etc.)
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
    // Support namespace-aware fixtures (e.g., partner:release_window vs seedcore:release_window)
    // Ensure governed facts have proper temporal validity (consistent with InitializationPage)
    const facts: Fact[] = fixture.facts.map((f) => {
      // Generate text representation from structured triple (required in new schema)
      const factText = `${f.subject} ${f.predicate} ${JSON.stringify(f.object || {})}`;
      
      // For governed facts in fixtures, ensure valid_from is set
      // If not provided, default to fixture currentTime for active facts
      const validFrom = f.validFrom || (f.namespace ? fixture.currentTime : undefined);
      
      return {
        id: `fixture-${fixture.name}-${f.subject}`,
        snapshotId: snapshot.id,
        text: factText, // Required field in new schema
        namespace: f.namespace || "seedcore", // Use fixture namespace or default to "seedcore"
        subject: f.subject,
        predicate: f.predicate,
        object: f.object,
        validFrom, // Ensure governed facts have valid_from set
        validTo: f.validTo,
        status: "active" as const,
        // Note: Fixture facts are typically ungoverned (no pkg_rule_id)
        // Governed facts would be created through PolicyStudio or InitializationPage
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
