export type RuntimeZoneId =
  | 'INGRESS'
  | 'VAULT'
  | 'TRANSFER'
  | 'QUARANTINE'
  | 'INFRASTRUCTURE'
  | 'MIXED';

export type OperationalZoneId = Exclude<RuntimeZoneId, 'INFRASTRUCTURE' | 'MIXED'>;

export type InfrastructureSystem =
  | 'identity'
  | 'seal_scanner'
  | 'robotic_handler'
  | 'door_controller'
  | 'telemetry'
  | 'audit';

export interface RuntimeZoneDefinition {
  id: OperationalZoneId;
  name: string;
  shortLabel: string;
  mission: string;
  emphasis: string;
  tags: string[];
}

export const RUNTIME_ZONES: RuntimeZoneDefinition[] = [
  {
    id: 'INGRESS',
    name: 'Event Ingress',
    shortLabel: 'Ingress',
    mission: 'Normalize intake events, scans, operator requests, and telemetry before execution.',
    emphasis: 'Multimodal entry and provenance verification',
    tags: ['ingress', 'provenance', 'intake', 'telemetry'],
  },
  {
    id: 'VAULT',
    name: 'Vault Control',
    shortLabel: 'Vault',
    mission: 'Protect sealed inventory, release windows, and high-value custody contracts.',
    emphasis: 'Release authorization and dual approval',
    tags: ['vault', 'release', 'approval', 'custody'],
  },
  {
    id: 'TRANSFER',
    name: 'Transfer Corridor',
    shortLabel: 'Transfer',
    mission: 'Coordinate handoffs among Governed Agents, robotic handlers, and operators.',
    emphasis: 'Actuator routing and handoff evidence',
    tags: ['transfer', 'handoff', 'robotic', 'routing'],
  },
  {
    id: 'QUARANTINE',
    name: 'Quarantine Bay',
    shortLabel: 'Quarantine',
    mission: 'Isolate broken seals, anomalous routes, and out-of-policy requests before release.',
    emphasis: 'Exception recovery and containment',
    tags: ['quarantine', 'exception', 'recovery', 'containment'],
  },
];

export const RUNTIME_ZONE_IDS = RUNTIME_ZONES.map((zone) => zone.id);

export const RUNTIME_ZONE_NAME_MAP = Object.fromEntries(
  RUNTIME_ZONES.map((zone) => [zone.id, zone.name]),
) as Record<OperationalZoneId, string>;

export const RUNTIME_FOUNDATION_FACTS = [
  'Deny-by-default policy is enforced before any actuator release.',
  'Governed Agents hold accountability; AI remains advisory.',
  'Robotic handlers, door controllers, and seal scanners execute through scoped contracts.',
  'Custody state is replayable from ingress through final handoff or quarantine.',
  'Unknown actors, broken seals, and route drift trigger containment first.',
  'Operator approvals and overrides become part of the execution record.',
  'Playback evidence is archived into unified memory after material transitions.',
] as const;

export const RUNTIME_SUBTASK_LIBRARY = [
  'verify_identity_and_provenance',
  'authorize_release_window',
  'lock_zone_access',
  'dispatch_operator_review',
  'route_robotic_handoff',
  'capture_playback_evidence',
  'quarantine_asset_lot',
  'sync_custody_memory',
  'notify_control_plane',
  'stabilize_environmental_controls',
] as const;

export function getRuntimeZoneDefinition(zoneId: string | undefined): RuntimeZoneDefinition | undefined {
  return RUNTIME_ZONES.find((zone) => zone.id === zoneId);
}
