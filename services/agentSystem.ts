import { EvolutionProposal, Rule, Snapshot, ValidationRun, Deployment, PkgEnv } from '../types';
import { generateEvolutionPlan } from './geminiService';

// --- Evolution Agent ---
export const proposeEvolution = async (
  intent: string,
  baseSnapshot: Snapshot
): Promise<EvolutionProposal | null> => {
  // Simulate fetching context from vector DB
  const context = [
    { subject: 'system:seedcore', predicate: 'last_failure', object: 'none' }
  ];

  const proposal = await generateEvolutionPlan(intent, baseSnapshot.version, context);
  
  if (proposal) {
    proposal.baseSnapshotId = baseSnapshot.id;
    // Auto-fix version if AI didn't
    if (proposal.newVersion === baseSnapshot.version) {
      proposal.newVersion = `${baseSnapshot.version}-evolved`;
    }
  }
  return proposal;
};

// --- Snapshot Builder Agent ---
export const buildSnapshotFromProposal = (
  proposal: EvolutionProposal,
  baseRules: Rule[]
): { snapshot: Snapshot; newRules: Rule[] } => {
  const newSnapshotId = Math.floor(Math.random() * 10000) + 100;
  
  const snapshot: Snapshot = {
    id: newSnapshotId,
    version: proposal.newVersion,
    env: PkgEnv.PROD, // Default env
    stage: 'DRAFT',
    isActive: false,
    checksum: `sha-${Date.now()}`,
    sizeBytes: 0, // calc later
    createdAt: new Date().toISOString(),
    notes: `AI Evolution: ${proposal.reason}`,
    parentId: proposal.baseSnapshotId
  };

  let newRules = baseRules.filter(r => r.snapshotId === proposal.baseSnapshotId).map(r => ({...r, snapshotId: newSnapshotId}));

  proposal.changes.forEach(change => {
    if (change.action === 'CREATE' && change.ruleData) {
      newRules.push({
        ...change.ruleData,
        id: `rule-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        snapshotId: newSnapshotId,
        disabled: false,
        engine: 'wasm'
      } as Rule);
    } else if (change.action === 'DELETE' && change.ruleId) {
      newRules = newRules.filter(r => r.id !== change.ruleId);
    } else if (change.action === 'MODIFY' && change.ruleId && change.ruleData) {
      newRules = newRules.map(r => r.id === change.ruleId ? { ...r, ...change.ruleData, snapshotId: newSnapshotId } as Rule : r);
    }
  });

  snapshot.sizeBytes = JSON.stringify(newRules).length;

  return { snapshot, newRules };
};

// --- Validation Agent ---
export const runValidationAgent = async (snapshotId: number, rules: Rule[]): Promise<ValidationRun> => {
  // Simulate complex validation logic (Consistency check, Loop detection, etc.)
  await new Promise(resolve => setTimeout(resolve, 2000)); // Sim delay

  const snapshotRules = rules.filter(r => r.snapshotId === snapshotId);
  const conflict = snapshotRules.find(r => r.priority < 0); // Mock check
  
  const passed = snapshotRules.length;
  const failed = conflict ? 1 : 0;
  const success = failed === 0;

  return {
    id: Date.now(),
    snapshotId,
    startedAt: new Date(Date.now() - 2000).toISOString(),
    finishedAt: new Date().toISOString(),
    success,
    report: {
      passed,
      failed,
      conflicts: conflict ? [`Rule ${conflict.ruleName} has invalid priority`] : [],
      simulationScore: success ? 0.99 : 0.45
    }
  };
};

// --- Deployment Agent ---
export const calculateCanaryStep = (currentPercent: number): number => {
  if (currentPercent === 0) return 5;
  if (currentPercent === 5) return 25;
  if (currentPercent === 25) return 50;
  if (currentPercent === 50) return 100;
  return 100;
};