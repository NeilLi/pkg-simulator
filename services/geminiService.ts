import { GoogleGenAI, Type } from "@google/genai";
import { Snapshot, Rule, Fact, SubtaskType, EvolutionProposal } from "../types";

const LLM_MODEL = process.env.LLM_MODEL || "gemini-3-flash-preview";

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);

const CONDITION_TYPE_ALIASES: Record<string, string> = {
  BASIC: 'VALUE',
  FIELD: 'VALUE',
  ATTRIBUTE: 'VALUE',
  METRIC: 'SIGNAL',
  BOOLEAN: 'SIGNAL',
  LABEL: 'TAG',
};

const normalizeConditionType = (raw: unknown) => {
  const normalized = String(raw ?? '').trim().toUpperCase();
  return CONDITION_TYPE_ALIASES[normalized] || normalized;
};

const OPERATOR_ALIASES: Record<string, string> = {
  EQ: '=',
  EQUALS: '=',
  NE: '!=',
  NOT_EQUALS: '!=',
  GTE: '>=',
  LTE: '<=',
  GT: '>',
  LT: '<',
};

const normalizeOperator = (raw: unknown) => {
  const normalized = String(raw ?? '').trim().toUpperCase();
  return OPERATOR_ALIASES[normalized] || normalized;
};

const normalizeCondition = (condition: any) => {
  if (!condition || typeof condition !== 'object') {
    return {
      conditionType: '',
      conditionKey: '',
      operator: '',
      value: undefined,
    };
  }

  return {
    ...condition,
    conditionType: normalizeConditionType(condition.conditionType ?? condition.condition_type ?? ''),
    conditionKey: String(condition.conditionKey ?? condition.condition_key ?? '').trim(),
    operator: normalizeOperator(condition.operator ?? ''),
    value: condition.value === undefined || condition.value === null ? undefined : String(condition.value),
  };
};

const normalizeEmission = (emission: any) => {
  if (!emission || typeof emission !== 'object') {
    return {
      subtaskName: '',
      subtaskTypeId: '',
      relationshipType: '',
      params: undefined,
    };
  }

  return {
    ...emission,
    subtaskName: String(emission.subtaskName ?? emission.subtask_name ?? '').trim(),
    subtaskTypeId: String(emission.subtaskTypeId ?? emission.subtask_type_id ?? '').trim(),
    relationshipType: String(emission.relationshipType ?? emission.relationship_type ?? '').trim().toUpperCase(),
    params: emission.params ?? undefined,
  };
};

const normalizeRuleData = (ruleData: any) => {
  if (!ruleData || typeof ruleData !== 'object') return undefined;
  return {
    ...ruleData,
    ruleName: String(ruleData.ruleName ?? ruleData.rule_name ?? '').trim(),
    priority: typeof ruleData.priority === 'number' ? ruleData.priority : Number(ruleData.priority ?? 100),
    engine: String(ruleData.engine ?? 'wasm').trim().toLowerCase(),
    ruleSource: typeof ruleData.ruleSource === 'string'
      ? ruleData.ruleSource
      : typeof ruleData.rule_source === 'string'
      ? ruleData.rule_source
      : undefined,
    conditions: asArray(ruleData.conditions).map(normalizeCondition),
    emissions: asArray(ruleData.emissions).map(normalizeEmission),
  };
};

const normalizeEvolutionProposal = (data: any): Omit<EvolutionProposal, 'id' | 'baseSnapshotId' | 'status' | 'generatedAt'> => ({
  newVersion: typeof data?.newVersion === 'string' && data.newVersion.trim() ? data.newVersion.trim() : `v${Date.now()}`,
  reason: typeof data?.reason === 'string' && data.reason.trim() ? data.reason.trim() : 'Policy evolution proposal generated from incident intent.',
  changes: asArray<any>(data?.changes).map((change) => ({
    action: change?.action,
    ruleId: typeof change?.ruleId === 'string' ? change.ruleId : undefined,
    rationale: typeof change?.rationale === 'string' && change.rationale.trim() ? change.rationale.trim() : 'No rationale provided.',
    ruleData: normalizeRuleData(change?.ruleData),
  })),
});

export interface GenerateRuleParams {
  prompt: string;
  snapshotId: number;
  snapshot?: Snapshot;
  existingRules?: Rule[];
  existingFacts?: Fact[];
  subtaskTypes?: SubtaskType[];
}

export interface GeneratedRule {
  ruleName: string;
  priority: number;
  engine: 'wasm' | 'native';
  ruleSource?: string;
  conditions: Array<{
    conditionType: string;
    conditionKey: string;
    operator: string;
    value?: string;
  }>;
  emissions: Array<{
    subtaskName: string;
    relationshipType: string;
    params?: any;
  }>;
}

