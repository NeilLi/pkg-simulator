import { GoogleGenAI } from "@google/genai";

const DEFAULT_DB_PROXY = "http://localhost:3011";

// Zone-aware seed intent types
export type CreativeSeedIntent = {
  story: string;
  style: string;
  type: string;
  size: string;
  persona: string;
  constraints: string[];
  designConcept: string;
  fabricType: string;
  safetyTags: string[];
};

export type InfrastructureSeedIntent = {
  operation: string; // e.g., "adjust_hvac", "route_elevator", "control_access"
  zone: string; // JOURNEY, GIFT, WEAR, KIDS
  parameters: Record<string, any>; // zone-specific parameters
  priority: "normal" | "high" | "emergency";
  description: string;
  systemType: "hvac" | "elevator" | "doors" | "environment";
  safetyLevel?: string; // especially for KIDS zone
};

export type SeedIntent = CreativeSeedIntent | InfrastructureSeedIntent;

export type SeedResult = {
  intent: SeedIntent;
  policyDecision: any;
  eventMemoryId?: string;
  knowledgeMemoryId?: string;
  ticket?: {
    ticketId: string;
    title?: string;
    runId: string;
  };
  id?: string;
  title?: string;
  written?: boolean;
  appended?: boolean;
  stored?: boolean;
  allowed?: boolean; // Policy validation result
  isSafety?: boolean; // For KIDS zone safety monitoring
  isHvac?: boolean; // For HVAC operations
  zone?: string; // Zone identifier
};

export type SeedProfile = "JOURNEY" | "GIFT" | "WEAR" | "KIDS" | "INFRASTRUCTURE" | "MIXED";
export type MemoryWriteMode = "dry_run" | "event_working" | "event_then_approve";

export type SeedOptions = {
  count: number;
  dbProxyUrl: string;
  includeKnowledgeBase?: boolean; // Optional, defaults to false
  profile?: SeedProfile;
  mode?: MemoryWriteMode;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
};

const SYSTEM_INSTRUCTION = `Return STRICT JSON only. No markdown. No extra keys.`;

// Schema for creative zones (JOURNEY, GIFT, WEAR, KIDS)
const CREATIVE_SEED_SCHEMA = {
  type: "object",
  properties: {
    seeds: {
      type: "array",
      items: {
        type: "object",
        properties: {
          story: { type: "string" },
          style: { type: "string" },
          type: { type: "string" },
          size: { type: "string" },
          persona: { type: "string" },
          constraints: { type: "array", items: { type: "string" } },
          designConcept: { type: "string" },
          fabricType: { type: "string" },
          safetyTags: { type: "array", items: { type: "string" } }
        },
        required: ["story", "style", "type", "size", "persona", "constraints", "designConcept", "fabricType", "safetyTags"]
      }
    }
  },
  required: ["seeds"]
};

// Schema for infrastructure scenarios
const INFRASTRUCTURE_SEED_SCHEMA = {
  type: "object",
  properties: {
    seeds: {
      type: "array",
      items: {
        type: "object",
        properties: {
          operation: { type: "string" },
          zone: { type: "string" },
          parameters: { type: "object" },
          priority: { type: "string", enum: ["normal", "high", "emergency"] },
          description: { type: "string" },
          systemType: { type: "string", enum: ["hvac", "elevator", "doors", "environment"] },
          safetyLevel: { type: "string" }
        },
        required: ["operation", "zone", "parameters", "priority", "description", "systemType"]
      }
    }
  },
  required: ["seeds"]
};

const STYLES = ["Minimalist", "Cyberpunk", "Boho", "Vintage", "Abstract Art", "Streetwear"];
const TYPES = ["T-Shirt", "Hoodie", "Jacket", "Tote Bag"];
const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

