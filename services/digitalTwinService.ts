/**
 * Digital Twin Simulation Service (Step 5)
 * 
 * Purpose: Pre-flight validation where a "Critic" Gemini instance validates rules
 * before they're promoted to active. Acts as a "Hardware Digital Twin" that checks
 * if rules will cause physical issues (e.g., "This will jam the printer").
 * 
 * Architecture:
 * - Mother (Rule Generator): Creates rego_bundle rules
 * - Critic (Digital Twin): Validates rules against hardware constraints
 * - Simulator: Marks snapshot as failed_validation if Critic rejects
 */

import { GoogleGenAI } from "@google/genai";
import { Rule, Snapshot } from "../types";

const LLM_MODEL = process.env.LLM_MODEL || "gemini-2.0-flash";

export interface DigitalTwinValidationResult {
  passed: boolean;
  issues: Array<{
    severity: "critical" | "warning" | "info";
    ruleId?: string;
    ruleName?: string;
    issue: string;
    recommendation?: string;
  }>;
  hardwareConstraints: {
    printer?: {
      maxInkPerLayer: number;
      maxLayers: number;
      supportedFabricTypes: string[];
    };
    painter?: {
      maxColors: number;
      precision: "high" | "medium" | "low";
    };
  };
  validationScore: number; // 0.0 - 1.0
}

/**
 * System prompt for the Environmental Critic (Digital Twin)
 * 
 * This prompt makes Gemini act as a hardware-aware validator that checks
 * if policy rules will cause physical problems in the hotel's equipment.
 */
const CRITIC_SYSTEM_PROMPT = `You are the **Environmental Critic** - a Digital Twin of the hotel's physical hardware.

Your role is to validate policy rules against **real-world hardware constraints** before they are deployed.

## Hardware Constraints

### 3D Fabric Printer
- Maximum ink per layer: 50 units
- Maximum layers: 10
- Supported fabric types: silk, cotton, polyester, leather
- Cannot print on fabric already painted (must prepare first)
- Requires fabric_prepare before fabric_print

### Robotic Painter
- Maximum colors per design: 8
- Precision levels: high (0.1mm), medium (0.5mm), low (1.0mm)
- Cannot paint on wet fabric (must wait for print to dry)
- Requires fabric_print before fabric_paint

### General Constraints
- Ink consumption cannot exceed guest credits
- Fabric must be prepared before printing
- Preview confirmation required before printing
- Billing must happen after resource usage

## Your Job

Analyze policy rules and their emissions. Flag issues if:
1. **Physical Impossibility**: Rule tries to print without preparing fabric
2. **Resource Overuse**: Rule allows ink consumption > 50 units per layer
3. **Sequence Violation**: Rule orders fabric_paint before fabric_print
4. **Missing Prerequisites**: Rule emits fabric_print without design_preview GATE
5. **Hardware Limits**: Rule exceeds printer/painter capabilities

## Output Format

Return JSON:
{
  "passed": boolean,
  "issues": [
    {
      "severity": "critical" | "warning" | "info",
      "ruleId": "uuid",
      "ruleName": "rule name",
      "issue": "description of problem",
      "recommendation": "how to fix"
    }
  ],
  "hardwareConstraints": {
    "printer": { "maxInkPerLayer": 50, "maxLayers": 10, "supportedFabricTypes": [...] },
    "painter": { "maxColors": 8, "precision": "high" }
  },
  "validationScore": 0.0-1.0
}

Be strict but fair. Only mark as "critical" if the rule will definitely cause hardware failure or safety issues.`;

/**
 * Validate rules using Gemini Critic (Digital Twin)
 */
