import { GoogleGenAI, Type } from "@google/genai";

export const generateRuleFromNaturalLanguage = async (prompt: string, snapshotId: number): Promise<any> => {
  if (!process.env.API_KEY) {
    console.warn("No API KEY found");
    return null;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const systemInstruction = `
      You are an expert SeedCore Policy Knowledge Graph engineer for a futuristic hotel (2030+).
      Convert natural language hospitality policies into JSON objects matching the Rule interface.
      
      Domain: Service robots, Smart HVAC, Emergency Protocols, Guest Comfort, 3D Printing.

      Interfaces:
      enum PkgConditionType { TAG, SIGNAL, VALUE, FACT }
      enum PkgOperator { EQUALS = '=', GT = '>', EXISTS = 'EXISTS', IN = 'IN' }
      enum PkgRelation { EMITS, ORDERS }
      
      Structure:
      {
        ruleName: string,
        priority: number (default 100),
        conditions: Array<{ conditionType: string, conditionKey: string, operator: string, value: string }>,
        emissions: Array<{ subtaskName: string, relationshipType: string, params: object }>
      }
      
      Example Input: "If a VIP guest is detected and temp is over 25, cool the room."
      Example Output: {
        "ruleName": "VIP Cooling Protocol",
        "priority": 50,
        "conditions": [
           { "conditionType": "TAG", "conditionKey": "role", "operator": "=", "value": "vip" },
           { "conditionType": "SIGNAL", "conditionKey": "temp", "operator": ">", "value": "25" }
        ],
        "emissions": [
           { "subtaskName": "adjust_hvac", "relationshipType": "EMITS", "params": { "mode": "cool", "target": 22 } }
        ]
      }
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    if (!text) return null;
    
    const data = JSON.parse(text);
    return {
      ...data,
      snapshotId,
      id: `gen-${Date.now()}`,
      engine: 'wasm',
      disabled: false
    };

  } catch (error) {
    console.error("Gemini Generation Error:", error);
    return null;
  }
};