const buildSeedPrompt = (count: number, profile?: SeedProfile): { prompt: string; schema: any; isInfrastructure: boolean } => {
  const isInfrastructure = profile === "INFRASTRUCTURE";
  
  if (isInfrastructure) {
    return {
      prompt: `Generate ${count} infrastructure operation scenarios for smart building systems.
Each scenario should simulate real-world operations for HVAC, elevators, doors, or room environment systems.
Operations should target zones: JOURNEY (Journey Studio), GIFT (Gift Forge), WEAR (Fashion Lab), or KIDS (Magic Atelier).
Include realistic parameters like temperature adjustments, elevator routing priorities, access control actions, or environmental setpoints.
For KIDS zone, always include enhanced safety monitoring parameters.
Each item must include: operation (e.g., "adjust_hvac", "route_elevator", "control_access", "adjust_environment"), 
zone (JOURNEY/GIFT/WEAR/KIDS), parameters (object with relevant fields), priority (normal/high/emergency), 
description (brief scenario description), systemType (hvac/elevator/doors/environment), and optionally safetyLevel for KIDS zone.`,
      schema: INFRASTRUCTURE_SEED_SCHEMA,
      isInfrastructure: true
    };
  }
  
  let context = "";
  let zoneFocus = "";
  switch (profile) {
    case "JOURNEY":
      context = "for Journey Studio - storytelling and journey planning experiences";
      zoneFocus = "Journey Studio focuses on directing personal stories and travel experiences";
      break;
    case "GIFT":
      context = "for Gift Forge - 3D object crafting and fabrication";
      zoneFocus = "Gift Forge specializes in crafting custom 3D objects and gifts";
      break;
    case "WEAR":
      context = "for Fashion Lab - wearable design and fashion creation";
      zoneFocus = "Fashion Lab creates custom wearables and fashion items";
      break;
    case "KIDS":
      context = "for Magic Atelier - safe creative play for children";
      zoneFocus = "Magic Atelier provides safe, supervised creative activities for kids with enhanced safety monitoring";
      break;
    case "MIXED":
      context = "across all creative zones: Journey Studio, Gift Forge, Fashion Lab, and Magic Atelier";
      zoneFocus = "Mix of storytelling, 3D crafting, wearable design, and kids' creative activities";
      break;
    default:
      context = "for creative zone experiences";
      zoneFocus = "General creative zone activities";
  }
  
  return {
    prompt: `Generate ${count} creative seed items ${context}.
${zoneFocus}
Each item must include a short story, style, type, size, persona, constraints, designConcept, fabricType, safetyTags.
Styles: ${STYLES.join(", ")}. Types: ${TYPES.join(", ")}. Sizes: ${SIZES.join(", ")}.
Keep stories under 40 words. Persona should be "guest" or "staff".
Constraints should be practical, like "no neon inks" or "avoid metallic threads".
For KIDS zone, ensure safetyTags include appropriate child-safety considerations.`,
    schema: CREATIVE_SEED_SCHEMA,
    isInfrastructure: false
  };
};

const parseJson = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Model returned invalid JSON.");
  }
};

const fetchJson = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || response.statusText);
  }
  return response.json();
};

const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
};

const loadActiveSnapshot = async (dbProxyUrl: string) => {
  const snapshots = await fetchJson(`${dbProxyUrl}/api/snapshots`);
  return snapshots.find((snap: any) => snap.isActive) || snapshots[0] || null;
};