export async function validateRulesWithDigitalTwin(
  rules: Rule[],
  snapshot: Snapshot,
  apiKey?: string
): Promise<DigitalTwinValidationResult> {
  const key = apiKey || process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("No Gemini API key found. Set API_KEY or GEMINI_API_KEY environment variable");
  }

  const ai = new GoogleGenAI({ apiKey: key });

  // Format rules for validation
  const rulesSummary = rules.map(r => ({
    id: r.id,
    name: r.ruleName,
    priority: r.priority,
    conditions: r.conditions.map(c => ({
      type: c.conditionType,
      key: c.conditionKey,
      operator: c.operator,
      value: c.value,
    })),
    emissions: r.emissions.map((e, idx) => ({
      subtaskName: e.subtaskName,
      relationshipType: e.relationshipType,
      params: e.params,
      position: (e as any).position ?? idx, // Use position if available, otherwise use index
    })),
  }));

  const prompt = `
Analyze these policy rules for hardware compatibility:

Snapshot: ${snapshot.version} (${snapshot.env})
Rules: ${JSON.stringify(rulesSummary, null, 2)}

Check each rule against hardware constraints. Look for:
1. Physical impossibilities (e.g., printing without preparation)
2. Resource overuse (ink > 50 units/layer)
3. Sequence violations (painting before printing)
4. Missing prerequisites (no preview GATE before print)
5. Hardware limit violations (colors > 8, unsupported fabrics)

Return your analysis in the JSON format specified.
`;

  try {
    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: CRITIC_SYSTEM_PROMPT,
        temperature: 0.3, // Lower temperature for more consistent validation
        responseMimeType: "application/json",
      },
    });

    // FIX: Access text properly - handle potential SDK version differences
    // Some SDK versions may have response.response.text() as a method
    // Others may have response.text as a getter property
    let resultText: string | undefined;
    try {
      // Try direct property access first (matches current SDK types)
      resultText = response.text;
      
      // If that doesn't work, try nested response pattern (for compatibility with different SDK versions)
      if (!resultText && (response as any).response) {
        const nestedResponse = (response as any).response;
        const nestedText = typeof nestedResponse.text === 'function' 
          ? nestedResponse.text() 
          : nestedResponse.text;
        if (nestedText) {
          resultText = nestedText;
        }
      }
    } catch (error) {
      console.error("Error accessing response text:", error);
      throw new Error(`Failed to extract text from API response: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    if (!resultText) {
      console.error("Digital Twin API response structure:", {
        hasText: !!response.text,
        responseKeys: Object.keys(response),
        responseType: typeof response,
        responseStructure: JSON.stringify(response, null, 2).substring(0, 500),
      });
      throw new Error("No response text from Gemini API - response.text is empty or undefined");
    }
    
    // Ensure we have a string before parsing
    const textString = typeof resultText === 'string' ? resultText : String(resultText);
    if (!textString || textString.trim().length === 0) {
      throw new Error("Response text is empty after conversion to string");
    }
    
    const result = JSON.parse(textString) as DigitalTwinValidationResult;

    // Validate result structure
    if (typeof result.passed !== "boolean") {
      throw new Error("Invalid validation result: missing 'passed' field");
    }

    // Ensure all required fields exist
    return {
      passed: result.passed,
      issues: result.issues || [],
      hardwareConstraints: result.hardwareConstraints || {
        printer: { maxInkPerLayer: 50, maxLayers: 10, supportedFabricTypes: [] },
        painter: { maxColors: 8, precision: "high" },
      },
      validationScore: result.validationScore ?? (result.passed ? 1.0 : 0.0),
    };
  } catch (error) {
    console.error("Digital Twin validation error:", error);
    // Return safe failure result
    return {
      passed: false,
      issues: [
        {
          severity: "critical",
          issue: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
          recommendation: "Review rule structure and try again",
        },
      ],
      hardwareConstraints: {
        printer: { maxInkPerLayer: 50, maxLayers: 10, supportedFabricTypes: [] },
        painter: { maxColors: 8, precision: "high" },
      },
      validationScore: 0.0,
    };
  }
}

/**
 * Run pre-flight validation for a snapshot
 * This is called before promoting a snapshot to active
 */
export async function runPreFlightValidation(
  snapshotId: number,
  rules: Rule[],
  snapshot: Snapshot,
  dbProxyUrl: string = "http://localhost:3011",
  apiKey?: string
): Promise<{
  validationRunId: number;
  result: DigitalTwinValidationResult;
}> {
  // Start validation run
  const startResponse = await fetch(`${dbProxyUrl}/api/validation-runs/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshotId }),
  });

  if (!startResponse.ok) {
    throw new Error(`Failed to start validation run: ${startResponse.statusText}`);
  }

  const { id: validationRunId } = await startResponse.json();

  try {
    // Run Digital Twin validation
    const validationResult = await validateRulesWithDigitalTwin(rules, snapshot, apiKey);

    // Finish validation run
    const finishResponse = await fetch(`${dbProxyUrl}/api/validation-runs/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: validationRunId,
        success: validationResult.passed,
        report: {
          validationType: "digital_twin",
          score: validationResult.validationScore,
          issues: validationResult.issues,
          hardwareConstraints: validationResult.hardwareConstraints,
          timestamp: new Date().toISOString(),
        },
      }),
    });

    if (!finishResponse.ok) {
      throw new Error(`Failed to finish validation run: ${finishResponse.statusText}`);
    }

    return {
      validationRunId,
      result: validationResult,
    };
  } catch (error) {
    // Mark validation as failed
    await fetch(`${dbProxyUrl}/api/validation-runs/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: validationRunId,
        success: false,
        report: {
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        },
      }),
    });

    throw error;
  }
}
