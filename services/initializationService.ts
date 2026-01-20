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

    // Step 2: Create subtask types for hotel operations
    // Each includes executor hints (agent_behavior) for dynamic agent initialization
    const subtaskTypes = [
      { 
        name: 'isolate_room_hvac', 
        defaultParams: { 
          room: null, 
          reason: null,
          agent_behavior: ['background_loop', 'task_filter']
        } 
      },
      { 
        name: 'dispatch_inspection_robot', 
        defaultParams: { 
          room: null, 
          priority: 'high',
          agent_behavior: ['task_filter', 'background_loop']
        } 
      },
      { 
        name: 'notify_human_supervisor', 
        defaultParams: { 
          message: null, 
          urgency: 'high',
          agent_behavior: ['immediate_execution']
        } 
      },
      { 
        name: 'prepare_guest_relocation', 
        defaultParams: { 
          fromRoom: null, 
          toRoom: null,
          agent_behavior: ['task_filter', 'background_loop']
        } 
      },
      { 
        name: 'activate_emergency_protocol', 
        defaultParams: { 
          type: null, 
          location: null,
          agent_behavior: ['immediate_execution', 'priority_override']
        } 
      },
      { 
        name: 'contact_external_service', 
        defaultParams: { 
          service: null, 
          reason: null,
          agent_behavior: ['immediate_execution']
        } 
      },
      { 
        name: 'fabricate_part', 
        defaultParams: { 
          partType: null, 
          material: null,
          agent_behavior: ['background_loop', 'progress_tracking']
        } 
      },
      { 
        name: 'install_part', 
        defaultParams: { 
          partId: null, 
          location: null,
          agent_behavior: ['task_filter', 'background_loop']
        } 
      },
      { 
        name: 'adjust_room_environment', 
        defaultParams: { 
          room: null, 
          temperature: null, 
          lighting: null,
          agent_behavior: ['background_loop', 'continuous_monitoring']
        } 
      },
      { 
        name: 'update_guest_profile', 
        defaultParams: { 
          guestId: null, 
          preferences: {},
          agent_behavior: ['immediate_execution']
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

    // Step 3: Create policy rules for hotel scenarios

    // Rule 1: Emergency Detection (HVAC + Smoke)
    await createRule({
      snapshotId,
      ruleName: 'emergency_hvac_smoke_detection',
      priority: 10, // High priority
      engine: PkgEngine.WASM,
      ruleSource: `# Emergency HVAC and Smoke Detection
# When emergency keywords and HVAC issues are detected, trigger emergency protocol`,
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*emergency.*' },
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*hvac.*' },
        { conditionType: PkgConditionType.SIGNAL, conditionKey: 'x6', operator: PkgOperator.GTE, value: '0.8' },
      ],
      emissions: [
        { subtaskTypeId: subtaskTypeIds['isolate_room_hvac'], relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskTypeIds['dispatch_inspection_robot'], relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskTypeIds['notify_human_supervisor'], relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskTypeIds['prepare_guest_relocation'], relationshipType: PkgRelation.ORDERS },
      ],
    });
    created.rules++;

    // Rule 2: HVAC Temperature Control
    await createRule({
      snapshotId,
      ruleName: 'hvac_temperature_adjustment',
      priority: 50,
      engine: PkgEngine.WASM,
      ruleSource: `# HVAC Temperature Adjustment
# Adjust room temperature based on guest feedback`,
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*hvac.*' },
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*temperature.*' },
      ],
      emissions: [
        { subtaskTypeId: subtaskTypeIds['adjust_room_environment'], relationshipType: PkgRelation.ORDERS },
      ],
    });
    created.rules++;

    // Rule 3: External Service Dispatch (Fire/Police/Medical)
    await createRule({
      snapshotId,
      ruleName: 'external_service_dispatch',
      priority: 5, // Very high priority
      engine: PkgEngine.WASM,
      ruleSource: `# External Service Dispatch
# Dispatch external services for critical emergencies`,
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*emergency.*' },
        { conditionType: PkgConditionType.SIGNAL, conditionKey: 'severity', operator: PkgOperator.GTE, value: '0.9' },
      ],
      emissions: [
        { subtaskTypeId: subtaskTypeIds['activate_emergency_protocol'], relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskTypeIds['contact_external_service'], relationshipType: PkgRelation.ORDERS },
      ],
    });
    created.rules++;

    // Rule 4: Self-Repair Protocol
    await createRule({
      snapshotId,
      ruleName: 'self_repair_protocol',
      priority: 30,
      engine: PkgEngine.WASM,
      ruleSource: `# Self-Repair Protocol
# Enable temporary override for emergency repair, fabricate and install parts`,
      conditions: [
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*repair.*' },
        { conditionType: PkgConditionType.TAG, conditionKey: 'tags', operator: PkgOperator.MATCHES, value: '.*emergency.*' },
      ],
      emissions: [
        { subtaskTypeId: subtaskTypeIds['fabricate_part'], relationshipType: PkgRelation.ORDERS },
        { subtaskTypeId: subtaskTypeIds['install_part'], relationshipType: PkgRelation.ORDERS },
      ],
    });
    created.rules++;

    // Step 4: Create facts for plug-in units (Cognitive USB model)
    const pluginUnits = [
      {
        subject: 'unit:cleaning_robot_01',
        predicate: 'hasCapabilities',
        object: { capabilities: ['deliver', 'scan', 'clean'], constraints: ['floor=1-10', 'hours=08:00-22:00'], skills: ['logistics'], authority: 'execution_only' },
        tags: ['robot', 'cleaning', 'logistics'],
      },
      {
        subject: 'unit:delivery_robot_01',
        predicate: 'hasCapabilities',
        object: { capabilities: ['deliver', 'scan'], constraints: ['floor=1-10', 'hours=08:00-22:00'], skills: ['logistics'], authority: 'execution_only' },
        tags: ['robot', 'delivery', 'logistics'],
      },
      {
        subject: 'unit:inspection_robot_01',
        predicate: 'hasCapabilities',
        object: { capabilities: ['scan', 'inspect'], constraints: ['floor=1-10', 'hours=00:00-23:59'], skills: ['inspection'], authority: 'execution_only' },
        tags: ['robot', 'inspection', 'safety'],
      },
      {
        subject: 'unit:3d_printer_01',
        predicate: 'hasCapabilities',
        object: { capabilities: ['print', 'fabricate'], constraints: ['location=workshop'], skills: ['fabrication'], authority: 'execution_only' },
        tags: ['printer', 'fabrication', 'workshop'],
      },
      {
        subject: 'room:1208',
        predicate: 'hasSystems',
        object: { systems: ['hvac', 'lighting', 'privacy_glass'], floor: 12 },
        tags: ['room', 'systems', 'hvac'],
      },
      {
        subject: 'guest:wearable_device',
        predicate: 'hasType',
        object: { type: 'wearable', capabilities: ['location', 'health', 'preferences'] },
        tags: ['wearable', 'device', 'guest'],
      },
      {
        subject: 'service:digital_concierge',
        predicate: 'hasType',
        object: { type: 'ai_assistant', capabilities: ['booking', 'recommendations', 'emergency'] },
        tags: ['service', 'ai', 'concierge'],
      },
      {
        subject: 'service:external_police',
        predicate: 'hasType',
        object: { type: 'external', capabilities: ['emergency_response'], contact: '911' },
        tags: ['service', 'external', 'emergency', 'police'],
      },
      {
        subject: 'service:external_fire',
        predicate: 'hasType',
        object: { type: 'external', capabilities: ['fire_response'], contact: '911' },
        tags: ['service', 'external', 'emergency', 'fire'],
      },
      {
        subject: 'service:external_hospital',
        predicate: 'hasType',
        object: { type: 'external', capabilities: ['medical_response'], contact: '911' },
        tags: ['service', 'external', 'emergency', 'medical'],
      },
    ];

    for (const unit of pluginUnits) {
      // Generate text representation from structured triple (required in new schema)
      const factText = `${unit.subject} ${unit.predicate} ${JSON.stringify(unit.object)}`;
      
      const response = await fetch(`${API_BASE_URL}/api/facts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Required fields
          text: factText,
          namespace: 'hotel',
          
          // Structured triple (all fields provided)
          subject: unit.subject,
          predicate: unit.predicate,
          object_data: unit.object,
          
          // Optional metadata
          tags: unit.tags || [],
          meta_data: {
            source: 'initialization',
            created_at: new Date().toISOString(),
          },
          
          // Governance
          snapshot_id: snapshotId,
          created_by: 'initialization',
        }),
      });

      if (response.ok) {
        created.facts++;
      } else {
        const error = await response.json();
        console.warn(`Failed to create fact for ${unit.subject}:`, error.error || response.statusText);
      }
    }

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
    value: string;
  }>;
  emissions: Array<{
    subtaskTypeId: string;
    relationshipType: PkgRelation;
  }>;
}): Promise<void> {
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
}