export const generateRuleFromNaturalLanguage = async (params: GenerateRuleParams): Promise<GeneratedRule | null> => {
  if (!process.env.API_KEY) {
    console.warn("No API KEY found");
    return null;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Build context from snapshot, existing rules, facts, and subtask types
    const contextParts: string[] = [];
    
    if (params.snapshot) {
      contextParts.push(`Current Snapshot: ${params.snapshot.version} (${params.snapshot.env})`);
      if (params.snapshot.notes) {
        contextParts.push(`Snapshot Notes: ${params.snapshot.notes}`);
      }
    }
    
    if (params.subtaskTypes && params.subtaskTypes.length > 0) {
      contextParts.push(`\nAvailable Subtask Types (${params.subtaskTypes.length}):`);
      params.subtaskTypes.forEach((st, idx) => {
        contextParts.push(`${idx + 1}. ${st.name}${st.defaultParams ? ` (default: ${JSON.stringify(st.defaultParams)})` : ''}`);
      });
    }
    
    if (params.existingRules && params.existingRules.length > 0) {
      contextParts.push(`\nExisting Rules (${params.existingRules.length}):`);
      params.existingRules.slice(0, 5).forEach((rule, idx) => {
        const conds = rule.conditions.map(c => `${c.conditionKey} ${c.operator} ${c.value || 'EXIST'}`).join(', ');
        const ems = rule.emissions.map(e => e.subtaskName || 'unknown').join(', ');
        contextParts.push(`${idx + 1}. ${rule.ruleName} (priority: ${rule.priority}) - Conditions: [${conds}], Emissions: [${ems}]`);
      });
    }
    
    if (params.existingFacts && params.existingFacts.length > 0) {
      contextParts.push(`\nRelevant Facts (${params.existingFacts.length}):`);
      params.existingFacts.slice(0, 5).forEach((fact, idx) => {
        contextParts.push(`${idx + 1}. ${fact.subject} ${fact.predicate}: ${JSON.stringify(fact.object)}`);
      });
    }
    
    const context = contextParts.length > 0 ? `\n\nContext:\n${contextParts.join('\n')}\n` : '';
    
    const systemInstruction = `
      You are an expert SeedCore Policy Knowledge Graph engineer for a zero-trust runtime.
      Convert natural language runtime policies into JSON objects matching the Rule interface.
      
      Domain: Governed Agents, vault control, robotic handoff, seal integrity, operator approvals, and quarantine recovery.

      Interfaces:
      enum PkgConditionType { TAG, SIGNAL, VALUE, FACT }
      enum PkgOperator { EQUALS = '=', NOT_EQUALS = '!=', GT = '>', GTE = '>=', LT = '<', LTE = '<=', EXISTS = 'EXISTS', IN = 'IN', MATCHES = 'MATCHES' }
      enum PkgRelation { EMITS, ORDERS, GATE }
      
      Structure:
      {
        "ruleName": string (descriptive name),
        "priority": number (lower = higher priority, default 100),
        "engine": "wasm" | "native" (default "wasm"),
        "ruleSource": string (optional description),
        "conditions": Array<{ 
          "conditionType": "TAG" | "SIGNAL" | "VALUE" | "FACT",
          "conditionKey": string (e.g., "tags", "identity_verified", "seal_integrity", "release_window_open"),
          "operator": "=" | "!=" | ">" | ">=" | "<" | "<=" | "EXISTS" | "IN" | "MATCHES",
          "value": string (optional, required for most operators except EXISTS)
        }>,
        "emissions": Array<{ 
          "subtaskName": string (must match available subtask types),
          "relationshipType": "EMITS" | "ORDERS" | "GATE",
          "params": object (optional parameters for the subtask)
        }>
      }
      
      Common Subtask Types:
      - verify_identity_and_provenance, authorize_release_window, lock_zone_access, dispatch_operator_review
      - route_robotic_handoff, quarantine_asset_lot, capture_playback_evidence, sync_custody_memory
      - notify_control_plane, stabilize_environmental_controls
      
      Example Input: "If a high-value vault release is requested without verified identity, lock the zone, dispatch operator review, and notify the control plane."
      Example Output: {
        "ruleName": "deny_unknown_actor_release",
        "priority": 10,
        "engine": "wasm",
        "ruleSource": "Deny vault release until identity and approvals are verified",
        "conditions": [
          { "conditionType": "TAG", "conditionKey": "tags", "operator": "MATCHES", "value": ".*release.*" },
          { "conditionType": "SIGNAL", "conditionKey": "identity_verified", "operator": "<", "value": "1" }
        ],
        "emissions": [
          { "subtaskName": "lock_zone_access", "relationshipType": "GATE", "params": {} },
          { "subtaskName": "dispatch_operator_review", "relationshipType": "ORDERS", "params": {} },
          { "subtaskName": "notify_control_plane", "relationshipType": "EMITS", "params": {} }
        ]
      }
      
      Use available subtask types from context. Return ONLY valid JSON matching the Rule structure.
    `;

    const fullPrompt = `${params.prompt}${context}\n\nGenerate a rule object in JSON format:`;

    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: fullPrompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    if (!text) return null;
    
    const data = JSON.parse(text);
    
    // Validate and return structured rule
    return {
      ruleName: data.ruleName || '',
      priority: data.priority || 100,
      engine: data.engine || 'wasm',
      ruleSource: data.ruleSource || undefined,
      conditions: data.conditions || [],
      emissions: data.emissions || [],
    };

  } catch (error) {
    console.error("Gemini Rule Generation Error:", error);
    return null;
  }
};

