import { GoogleGenAI } from "@google/genai";
import { Rule, Fact, Snapshot } from "../types";

/**
 * Design Governance Service
 * 
 * Purpose: Govern generative design processes (DIY dress printing, custom apparel, etc.)
 * using Gemini API for content analysis and PKG for policy enforcement.
 * 
 * Architecture:
 * - Content Analysis: Gemini analyzes design metadata/images for policy violations
 * - Policy Evaluation: PKG rules check against design context (guest tags, credits, etc.)
 * - Action Emission: Validated designs trigger subtasks (printing, painting, etc.)
 */

export interface DesignContext {
  // Guest context
  guestId: string;
  guestTags?: string[]; // e.g., ["Premium_Silk", "VIP", "Designer"]
  guestCredits?: number;
  
  // Design metadata
  designMetadata: {
    title?: string;
    description?: string;
    imageUri?: string; // S3/GCS URI for design image
    patternUri?: string; // SVG/vector pattern file
    colors?: string[]; // Hex color codes
    fabricType?: string;
    designType?: string; // "dress", "shirt", "accessory"
    inkConsumption?: number; // Estimated ink units
    complexity?: "simple" | "moderate" | "complex";
  };
  
  // Request context
  requestType: "print" | "preview" | "save";
  runId?: string;
}

export interface DesignPolicyDecision {
  allowed: boolean;
  reason: string;
  violations?: string[];
  warnings?: string[];
  requiredActions?: string[]; // e.g., ["require_preview_confirmation", "reduce_ink_usage"]
  riskScore: number; // 0.0 - 1.0
  policyRuleId?: string; // Which rule triggered the decision
}

export interface DesignAnalysis {
  // Content analysis from Gemini
  contentAnalysis: {
    hasCopyrightRisk: boolean;
    hasInappropriateContent: boolean;
    hasRestrictedSymbols: boolean;
    detectedSymbols?: string[]; // Symbols/logos detected
    contentCategory: string; // "artistic", "text", "logo", "pattern"
    complexity: "simple" | "moderate" | "complex";
    estimatedInkUsage: number;
  };
  
  // Policy decision
  policyDecision: DesignPolicyDecision;
  
  // Recommended emissions (if allowed)
  recommendedEmissions?: Array<{
    subtaskName: string;
    relationshipType: "EMITS" | "ORDERS" | "GATE";
    params: Record<string, any>;
    position: number;
  }>;
}

/**
 * Analyze design content using Gemini Vision API
 * Checks for copyright violations, inappropriate content, restricted symbols
 */
export async function analyzeDesignContent(
  designMetadata: DesignContext["designMetadata"],
  apiKey?: string
): Promise<DesignAnalysis["contentAnalysis"]> {
  const key = apiKey || process.env.API_KEY || process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;
  if (!key) {
    throw new Error("No API KEY found. Please set GEMINI_API_KEY or VITE_GEMINI_API_KEY");
  }

  const ai = new GoogleGenAI({ apiKey: key });

  const systemInstruction = `
    You are a Design Content Analyzer for a luxury hotel's DIY apparel printing system.
    Analyze design metadata and images for policy compliance.
    
    Your job:
    1. Detect copyright/trademark violations (logos, brand symbols, copyrighted characters)
    2. Identify inappropriate content (offensive imagery, hate symbols)
    3. Assess design complexity and resource requirements
    4. Categorize content type (artistic, text, logo, pattern)
    
    Return JSON:
    {
      "hasCopyrightRisk": boolean,
      "hasInappropriateContent": boolean,
      "hasRestrictedSymbols": boolean,
      "detectedSymbols": string[] (if any),
      "contentCategory": "artistic" | "text" | "logo" | "pattern",
      "complexity": "simple" | "moderate" | "complex",
      "estimatedInkUsage": number (0-100 scale)
    }
  `;

  // Build prompt from metadata
  const promptParts: string[] = [];
  
  if (designMetadata.title) {
    promptParts.push(`Design Title: ${designMetadata.title}`);
  }
  if (designMetadata.description) {
    promptParts.push(`Description: ${designMetadata.description}`);
  }
  if (designMetadata.colors && designMetadata.colors.length > 0) {
    promptParts.push(`Colors: ${designMetadata.colors.join(", ")}`);
  }
  if (designMetadata.fabricType) {
    promptParts.push(`Fabric Type: ${designMetadata.fabricType}`);
  }
  if (designMetadata.designType) {
    promptParts.push(`Design Type: ${designMetadata.designType}`);
  }
  
  const prompt = promptParts.length > 0 
    ? `Analyze this design:\n${promptParts.join("\n")}`
    : "Analyze the provided design metadata for policy compliance.";

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("No response from Gemini");
    }

    const analysis = JSON.parse(text);
    
    return {
      hasCopyrightRisk: analysis.hasCopyrightRisk || false,
      hasInappropriateContent: analysis.hasInappropriateContent || false,
      hasRestrictedSymbols: analysis.hasRestrictedSymbols || false,
      detectedSymbols: analysis.detectedSymbols || [],
      contentCategory: analysis.contentCategory || "artistic",
      complexity: analysis.complexity || "moderate",
      estimatedInkUsage: analysis.estimatedInkUsage || 50,
    };
  } catch (error) {
    console.error("Design content analysis error:", error);
    // Fallback: conservative analysis
    return {
      hasCopyrightRisk: false,
      hasInappropriateContent: false,
      hasRestrictedSymbols: false,
      contentCategory: "artistic",
      complexity: "moderate",
      estimatedInkUsage: 50,
    };
  }
}

