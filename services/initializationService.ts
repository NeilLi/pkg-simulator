import { PkgEnv, PkgEngine, PkgConditionType, PkgOperator, PkgRelation } from '../types';

const API_BASE_URL = import.meta.env.VITE_DB_PROXY_URL || 'http://localhost:3011';

interface InitializeResult {
  success: boolean;
  message: string;
  snapshotId?: number;
  created: {
    snapshots: number;
    subtaskTypes: number;
    rules: number;
    facts: number;
    governedFacts?: number; // Facts linked to rules via pkg_rule_id
  };
}

/**
 * Idempotent initialization of SeedCore-Native Hotel (2030+) scenario
 * Creates basic policy rules and snapshots for a single specified environment
 * 
 * @param env - The environment to initialize (prod, dev, or staging). Only one environment is supported.
 */
export async function initializeHotelScenario(env: PkgEnv = PkgEnv.PROD): Promise<InitializeResult> {
  const created = {
    snapshots: 0,
    subtaskTypes: 0,
    rules: 0,
    facts: 0,
    governedFacts: 0,
  };

  try {
    // Step 1: Check if hotel snapshot already exists for the specified environment (idempotent)
    const existingSnapshotsResponse = await fetch(`${API_BASE_URL}/api/snapshots`);
    let snapshotId: number;
    
    if (existingSnapshotsResponse.ok) {
      const existingSnapshots = await existingSnapshotsResponse.json();
      // Find snapshot matching both the notes pattern AND the specified environment
      const hotelSnapshot = existingSnapshots.find((s: any) => 
        s.notes && s.notes.includes('SeedCore-Native Hotel (2030+)') && s.env === env
      );
      
      if (hotelSnapshot) {
        // Use existing snapshot for this environment
        snapshotId = hotelSnapshot.id;
        created.snapshots = 0; // Already exists
      } else {
        // Create new hotel snapshot for the specified environment only
        const envSuffix = env === PkgEnv.PROD ? '' : `-${env}`;
        const snapshotVersion = `hotel-2030${envSuffix}-v1.0.0-${Date.now()}`;
        const envLabel = env === PkgEnv.PROD ? 'Production' : 
                        env === PkgEnv.STAGING ? 'Staging' : 'Development';
        
        const snapshotResponse = await fetch(`${API_BASE_URL}/api/snapshots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            version: snapshotVersion,
            env: env,
            entrypoint: 'data.pkg',
            schemaVersion: '1',
            checksum: '0'.repeat(64), // Placeholder
            sizeBytes: 0,
            notes: `SeedCore-Native Hotel (2030+) - ${envLabel} Environment`,
            isActive: true,
          }),
        });

        if (!snapshotResponse.ok) {
          throw new Error(`Failed to create snapshot for ${env} environment: ${snapshotResponse.statusText}`);
        }

        const snapshot = await snapshotResponse.json();
        snapshotId = snapshot.id;
        created.snapshots = 1;
      }
    } else {
      throw new Error('Failed to fetch existing snapshots');
    }

    // Step 2: Create subtask types for zone-based operations
    // Focused on JOURNEY, GIFT, WEAR, KIDS zones and smart building systems
    // Each includes executor hints (agent_behavior) for dynamic agent initialization
    const subtaskTypes = [
      { 
        name: 'adjust_zone_environment', 
        defaultParams: { 
          zone: null, // JOURNEY, GIFT, WEAR, KIDS
          temperature: null, 
          lighting: null,
          humidity: null,
          agent_behavior: ['background_loop', 'continuous_monitoring'],
          routing: { preferred_organ: 'utility_organ' }
        } 
      },
      { 
        name: 'adjust_zone_hvac', 
        defaultParams: { 
          zone: null, // JOURNEY, GIFT, WEAR, KIDS
          temperature: null,
          airFlow: null,
          isolation: false,
          agent_behavior: ['background_loop', 'energy_optimization'],
          routing: { preferred_organ: 'utility_organ' }
        } 
      },
      { 
        name: 'control_zone_access', 
        defaultParams: { 
          zone: null, // JOURNEY, GIFT, WEAR, KIDS
          action: null, // 'lock', 'unlock', 'restrict'
          accessLevel: null,
          timeout_ms: 5000, // 5-second timeout for access control operations
          agent_behavior: ['immediate_execution', 'security_monitoring'],
          routing: { preferred_organ: 'physical_actuation_organ' }
        } 
      },
      { 
        name: 'route_elevator_to_zone', 
        defaultParams: { 
          zone: null, // JOURNEY, GIFT, WEAR, KIDS
          priority: 'normal', // 'normal', 'high', 'emergency'
          agent_behavior: ['intelligent_routing', 'load_balancing'],
          routing: { preferred_organ: 'physical_actuation_organ' }
        } 
      },
      { 
        name: 'monitor_zone_safety', 
        defaultParams: { 
          zone: null, // JOURNEY, GIFT, WEAR, KIDS (especially KIDS)
          safetyLevel: null,
          agent_behavior: ['continuous_monitoring', 'immediate_execution'],
          routing: { preferred_organ: 'physical_actuation_organ' }
        } 
      },
      { 
        name: 'reachy_actuator', 
        defaultParams: { 
          zone: null, // JOURNEY, GIFT, WEAR, KIDS
          action: null, // Physical actuation commands
          agent_behavior: ['immediate_execution', 'precision_control'],
          routing: { preferred_organ: 'physical_actuation_organ' }
        } 
      },
      { 
        name: 'optimize_zone_energy', 
        defaultParams: { 
          zone: null, // JOURNEY, GIFT, WEAR, KIDS
          target: null, // 'hvac', 'lighting', 'all'
          agent_behavior: ['background_loop', 'energy_optimization'],
          routing: { preferred_organ: 'utility_organ' }
        } 
      },
      { 
        name: 'notify_zone_operator', 
        defaultParams: { 
          zone: null, // JOURNEY, GIFT, WEAR, KIDS
          message: null, 
          urgency: 'normal', // 'normal', 'high', 'critical'
          agent_behavior: ['immediate_execution'],
          routing: { preferred_organ: 'user_experience_organ' }
        } 
      },
      { 
        name: 'activate_zone_emergency', 
        defaultParams: { 
          zone: null, // JOURNEY, GIFT, WEAR, KIDS
          type: null, // 'fire', 'medical', 'security'
          timeout_ms: 2000, // 2-second timeout for emergency triggers
          agent_behavior: ['immediate_execution', 'priority_override'],
          routing: { preferred_organ: 'physical_actuation_organ' }
        } 
      },
      { 
        name: 'generate_precision_mockups', 
        defaultParams: { 
          engine: 'three_js', // Rendering engine: three_js, canvas, svg
          export_format: 'png', // Output format: png, jpg, svg, pdf
          dpi: 300, // High-fidelity rendering resolution
          agent_behavior: ['background_loop', 'task_filter'],
          description: 'High-fidelity rendering for DIY Studios (Gift, Wear, Journey)',
          routing: { preferred_organ: 'brain_foundry_organ' }
        } 
      },
      { 
        name: 'sync_unified_memory', 
        defaultParams: { 
          memory_tier: 'event_working', // Tier A: event_working, Tier B: knowledge_base, Tier C: world_memory
          operation: null, // 'write', 'append', 'update'
          category: null, // Event category for classification
          agent_behavior: ['background_loop', 'continuous_monitoring']
        } 
      },
    ];

    const subtaskTypeIds: Record<string, string> = {};
    for (const subtask of subtaskTypes) {
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
        created.subtaskTypes++;
      }
    }

    // Step 3: Create policy rules for zone-based scenarios
    // Focused on JOURNEY, GIFT, WEAR, KIDS zones and smart building systems
    // Store rule IDs to link facts to rules
    const ruleIds: Record<string, string> = {};

    // Rule 1: Zone Environment Adjustment (Temperature, Lighting, Humidity)
    const rule1Id = await createRule({
      snapshotId,
      ruleName: 'zone_environment_adjustment',
      priority: 50,
      engine: PkgEngine.WASM,
      ruleSource: `# Zone Environment Adjustment
# Adjust zone environment (temperature, lighting, humidity) based on occupancy and preferences
# Applies to all zones: JOURNEY, GIFT, WEAR, KIDS`,
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*zone.*' },
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*environment.*' },
      ],
      emissions: [
        { subtaskTypeId: subtaskTypeIds['adjust_zone_environment'], relationshipType: PkgRelation.ORDERS },
      ],
    });
    ruleIds['zone_environment_adjustment'] = rule1Id;
    created.rules++;

    // Rule 2: Smart HVAC Zone Control
    const rule2Id = await createRule({
      snapshotId,
      ruleName: 'smart_hvac_zone_control',
      priority: 40,
      engine: PkgEngine.WASM,
      ruleSource: `# Smart HVAC Zone Control
# Intelligent climate management using adaptive setpoints from zone facts.
# Optimizes energy by cross-referencing system:hvac and occupancy signals.
# Dynamically looks up zone configurations from normalized facts (not hardcoded).`,
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*hvac.*' },
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*zone.*' },
      ],
      emissions: [
        { subtaskTypeId: subtaskTypeIds['adjust_zone_hvac'], relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskTypeIds['optimize_zone_energy'], relationshipType: PkgRelation.ORDERS },
      ],
    });
    ruleIds['smart_hvac_zone_control'] = rule2Id;
    created.rules++;

    // Rule 3: Zone Access Control (Doors Management)
    const rule3Id = await createRule({
      snapshotId,
      ruleName: 'zone_access_control',
      priority: 30,
      engine: PkgEngine.WASM,
      ruleSource: `# Zone Access Control
# Evaluate access based on persona signals and system:access facts.
# Gate access to Magic Atelier (KIDS) if age_rating < 13.
# Uses Biometric authentication and Persona-based authorization from normalized facts.`,
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*zone.*' },
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*access.*' },
        { conditionType: PkgConditionType.SIGNAL, conditionKey: 'persona', operator: PkgOperator.EXISTS, value: '' },
      ],
      emissions: [
        { subtaskTypeId: subtaskTypeIds['control_zone_access'], relationshipType: PkgRelation.ORDERS },
      ],
    });
    ruleIds['zone_access_control'] = rule3Id;
    created.rules++;

    // Rule 4: Elevator Zone Routing
    const rule4Id = await createRule({
      snapshotId,
      ruleName: 'elevator_zone_routing',
      priority: 35,
      engine: PkgEngine.WASM,
      ruleSource: `# Elevator Zone Routing
# Intelligent elevator routing to zones with priority handling
# Dynamically looks up zone-to-floor mappings from building:hotel_2030 facts (not hardcoded).
# Routes to all mapped zones based on normalized zone configuration facts.`,
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*elevator.*' },
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*zone.*' },
      ],
      emissions: [
        { subtaskTypeId: subtaskTypeIds['route_elevator_to_zone'], relationshipType: PkgRelation.ORDERS },
      ],
    });
    ruleIds['elevator_zone_routing'] = rule4Id;
    created.rules++;

    // Rule 5: Kids Zone Safety Monitoring (Special handling for KIDS zone)
    const rule5Id = await createRule({
      snapshotId,
      ruleName: 'kids_zone_safety_monitoring',
      priority: 20, // Higher priority for safety
      engine: PkgEngine.WASM,
      ruleSource: `# Kids Zone Safety Monitoring
# Enhanced safety monitoring for Magic Atelier (KIDS zone)
# Continuous monitoring with immediate alerts`,
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*kids.*' },
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*safety.*' },
      ],
      emissions: [
        { subtaskTypeId: subtaskTypeIds['monitor_zone_safety'], relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskTypeIds['notify_zone_operator'], relationshipType: PkgRelation.ORDERS },
      ],
    });
    ruleIds['kids_zone_safety_monitoring'] = rule5Id;
    created.rules++;

    // Rule 6: Zone Emergency Protocol
    const rule6Id = await createRule({
      snapshotId,
      ruleName: 'zone_emergency_protocol',
      priority: 10, // High priority for emergencies
      engine: PkgEngine.WASM,
      ruleSource: `# Zone Emergency Protocol
# Emergency response for any zone (JOURNEY, GIFT, WEAR, KIDS)
# Triggers HVAC isolation, access control, and operator notification`,
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*emergency.*' },
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*zone.*' },
        { conditionType: PkgConditionType.SIGNAL, conditionKey: 'severity', operator: PkgOperator.GTE, value: '0.7' },
      ],
      emissions: [
        { subtaskTypeId: subtaskTypeIds['activate_zone_emergency'], relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskTypeIds['adjust_zone_hvac'], relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskTypeIds['control_zone_access'], relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskTypeIds['notify_zone_operator'], relationshipType: PkgRelation.ORDERS },
      ],
    });
    ruleIds['zone_emergency_protocol'] = rule6Id;
    created.rules++;

    // Rule 7: DIY Studio Rendering Pipeline (Unified for JOURNEY, GIFT, WEAR)
    // Triggers high-fidelity rendering when a design is approved in any DIY Studio zone
    // Priority 45 ensures it runs after building safety rules (10-40) but before general environment (50+)
    const rule7Id = await createRule({
      snapshotId,
      ruleName: 'diy_studio_rendering_pipeline',
      priority: 45,
      engine: PkgEngine.WASM,
      ruleSource: `# DIY Studio Rendering Pipeline
# Triggers generate_precision_mockups for approved creative designs.
# Applicable to JOURNEY, GIFT, and WEAR zones only (excludes KIDS for safety).
# Bridges Policy → Rendering Pipeline (Three.js/Canvas Engine)`,
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*(journey|gift|wear).*' },
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*design.*' },
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*approved.*' },
        { conditionType: PkgConditionType.SIGNAL, conditionKey: 'confidence', operator: PkgOperator.GTE, value: '0.8' },
      ],
      emissions: [
        { subtaskTypeId: subtaskTypeIds['generate_precision_mockups'], relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskTypeIds['sync_unified_memory'], relationshipType: PkgRelation.ORDERS },
      ],
    });
    ruleIds['diy_studio_rendering_pipeline'] = rule7Id;
    created.rules++;

    // Rule 9: Deployment Success → Unified Memory Sync
    // Archives successful deployments as historical facts for next agent iteration
    const rule9Id = await createRule({
      snapshotId,
      ruleName: 'deployment_success_memory_sync',
      priority: 60,
      engine: PkgEngine.WASM,
      ruleSource: `# Deployment Success Memory Sync
# Ensures successful deployments are immediately archived as historical facts
# Context Management: Makes deployment history available for Evolution Agent`,
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*deployment.*' },
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*success.*' },
        { conditionType: PkgConditionType.SIGNAL, conditionKey: 'deployment_percent', operator: PkgOperator.GTE, value: '100' },
      ],
      emissions: [
        { subtaskTypeId: subtaskTypeIds['sync_unified_memory'], relationshipType: PkgRelation.ORDERS },
      ],
    });
    ruleIds['deployment_success_memory_sync'] = rule9Id;
    created.rules++;

    // Step 4: Create facts for zones and smart building systems (Cognitive USB model)
    // Facts aligned with Journey Studio, Gift Forge, Fashion Lab, Magic Atelier zones
    // and smart building management systems (HVAC, doors, elevators, room environment)
    //
    // NORMALIZATION STRATEGY:
    // - System facts focus on HOW they work (capabilities/features), NOT which zones they serve
    // - Zone facts focus on WHAT they are (theme/requirements/safety)
    // - Zone-to-System mapping is handled by policy rules, not hardcoded in facts
    // - This prevents "Redundancy Bloat" and makes Evolution Agent more efficient
    // - Example: When fixing "fire alarm in KIDS zone", AI sees:
    //   * zone:KIDS (Location with safety_priority: 'high')
    //   * system:smart_hvac (Tool with zone_isolation capability)
    //   * Policy connects them via tags/conditions, not hardcoded zone lists
    const pluginUnits = [
      {
        subject: 'zone:JOURNEY',
        predicate: 'hasConfiguration',
        object: { 
          name: 'Journey Studio', 
          caption: 'Direct Your Story', 
          theme: 'royal',
          capabilities: ['storytelling', 'journey_planning', 'experience_design'],
          systems: ['hvac', 'lighting', 'environmental_control']
        },
        tags: ['zone', 'journey', 'studio'],
        // Link to zone environment adjustment rule
        pkgRuleId: ruleIds['zone_environment_adjustment'],
      },
      {
        subject: 'zone:GIFT',
        predicate: 'hasConfiguration',
        object: { 
          name: 'Gift Forge', 
          caption: 'Craft 3D Objects', 
          theme: 'gold',
          capabilities: ['3d_printing', 'fabrication', 'custom_objects'],
          systems: ['hvac', 'ventilation', 'environmental_control']
        },
        tags: ['zone', 'gift', 'forge', 'fabrication'],
        // Link to zone environment adjustment rule
        pkgRuleId: ruleIds['zone_environment_adjustment'],
      },
      {
        subject: 'zone:WEAR',
        predicate: 'hasConfiguration',
        object: { 
          name: 'Fashion Lab', 
          caption: 'Design Wearables', 
          theme: 'blue',
          capabilities: ['wearable_design', 'fashion_creation', 'custom_wearables'],
          systems: ['hvac', 'lighting', 'environmental_control']
        },
        tags: ['zone', 'wear', 'fashion', 'lab'],
        // Link to zone environment adjustment rule
        pkgRuleId: ruleIds['zone_environment_adjustment'],
      },
      {
        subject: 'zone:KIDS',
        predicate: 'hasConfiguration',
        object: { 
          name: 'Magic Atelier', 
          caption: 'Kids Create', 
          theme: 'rose',
          isKids: true,
          safety_priority: 'high',
          capabilities: ['creative_play', 'safe_crafting', 'educational_activities'],
          systems: ['hvac', 'lighting', 'safety_monitoring', 'environmental_control'],
          requirements: {
            safety_monitoring: 'continuous',
            emergency_lock_override: true
          }
        },
        tags: ['zone', 'kids', 'atelier', 'safety'],
        // Link to both zone environment adjustment and kids safety monitoring rules
        // Use kids safety monitoring as primary (higher priority for safety)
        pkgRuleId: ruleIds['kids_zone_safety_monitoring'],
      },
      {
        subject: 'system:room_environment',
        predicate: 'hasCapabilities',
        object: { 
          capabilities: ['temperature_control', 'lighting_adjustment', 'humidity_control', 'air_quality'],
          controlType: 'adaptive',
          integration: ['hvac', 'lighting', 'sensors']
        },
        tags: ['system', 'environment', 'room', 'control'],
        // Link to zone environment adjustment rule
        pkgRuleId: ruleIds['zone_environment_adjustment'],
      },
      {
        subject: 'system:smart_hvac',
        predicate: 'hasCapabilities',
        object: { 
          capabilities: ['temperature_regulation', 'air_flow_control', 'energy_optimization', 'zone_isolation'],
          controlType: 'intelligent',
          features: ['predictive_adjustment', 'occupancy_based', 'emergency_override']
        },
        tags: ['system', 'hvac', 'smart', 'climate'],
        // Link to smart HVAC zone control rule
        pkgRuleId: ruleIds['smart_hvac_zone_control'],
      },
      {
        subject: 'system:doors_management',
        predicate: 'hasCapabilities',
        object: { 
          capabilities: ['access_control', 'automated_opening', 'security_monitoring', 'zone_gating'],
          controlType: 'automated',
          features: ['biometric_auth', 'scheduled_access', 'emergency_unlock']
        },
        tags: ['system', 'doors', 'access', 'security'],
        // Link to zone access control rule
        pkgRuleId: ruleIds['zone_access_control'],
      },
      {
        subject: 'system:elevators_management',
        predicate: 'hasCapabilities',
        object: { 
          capabilities: ['intelligent_routing', 'load_balancing', 'priority_handling', 'maintenance_scheduling'],
          controlType: 'smart',
          features: ['predictive_dispatch', 'energy_efficiency', 'access_control']
        },
        tags: ['system', 'elevators', 'transport', 'smart'],
        // Link to elevator zone routing rule
        pkgRuleId: ruleIds['elevator_zone_routing'],
      },
      // Optional: Building Map fact for elevator routing
      // This provides floor-level mapping so elevators can route between zones
      {
        subject: 'building:hotel_2030',
        predicate: 'hasFloorMap',
        object: {
          floors: [
            { level: 1, zones: ['JOURNEY'], name: 'Ground Floor - Journey Studio' },
            { level: 2, zones: ['GIFT'], name: 'Second Floor - Gift Forge' },
            { level: 3, zones: ['WEAR'], name: 'Third Floor - Fashion Lab' },
            { level: 4, zones: ['KIDS'], name: 'Fourth Floor - Magic Atelier' },
          ],
          elevatorBanks: ['ELEVATOR_BANK_A'],
          zoneToFloor: {
            'JOURNEY': 1,
            'GIFT': 2,
            'WEAR': 3,
            'KIDS': 4,
          }
        },
        tags: ['building', 'map', 'routing', 'elevator'],
        // Link to elevator zone routing rule (used by the rule for routing decisions)
        pkgRuleId: ruleIds['elevator_zone_routing'],
      },
    ];

    // Helper function to create a governed fact with all required PKG fields
    const createGovernedFact = async (params: {
      subject: string;
      predicate: string;
      object: any;
      tags: string[];
      pkgRuleId: string;
      ruleName: string;
      metaData?: any;
    }): Promise<boolean> => {
      const factText = `${params.subject} ${params.predicate} ${JSON.stringify(params.object)}`;
      const now = new Date().toISOString();
      
      const response = await fetch(`${API_BASE_URL}/api/facts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Required fields
          text: factText,
          namespace: 'hotel',
          
          // Structured triple (all fields provided)
          subject: params.subject,
          predicate: params.predicate,
          object_data: params.object,
          
          // Temporal validity - CRITICAL for governed facts to be active
          valid_from: now, // Active immediately
          valid_to: null,  // Indefinite validity
          
          // Optional metadata
          tags: params.tags || [],
          meta_data: params.metaData || {
            source: 'initialization',
            created_at: now,
          },
          
          // PKG Governance - all required fields for governed facts
          snapshot_id: snapshotId,
          pkg_rule_id: params.pkgRuleId, // MUST be non-null for governed facts
          pkg_provenance: {
            rule: params.ruleName,
            engine: 'wasm',
            source: 'initialization',
            note: 'inserted during system initialization'
          },
          validation_status: 'trusted', // Trust initialization facts
          created_by: 'pkg-engine',
        }),
      });

      if (response.ok) {
        created.facts++;
        return true;
      } else {
        const error = await response.json();
        console.warn(`Failed to create fact for ${params.subject}:`, error.error || response.statusText);
        return false;
      }
    };

    // Create all plugin unit facts (zones, systems, building)
    let governedFactsCount = 0;
    for (const unit of pluginUnits) {
      if (unit.pkgRuleId) {
        const ruleName = Object.keys(ruleIds).find(key => ruleIds[key] === unit.pkgRuleId) || 'unknown';
        const success = await createGovernedFact({
          subject: unit.subject,
          predicate: unit.predicate,
          object: unit.object,
          tags: unit.tags || [],
          pkgRuleId: unit.pkgRuleId,
          ruleName: ruleName,
        });
        if (success) {
          governedFactsCount++;
        }
      }
    }

    // Step 5: Create additional governed facts that rules expect
    // These are critical for rule matching - without them, rules_matched = 0
    
    // 5a) System access facts for zone_access_control rule
    // These represent access grants that the access control rule may check
    const systemAccessFacts = [
      {
        subject: 'system:doors_management',
        predicate: 'accessGrantedTo',
        object: {
          zone: 'JOURNEY',
          persona: 'guest:persona_e41828e2', // Example persona
          granted: true,
          accessLevel: 'full',
          reason: 'initialization_default_access'
        },
        tags: ['pkg', 'access', 'security', 'zone', 'journey'],
        pkgRuleId: ruleIds['zone_access_control'],
        ruleName: 'zone_access_control',
      },
      {
        subject: 'system:doors_management',
        predicate: 'accessGrantedTo',
        object: {
          zone: 'GIFT',
          persona: 'guest:persona_e41828e2',
          granted: true,
          accessLevel: 'full',
          reason: 'initialization_default_access'
        },
        tags: ['pkg', 'access', 'security', 'zone', 'gift'],
        pkgRuleId: ruleIds['zone_access_control'],
        ruleName: 'zone_access_control',
      },
      {
        subject: 'system:doors_management',
        predicate: 'accessGrantedTo',
        object: {
          zone: 'WEAR',
          persona: 'guest:persona_e41828e2',
          granted: true,
          accessLevel: 'full',
          reason: 'initialization_default_access'
        },
        tags: ['pkg', 'access', 'security', 'zone', 'wear'],
        pkgRuleId: ruleIds['zone_access_control'],
        ruleName: 'zone_access_control',
      },
      // KIDS zone access - conditional (age-restricted)
      {
        subject: 'system:doors_management',
        predicate: 'accessGrantedTo',
        object: {
          zone: 'KIDS',
          persona: 'guest:persona_e41828e2',
          granted: true, // Will be evaluated by rule based on age_rating
          accessLevel: 'conditional',
          reason: 'age_restricted_zone',
          requiresAgeCheck: true
        },
        tags: ['pkg', 'access', 'security', 'zone', 'kids'],
        pkgRuleId: ruleIds['zone_access_control'],
        ruleName: 'zone_access_control',
      },
    ];

    for (const fact of systemAccessFacts) {
      const success = await createGovernedFact(fact);
      if (success) {
        governedFactsCount++;
      }
    }

    // 5b) Persona preference facts (for rules that check persona signals)
    // These help rules understand guest preferences
    const personaPreferenceFacts = [
      {
        subject: 'guest:persona_e41828e2',
        predicate: 'hasPreference',
        object: {
          quiet: true,
          temperature: 22, // Celsius
          lighting: 'warm',
          zone_preferences: ['JOURNEY', 'GIFT', 'WEAR']
        },
        tags: ['pkg', 'governed', 'preference', 'persona'],
        pkgRuleId: ruleIds['zone_environment_adjustment'],
        ruleName: 'zone_environment_adjustment',
      },
    ];

    for (const fact of personaPreferenceFacts) {
      const success = await createGovernedFact(fact);
      if (success) {
        governedFactsCount++;
      }
    }

    // 5c) System access facts (for emergency protocol rule)
    // These represent system-level access that emergency rules may need
    const systemAccessFactsForEmergency = [
      {
        subject: 'system:access',
        predicate: 'hasEmergencyOverride',
        object: {
          enabled: true,
          zones: ['JOURNEY', 'GIFT', 'WEAR', 'KIDS'],
          overrideLevel: 'full',
          reason: 'emergency_protocol_initialization'
        },
        tags: ['pkg', 'access', 'emergency', 'zone'],
        pkgRuleId: ruleIds['zone_emergency_protocol'],
        ruleName: 'zone_emergency_protocol',
      },
    ];

    for (const fact of systemAccessFactsForEmergency) {
      const success = await createGovernedFact(fact);
      if (success) {
        governedFactsCount++;
      }
    }

    created.governedFacts = governedFactsCount;

    const envLabel = env === PkgEnv.PROD ? 'production' : 
                    env === PkgEnv.STAGING ? 'staging' : 'development';
    
    return {
      success: true,
      message: `Successfully initialized SeedCore-Native Hotel scenario for ${envLabel} environment`,
      snapshotId,
      created,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Initialization failed: ${error.message}`,
      created,
    };
  }
}

async function createRule(params: {
  snapshotId: number;
  ruleName: string;
  priority: number;
  engine: PkgEngine;
  ruleSource: string;
  conditions: Array<{
    conditionType: PkgConditionType;
    conditionKey: string;
    operator: PkgOperator;
    value?: string;
  }>;
  emissions: Array<{
    subtaskTypeId: string;
    relationshipType: PkgRelation;
  }>;
}): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snapshotId: params.snapshotId,
      ruleName: params.ruleName,
      priority: params.priority,
      engine: params.engine,
      ruleSource: params.ruleSource,
      conditions: params.conditions,
      emissions: params.emissions,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create rule ${params.ruleName}: ${error.error || response.statusText}`);
  }

  const data = await response.json();
  // Return rule ID as string (pkg_rule_id is TEXT in schema)
  return String(data.id || data.ruleId || data.rule_id);
}
