/**
 * Multimodal Feedback Loop Service (Step 7)
 * 
 * Purpose: Real-time governance endpoint that processes WebSocket streams
 * from hotel simulator (camera/sensor feeds) and applies policy in real-time.
 * 
 * Architecture:
 * - Hotel Simulator streams frames via WebSockets (Gemini Live API)
 * - PKG Simulator's endpoint processes the stream
 * - If violation detected, sends GATE signal back to Hotel
 * - Uses Gemini 3 Pro/Flash Live API for sub-second latency
 * 
 * Note: WebSocket server setup requires ws or socket.io library
 * This service provides the business logic; server setup is separate
 */

import { GoogleGenAI } from "@google/genai";
import { DesignContext, DesignAnalysis } from "./designGovernanceService";

const LLM_MODEL = process.env.LLM_MODEL || "gemini-3-flash-preview";

export interface StreamFrame {
  frameId: string;
  timestamp: string;
  imageData?: string; // Base64 encoded image
  imageUri?: string; // S3/GCS URI
  sensorData?: {
    inkLevel?: number;
    fabricType?: string;
    printerStatus?: "idle" | "printing" | "error";
  };
  guestContext?: {
    guestId: string;
    room: string;
  };
}

export interface StreamGovernanceResult {
  frameId: string;
  timestamp: string;
  violationDetected: boolean;
  violationType?: "copyright" | "inappropriate" | "restricted_symbol" | "hardware_error";
  gateSignal?: {
    action: "BLOCK" | "PAUSE" | "WARN";
    reason: string;
    severity: "critical" | "warning" | "info";
  };
  policyDecision?: {
    allowed: boolean;
    reason: string;
  };
  latency: number; // milliseconds
}

/**
 * Process a single frame from the stream
 * Uses Gemini Vision API for real-time analysis
 */
export async function processStreamFrame(
  frame: StreamFrame,
  designContext: DesignContext,
  snapshotId: number,
  dbProxyUrl: string = "http://localhost:3011",
  apiKey?: string
): Promise<StreamGovernanceResult> {
  const startTime = Date.now();
  const key = apiKey || process.env.API_KEY || process.env.GEMINI_API_KEY;
  
  if (!key) {
    throw new Error("No Gemini API key found. Set API_KEY or GEMINI_API_KEY environment variable");
  }

  const ai = new GoogleGenAI({ apiKey: key });

  try {
    // Analyze frame for violations
    let violationDetected = false;
    let violationType: StreamGovernanceResult["violationType"] = undefined;
    let gateSignal: StreamGovernanceResult["gateSignal"] = undefined;

    if (frame.imageData || frame.imageUri) {
      // Use Gemini Vision to analyze frame
      const visionPrompt = `
Analyze this frame from the hotel's DIY painting station.

Check for:
1. Copyright/trademark violations (logos, brand symbols)
2. Inappropriate content (offensive imagery)
3. Restricted symbols (hate symbols, prohibited content)
4. Hardware issues (printer errors, fabric misalignment)

Return JSON:
{
  "violationDetected": boolean,
  "violationType": "copyright" | "inappropriate" | "restricted_symbol" | null,
  "confidence": 0.0-1.0,
  "description": "what was detected"
}
`;

      const imagePart = frame.imageData 
        ? { inlineData: { data: frame.imageData, mimeType: "image/jpeg" } }
        : { fileUri: frame.imageUri };

      const response = await ai.models.generateContent({
        model: LLM_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { text: visionPrompt },
              imagePart,
            ],
          },
        ],
        config: {
          temperature: 0.1, // Low temperature for consistent detection
          responseMimeType: "application/json",
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error("No response text from Gemini API");
      }
      const analysis = JSON.parse(text);
      
      if (analysis.violationDetected && analysis.confidence > 0.7) {
        violationDetected = true;
        violationType = analysis.violationType || undefined;
        
        // Determine gate signal based on violation type
        if (violationType === "copyright" || violationType === "restricted_symbol") {
          gateSignal = {
            action: "BLOCK",
            reason: analysis.description || `Violation detected: ${violationType}`,
            severity: "critical",
          };
        } else if (violationType === "inappropriate") {
          gateSignal = {
            action: "PAUSE",
            reason: analysis.description || "Inappropriate content detected",
            severity: "warning",
          };
        }
      }
    }

    // Evaluate policy if no visual violation
    let policyDecision: StreamGovernanceResult["policyDecision"] = undefined;
    if (!violationDetected) {
      const policyResponse = await fetch(`${dbProxyUrl}/api/policy/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotId,
          context: {
            tags: designContext.guestTags || [],
            signals: {
              ink_level: frame.sensorData?.inkLevel || 0,
              printer_status: frame.sensorData?.printerStatus === "error" ? 1 : 0,
            },
            values: {
              guest_credits: designContext.guestCredits || 0,
            },
          },
        }),
      });

      if (policyResponse.ok) {
        const policyResult = await policyResponse.json();
        policyDecision = {
          allowed: policyResult.allowed,
          reason: policyResult.reason,
        };

        // If policy blocks, create gate signal
        if (!policyResult.allowed && !gateSignal) {
          gateSignal = {
            action: "BLOCK",
            reason: policyResult.reason,
            severity: "critical",
          };
        }
      }
    }

    const latency = Date.now() - startTime;

    return {
      frameId: frame.frameId,
      timestamp: frame.timestamp,
      violationDetected,
      violationType,
      gateSignal,
      policyDecision,
      latency,
    };
  } catch (error) {
    console.error("Error processing stream frame:", error);
    const latency = Date.now() - startTime;
    
    // Return safe failure result
    return {
      frameId: frame.frameId,
      timestamp: frame.timestamp,
      violationDetected: true, // Fail-safe: block on error
      gateSignal: {
        action: "PAUSE",
        reason: `Processing error: ${error instanceof Error ? error.message : String(error)}`,
        severity: "warning",
      },
      latency,
    };
  }
}

/**
 * WebSocket message handler for stream governance
 * This would be called by the WebSocket server when receiving frames
 */
export async function handleStreamGovernanceMessage(
  message: {
    type: "frame" | "ping" | "close";
    frame?: StreamFrame;
    designContext?: DesignContext;
    snapshotId?: number;
  },
  dbProxyUrl: string = "http://localhost:3011",
  apiKey?: string
): Promise<StreamGovernanceResult | null> {
  if (message.type === "frame" && message.frame && message.designContext && message.snapshotId) {
    return await processStreamFrame(
      message.frame,
      message.designContext,
      message.snapshotId,
      dbProxyUrl,
      apiKey
    );
  }
  
  return null;
}