/**
 * Evaluate design against PKG policy rules
 * Combines Gemini content analysis with PKG rule evaluation
 */
export async function evaluateDesignPolicy(
  context: DesignContext,
  snapshot: Snapshot,
  contentAnalysis: DesignAnalysis["contentAnalysis"],
  dbProxyUrl: string = "http://localhost:3011"
): Promise<DesignPolicyDecision> {
  // Build PKG context from design context + content analysis
  const pkgContext = {
    tags: [
      `guest_id=${context.guestId}`,
      `request_type=${context.requestType}`,
      `design_type=${context.designMetadata.designType || "unknown"}`,
      `fabric_type=${context.designMetadata.fabricType || "unknown"}`,
      `content_category=${contentAnalysis.contentCategory}`,
      ...(context.guestTags || []),
    ],
    signals: {
      copyright_risk: contentAnalysis.hasCopyrightRisk ? 1.0 : 0.0,
      inappropriate_content: contentAnalysis.hasInappropriateContent ? 1.0 : 0.0,
      restricted_symbols: contentAnalysis.hasRestrictedSymbols ? 1.0 : 0.0,
      complexity_score: contentAnalysis.complexity === "complex" ? 0.9 : 
                        contentAnalysis.complexity === "moderate" ? 0.5 : 0.2,
      ink_usage: contentAnalysis.estimatedInkUsage / 100,
      risk_score: (contentAnalysis.hasCopyrightRisk ? 0.4 : 0) +
                  (contentAnalysis.hasInappropriateContent ? 0.4 : 0) +
                  (contentAnalysis.hasRestrictedSymbols ? 0.2 : 0),
    },
    values: {
      guest_credits: context.guestCredits || 0,
      ink_consumption: contentAnalysis.estimatedInkUsage,
      fabric_type: context.designMetadata.fabricType || "cotton",
    },
  };

  // Evaluate against PKG policy
  try {
    const response = await fetch(`${dbProxyUrl}/api/policy/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        snapshotId: snapshot.id,
        context: pkgContext,
      }),
    });

    if (!response.ok) {
      throw new Error(`Policy evaluation failed: ${response.statusText}`);
    }

    const result = await response.json();
    
    // Build comprehensive decision
    const violations: string[] = [];
    const warnings: string[] = [];
    const requiredActions: string[] = [];

    if (contentAnalysis.hasCopyrightRisk) {
      violations.push("Copyright/trademark violation detected");
    }
    if (contentAnalysis.hasInappropriateContent) {
      violations.push("Inappropriate content detected");
    }
    if (contentAnalysis.hasRestrictedSymbols) {
      violations.push(`Restricted symbols detected: ${contentAnalysis.detectedSymbols?.join(", ")}`);
    }
    
    // Check credits
    if (context.guestCredits !== undefined && contentAnalysis.estimatedInkUsage > context.guestCredits) {
      warnings.push(`Ink consumption (${contentAnalysis.estimatedInkUsage}) exceeds available credits (${context.guestCredits})`);
      requiredActions.push("require_credit_purchase");
    }

    // Check fabric access
    if (context.designMetadata.fabricType === "silk" && !context.guestTags?.includes("Premium_Silk")) {
      violations.push("Premium_Silk tag required for silk fabric");
    }

    const riskScore = Math.min(
      pkgContext.signals.risk_score + 
      (violations.length > 0 ? 0.3 : 0) +
      (warnings.length > 0 ? 0.1 : 0),
      1.0
    );

    const allowed = result.allowed && violations.length === 0;

    return {
      allowed,
      reason: allowed 
        ? result.reason || "Design approved by policy"
        : violations.length > 0 
          ? violations.join("; ")
          : result.reason || "Design blocked by policy",
      violations: violations.length > 0 ? violations : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      requiredActions: requiredActions.length > 0 ? requiredActions : undefined,
      riskScore,
      policyRuleId: result.ruleId,
    };
  } catch (error) {
    console.error("Policy evaluation error:", error);
    // Conservative fallback: block if high risk
    const riskScore = pkgContext.signals.risk_score;
    return {
      allowed: riskScore < 0.5,
      reason: `Policy evaluation error: ${error instanceof Error ? error.message : String(error)}`,
      riskScore,
    };
  }
}

/**
 * Generate recommended emissions for approved design
 * Uses Gemini to suggest the appropriate subtask sequence
 */
export async function generateDesignEmissions(
  context: DesignContext,
  contentAnalysis: DesignAnalysis["contentAnalysis"],
  apiKey?: string
): Promise<DesignAnalysis["recommendedEmissions"]> {
  const key = apiKey || process.env.API_KEY || process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;
  if (!key) {
    return undefined; // Optional, can work without
  }

  const ai = new GoogleGenAI({ apiKey: key });

  const systemInstruction = `
    You are a Subtask Orchestrator for DIY apparel printing.
    Given a design context, generate the sequence of subtasks needed to execute the design.
    
    Available Subtask Types:
    - fabric_print: Print design onto fabric
    - fabric_paint: Apply paint/ink to fabric
    - fabric_prepare: Prepare fabric (tension, alignment)
    - design_preview: Generate preview for guest confirmation
    - billing_log: Log resource usage for billing
    - notify_guest: Send notification to guest
    
    Relationship Types:
    - GATE: Must complete before next step (blocking)
    - ORDERS: Direct command to execute
    - EMITS: Fire-and-forget notification
    
    Return JSON array of emissions:
    [
      {
        "subtaskName": string,
        "relationshipType": "GATE" | "ORDERS" | "EMITS",
        "params": object,
        "position": number (0, 1, 2, ...)
      }
    ]
    
    Example for print request:
    [
      {
        "subtaskName": "design_preview",
        "relationshipType": "GATE",
        "params": {"require_confirmation": true},
        "position": 0
      },
      {
        "subtaskName": "fabric_prepare",
        "relationshipType": "ORDERS",
        "params": {"fabric_type": "silk", "tension": 0.8},
        "position": 1
      },
      {
        "subtaskName": "fabric_print",
        "relationshipType": "ORDERS",
        "params": {"pattern_uri": "...", "ink_colors": [...], "print_speed": "high_precision"},
        "position": 2
      },
      {
        "subtaskName": "billing_log",
        "relationshipType": "EMITS",
        "params": {"ink_usage": 45, "guest_id": "..."},
        "position": 3
      }
    ]
  `;

  const prompt = `
    Design Context:
    - Type: ${context.designMetadata.designType}
    - Fabric: ${context.designMetadata.fabricType}
    - Complexity: ${contentAnalysis.complexity}
    - Ink Usage: ${contentAnalysis.estimatedInkUsage}
    - Request Type: ${context.requestType}
    - Pattern URI: ${context.designMetadata.patternUri || "N/A"}
    - Colors: ${context.designMetadata.colors?.join(", ") || "N/A"}
    
    Generate the subtask emission sequence for this design.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    if (!text) {
      return undefined;
    }

    const emissions = JSON.parse(text);
    return Array.isArray(emissions) ? emissions : undefined;
  } catch (error) {
    console.error("Emission generation error:", error);
    return undefined;
  }
}

/**
 * Complete design governance workflow
 * Analyzes content, evaluates policy, and generates emissions
 */
export async function governDesign(
  context: DesignContext,
  snapshot: Snapshot,
  dbProxyUrl: string = "http://localhost:3011",
  apiKey?: string
): Promise<DesignAnalysis> {
  // Step 1: Analyze design content with Gemini
  const contentAnalysis = await analyzeDesignContent(context.designMetadata, apiKey);

  // Step 2: Evaluate against PKG policy
  const policyDecision = await evaluateDesignPolicy(context, snapshot, contentAnalysis, dbProxyUrl);

  // Step 3: Generate emissions if allowed
  let recommendedEmissions: DesignAnalysis["recommendedEmissions"] = undefined;
  if (policyDecision.allowed && context.requestType === "print") {
    recommendedEmissions = await generateDesignEmissions(context, contentAnalysis, apiKey);
  }

  return {
    contentAnalysis,
    policyDecision,
    recommendedEmissions,
  };
}
