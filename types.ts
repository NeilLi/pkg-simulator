export enum PkgEnv {
  PROD = 'prod',
  STAGING = 'staging',
  DEV = 'dev'
}

export enum PkgEngine {
  WASM = 'wasm',
  NATIVE = 'native'
}

export enum PkgConditionType {
  TAG = 'TAG',
  SIGNAL = 'SIGNAL',
  VALUE = 'VALUE',
  FACT = 'FACT'
}

export enum PkgOperator {
  EQUALS = '=',
  NOT_EQUALS = '!=',
  GTE = '>=',
  LTE = '<=',
  GT = '>',
  LT = '<',
  EXISTS = 'EXISTS',
  IN = 'IN',
  MATCHES = 'MATCHES'
}

export enum PkgRelation {
  EMITS = 'EMITS',
  ORDERS = 'ORDERS',
  GATE = 'GATE'
}

export interface Snapshot {
  id: number;
  version: string;
  env: PkgEnv;
  isActive: boolean;
  checksum: string;
  sizeBytes: number;
  createdAt: string;
  notes?: string;
}

export interface SubtaskType {
  id: string;
  snapshotId: number;
  name: string;
  defaultParams?: any;
}

export interface Rule {
  id: string;
  snapshotId: number;
  ruleName: string;
  priority: number;
  engine: PkgEngine;
  conditions: Condition[];
  emissions: Emission[];
  disabled: boolean;
  // Additional fields from PKG DAO (optional)
  ruleSource?: string;
  compiledRule?: string;
  ruleHash?: string;
  metadata?: any;
}

export interface Condition {
  ruleId: string;
  conditionType: PkgConditionType;
  conditionKey: string;
  operator: PkgOperator;
  value?: string;
}

export interface Emission {
  ruleId: string;
  subtaskTypeId: string; // references SubtaskType
  subtaskName?: string; // Hydrated for UI
  relationshipType: PkgRelation;
  params?: any;
}

export interface Fact {
  id: string;
  snapshotId?: number;
  namespace: string;
  subject: string;
  predicate: string;
  object: any;
  validFrom: string;
  validTo?: string;
  status?: 'active' | 'expired' | 'future';
  createdBy?: string;
}

export type MemoryTier = 'event_working' | 'knowledge_base' | 'world_memory';

export interface UnifiedMemoryItem {
  id: string;
  category: string;
  content: string;
  memoryTier: MemoryTier;
  vectorId?: string;
  metadata: any;
}

export interface Deployment {
  id: number;
  snapshotId: number;
  target: string; // router, edge:door, edge:robot
  region: string;
  percent: number;
  isActive: boolean;
  activatedAt: string;
  activatedBy?: string;
  snapshotVersion?: string; // From JOIN with pkg_snapshots
}

export interface ValidationRun {
  id: number;
  snapshotId: number;
  startedAt: string;
  finishedAt?: string;
  success?: boolean;
  report?: any;
}

export interface SimulationResult {
  ruleName: string;
  success: boolean;
  emissions: Emission[];
  logs: string[];
}