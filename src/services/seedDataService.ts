import { GoogleGenAI } from "@google/genai";

const DEFAULT_DB_PROXY = "http://localhost:3001";

export type SeedIntent = {
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
};

export type SeedProfile = "wearable_story" | "magic_atelier" | "journey_studio" | "mixed";
export type MemoryWriteMode = "dry_run" | "event_working" | "event_then_approve";

export type SeedOptions = {
  count: number;
  dbProxyUrl: string;
  includeKnowledgeBase: boolean;
  profile?: SeedProfile;
  mode?: MemoryWriteMode;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
};

const SYSTEM_INSTRUCTION = `Return STRICT JSON only. No markdown. No extra keys.`;

const SEED_SCHEMA = {
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

const STYLES = ["Minimalist", "Cyberpunk", "Boho", "Vintage", "Abstract Art", "Streetwear"];
const TYPES = ["T-Shirt", "Hoodie", "Jacket", "Tote Bag"];
const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

const buildSeedPrompt = (count: number, profile?: SeedProfile) => {
  let context = "";
  switch (profile) {
    case "wearable_story":
      context = "for a luxury hotel wearable experience (WearableStoryStudio scene)";
      break;
    case "magic_atelier":
      context = "for a magical atelier crafting experience (MagicAtelier scene)";
      break;
    case "journey_studio":
      context = "for a journey and travel experience (JourneyStudio scene)";
      break;
    case "mixed":
      context = "across multiple scenes: luxury hotel wearables, magical atelier crafting, and journey/travel experiences";
      break;
    default:
      context = "for a luxury hotel wearable experience";
  }
  
  return `Generate ${count} seed items ${context}.
Each item must include a short story, style, type, size, persona, constraints, designConcept, fabricType, safetyTags.
Styles: ${STYLES.join(", ")}. Types: ${TYPES.join(", ")}. Sizes: ${SIZES.join(", ")}.
Keep stories under 40 words. Persona should be "guest" or "staff".
Constraints should be practical, like "no neon inks" or "avoid metallic threads".`;
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

const buildPolicyContext = (intent: SeedIntent, action: string) => ({
  tags: [
    "scene=wearable_story_studio",
    `action=${action}`,
    `wearable_type=${intent.type}`,
    `wearable_style=${intent.style}`
  ],
  signals: {
    risk_score: Math.min(intent.story.length / 1000, 1),
    content_category: "wearable_story",
    age_rating: "general",
    region: "global",
    device: "router"
  },
  values: {
    size: intent.size,
    persona: intent.persona
  }
});

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
    const profile = options.profile || "wearable_story";
    
    const ai = new GoogleGenAI({ apiKey });
    const prompt = buildSeedPrompt(options.count, profile);

    checkAbort(options.signal);
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: SEED_SCHEMA
      }
    });

    if (!response?.text) {
      throw new Error("No response from Gemini.");
    }

    const parsed = parseJson(response.text);
    const seeds: SeedIntent[] = parsed.seeds || [];

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
      const ticketId = `SEEDCORE-MFG-${runId.slice(0, 8)}`;
      const title = `${intent.style} ${intent.type} - ${intent.persona}`;
      
      const policyContext = buildPolicyContext(intent, "generate_design");
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
          const eventMemory = await fetchJson(`${dbProxyUrl}/api/memory/append`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tier: "event_working",
              category: "wearable_design_seed",
              content: intent.story,
              runId,
              metadata: {
                intent,
                snapshot,
                policyDecision,
                source_modality: "text",
                design: {
                  designConcept: intent.designConcept,
                  fabricType: intent.fabricType,
                  safetyTags: intent.safetyTags
                },
                ticket: {
                  ticketId,
                  title,
                  runId
                }
              }
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
          const knowledgeMemory = await fetchJson(`${dbProxyUrl}/api/memory/append`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tier: "knowledge_base",
              category: "wearable_design_ticket",
              content: ticketId,
              runId,
              metadata: {
                ticket: { ticketId, title, runId },
                intent,
                snapshot,
                policyDecision
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
        stored
      });

      // Report progress
      options.onProgress?.(i + 1, total);
    }

    return results;
  }
};
