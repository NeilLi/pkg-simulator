/**
 * Design Governance Setup Service
 * 
 * Purpose: Register design-related subtask types and policy rules via API
 * (Not migrations - these are runtime registrations per snapshot)
 * 
 * Architecture: Follows the same pattern as initializationService.ts
 * - Subtask types are registered via POST /api/subtask-types
 * - Policy rules are created via POST /api/rules
 * - All data goes into the database through the API layer
 */

const API_BASE_URL = import.meta.env.VITE_DB_PROXY_URL || 'http://localhost:3001';

import { PkgConditionType, PkgOperator, PkgRelation, PkgEngine } from '../types';

export interface DesignGovernanceSetupResult {
  success: boolean;
  message: string;
  snapshotId: number;
  created: {
    subtaskTypes: number;
    rules: number;
  };
  subtaskTypeIds: Record<string, string>;
}

/**
 * Register design-related subtask types for a snapshot
 * These are abstract-friendly: domain-specific details go in default_params JSONB
 */
export async function registerDesignSubtaskTypes(snapshotId: number): Promise<Record<string, string>> {
  const subtaskTypes = [
    {
      name: 'design_preview',
      defaultParams: {
        description: 'Generate preview for guest confirmation before printing',
        require_confirmation: true,
        preview_uri: null,
        device_types: ['tablet', 'phone', 'display']
      }
    },
    {
      name: 'fabric_prepare',
      defaultParams: {
        description: 'Prepare fabric for printing/painting',
        fabric_type: null,
        tension: 0.8,
        alignment: true,
        temperature: null
      }
    },
    {
      name: 'fabric_print',
      defaultParams: {
        description: 'Print design pattern onto fabric using digital printer',
        pattern_uri: null,
        ink_colors: [],
        print_speed: 'high_precision',
        resolution: 'dpi_600'
      }
    },
    {
      name: 'fabric_paint',
      defaultParams: {
        description: 'Apply paint/ink to fabric using robotic painter',
        colors: [],
        technique: 'spray',
        precision: 'high',
        layers: 1
      }
    },
    {
      name: 'billing_log',
      defaultParams: {
        description: 'Log resource usage for billing/credits',
        ink_usage: 0,
        fabric_usage: 0,
        guest_id: null,
        resource_type: 'ink'
      }
    },
    {
      name: 'notify_guest',
      defaultParams: {
        description: 'Send notification to guest device',
        message: null,
        type: 'info',
        channels: ['app', 'sms', 'email'],
        urgency: 'normal'
      }
    },
    {
      name: 'block_design',
      defaultParams: {
        description: 'Block design from proceeding due to policy violation',
        reason: null,
        violation_type: null,
        appealable: true
      }
    },
    {
      name: 'require_credit_purchase',
      defaultParams: {
        description: 'Require guest to purchase additional credits',
        required_credits: 0,
        current_credits: 0,
        purchase_uri: null
      }
    },
    {
      name: 'require_preview_confirmation',
      defaultParams: {
        description: 'Require guest to confirm preview before proceeding',
        preview_uri: null,
        timeout_seconds: 300,
        auto_approve: false
      }
    }
  ];

  const subtaskTypeIds: Record<string, string> = {};

  for (const subtask of subtaskTypes) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/subtask-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshotId,
          name: subtask.name,
          defaultParams: subtask.defaultParams,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        subtaskTypeIds[subtask.name] = result.id;
      } else {
        const error = await response.text();
        console.warn(`Failed to create subtask type ${subtask.name}:`, error);
      }
    } catch (error) {
      console.error(`Error creating subtask type ${subtask.name}:`, error);
    }
  }

  return subtaskTypeIds;
}

/**
 * Create design governance policy rules
 * Uses Gemini API to generate rules from natural language, then creates them via API
 */
