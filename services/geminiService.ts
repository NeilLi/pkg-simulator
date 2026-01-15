import { GoogleGenAI, Type } from "@google/genai";
import { Snapshot, Rule, Fact, SubtaskType, EvolutionProposal } from "../types";

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
      You are an expert SeedCore Policy Knowledge Graph engineer for a futuristic hotel (2030+).
      Convert natural language hospitality policies into JSON objects matching the Rule interface.
      
      Domain: Service robots, Smart HVAC, Emergency Protocols, Guest Comfort, 3D Printing, Room Management.

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
          "conditionKey": string (e.g., "tags", "x6", "temperature", "room"),
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
      - isolate_room_hvac, dispatch_inspection_robot, notify_human_supervisor, prepare_guest_relocation
      - activate_emergency_protocol, contact_external_service, fabricate_part, install_part
      - adjust_room_environment, update_guest_profile
      
      Example Input: "If emergency keywords and HVAC issues are detected with high confidence, isolate the room HVAC, dispatch inspection robot, notify supervisor, and prepare guest relocation."
      Example Output: {
        "ruleName": "emergency_hvac_smoke_detection",
        "priority": 10,
        "engine": "wasm",
        "ruleSource": "Emergency HVAC and Smoke Detection Protocol",
        "conditions": [
          { "conditionType": "TAG", "conditionKey": "tags", "operator": "MATCHES", "value": ".*emergency.*" },
          { "conditionType": "TAG", "conditionKey": "tags", "operator": "MATCHES", "value": ".*hvac.*" },
          { "conditionType": "SIGNAL", "conditionKey": "x6", "operator": ">=", "value": "0.8" }
        ],
        "emissions": [
          { "subtaskName": "isolate_room_hvac", "relationshipType": "ORDERS", "params": {} },
          { "subtaskName": "dispatch_inspection_robot", "relationshipType": "ORDERS", "params": {} },
          { "subtaskName": "notify_human_supervisor", "relationshipType": "ORDERS", "params": {} },
          { "subtaskName": "prepare_guest_relocation", "relationshipType": "ORDERS", "params": {} }
        ]
      }
      
      Use available subtask types from context. Return ONLY valid JSON matching the Rule structure.
    `;

    const fullPrompt = `${params.prompt}${context}\n\nGenerate a rule object in JSON format:`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
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
      You are an expert SeedCore Policy Knowledge Graph engineer for a futuristic hotel (2030+).
      Convert natural language descriptions into Fact objects for the PKG system.
      
      Domain: Service robots, Smart rooms (HVAC, lighting, privacy glass), 3D printers, Wearable devices, 
      Digital concierges, Human staff, External city services (police, fire, hospitals).
      
      Fact Structure:
      {
        "namespace": string (e.g., "hotel", "default"),
        "subject": string (e.g., "unit:robot_01", "room:1208", "guest:john_doe", "service:external_police"),
        "predicate": string (e.g., "hasCapabilities", "hasType", "hasSystems", "hasAccess"),
        "object": object (JSON object with relevant properties)
      }
      
      Common Patterns:
      - Plug-in units: subject="unit:NAME", predicate="hasCapabilities", object={capabilities: [], constraints: [], skills: [], authority: ""}
      - Rooms: subject="room:NUMBER", predicate="hasSystems", object={systems: [], floor: NUMBER}
      - Services: subject="service:NAME", predicate="hasType", object={type: "", capabilities: [], contact: ""}
      - Guests: subject="guest:ID", predicate="hasAccess", object={level: "", services: []}
      
      Examples:
      Input: "A cleaning robot on floor 1-10 that works 8am to 10pm"
      Output: {
        "namespace": "hotel",
        "subject": "unit:cleaning_robot_01",
        "predicate": "hasCapabilities",
        "object": {
          "capabilities": ["deliver", "scan", "clean"],
          "constraints": ["floor=1-10", "hours=08:00-22:00"],
          "skills": ["logistics"],
          "authority": "execution_only"
        }
      }
      
      Input: "Room 1208 has HVAC, lighting, and privacy glass systems"
      Output: {
        "namespace": "hotel",
        "subject": "room:1208",
        "predicate": "hasSystems",
        "object": {
          "systems": ["hvac", "lighting", "privacy_glass"],
          "floor": 12
        }
      }
      
      Input: "External police service for emergency response, contact 911"
      Output: {
        "namespace": "hotel",
        "subject": "service:external_police",
        "predicate": "hasType",
        "object": {
          "type": "external",
          "capabilities": ["emergency_response"],
          "contact": "911"
        }
      }
      
      Always use namespace "hotel" for hotel-related facts.
      Generate appropriate subject identifiers based on the description.
      Return ONLY valid JSON matching the Fact structure.
    `;

    const fullPrompt = `${params.prompt}${context}\n\nGenerate a fact object in JSON format:`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
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
      namespace: data.namespace || 'hotel',
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

export const generateEvolutionPlan = async (
  intent: string, 
  currentVersion: string, 
  contextFacts: any[]
): Promise<EvolutionProposal | null> => {
  if (!process.env.API_KEY) return null;

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const systemInstruction = `
      You are the "Policy Evolution Agent" for SeedCore (Hospitality PKG).
      Your job is to analyze human intent or failure logs and propose specific, structured changes to the policy graph.

      Rules:
      1. You cannot delete facts, only rules.
      2. You must provide a "rationale" for every change.
      3. Your output must be a JSON object matching the EvolutionProposal schema (excluding id/status).
      4. Suggest a semantic version bump.

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

    const userPrompt = `
      Current Version: ${currentVersion}
      Context/Facts Sample: ${JSON.stringify(contextFacts.slice(0, 3))}
      
      Human Intent / Incident Log:
      "${intent}"

      Propose a safe evolution plan.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: userPrompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    if (!text) return null;

    const data = JSON.parse(text);
    
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