export interface GenerateFactParams {
  prompt: string;
  snapshotId?: number;
  snapshot?: Snapshot;
  existingFacts?: Fact[];
}

export interface GeneratedFact {
  namespace: string;
  subject: string;
  predicate: string;
  object: any;
  validFrom?: string;
  validTo?: string;
  createdBy?: string;
}

export const generateFactFromNaturalLanguage = async (params: GenerateFactParams): Promise<GeneratedFact | null> => {
  if (!process.env.API_KEY) {
    console.warn("No API KEY found");
    return null;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Build context from snapshot and existing facts
    const contextParts: string[] = [];
    
    if (params.snapshot) {
      contextParts.push(`Current Snapshot: ${params.snapshot.version} (${params.snapshot.env})`);
      if (params.snapshot.notes) {
        contextParts.push(`Snapshot Notes: ${params.snapshot.notes}`);
      }
    }
    
    if (params.existingFacts && params.existingFacts.length > 0) {
      contextParts.push(`\nExisting Facts (${params.existingFacts.length}):`);
      params.existingFacts.slice(0, 10).forEach((fact, idx) => {
        contextParts.push(`${idx + 1}. ${fact.subject} ${fact.predicate}: ${JSON.stringify(fact.object)}`);
      });
    }
    
    const context = contextParts.length > 0 ? `\n\nContext:\n${contextParts.join('\n')}\n` : '';
    
    const systemInstruction = `
      You are an expert SeedCore Policy Knowledge Graph engineer for a zero-trust runtime.
      Convert natural language descriptions into Fact objects for the PKG system.
      
      Domain: Governed Agents, actuator endpoints, vault control, seal scanners, custody memory,
      operator approvals, and quarantine recovery.
      
      Fact Structure:
      {
        "namespace": string (e.g., "seedcore", "default"),
        "subject": string (e.g., "system:robotic_handler", "zone:VAULT", "policy:high_value_release"),
        "predicate": string (e.g., "hasCapabilities", "hasRuntimeSurface", "requiresControls"),
        "object": object (JSON object with relevant properties)
      }
      
      Common Patterns:
      - Systems: subject="system:NAME", predicate="hasCapabilities", object={capabilities: [], controlType: "", constraints: []}
      - Zones: subject="zone:NAME", predicate="hasRuntimeSurface", object={name: "", mission: "", emphasis: ""}
      - Policies: subject="policy:NAME", predicate="requiresControls", object={approvals: NUMBER, releaseWindowMinutes: NUMBER}
      - Assets: subject="asset_class:NAME", predicate="hasCustodyRequirements", object={requireSealIntegrity: true}
      
      Examples:
      Input: "A robotic handler that can move sealed lots from the vault to the transfer corridor"
      Output: {
        "namespace": "seedcore",
        "subject": "system:robotic_handler",
        "predicate": "hasCapabilities",
        "object": {
          "capabilities": ["vault_pick", "handoff_transfer"],
          "constraints": ["VAULT->TRANSFER only"],
          "controlType": "actuator"
        }
      }
      
      Input: "The vault requires dual approval and a 15 minute release window"
      Output: {
        "namespace": "seedcore",
        "subject": "policy:high_value_release",
        "predicate": "requiresControls",
        "object": {
          "approvals": 2,
          "releaseWindowMinutes": 15
        }
      }
      
      Input: "The quarantine bay isolates broken seals and route drift incidents"
      Output: {
        "namespace": "seedcore",
        "subject": "zone:QUARANTINE",
        "predicate": "hasRuntimeSurface",
        "object": {
          "name": "Quarantine Bay",
          "mission": "Contain anomalies before irreversible handoff",
          "emphasis": "Recovery"
        }
      }
      
      Always use namespace "seedcore" for runtime-related facts.
      Generate appropriate subject identifiers based on the description.
      Return ONLY valid JSON matching the Fact structure.
    `;

    const fullPrompt = `${params.prompt}${context}\n\nGenerate a fact object in JSON format:`;

    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: fullPrompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
      }
    }); 

    const text = response.text;
    if (!text) return null;
    
    const data = JSON.parse(text);
    
    // Validate and return structured fact
    return {
      namespace: data.namespace || 'seedcore',
      subject: data.subject || '',
      predicate: data.predicate || '',
      object: data.object || {},
      validFrom: data.validFrom || undefined,
      validTo: data.validTo || undefined,
      createdBy: data.createdBy || 'user',
    };

  } catch (error) {
    console.error("Gemini Fact Generation Error:", error);
    return null;
  }
};

