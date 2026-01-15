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

export type SnapshotStage = 'DRAFT' | 'VALIDATING' | 'VALIDATED' | 'CANARY' | 'PROD' | 'ARCHIVED';

export interface Snapshot {
  id: number;
  version: string;
  env: PkgEnv;
  stage: SnapshotStage;
  isActive: boolean;
  checksum: string;
  sizeBytes: number;
  createdAt: string;
  notes?: string;
  parentId?: number;
  artifactFormat?: 'native' | 'wasm';
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
  ruleSource?: string | null;
  compiledRule?: string | null;
  ruleHash?: string | null;
  metadata?: any | null;
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

export type DeploymentTarget =
  | 'router'
  | 'edge:robot'
  | 'edge:camera'
  | 'edge:door'
  | 'cloud:simulation';

export interface Deployment {
  id: number;
  snapshotId: number;
  target: DeploymentTarget;
  region: string;
  percent: number;
  isActive: boolean;
  activatedAt: string;
  deploymentKey?: string; // For explicit idempotency (default: 'default')
  validationRunId?: number; // Optional reference to validation run
}

export interface ValidationRun {
  id: number;
  snapshotId: number;
  startedAt: string;
  finishedAt?: string;
  success?: boolean;
  report?: {
    type?: 'simulation' | 'validation' | 'canary' | 'regression';
    engine?: 'wasm' | 'native';
    rulesEvaluated?: number;
    rulesTriggered?: number;
    passed?: number;
    failed?: number;
    conflicts?: string[];
    simulationScore?: number;
    timingMs?: {
      total: number;
      hydration?: number;
      execution?: number;
    };
    emissions?: Array<{
      rule: string;
      subtask: string;
      params?: any;
    }>;
    logs?: string[];
  };
}

export interface SimulationResult {
  ruleName: string;
  success: boolean;
  emissions: Emission[];
  logs: string[];
}

// --- Agent & Evolution Types ---

export interface EvolutionProposal {
  id: string;
  baseSnapshotId: number;
  newVersion: string;
  reason: string;
  changes: RuleChange[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED';
  generatedAt: string;
}

export interface RuleChange {
  action: 'CREATE' | 'MODIFY' | 'DELETE';
  ruleData?: Partial<Rule>; // For CREATE/MODIFY
  ruleId?: string; // For MODIFY/DELETE
  rationale: string;
}

export interface AgentLog {
  id: string;
  agent: 'EVOLUTION' | 'VALIDATION' | 'DEPLOYMENT';
  message: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
}