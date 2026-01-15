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
  
  // Generate a valid 64-character hex checksum for native format (placeholder - will be replaced on promotion)
  const timestamp = Date.now();
  const checksumBase = `${proposal.newVersion}-native-${timestamp}`;
  // Convert to hex and pad/truncate to exactly 64 characters
  let nativeChecksum = Array.from(checksumBase)
    .map(c => c.charCodeAt(0).toString(16))
    .join('')
    .padEnd(64, '0')
    .substring(0, 64);
  
  const snapshot: Snapshot = {
    id: newSnapshotId,
    version: proposal.newVersion,
    env: PkgEnv.PROD, // Default env
    stage: 'DRAFT',
    isActive: false,
    checksum: nativeChecksum,
    sizeBytes: 0, // calc later
    createdAt: new Date().toISOString(),
    notes: `AI Evolution: ${proposal.reason}`,
    parentId: proposal.baseSnapshotId,
    artifactFormat: 'native' // New drafts are created in native format
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
// Monotonic canary step progression (strictly increasing, never returns same value)
const CANARY_STEPS = [1, 5, 10, 25, 50, 100];

export const calculateCanaryStep = (currentPercent: number): number => {
  // Find the next step that is strictly greater than current
  const idx = CANARY_STEPS.findIndex(s => s > currentPercent);
  // If no step is greater (current >= 100), return 100
  return idx === -1 ? 100 : CANARY_STEPS[idx];
};

// --- Snapshot Promotion Service ---
import { promoteSnapshot } from './snapshotService';

/**
 * Generate SHA256 hash using Web Crypto API (browser-compatible)
 */
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Promote a native snapshot to WASM format
 * Simulates the compilation process: compression + checksum update
 */
export const promoteToWasm = async (
  snapshot: Snapshot,
  rules: Rule[]
): Promise<Snapshot> => {
  // Simulate WASM compilation: compress rules and generate new checksum
  const rulesJson = JSON.stringify(rules);
  const nativeSize = new Blob([rulesJson]).size; // Browser-compatible size calculation
  
  // Simulate compression (WASM is typically 60-80% of native size)
  const compressionRatio = 0.7; // 30% compression
  const wasmSize = Math.floor(nativeSize * compressionRatio);
  
  // Generate new checksum from compressed content (simulate SHA256)
  const checksumInput = `${snapshot.version}-wasm-${wasmSize}-${Date.now()}`;
  const checksum = await sha256(checksumInput);
  
  // Promote snapshot to WASM via dedicated promotion endpoint (ID-based lookup)
  const updated = await promoteSnapshot(snapshot.id, {
    checksum,
    sizeBytes: wasmSize,
    artifactFormat: 'wasm'
  });
  
  return updated;
};