const buildPolicyContext = (intent: SeedIntent, profile: SeedProfile, action: string) => {
  // Check if intent is infrastructure type
  if ('operation' in intent && 'zone' in intent) {
    const infraIntent = intent as InfrastructureSeedIntent;
    const isKidsZone = infraIntent.zone === "KIDS";
    const isSafety = infraIntent.systemType === "environment" && isKidsZone;
    const isHvac = infraIntent.systemType === "hvac";
    
    return {
      tags: [
        `zone=${infraIntent.zone}`,
        `system=${infraIntent.systemType}`,
        `operation=${infraIntent.operation}`,
        `priority=${infraIntent.priority}`,
        ...(isKidsZone ? ["kids", "safety"] : []),
        ...(isHvac ? ["hvac"] : []),
        ...(isSafety ? ["safety_monitoring"] : [])
      ],
      signals: {
        severity: infraIntent.priority === "emergency" ? 0.9 : infraIntent.priority === "high" ? 0.7 : 0.5,
        zone: infraIntent.zone,
        system_type: infraIntent.systemType,
        priority_level: infraIntent.priority,
        ...(isKidsZone && infraIntent.safetyLevel ? { safety_level: infraIntent.safetyLevel } : {})
      },
      values: {
        zone: infraIntent.zone,
        operation: infraIntent.operation,
        ...infraIntent.parameters
      }
    };
  }
  
  // Creative zone intent
  const creativeIntent = intent as CreativeSeedIntent;
  const isKidsZone = profile === "KIDS";
  const isSafety = isKidsZone && (creativeIntent.safetyTags?.length > 0 || 
    JSON.stringify(creativeIntent).toLowerCase().includes("safety"));
  
  return {
    tags: [
      `zone=${profile}`,
      `action=${action}`,
      `wearable_type=${creativeIntent.type}`,
      `wearable_style=${creativeIntent.style}`,
      ...(isKidsZone ? ["kids", "creative_rendering"] : ["creative_rendering"]),
      ...(isSafety ? ["safety_monitoring"] : [])
    ],
    signals: {
      risk_score: Math.min(creativeIntent.story.length / 1000, 1),
      content_category: profile.toLowerCase(),
      age_rating: isKidsZone ? "kids" : "general",
      region: "global",
      device: "router"
    },
    values: {
      size: creativeIntent.size,
      persona: creativeIntent.persona,
      zone: profile
    }
  };
};