export interface GenerateEvolutionPlanParams {
  intent: string;
  currentVersion: string;
  contextFacts: any[];
  snapshot?: Snapshot;
  existingRules?: Rule[];
  subtaskTypes?: SubtaskType[];
}

export const generateEvolutionPlan = async (
  params: GenerateEvolutionPlanParams
): Promise<EvolutionProposal | null> => {
  if (!process.env.API_KEY) return null;

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const systemInstruction = `
      You are the "Policy Evolution Agent" for SeedCore runtime governance.
      Your job is to analyze human intent or failure logs and propose specific, structured changes to the policy graph.

      Rules:
      1. You cannot delete facts, only rules.
      2. You must provide a "rationale" for every change.
      3. Your output must be a JSON object matching the EvolutionProposal schema (excluding id/status).
      4. Suggest a semantic version bump.
      5. Every CREATE or MODIFY ruleData must include at least one condition and at least one emission.
      6. Do not emit empty arrays for conditions or emissions.
      7. Use the exact field names conditionType, conditionKey, operator, value, subtaskName, relationshipType, params.
      8. Do not use snake_case keys like condition_type, condition_key, relationship_type, or subtask_name.
      9. Valid conditionType values are only TAG, SIGNAL, VALUE, FACT. Never emit BASIC or any other enum.
      10. Valid operator values are only =, !=, >=, <=, >, <, EXISTS, IN, MATCHES. Never emit GTE/LTE/EQUALS spellings.

      Schema:
      {
        "newVersion": "vX.Y.Z",
        "reason": "Executive summary of the change plan",
        "changes": [
          {
            "action": "CREATE" | "MODIFY" | "DELETE",
            "ruleId": "string (only for modify/delete)",
            "rationale": "Why this specific change?",
            "ruleData": { ... Rule Object Structure ... } (only for create/modify)
          }
        ]
      }
    `;

    const contextParts: string[] = [];

    if (params.snapshot) {
      contextParts.push(`Current Snapshot: ${params.snapshot.version} (${params.snapshot.env})`);
      if (params.snapshot.notes) {
        contextParts.push(`Snapshot Notes: ${params.snapshot.notes}`);
      }
    }

    if (params.subtaskTypes && params.subtaskTypes.length > 0) {
      contextParts.push(`Available Subtask Types (${params.subtaskTypes.length}):`);
      params.subtaskTypes.forEach((st, idx) => {
        contextParts.push(`${idx + 1}. ${st.name}${st.defaultParams ? ` (default: ${JSON.stringify(st.defaultParams)})` : ''}`);
      });
    }

    if (params.existingRules && params.existingRules.length > 0) {
      contextParts.push(`Existing Rules (${params.existingRules.length}):`);
      params.existingRules.slice(0, 10).forEach((rule, idx) => {
        const conds = rule.conditions.map(c => `${c.conditionKey} ${c.operator} ${c.value || 'EXISTS'}`).join(', ');
        const ems = rule.emissions.map(e => `${e.relationshipType}:${e.subtaskName || e.subtaskTypeId || 'unknown'}`).join(', ');
        contextParts.push(`${idx + 1}. ${rule.ruleName} [${rule.engine}] conditions=[${conds}] emissions=[${ems}]`);
      });
    }

    const userPrompt = `
      Current Version: ${params.currentVersion}
      Context/Facts Sample: ${JSON.stringify(params.contextFacts.slice(0, 5))}
      ${contextParts.length ? `\nDetailed Snapshot Context:\n${contextParts.join('\n')}\n` : ''}
      
      Human Intent / Incident Log:
      "${params.intent}"

      Propose a safe evolution plan.
      Use ONLY available subtask names from the provided context.
      Every emission must include both subtaskName and relationshipType.
      Do not invent new subtask names when an existing one already fits.
    `;

    const response = await ai.models.generateContent({
      model: LLM_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    if (!text) return null;

    const data = normalizeEvolutionProposal(JSON.parse(text));
    
    return {
      id: `prop-${Date.now()}`,
      baseSnapshotId: 0, // Assigned by caller
      status: 'PENDING',
      generatedAt: new Date().toISOString(),
      ...data
    };

  } catch (error) {
    console.error("Evolution Agent Error:", error);
    return null;
  }
};
