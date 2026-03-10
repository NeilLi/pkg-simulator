import { GoogleGenAI } from '@google/genai';
import { Rule, Snapshot } from '../types';

const LLM_MODEL = process.env.LLM_MODEL || 'gemini-2.0-flash';

export interface DigitalTwinValidationResult {
  passed: boolean;
  issues: Array<{
    severity: 'critical' | 'warning' | 'info';
    ruleId?: string;
    ruleName?: string;
    issue: string;
    recommendation?: string;
  }>;
  hardwareConstraints: {
    roboticHandler?: {
      maxPayloadKg: number;
      allowedZoneTransitions: string[];
      requiresDualApproval: boolean;
    };
    sealScanner?: {
      minimumConfidence: number;
      supportedSealClasses: string[];
    };
    vaultDoor?: {
      maxOpenSeconds: number;
      failMode: 'fail-secure' | 'fail-safe';
    };
  };
  validationScore: number;
}

const CRITIC_SYSTEM_PROMPT = `You are the SeedCore Digital Twin Critic for a zero-trust runtime.

Your role is to validate runtime policy rules against operational constraints before deployment.

## Physical and Control Constraints

### Robotic Handler
- Max payload: 25 kg
- Allowed transitions: VAULT->TRANSFER, INGRESS->VAULT, TRANSFER->QUARANTINE
- High-value lots require dual approval before movement

### Seal Scanner
- Minimum confidence: 0.95 for high-value releases
- Supported seal classes: tamper_evident, serialized, cold_chain

### Vault Door Controller
- Door may remain open for at most 12 seconds
- Fail mode: fail-secure

## Flag issues when
1. A rule allows movement without identity/provenance checks
2. A rule routes a robotic handoff across an unsupported zone transition
3. A rule permits release without dual approval for high-value assets
4. A rule treats low-confidence seal scans as valid
5. A rule omits playback or custody evidence for irreversible handoff

Return JSON:
{
  "passed": boolean,
  "issues": [{ "severity": "...", "ruleId": "...", "ruleName": "...", "issue": "...", "recommendation": "..." }],
  "hardwareConstraints": {
    "roboticHandler": { "maxPayloadKg": 25, "allowedZoneTransitions": ["VAULT->TRANSFER"], "requiresDualApproval": true },
    "sealScanner": { "minimumConfidence": 0.95, "supportedSealClasses": ["tamper_evident"] },
    "vaultDoor": { "maxOpenSeconds": 12, "failMode": "fail-secure" }
  },
  "validationScore": 0.0
}`;

export async function validateRulesWithDigitalTwin(
  rules: Rule[],
  snapshot: Snapshot,
  apiKey?: string,
): Promise<DigitalTwinValidationResult> {
  const key = apiKey || process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('No Gemini API key found. Set API_KEY or GEMINI_API_KEY.');
  }

  const ai = new GoogleGenAI({ apiKey: key });
  const rulesSummary = rules.map((rule) => ({
    id: rule.id,
    name: rule.ruleName,
    priority: rule.priority,
    conditions: rule.conditions.map((condition) => ({
      type: condition.conditionType,
      key: condition.conditionKey,
      operator: condition.operator,
      value: condition.value,
    })),
    emissions: rule.emissions.map((emission) => ({
      subtaskName: emission.subtaskName,
      relationshipType: emission.relationshipType,
      params: emission.params,
    })),
  }));

  const response = await ai.models.generateContent({
    model: LLM_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Validate these runtime policy rules for snapshot ${snapshot.version} (${snapshot.env}):\n${JSON.stringify(
              rulesSummary,
              null,
              2,
            )}`,
          },
        ],
      },
    ],
    config: {
      systemInstruction: CRITIC_SYSTEM_PROMPT,
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('No response text from Gemini API.');
  }

  const parsed = JSON.parse(text) as DigitalTwinValidationResult;
  return {
    passed: parsed.passed,
    issues: parsed.issues || [],
    hardwareConstraints: parsed.hardwareConstraints || {
      roboticHandler: {
        maxPayloadKg: 25,
        allowedZoneTransitions: ['VAULT->TRANSFER', 'INGRESS->VAULT', 'TRANSFER->QUARANTINE'],
        requiresDualApproval: true,
      },
      sealScanner: {
        minimumConfidence: 0.95,
        supportedSealClasses: ['tamper_evident', 'serialized', 'cold_chain'],
      },
      vaultDoor: {
        maxOpenSeconds: 12,
        failMode: 'fail-secure',
      },
    },
    validationScore: parsed.validationScore ?? (parsed.passed ? 1 : 0),
  };
}