const createRunId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `run_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
};

export const seedDataService = {
  async generateSeeds(options: SeedOptions): Promise<SeedResult[]> {
    checkAbort(options.signal);
    
    // Get API key from environment variables (same pattern as geminiService.ts)
    const apiKey = (process.env.API_KEY || process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY) as string;
    if (!apiKey) {
      throw new Error("No API KEY found. Please set GEMINI_API_KEY or VITE_GEMINI_API_KEY in your .env.local file.");
    }

    const dbProxyUrl = options.dbProxyUrl || DEFAULT_DB_PROXY;
    const mode = options.mode || "event_working";
    const profile = options.profile || "MIXED";
    
    const ai = new GoogleGenAI({ apiKey });
    const { prompt, schema, isInfrastructure } = buildSeedPrompt(options.count, profile);

    checkAbort(options.signal);
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    if (!response?.text) {
      throw new Error("No response from Gemini.");
    }

    const parsed = parseJson(response.text);
    const seeds: SeedIntent[] = parsed.seeds || [];
    
    // Determine if we're processing infrastructure or creative seeds
    const processingInfrastructure = isInfrastructure || seeds.length > 0 && 'operation' in seeds[0];

    checkAbort(options.signal);
    const snapshot = await loadActiveSnapshot(dbProxyUrl);
    if (!snapshot) {
      throw new Error("No active snapshot available.");
    }

    const results: SeedResult[] = [];
    const total = seeds.length;

    for (let i = 0; i < seeds.length; i++) {
      checkAbort(options.signal);
      
      const intent = seeds[i];
      const runId = createRunId();
      
      // Determine intent type and build appropriate metadata
      const isInfraIntent = processingInfrastructure && 'operation' in intent;
      const infraIntent = isInfraIntent ? intent as InfrastructureSeedIntent : null;
      const creativeIntent = !isInfraIntent ? intent as CreativeSeedIntent : null;
      
      // Build ticket ID and title based on intent type
      const ticketId = isInfraIntent 
        ? `SEEDCORE-INFRA-${runId.slice(0, 8)}`
        : `SEEDCORE-MFG-${runId.slice(0, 8)}`;
      
      const title = isInfraIntent
        ? `${infraIntent!.operation} - ${infraIntent!.zone} Zone`
        : `${creativeIntent!.style} ${creativeIntent!.type} - ${creativeIntent!.persona}`;
      
      // Determine zone and safety flags
      const zone = isInfraIntent ? infraIntent!.zone : profile;
      const isKidsZone = zone === "KIDS";
      const isSafety = isKidsZone && (
        isInfraIntent 
          ? (infraIntent!.systemType === "environment" || infraIntent!.safetyLevel !== undefined)
          : (creativeIntent!.safetyTags?.length > 0 || JSON.stringify(creativeIntent).toLowerCase().includes("safety"))
      );
      const isHvac = isInfraIntent && infraIntent!.systemType === "hvac";

      // Build PKG policy context (zone-aware)
      const action = isInfraIntent ? infraIntent!.operation : "generate_design";
      const policyContext = buildPolicyContext(intent, profile, action);
      checkAbort(options.signal);
      const policyDecision = await fetchJson(`${dbProxyUrl}/api/policy/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId: snapshot.id, context: policyContext }),
        signal: options.signal
      });

      let eventMemoryId: string | undefined;
      let knowledgeMemoryId: string | undefined;
      let written = false;
      let appended = false;
      let stored = false;

      // Only write if not in dry_run mode
      if (mode !== "dry_run") {
        // Write to event_working if allowed
        if (policyDecision.allowed) {
          checkAbort(options.signal);
          
          // Determine category and content based on intent type
          const category = isInfraIntent 
            ? `infrastructure_${infraIntent!.systemType}_operation`
            : `${profile.toLowerCase()}_design_seed`;
          
          const content = isInfraIntent
            ? infraIntent!.description
            : creativeIntent!.story;
          
          // Build metadata based on intent type
          const metadata: any = {
            intent,
            snapshot,
            policyDecision,
            source_modality: "text",
            zone,
            ticket: {
              ticketId,
              title,
              runId
            }
          };
          
          if (isInfraIntent) {
            metadata.operation = infraIntent!.operation;
            metadata.systemType = infraIntent!.systemType;
            metadata.parameters = infraIntent!.parameters;
            metadata.priority = infraIntent!.priority;
            if (infraIntent!.safetyLevel) {
              metadata.safetyLevel = infraIntent!.safetyLevel;
            }
          } else {
            metadata.design = {
              designConcept: creativeIntent!.designConcept,
              fabricType: creativeIntent!.fabricType,
              safetyTags: creativeIntent!.safetyTags
            };
          }
          
          const eventMemory = await fetchJson(`${dbProxyUrl}/api/memory/append`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tier: "event_working",
              category,
              content,
              runId,
              metadata
            }),
            signal: options.signal
          });
          eventMemoryId = eventMemory.id;
          written = true;
          appended = true;
        }

        // Write to knowledge_base if includeKnowledgeBase and allowed
        if (options.includeKnowledgeBase && policyDecision.allowed && mode === "event_then_approve") {
          // In event_then_approve mode, we write to event_working first, then user can approve later
          // For now, we don't auto-promote, but we could add that logic here
        } else if (options.includeKnowledgeBase && policyDecision.allowed && mode === "event_working") {
          // Only write to knowledge_base if explicitly requested
          checkAbort(options.signal);
          const knowledgeCategory = isInfraIntent
            ? `infrastructure_${infraIntent!.systemType}_ticket`
            : `${profile.toLowerCase()}_design_ticket`;
          
          const knowledgeMemory = await fetchJson(`${dbProxyUrl}/api/memory/append`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tier: "knowledge_base",
              category: knowledgeCategory,
              content: ticketId,
              runId,
              metadata: {
                ticket: { ticketId, title, runId },
                intent,
                snapshot,
                policyDecision,
                zone
              }
            }),
            signal: options.signal
          });
          knowledgeMemoryId = knowledgeMemory.id;
          stored = true;
        }
      }

      results.push({
        intent,
        policyDecision,
        eventMemoryId,
        knowledgeMemoryId,
        ticket: {
          ticketId,
          title,
          runId
        },
        id: ticketId,
        title,
        written,
        appended,
        stored,
        allowed: policyDecision.allowed,
        isSafety,
        isHvac,
        zone
      });

      // Report progress
      options.onProgress?.(i + 1, total);
    }

    return results;
  }
};