export async function createDesignGovernanceRules(
  snapshotId: number,
  subtaskTypeIds: Record<string, string>,
  apiKey?: string
): Promise<number> {
  const key = apiKey || import.meta.env.VITE_GEMINI_API_KEY;
  if (!key) {
    console.warn('No Gemini API key - skipping rule generation');
    return 0;
  }

  // Import Gemini service
  const { generateRuleFromNaturalLanguage } = await import('./geminiService');
  
  // Rule 1: Copyright Protection
  const copyrightRulePrompt = `Create a policy rule that blocks designs with copyright risk.
    Conditions: copyright_risk signal >= 0.5
    Emissions: block_design subtask (GATE relationship) with params: violation_type="copyright", reason="Copyright violation detected"
    Priority: 10 (high priority blocking rule)`;
  
  // Rule 2: Premium Fabric Access Control  
  const fabricAccessRulePrompt = `Create a policy rule for premium fabric access control.
    Conditions: fabric_type tag = "silk" AND Premium_Silk tag does NOT exist
    Emissions: block_design subtask (GATE relationship) with params: violation_type="fabric_access", reason="Premium_Silk tag required for silk fabric"
    Priority: 20 (high priority blocking rule)`;
  
  // Rule 3: Credit-Based Printing
  const creditRulePrompt = `Create a policy rule for credit-based printing restrictions.
    Conditions: ink_consumption value > guest_credits value
    Emissions: 
      1. require_credit_purchase subtask (GATE relationship) with params: required_credits, current_credits
      2. notify_guest subtask (EMITS relationship) with message about insufficient credits
    Priority: 30`;
  
  // Rule 4: Approved Design Printing Flow
  const printFlowRulePrompt = `Create a policy rule for approved design printing workflow.
    Conditions: copyright_risk signal < 0.5 AND inappropriate_content signal = 0 AND restricted_symbols signal = 0 AND request_type tag = "print"
    Emissions (in order):
      1. design_preview subtask (GATE relationship, position 0) with require_confirmation=true
      2. fabric_prepare subtask (ORDERS relationship, position 1) with fabric_type parameter
      3. fabric_print subtask (ORDERS relationship, position 2) with pattern_uri and ink_colors parameters
      4. billing_log subtask (EMITS relationship, position 3) with ink_usage and guest_id parameters
    Priority: 100 (lower priority, runs after blocking rules)`;

  const rulePrompts = [
    { prompt: copyrightRulePrompt, priority: 10, name: 'copyright_protection' },
    { prompt: fabricAccessRulePrompt, priority: 20, name: 'premium_fabric_access_control' },
    { prompt: creditRulePrompt, priority: 30, name: 'credit_based_printing' },
    { prompt: printFlowRulePrompt, priority: 100, name: 'approved_design_print_flow' },
  ];

  let createdCount = 0;

  for (const ruleDef of rulePrompts) {
    try {
      // Generate rule using Gemini
      const generatedRule = await generateRuleFromNaturalLanguage({
        prompt: ruleDef.prompt,
        snapshotId,
        subtaskTypes: Object.keys(subtaskTypeIds).map(name => ({
          id: subtaskTypeIds[name],
          snapshotId,
          name,
        })),
      });

      if (!generatedRule) {
        console.warn(`Failed to generate rule: ${ruleDef.name}`);
        continue;
      }

      // Map subtask names to IDs for emissions
      const emissions = generatedRule.emissions.map(em => {
        const subtaskId = subtaskTypeIds[em.subtaskName];
        if (!subtaskId) {
          console.warn(`Subtask type not found: ${em.subtaskName}`);
          return null;
        }
        return {
          subtaskTypeId: subtaskId,
          relationshipType: em.relationshipType as PkgRelation,
          params: em.params || {},
        };
      }).filter(Boolean);

      // Create rule via API
      const response = await fetch(`${API_BASE_URL}/api/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshotId,
          ruleName: generatedRule.ruleName || ruleDef.name,
          priority: ruleDef.priority,
          engine: generatedRule.engine || PkgEngine.WASM,
          ruleSource: generatedRule.ruleSource || `Design Governance: ${ruleDef.name}`,
          conditions: generatedRule.conditions.map(c => ({
            conditionType: c.conditionType as PkgConditionType,
            conditionKey: c.conditionKey,
            operator: c.operator as PkgOperator,
            value: c.value || undefined,
          })),
          emissions: emissions,
        }),
      });

      if (response.ok) {
        createdCount++;
      } else {
        const error = await response.text();
        console.warn(`Failed to create rule ${ruleDef.name}:`, error);
      }
    } catch (error) {
      console.error(`Error creating rule ${ruleDef.name}:`, error);
    }
  }

  return createdCount;
}

/**
 * Complete setup: Register subtask types and create policy rules
 */
export async function setupDesignGovernance(
  snapshotId: number,
  apiKey?: string
): Promise<DesignGovernanceSetupResult> {
  try {
    // Step 1: Register subtask types
    const subtaskTypeIds = await registerDesignSubtaskTypes(snapshotId);
    const subtaskTypesCount = Object.keys(subtaskTypeIds).length;

    // Step 2: Create policy rules
    const rulesCount = await createDesignGovernanceRules(snapshotId, subtaskTypeIds, apiKey);

    return {
      success: true,
      message: `Design governance setup complete: ${subtaskTypesCount} subtask types, ${rulesCount} rules`,
      snapshotId,
      created: {
        subtaskTypes: subtaskTypesCount,
        rules: rulesCount,
      },
      subtaskTypeIds,
    };
  } catch (error) {
    return {
      success: false,
      message: `Design governance setup failed: ${error instanceof Error ? error.message : String(error)}`,
      snapshotId,
      created: {
        subtaskTypes: 0,
        rules: 0,
      },
      subtaskTypeIds: {},
    };
  }
}
