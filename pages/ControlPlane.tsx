import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, GitMerge, ShieldAlert, Terminal,
  ArrowRight, CheckCircle, XCircle, Loader2, Play, RotateCcw,
  Server, Radio, Edit, Pause, Clock
} from 'lucide-react';

import { getSnapshots, getRules, getSubtaskTypes, getDeployments } from '../mockData';
import { EvolutionProposal, AgentLog, Snapshot, ValidationRun, Rule, PkgEnv, SubtaskType, Deployment, DeploymentTarget } from '../types';

import {
  proposeEvolution,
  buildSnapshotFromProposal,
  runValidationAgent,
  calculateCanaryStep,
  promoteToWasm,
} from '../services/agentSystem';
import { generateEvolutionPlan } from '../services/geminiService';

import { createSnapshot } from '../services/snapshotService';
import { createRule } from '../services/ruleService';
import { createOrUpdateDeployment, rollbackDeploymentLane, getRolloutEvents } from '../services/deploymentService';

// ---------- helpers ----------
const mkId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function safeQuote(s: string, max = 240) {
  const t = (s || '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function ruleSourceFromIntentOrStructure(intent?: string, rule?: Partial<Rule>) {
  const i = safeQuote(intent || '');
  if (i) return `Generated from: "${i}"`;

  // fallback: structure-based (best-effort)
  const conds = (rule?.conditions || [])
    .map(c => `${c.conditionKey} ${c.operator} ${c.value ?? 'EXISTS'}`)
    .join(' AND ');
  const ems = (rule?.emissions || [])
    .map(e => `${e.relationshipType} -> ${e.subtaskName || e.subtaskTypeId}`)
    .join(', ');
  if (conds || ems) return `Rule: When ${conds || '(conditions)'}, then ${ems || '(emissions)'}`;
  return 'Generated rule';
}

function pickBaseSnapshot(snaps: Snapshot[], baseId?: number | null) {
  if (baseId) {
    const found = snaps.find(s => s.id === baseId);
    if (found) return found;
  }
  // Prefer active PROD
  return snaps.find(s => s.env === PkgEnv.PROD && s.isActive) || snaps[0] || null;
}

export const ControlPlane: React.FC = () => {
  // Pipeline identity: prevents stale async steps from writing into a new run
  const [pipelineId, setPipelineId] = useState<string>(mkId());
  const pipelineIdRef = useRef(pipelineId);
  useEffect(() => { pipelineIdRef.current = pipelineId; }, [pipelineId]);

  // State for the pipeline
  const [intent, setIntent] = useState(
    'We are seeing too many false positive fire alarms from toaster ovens in standard rooms. Adjust threshold.'
  );

  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [proposal, setProposal] = useState<EvolutionProposal | null>(null);

  const [draftSnapshot, setDraftSnapshot] = useState<Snapshot | null>(null);
  const [draftRules, setDraftRules] = useState<Rule[]>([]);
  const [validationResult, setValidationResult] = useState<ValidationRun | null>(null);
  const [deploymentPercent, setDeploymentPercent] = useState<number>(0);

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [subtaskTypes, setSubtaskTypes] = useState<SubtaskType[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [rolloutEvents, setRolloutEvents] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Deployment management state
  const [editingDeployment, setEditingDeployment] = useState<Deployment | null>(null);
  const [editDeploymentPercent, setEditDeploymentPercent] = useState<number>(0);
  const [updatingDeployment, setUpdatingDeployment] = useState(false);
  const [deploymentMessage, setDeploymentMessage] = useState<string | null>(null);

  // Select base snapshot explicitly (prevents "wrong base" surprises)
  const [baseSnapshotId, setBaseSnapshotId] = useState<number | null>(null);

  // Keep the "run intent" stable for the whole run (avoids head-of-prompt mismatch)
  const [runIntent, setRunIntent] = useState<string>('');

  // Loaders
  const [isEvolving, setIsEvolving] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  // Optional: whether to persist rules into DB immediately on build
  const [persistRulesOnBuild, setPersistRulesOnBuild] = useState<boolean>(true);

  const baseSnapshot = useMemo(() => pickBaseSnapshot(snapshots, baseSnapshotId), [snapshots, baseSnapshotId]);
  const prodSnapshots = useMemo(() => snapshots.filter(s => s.env === PkgEnv.PROD), [snapshots]);
  
  // Option to deploy an existing snapshot directly (for first-time initialization)
  const [selectedSnapshotForDeployment, setSelectedSnapshotForDeployment] = useState<number | null>(null);

  const addLog = (agent: AgentLog['agent'], message: string, level: AgentLog['level'] = 'INFO', pid?: string) => {
    const effectivePid = pid || pipelineIdRef.current;

    setAgentLogs(prev => [{
      id: mkId(),
      agent,
      message,
      timestamp: new Date().toLocaleTimeString(),
      level,
      // keep compat: AgentLog type doesn't have pipelineId, so we encode it in message or ignore
    }, ...prev.filter(x => x.id)]); // shallow stability
  };

  const resetPipeline = () => {
    setProposal(null);
    setDraftSnapshot(null);
    setDraftRules([]);
    setValidationResult(null);
    setDeploymentPercent(0);
    setAgentLogs([]);
    setRunIntent('');
    const next = mkId();
    setPipelineId(next);
    addLog('EVOLUTION', `Pipeline reset (run=${next})`, 'INFO', next);
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        const [snaps, ruls, sts, deps, events] = await Promise.all([
          getSnapshots(), 
          getRules(), 
          getSubtaskTypes(),
          getDeployments(false), // Get all deployments, not just active
          getRolloutEvents({ limit: 10 }).catch(() => []), // Optional: rollout events
        ]);
        setSnapshots(snaps);
        setRules(ruls);
        setSubtaskTypes(sts || []);
        setDeployments(deps || []);
        setRolloutEvents(events || []);

        // pick default base snapshot id (active prod preferred)
        const base = pickBaseSnapshot(snaps, null);
        setBaseSnapshotId(base?.id ?? null);

        // FIRST-TIME DETECTION: If no deployments exist, automatically select the first snapshot for deployment
        // This prevents creating a new snapshot when we should deploy the initialized one
        if ((deps || []).length === 0 && snaps.length > 0) {
          // Find the first snapshot (usually snapshot_id=1 from initialization)
          const firstSnapshot = snaps
            .filter(s => s.env === PkgEnv.PROD)
            .sort((a, b) => (a.id || 0) - (b.id || 0))[0]; // Sort by id, get first
          
          if (firstSnapshot) {
            setSelectedSnapshotForDeployment(firstSnapshot.id || null);
            // Set as draftSnapshot so it can be deployed
            // If snapshot is not WASM, treat it as 'native' so promotion button shows
            setDraftSnapshot({
              ...firstSnapshot,
              artifactFormat: firstSnapshot.artifactFormat === 'wasm' ? 'wasm' : 'native', // Treat undefined/null as 'native' for promotion
            });
            setDeploymentPercent(0);
            // Log first-time detection (addLog will be called after component mounts)
            setTimeout(() => {
              const runId = pipelineIdRef.current;
              const formatStatus = firstSnapshot.artifactFormat === 'wasm' 
                ? 'WASM format' 
                : firstSnapshot.artifactFormat === 'native'
                ? 'Native format (needs promotion)'
                : 'Unknown format (may need promotion)';
              addLog('DEPLOYMENT', `First-time detected: No deployments found. Selected snapshot ${firstSnapshot.version} (id=${firstSnapshot.id}, ${formatStatus})`, 'INFO', runId);
            }, 100);
          }
        }
      } catch (error) {
        console.error('Error loading control plane data:', error);
      } finally {
        setLoadingData(false);
      }
    };
    loadData();
  }, []);

  // Get active snapshot for deployment filtering
  // Priority: 1) Active PROD snapshot from DB, 2) Selected snapshot for deployment, 3) Draft snapshot
  const activeSnapshot = useMemo(() => {
    const activeFromDb = snapshots.find(s => s.isActive && s.env === PkgEnv.PROD);
    if (activeFromDb) return activeFromDb;
    
    if (selectedSnapshotForDeployment) {
      const selected = snapshots.find(s => s.id === selectedSnapshotForDeployment);
      if (selected) return selected;
    }
    
    return draftSnapshot;
  }, [snapshots, draftSnapshot, selectedSnapshotForDeployment]);

  const activeSnapshotId = activeSnapshot?.id;

  // Filter deployments by active snapshot
  const snapshotDeployments = useMemo(() => {
    if (!activeSnapshotId) return [];
    return deployments.filter(d => d.snapshotId === activeSnapshotId);
  }, [deployments, activeSnapshotId]);

  // Deployment management functions
  const handleEditDeployment = (deployment: Deployment) => {
    setEditingDeployment(deployment);
    setEditDeploymentPercent(deployment.percent);
    setDeploymentMessage(null);
  };

  const handleCancelEdit = () => {
    setEditingDeployment(null);
    setEditDeploymentPercent(0);
    setDeploymentMessage(null);
  };

  const handleUpdateDeployment = async () => {
    if (!editingDeployment || !activeSnapshotId) return;

    setUpdatingDeployment(true);
    setDeploymentMessage(null);
    const runId = pipelineIdRef.current;

    try {
      const result = await createOrUpdateDeployment({
        snapshotId: activeSnapshotId,
        target: editingDeployment.target,
        region: editingDeployment.region,
        percent: editDeploymentPercent,
        isActive: editDeploymentPercent > 0,
        activatedBy: 'control-plane',
        deploymentKey: `control-plane-edit-${Date.now()}`,
        isRollback: editDeploymentPercent < editingDeployment.percent,
      });

      setDeploymentMessage(
        `✅ Deployment updated: ${editingDeployment.target} (${editingDeployment.region}) → ${editDeploymentPercent}%`
      );
      addLog('DEPLOYMENT', `Run ${runId}: Updated deployment ${editingDeployment.target} to ${editDeploymentPercent}%`, 'SUCCESS', runId);
      
      // Reload deployments
      const [deps, events] = await Promise.all([
        getDeployments(false),
        getRolloutEvents({ limit: 10 }).catch(() => []),
      ]);
      setDeployments(deps || []);
      setRolloutEvents(events || []);

      setTimeout(() => {
        handleCancelEdit();
        setDeploymentMessage(null);
      }, 2000);
    } catch (error: any) {
      setDeploymentMessage(`❌ Error: ${error.message || String(error)}`);
      addLog('DEPLOYMENT', `Run ${runId}: Failed to update deployment: ${error.message}`, 'ERROR', runId);
    } finally {
      setUpdatingDeployment(false);
    }
  };

  const handleRollbackDeployment = async (deployment: Deployment) => {
    if (!activeSnapshotId) return;

    setUpdatingDeployment(true);
    setDeploymentMessage(null);
    const runId = pipelineIdRef.current;

    try {
      await rollbackDeploymentLane({
        snapshotId: activeSnapshotId,
        target: deployment.target,
        region: deployment.region,
        activatedBy: 'control-plane',
        deploymentKey: `control-plane-rollback-${Date.now()}`,
      });

      setDeploymentMessage(
        `✅ Deployment rolled back: ${deployment.target} (${deployment.region})`
      );
      addLog('DEPLOYMENT', `Run ${runId}: Rolled back deployment ${deployment.target}`, 'WARN', runId);
      
      // Reload deployments
      const [deps, events] = await Promise.all([
        getDeployments(false),
        getRolloutEvents({ limit: 10 }).catch(() => []),
      ]);
      setDeployments(deps || []);
      setRolloutEvents(events || []);

      setTimeout(() => setDeploymentMessage(null), 3000);
    } catch (error: any) {
      setDeploymentMessage(`❌ Rollback failed: ${error.message || String(error)}`);
      addLog('DEPLOYMENT', `Run ${runId}: Failed to rollback deployment: ${error.message}`, 'ERROR', runId);
    } finally {
      setUpdatingDeployment(false);
    }
  };

  const handleDeactivateDeployment = async (deployment: Deployment) => {
    if (!activeSnapshotId) return;

    setUpdatingDeployment(true);
    setDeploymentMessage(null);
    const runId = pipelineIdRef.current;

    try {
      await createOrUpdateDeployment({
        snapshotId: activeSnapshotId,
        target: deployment.target,
        region: deployment.region,
        percent: 0,
        isActive: false,
        activatedBy: 'control-plane',
        deploymentKey: `control-plane-deactivate-${Date.now()}`,
        isRollback: true,
      });

      setDeploymentMessage(
        `✅ Deployment deactivated: ${deployment.target} (${deployment.region})`
      );
      addLog('DEPLOYMENT', `Run ${runId}: Deactivated deployment ${deployment.target}`, 'WARN', runId);
      
      // Reload deployments
      const [deps, events] = await Promise.all([
        getDeployments(false),
        getRolloutEvents({ limit: 10 }).catch(() => []),
      ]);
      setDeployments(deps || []);
      setRolloutEvents(events || []);

      setTimeout(() => setDeploymentMessage(null), 3000);
    } catch (error: any) {
      setDeploymentMessage(`❌ Deactivation failed: ${error.message || String(error)}`);
      addLog('DEPLOYMENT', `Run ${runId}: Failed to deactivate deployment: ${error.message}`, 'ERROR', runId);
    } finally {
      setUpdatingDeployment(false);
    }
  };

  // -------- Step 0: Initialize First Snapshot (when no snapshots exist) --------
  // NOTE: This should only be used when NO snapshots exist at all
  // If snapshots exist but no deployments, use the existing snapshot instead
  const handleInitializeFirstSnapshot = async () => {
    if (loadingData) return;

    const newRunId = mkId();
    setPipelineId(newRunId);
    pipelineIdRef.current = newRunId;

    setProposal(null);
    setDraftSnapshot(null);
    setDraftRules([]);
    setValidationResult(null);
    setDeploymentPercent(0);

    const intentForRun = intent.trim() || 'Initialize baseline policy snapshot for hotel operations';
    setRunIntent(intentForRun);

    setIsEvolving(true);
    addLog('EVOLUTION', `Run ${newRunId}: Initializing first snapshot from scratch...`, 'INFO', newRunId);

    try {
      // Create a minimal base snapshot for initialization
      const initialVersion = `v1.0.0-${Date.now()}`;
      const initialSnapshot: Snapshot = {
        id: 0, // Temporary, will be replaced when saved to DB
        version: initialVersion,
        env: PkgEnv.PROD,
        stage: 'DRAFT',
        isActive: false,
        checksum: '0'.repeat(64),
        sizeBytes: 0,
        createdAt: new Date().toISOString(),
        notes: `Initial snapshot: ${intentForRun}`,
        artifactFormat: 'native'
      };

      // Generate evolution plan without a base (use empty version)
      const prop = await generateEvolutionPlan(intentForRun, 'v0.0.0-initial', []);
      
      if (!prop) {
        addLog('EVOLUTION', 'Failed to generate initial proposal. Check API Key.', 'ERROR', newRunId);
        setIsEvolving(false);
        return;
      }

      // Create proposal with initial snapshot as base
      const proposal: EvolutionProposal = {
        ...prop,
        id: `prop-${Date.now()}`,
        baseSnapshotId: 0, // No base snapshot for initialization
        status: 'PENDING',
        generatedAt: new Date().toISOString(),
        newVersion: prop.newVersion || initialVersion
      };

      // Build snapshot from proposal with empty base rules (no existing rules to copy)
      const { snapshot, newRules } = buildSnapshotFromProposal(proposal, []);

      // Save snapshot to database
      addLog('EVOLUTION', 'Saving initial snapshot to database...', 'INFO', newRunId);
      const savedSnapshot = await createSnapshot({
        version: snapshot.version,
        env: snapshot.env,
        checksum: snapshot.checksum,
        sizeBytes: snapshot.sizeBytes,
        notes: snapshot.notes,
        isActive: false,
      });

      if (!savedSnapshot.id || savedSnapshot.id < 1) {
        throw new Error('Initial snapshot created but did not receive a valid database ID');
      }

      addLog('EVOLUTION', `Initial snapshot saved (id=${savedSnapshot.id}).`, 'SUCCESS', newRunId);

      const snapshotWithDbId: Snapshot = {
        ...snapshot,
        id: savedSnapshot.id,
        checksum: savedSnapshot.checksum,
        sizeBytes: savedSnapshot.sizeBytes,
        createdAt: savedSnapshot.createdAt,
      };

      // Attach saved snapshot id to all rules
      const rulesForDb = newRules.map(r => ({
        ...r,
        snapshotId: savedSnapshot.id,
      }));

      // Persist rules to database
      if (persistRulesOnBuild && rulesForDb.length > 0) {
        addLog('EVOLUTION', `Persisting ${rulesForDb.length} initial rule(s) into DB...`, 'INFO', newRunId);
        
        for (const r of rulesForDb) {
          const ruleSource = ruleSourceFromIntentOrStructure(intentForRun, r);
          await createRule({
            snapshotId: savedSnapshot.id,
            ruleName: r.ruleName,
            priority: r.priority,
            engine: r.engine,
            ruleSource,
            conditions: r.conditions || [],
            emissions: (r.emissions || []).map(e => ({
              subtaskTypeId: e.subtaskTypeId || '',
              relationshipType: e.relationshipType,
              params: e.params || {}
            }))
          });
        }
        addLog('EVOLUTION', `Persisted ${rulesForDb.length} rule(s).`, 'SUCCESS', newRunId);
      }

      setDraftSnapshot(snapshotWithDbId);
      setDraftRules(rulesForDb);
      setProposal(proposal);
      
      // Reload snapshots to include the new one
      const updatedSnaps = await getSnapshots();
      setSnapshots(updatedSnaps);
      setBaseSnapshotId(savedSnapshot.id);

      addLog('EVOLUTION', `Initial snapshot created: ${snapshot.version}`, 'SUCCESS', newRunId);
    } catch (e: any) {
      addLog('EVOLUTION', `Initialization error: ${e?.message || String(e)}`, 'ERROR', newRunId);
      console.error('Initialization error:', e);
    } finally {
      if (pipelineIdRef.current === newRunId) setIsEvolving(false);
    }
  };

  // -------- Step 1: Evolution --------
  const handleEvolution = async () => {
    if (loadingData) return;

    // new run starts here
    const newRunId = mkId();
    setPipelineId(newRunId);
    pipelineIdRef.current = newRunId;

    setProposal(null);
    setDraftSnapshot(null);
    setDraftRules([]);
    setValidationResult(null);
    setDeploymentPercent(0);

    const intentForRun = intent.trim();
    setRunIntent(intentForRun);

    setIsEvolving(true);
    addLog('EVOLUTION', `Run ${newRunId}: analyzing intent + historical failures...`, 'INFO', newRunId);

    const base = pickBaseSnapshot(snapshots, baseSnapshotId);
    if (!base) {
      addLog('EVOLUTION', 'No snapshots available. Use "Initialize First Snapshot" to create one.', 'ERROR', newRunId);
      setIsEvolving(false);
      return;
    }

    addLog('EVOLUTION', `Base snapshot: ${base.version} (id=${base.id}, env=${base.env}, active=${base.isActive})`, 'INFO', newRunId);

    try {
      const prop = await proposeEvolution(intentForRun, base);

      // ignore stale results
      if (pipelineIdRef.current !== newRunId) return;

      if (prop) {
        setProposal(prop);
        addLog('EVOLUTION', `Generated proposal: ${prop.newVersion}`, 'SUCCESS', newRunId);
      } else {
        addLog('EVOLUTION', 'Failed to generate proposal. Check API Key.', 'ERROR', newRunId);
      }
    } catch (e: any) {
      addLog('EVOLUTION', `Evolution error: ${e?.message || String(e)}`, 'ERROR', newRunId);
    } finally {
      if (pipelineIdRef.current === newRunId) setIsEvolving(false);
    }
  };

  // -------- Step 2: Build (create snapshot + optionally persist rules) --------
  const handleBuild = async () => {
    if (!proposal) return;

    const runId = pipelineIdRef.current;
    setIsBuilding(true);
    addLog('EVOLUTION', `Run ${runId}: building draft snapshot (Native)...`, 'INFO', runId);

    try {
      const { snapshot, newRules } = buildSnapshotFromProposal(proposal, rules);

      // Save snapshot to database
      addLog('EVOLUTION', 'Saving snapshot to database...', 'INFO', runId);
      const savedSnapshot = await createSnapshot({
        version: snapshot.version,
        env: snapshot.env,
        checksum: snapshot.checksum,
        sizeBytes: snapshot.sizeBytes,
        notes: snapshot.notes,
        isActive: false,
      });

      if (!savedSnapshot.id || savedSnapshot.id < 1) {
        throw new Error('Snapshot created but did not receive a valid database ID');
      }

      addLog('EVOLUTION', `Snapshot saved (id=${savedSnapshot.id}).`, 'SUCCESS', runId);

      const snapshotWithDbId: Snapshot = {
        ...snapshot,
        id: savedSnapshot.id,
        checksum: savedSnapshot.checksum,
        sizeBytes: savedSnapshot.sizeBytes,
        createdAt: savedSnapshot.createdAt,
        // keep artifactFormat if buildSnapshotFromProposal sets it
      };

      // attach saved snapshot id to all rules
      const rulesForDb = newRules.map(r => ({
        ...r,
        snapshotId: savedSnapshot.id,
      }));

      setDraftSnapshot(snapshotWithDbId);
      setDraftRules(rulesForDb);
      setValidationResult(null);

      // OPTIONAL but recommended: persist rules now, with stable ruleSource derived from runIntent
      if (persistRulesOnBuild) {
        addLog('EVOLUTION', `Persisting ${rulesForDb.length} rule(s) into DB...`, 'INFO', runId);

        // Get subtask types for the new snapshot (from base snapshot)
        const baseSnapshotSubtaskTypes = subtaskTypes.filter(st => st.snapshotId === proposal.baseSnapshotId);

        for (const r of rulesForDb) {
          const ruleSource = ruleSourceFromIntentOrStructure(runIntent, r);

          // Map emissions: convert subtaskName to subtaskTypeId if needed
          const mappedEmissions = r.emissions.map((e, idx) => {
            let subtaskTypeId = e.subtaskTypeId;

            // If subtaskTypeId is missing but subtaskName exists, look it up
            if (!subtaskTypeId && e.subtaskName) {
              const found = baseSnapshotSubtaskTypes.find(st => st.name === e.subtaskName);
              if (found) {
                subtaskTypeId = found.id;
              } else {
                throw new Error(
                  `Rule "${r.ruleName}", emission ${idx + 1}: Could not find subtask type "${e.subtaskName}" for snapshot ${savedSnapshot.id}.`
                );
              }
            }

            if (!subtaskTypeId) {
              throw new Error(`Rule "${r.ruleName}", emission ${idx + 1}: subtaskTypeId is required.`);
            }

            return {
              subtaskTypeId,
              relationshipType: e.relationshipType,
              params: e.params,
            };
          });

          await createRule({
            snapshotId: savedSnapshot.id,
            ruleName: r.ruleName,
            priority: r.priority,
            engine: r.engine,
            ruleSource, // ✅ prevents prompt mismatch / empty source
            conditions: r.conditions.map(c => ({
              conditionType: c.conditionType,
              conditionKey: c.conditionKey,
              operator: c.operator,
              value: c.value,
            })),
            emissions: mappedEmissions,
          });
        }

        addLog('EVOLUTION', `Rules persisted successfully (snapshotId=${savedSnapshot.id}).`, 'SUCCESS', runId);
      } else {
        addLog('EVOLUTION', 'Rules kept in-memory (persistRulesOnBuild=false).', 'WARN', runId);
      }

      addLog(
        'EVOLUTION',
        `Snapshot ${savedSnapshot.version} built in NATIVE format. Size: ${savedSnapshot.sizeBytes} bytes.`,
        'SUCCESS',
        runId
      );
    } catch (error: any) {
      addLog('EVOLUTION', `Build failed: ${error?.message || String(error)}`, 'ERROR', runId);
    } finally {
      setIsBuilding(false);
    }
  };

  // -------- Step 3: Promote --------
  const handlePromoteToWasm = async () => {
    if (!draftSnapshot) return;
    const runId = pipelineIdRef.current;

    if (!draftSnapshot.id || draftSnapshot.id < 1) {
      addLog('EVOLUTION', 'Cannot promote: Snapshot must be saved to DB first.', 'ERROR', runId);
      return;
    }

    setIsPromoting(true);
    const nativeSize = draftSnapshot.sizeBytes;
    addLog('EVOLUTION', `Run ${runId}: promoting snapshot id=${draftSnapshot.id} to WASM...`, 'INFO', runId);

    try {
      const snapshotRules = draftRules.length > 0 ? draftRules : rules.filter(r => r.snapshotId === draftSnapshot.id);
      const promoted = await promoteToWasm(draftSnapshot, snapshotRules);

      setDraftSnapshot(promoted);
      addLog(
        'EVOLUTION',
        `Promoted to WASM. ${nativeSize.toLocaleString()} → ${promoted.sizeBytes.toLocaleString()} bytes.`,
        'SUCCESS',
        runId
      );
    } catch (error: any) {
      addLog('EVOLUTION', `Promote failed: ${error?.message || String(error)}`, 'ERROR', runId);
      console.error('Promote error details:', { snapshotId: draftSnapshot.id, error });
    } finally {
      setIsPromoting(false);
    }
  };

  // -------- Step 4: Validate --------
  const handleValidate = async () => {
    const runId = pipelineIdRef.current;

    if (!draftSnapshot || draftSnapshot.artifactFormat !== 'wasm') {
      addLog('VALIDATION', 'Cannot validate: snapshot must be WASM first.', 'ERROR', runId);
      return;
    }

    setIsValidating(true);
    addLog('VALIDATION', `Run ${runId}: initializing simulation suite...`, 'INFO', runId);

    try {
      const snapshotRules = draftRules.length > 0 ? draftRules : rules.filter(r => r.snapshotId === draftSnapshot.id);
      const result = await runValidationAgent(draftSnapshot.id, snapshotRules);

      setValidationResult(result);

      if (result.success) {
        addLog('VALIDATION', `Validation PASSED. Score: ${result.report?.simulationScore}`, 'SUCCESS', runId);
      } else {
        addLog('VALIDATION', `Validation FAILED. Conflicts: ${result.report?.conflicts?.length ?? 0}`, 'ERROR', runId);
      }
    } catch (e: any) {
      addLog('VALIDATION', `Validation error: ${e?.message || String(e)}`, 'ERROR', runId);
    } finally {
      setIsValidating(false);
    }
  };

  // -------- Step 5: Deploy --------
  const handleDeployStep = async () => {
    const runId = pipelineIdRef.current;
    
    // Determine which snapshot to deploy: selected existing snapshot OR draft snapshot
    const snapshotToDeploy = selectedSnapshotForDeployment 
      ? snapshots.find(s => s.id === selectedSnapshotForDeployment)
      : draftSnapshot;
    
    if (!snapshotToDeploy || !snapshotToDeploy.id) {
      addLog('DEPLOYMENT', 'Cannot deploy: No snapshot available. Select an existing snapshot or complete Evolution → Build.', 'ERROR', runId);
      return;
    }
    
    // For existing snapshots, check if they're WASM format (required for deployment)
    // If not WASM, automatically promote it first (for first-time deployment convenience)
    let finalSnapshotToDeploy = snapshotToDeploy;
    
    if (selectedSnapshotForDeployment && snapshotToDeploy.artifactFormat !== 'wasm') {
      // Check if this is a first-time deployment scenario (no deployments exist)
      const isFirstTimeDeployment = deployments.length === 0;
      
      if (isFirstTimeDeployment && (snapshotToDeploy.artifactFormat === 'native' || !snapshotToDeploy.artifactFormat)) {
        // Automatically promote to WASM for first-time deployment
        addLog('DEPLOYMENT', `Promoting snapshot ${snapshotToDeploy.version} to WASM format before deployment...`, 'INFO', runId);
        
        try {
          // Load rules for this snapshot
          const snapshotRules = rules.filter(r => r.snapshotId === snapshotToDeploy.id);
          
          // Promote to WASM
          const promoted = await promoteToWasm(snapshotToDeploy, snapshotRules);
          
          // Update the snapshot in our state
          setSnapshots(prev => prev.map(s => s.id === snapshotToDeploy.id ? promoted : s));
          setDraftSnapshot(promoted);
          setSelectedSnapshotForDeployment(promoted.id);
          
          // Use the promoted snapshot for deployment
          finalSnapshotToDeploy = promoted;
          
          addLog('DEPLOYMENT', `Successfully promoted to WASM. Proceeding with deployment...`, 'SUCCESS', runId);
        } catch (error: any) {
          addLog('DEPLOYMENT', `Failed to promote snapshot: ${error?.message || String(error)}. Please promote manually.`, 'ERROR', runId);
          return;
        }
      } else {
        // Not first-time or not native format - require manual promotion
        addLog('DEPLOYMENT', `Cannot deploy: Snapshot ${snapshotToDeploy.version} must be promoted to WASM format first. Use the "Promote to WASM" button.`, 'ERROR', runId);
        return;
      }
    }
    
    // Final check: ensure snapshot is WASM format
    if (!finalSnapshotToDeploy || finalSnapshotToDeploy.artifactFormat !== 'wasm') {
      addLog('DEPLOYMENT', `Cannot deploy: Snapshot must be in WASM format.`, 'ERROR', runId);
      return;
    }
    
    const nextStep = calculateCanaryStep(deploymentPercent);
    
    // Fix 1: Guard against no-op deploys
    if (nextStep === deploymentPercent) {
      addLog(
        'DEPLOYMENT',
        `Run ${runId}: Canary rollout already at ${deploymentPercent}%. No change applied.`,
        'WARN',
        runId
      );
      return;
    }
    
    setDeploymentPercent(nextStep);
    
    try {
      // Persist deployment to database
      const deploymentResult = await createOrUpdateDeployment({
        snapshotId: finalSnapshotToDeploy.id,
        target: 'router', // Default target, could be made configurable
        region: 'global',
        percent: nextStep,
        isActive: true,
        activatedBy: 'control-plane',
        deploymentKey: 'default',
        isRollback: false,
      });
      
      // Check for server-side no-op detection
      if (deploymentResult.current.noop) {
        addLog(
          'DEPLOYMENT',
          `Run ${runId}: Deployment no-op - already at ${nextStep}%`,
          'WARN',
          runId
        );
        return;
      }
      
      const prevPercent = deploymentResult.previous?.percent ?? deploymentPercent;
      const deploymentMsg = prevPercent > 0 && prevPercent !== nextStep
        ? `Run ${runId}: canary rollout increased from ${prevPercent}% to ${nextStep}% (deployment persisted)`
        : `Run ${runId}: canary rollout set to ${nextStep}% (deployment persisted)`;
      addLog('DEPLOYMENT', deploymentMsg, 'WARN', runId);

      if (nextStep === 100) {
        addLog('DEPLOYMENT', `Run ${runId}: full rollout complete. Snapshot ${snapshotToDeploy.version} deployed to PROD.`, 'SUCCESS', runId);
      }

      // Reload deployments and snapshots to show the newly created deployment and updated active snapshot
      try {
        const [snaps, deps, events] = await Promise.all([
          getSnapshots(), // Reload snapshots to get updated is_active status
          getDeployments(false),
          getRolloutEvents({ limit: 10 }).catch(() => []),
        ]);
        setSnapshots(snaps);
        setDeployments(deps || []);
        setRolloutEvents(events || []);
        
        // Update activeSnapshotId if the deployed snapshot became active
        const newActiveSnapshot = snaps.find(s => s.isActive && s.env === PkgEnv.PROD);
        if (newActiveSnapshot && newActiveSnapshot.id === snapshotToDeploy.id) {
          // Clear selected snapshot since it's now active
          setSelectedSnapshotForDeployment(null);
        }
      } catch (reloadError) {
        console.warn('Failed to reload data after deployment:', reloadError);
      }
    } catch (error: any) {
      addLog('DEPLOYMENT', `Failed to persist deployment: ${error?.message || String(error)}`, 'ERROR', runId);
      console.error('Deployment error:', error);
      // Revert UI state if persistence fails
      setDeploymentPercent(deploymentPercent);
    }
  };

  return (
    <div className="h-full flex flex-col space-y-4">
      
      {/* Top Status Bar */}
      <div className="bg-slate-900 text-white p-4 rounded-lg flex items-center justify-between shadow-md">
        <div className="flex items-center space-x-3">
          <Bot className="text-indigo-400 h-6 w-6" />
          <div className="flex flex-col">
            <span className="font-semibold text-lg">Autonomous Control Plane</span>
            <span className="text-xs text-slate-400 font-mono">run={pipelineId}</span>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={resetPipeline}
            className="flex items-center text-xs px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700"
            title="Reset pipeline state"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </button>
        </div>
      </div>
      {loadingData && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">
          Loading snapshots and rules from the proxy server...
        </div>
      )}

      {/* Controls: Base snapshot + persist rules */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="text-xs text-gray-500">Base Snapshot (PROD):</div>
          <select
            value={baseSnapshotId ?? ''}
            onChange={(e) => setBaseSnapshotId(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            {prodSnapshots.map(s => (
              <option key={s.id} value={s.id}>
                {s.version} {s.isActive ? '★' : ''} · {s.stage} · id={s.id}
              </option>
            ))}
          </select>
          {baseSnapshot && (
            <div className="text-xs text-gray-500">
              Using: <span className="font-mono">{baseSnapshot.version}</span>
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={persistRulesOnBuild}
            onChange={(e) => setPersistRulesOnBuild(e.target.checked)}
          />
          Persist rules to DB during build (recommended)
        </label>
      </div>

      {/* Main Pipeline Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        
        {/* COL 1: Evolution (Input -> Proposal) */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col">
          <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-700 flex items-center"><GitMerge className="w-4 h-4 mr-2 text-indigo-500"/> Policy Evolution</h3>
            <span className="text-xs font-mono bg-gray-200 px-2 py-1 rounded">AGENT-1</span>
          </div>
          <div className="p-4 flex-1 overflow-y-auto space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Human Intent / Incident Log</label>
              <textarea
                className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm border p-3 h-32"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="Describe what needs to change..."
              />
              <div className="text-xs text-gray-500 mt-2">
                Run intent snapshot: <span className="font-mono">{runIntent ? safeQuote(runIntent, 80) : '(none yet)'}</span>
              </div>
            </div>
            
            {snapshots.length === 0 ? (
              <div className="space-y-3">
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800">
                  <strong>No snapshots found.</strong> Initialize the first snapshot to get started.
                </div>
                <button 
                  onClick={handleInitializeFirstSnapshot}
                  disabled={loadingData || isEvolving}
                  className={`w-full flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${isEvolving ? 'bg-gray-400 cursor-not-allowed' : 'bg-amber-600 hover:bg-amber-700'}`}
                >
                  {isEvolving ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <Bot className="mr-2 h-4 w-4"/>}
                  Initialize First Snapshot
                </button>
              </div>
            ) : deployments.length === 0 ? (
              <div className="space-y-3">
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-800">
                  <strong>First-time deployment detected.</strong> Use the "Deploy Existing Snapshot" option in the Validation & Deployment column to deploy snapshot_id=1.
                </div>
                <div className="text-xs text-gray-500 text-center">
                  Evolution → Build creates new snapshots. For first-time, deploy the initialized snapshot instead.
                </div>
              </div>
            ) : (
              <button 
                onClick={handleEvolution}
                disabled={loadingData || isEvolving || !!proposal}
                className={`w-full flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${isEvolving || !!proposal ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
              >
                {isEvolving ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <Bot className="mr-2 h-4 w-4"/>}
                Analyze & Propose
              </button>
            )}

            {proposal && (
              <div className="mt-4 bg-indigo-50 border border-indigo-100 rounded-md p-4">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-bold text-indigo-800 uppercase">PROPOSAL GENERATED</span>
                  <span className="text-xs font-mono text-gray-500">{proposal.generatedAt}</span>
                </div>
                <h4 className="font-bold text-gray-900">{proposal.newVersion}</h4>
                <p className="text-sm text-gray-600 mt-1 mb-3">{proposal.reason}</p>
                <div className="space-y-2">
                   {proposal.changes.map((c, i) => (
                     <div key={i} className="text-xs bg-white p-2 rounded border border-indigo-100">
                       <span className={`font-bold mr-2 ${c.action === 'DELETE' ? 'text-red-600' : 'text-green-600'}`}>{c.action}</span>
                       <span className="text-gray-500">{c.rationale}</span>
                     </div>
                   ))}
                </div>
                <div className="mt-4 flex space-x-2">
                   <button 
                     onClick={handleBuild}
                     disabled={!!draftSnapshot || isBuilding}
                     className="flex-1 bg-indigo-600 text-white text-xs py-2 rounded hover:bg-indigo-700 disabled:bg-gray-400 flex items-center justify-center"
                   >
                     {isBuilding ? <Loader2 className="animate-spin mr-2 h-3 w-3"/> : null}
                     Approve & Build (Native)
                   </button>
                   <button
                    onClick={() => {
                      setProposal(null);
                      setDraftSnapshot(null);
                      setDraftRules([]);
                      setValidationResult(null);
                      setDeploymentPercent(0);
                      addLog('EVOLUTION', 'Proposal rejected; pipeline cleared (run intent preserved).', 'WARN');
                    }}
                    className="px-3 py-2 bg-white border border-gray-300 text-gray-700 text-xs rounded hover:bg-gray-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* COL 2: Promotion Pipeline (Native → WASM) */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col">
           <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-700 flex items-center"><GitMerge className="w-4 h-4 mr-2 text-purple-500"/> Promotion Pipeline</h3>
            <span className="text-xs font-mono bg-gray-200 px-2 py-1 rounded">AGENT-2</span>
          </div>
          <div className="p-4 flex-1 flex flex-col items-center justify-center space-y-6">
             {!draftSnapshot && (
               <div className="text-center text-gray-400">
                 <GitMerge className="h-12 w-12 mx-auto mb-2 opacity-20" />
                 <p className="text-sm">Waiting for built snapshot...</p>
               </div>
             )}

             {draftSnapshot && (
               <div className="w-full space-y-6">
                  {/* Snapshot Info */}
                  <div className={`border p-4 rounded-lg text-center ${
                    (draftSnapshot.artifactFormat === 'native' || !draftSnapshot.artifactFormat)
                      ? 'bg-amber-50 border-amber-200' 
                      : 'bg-purple-50 border-purple-200'
                  }`}>
                    <div className="text-xs font-bold uppercase mb-2">
                      {(draftSnapshot.artifactFormat === 'native' || !draftSnapshot.artifactFormat) ? 'NATIVE SNAPSHOT' : 'WASM SNAPSHOT'}
                    </div>
                    <div className="font-mono text-lg font-bold text-gray-900">{draftSnapshot.version}</div>
                    <div className="text-xs text-gray-600 mt-2">
                      Size: {draftSnapshot.sizeBytes.toLocaleString()} bytes
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Checksum: {draftSnapshot.checksum.substring(0, 16)}...
                    </div>
                  </div>

                  {/* Pipeline Visualizer */}
                  <div className="relative">
                    {/* Native Stage */}
                    <div className={`flex items-center justify-between p-4 rounded-lg border-2 mb-4 ${
                      draftSnapshot.artifactFormat === 'native'
                        ? 'bg-amber-50 border-amber-400'
                        : 'bg-gray-50 border-gray-200'
                    }`}>
                      <div className="flex items-center space-x-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          draftSnapshot.artifactFormat === 'native'
                            ? 'bg-amber-500 text-white'
                            : 'bg-gray-300 text-gray-600'
                        }`}>
                          {draftSnapshot.artifactFormat === 'wasm' ? <CheckCircle className="w-5 h-5" /> : '1'}
                        </div>
                        <div>
                          <div className="font-semibold text-sm">Native Format</div>
                          <div className="text-xs text-gray-500">Draft snapshot</div>
                        </div>
                      </div>
                      {(draftSnapshot.artifactFormat === 'native' || !draftSnapshot.artifactFormat) && (
                        <div className="text-xs bg-amber-200 text-amber-800 px-2 py-1 rounded">Current</div>
                      )}
                    </div>

                    {/* Arrow */}
                    <div className="flex justify-center mb-4">
                      <ArrowRight className={`w-6 h-6 ${
                        draftSnapshot.artifactFormat === 'wasm' ? 'text-purple-500' : 'text-gray-400'
                      }`} />
                    </div>

                    {/* WASM Stage */}
                    <div className={`flex items-center justify-between p-4 rounded-lg border-2 ${
                      draftSnapshot.artifactFormat === 'wasm'
                        ? 'bg-purple-50 border-purple-400'
                        : 'bg-gray-50 border-gray-200'
                    }`}>
                      <div className="flex items-center space-x-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          draftSnapshot.artifactFormat === 'wasm'
                            ? 'bg-purple-500 text-white'
                            : 'bg-gray-300 text-gray-600'
                        }`}>
                          {draftSnapshot.artifactFormat === 'wasm' ? <CheckCircle className="w-5 h-5" /> : '2'}
                        </div>
                        <div>
                          <div className="font-semibold text-sm">WASM Format</div>
                          <div className="text-xs text-gray-500">Compiled & optimized</div>
                        </div>
                      </div>
                      {draftSnapshot.artifactFormat === 'wasm' && (
                        <div className="text-xs bg-purple-200 text-purple-800 px-2 py-1 rounded">Complete</div>
                      )}
                    </div>
                  </div>

                  {/* Promote Button - Show if native or undefined (needs promotion) */}
                  {(draftSnapshot.artifactFormat === 'native' || !draftSnapshot.artifactFormat) && (
                    <button 
                      onClick={handlePromoteToWasm}
                      disabled={isPromoting}
                      className="w-full bg-purple-600 text-white py-3 rounded-lg shadow hover:bg-purple-700 flex items-center justify-center disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
                    >
                      {isPromoting ? (
                        <>
                          <Loader2 className="animate-spin mr-2 h-4 w-4" />
                          Compiling to WASM...
                        </>
                      ) : (
                        <>
                          <ArrowRight className="h-4 w-4 mr-2" />
                          Promote to WASM
                        </>
                      )}
                    </button>
                  )}

                  {draftSnapshot.artifactFormat === 'wasm' && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                      <div className="text-sm font-semibold text-green-800">✓ Ready for Validation</div>
                      <div className="text-xs text-green-600 mt-1">
                        Snapshot compiled and optimized
                      </div>
                    </div>
                  )}
               </div>
             )}
          </div>
        </div>

        {/* COL 3: Validation & Deployment (WASM -> Production) */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col">
           <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-700 flex items-center"><ShieldAlert className="w-4 h-4 mr-2 text-emerald-500"/> Validation & Deployment</h3>
            <span className="text-xs font-mono bg-gray-200 px-2 py-1 rounded">AGENT-3</span>
          </div>
          <div className="p-4 flex-1 flex flex-col">
             
             {/* Option to deploy existing snapshot (for first-time initialization) */}
             {!draftSnapshot && snapshots.length > 0 && (
               <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                 <div className="text-xs font-semibold text-blue-800 mb-2">Deploy Existing Snapshot (Skip Evolution/Build)</div>
                 <select
                   value={selectedSnapshotForDeployment ?? ''}
                   onChange={(e) => {
                     const id = e.target.value ? Number(e.target.value) : null;
                     setSelectedSnapshotForDeployment(id);
                     if (id) {
                       const snap = snapshots.find(s => s.id === id);
                       if (snap) {
                         // Set as draftSnapshot so it can be deployed
                         // Treat undefined/null as 'native' so promotion button shows
                         setDraftSnapshot({
                           ...snap,
                           artifactFormat: snap.artifactFormat === 'wasm' ? 'wasm' : 'native',
                         });
                         setValidationResult(null);
                         setDeploymentPercent(0);
                         const runId = pipelineIdRef.current;
                         addLog('DEPLOYMENT', `Selected existing snapshot ${snap.version} (id=${snap.id}) for deployment`, 'INFO', runId);
                       }
                     } else {
                       setDraftSnapshot(null);
                       setSelectedSnapshotForDeployment(null);
                     }
                   }}
                   className="w-full px-2 py-1.5 border border-blue-300 rounded text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                 >
                   <option value="">Select snapshot to deploy...</option>
                   {prodSnapshots
                     .filter(s => s.artifactFormat === 'wasm' || !s.artifactFormat) // Allow WASM or undefined (from initialization)
                     .map(s => (
                       <option key={s.id} value={s.id}>
                         {s.version} {s.isActive ? '★' : ''} (id={s.id})
                       </option>
                     ))}
                 </select>
                 {selectedSnapshotForDeployment && (
                   <div className="mt-2 text-xs text-blue-700">
                     Selected: {snapshots.find(s => s.id === selectedSnapshotForDeployment)?.version}
                     <span className="ml-2 text-blue-600">(You can deploy without validation)</span>
                   </div>
                 )}
               </div>
             )}
             
             {!draftSnapshot || draftSnapshot.artifactFormat !== 'wasm' ? (
               <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                  <ShieldAlert className="h-12 w-12 mx-auto mb-2 opacity-20" />
                  <p className="text-sm text-center">
                    {!draftSnapshot 
                      ? 'Waiting for WASM snapshot...' 
                      : 'Snapshot must be promoted to WASM format before validation'}
                  </p>
               </div>
             ) : !validationResult ? (
               /* Validation Not Run Yet */
               <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                  <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-lg text-center w-full">
                    <div className="text-xs font-bold text-emerald-800 uppercase mb-1">WASM SNAPSHOT READY</div>
                    <div className="font-mono text-sm font-bold text-gray-900">{draftSnapshot.version}</div>
                    <div className="text-xs text-emerald-600 mt-2">
                      Size: {draftSnapshot.sizeBytes.toLocaleString()} bytes (compressed)
                    </div>
                  </div>

                  <button 
                    onClick={handleValidate}
                    disabled={isValidating}
                    className="w-full bg-emerald-600 text-white py-3 rounded-lg shadow hover:bg-emerald-700 flex items-center justify-center disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
                  >
                    {isValidating ? (
                      <>
                        <Loader2 className="animate-spin mr-2 h-4 w-4" />
                        Running Validation...
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="h-4 w-4 mr-2" />
                        Run Validation
                      </>
                    )}
                  </button>
               </div>
             ) : deploymentPercent === 0 ? (
               /* Validation Complete, Ready for Deployment */
               <div className="space-y-6">
                  {validationResult ? (
                    <div className={`border rounded-lg p-4 ${validationResult.success ? 'bg-white border-green-200' : 'bg-red-50 border-red-200'}`}>
                       <div className="flex items-center justify-between mb-4">
                          <span className="font-bold text-gray-700">Validation Report</span>
                          {validationResult.success ? <CheckCircle className="text-green-500"/> : <XCircle className="text-red-500"/>}
                       </div>
                       <div className="grid grid-cols-2 gap-4 text-center mb-4">
                          <div className="bg-gray-50 p-2 rounded">
                             <div className="text-xl font-bold text-gray-800">{validationResult.report?.passed}</div>
                             <div className="text-xs text-gray-500">Passed Checks</div>
                          </div>
                          <div className="bg-gray-50 p-2 rounded">
                             <div className="text-xl font-bold text-gray-800">{validationResult.report?.failed}</div>
                             <div className="text-xs text-gray-500">Failures</div>
                          </div>
                       </div>
                       {validationResult.report?.conflicts && validationResult.report.conflicts.length > 0 && (
                          <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
                             <div className="text-xs font-bold text-red-800 mb-2">Conflicts:</div>
                             <ul className="list-disc pl-5 text-xs text-red-700">
                                {validationResult.report.conflicts.map((c, i) => (
                                   <li key={i}>{c}</li>
                                ))}
                             </ul>
                          </div>
                       )}
                       {validationResult.success ? (
                          <button 
                             onClick={() => handleDeployStep()}
                             className="w-full bg-emerald-600 text-white py-2 rounded shadow hover:bg-emerald-700 flex justify-center items-center"
                          >
                             <ArrowRight className="h-4 w-4 mr-2" />
                             Proceed to Canary Deployment
                          </button>
                       ) : (
                          <div className="text-center text-red-700 text-sm font-semibold">
                             Validation Failed - Cannot Deploy
                          </div>
                       )}
                    </div>
                  ) : selectedSnapshotForDeployment ? (
                    /* Deploy existing snapshot without validation */
                    <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
                       <div className="flex items-center justify-between mb-4">
                          <span className="font-bold text-gray-700">Deploy Existing Snapshot</span>
                          <CheckCircle className="text-blue-500"/>
                       </div>
                       <div className="text-sm text-gray-600 mb-4">
                          Ready to deploy: <span className="font-mono font-semibold">{draftSnapshot?.version}</span>
                       </div>
                       <button 
                          onClick={() => handleDeployStep()}
                          className="w-full bg-emerald-600 text-white py-2 rounded shadow hover:bg-emerald-700 flex justify-center items-center"
                       >
                          <ArrowRight className="h-4 w-4 mr-2" />
                          Deploy Snapshot
                       </button>
                    </div>
                  ) : null}
               </div>
             ) : (
               /* Active Deployment */
               <div className="space-y-6">
                  <div className="text-center">
                     <div className="text-sm text-gray-500 mb-1">Target Version</div>
                     <div className="text-2xl font-bold text-indigo-600">{draftSnapshot?.version}</div>
                  </div>

                  <div className="relative pt-1">
                     <div className="flex mb-2 items-center justify-between">
                        <div className="text-right">
                           <span className="text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-indigo-600 bg-indigo-200">
                              {deploymentPercent}% Traffic
                           </span>
                        </div>
                     </div>
                     <div className="overflow-hidden h-4 mb-4 text-xs flex rounded bg-indigo-200">
                        <div style={{ width: `${deploymentPercent}%` }} className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-indigo-500 transition-all duration-500"></div>
                     </div>
                  </div>

                  <div className="bg-amber-50 border border-amber-200 p-4 rounded text-sm text-amber-800">
                     <p className="font-bold flex items-center mb-2"><Play className="h-3 w-3 mr-2"/> Live Metrics (Simulated)</p>
                     <ul className="list-disc pl-5 space-y-1 text-xs">
                        <li>Error Rate: 0.01% (Stable)</li>
                        <li>Latency: 45ms (Normal)</li>
                        <li>Rule Evaluations: 1,204/sec</li>
                     </ul>
                  </div>

                  {deploymentPercent < 100 ? (
                     <div className="flex space-x-3">
                        <button onClick={handleDeployStep} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2 rounded shadow">
                           Promote Stage
                        </button>
                        <button 
                          onClick={async () => {
                            const runId = pipelineIdRef.current;
                            if (!draftSnapshot || !draftSnapshot.id) return;
                            
                            try {
                              // Deactivate deployment on rollback (explicit rollback flag allows percent decrease)
                              await createOrUpdateDeployment({
                                snapshotId: draftSnapshot.id,
                                target: 'router',
                                region: 'global',
                                percent: 0,
                                isActive: false, // Will be forced to false anyway when percent=0
                                activatedBy: 'control-plane',
                                deploymentKey: 'default',
                                isRollback: true, // Explicit rollback flag
                              });
                              setDeploymentPercent(0);
                              addLog('DEPLOYMENT', `Run ${runId}: Deployment rolled back (set to 0% and deactivated)`, 'WARN', runId);
                            } catch (error: any) {
                              addLog('DEPLOYMENT', `Failed to rollback deployment: ${error?.message || String(error)}`, 'ERROR', runId);
                              // Still reset UI state
                              setDeploymentPercent(0);
                            }
                          }}
                          className="px-4 bg-red-100 text-red-700 hover:bg-red-200 rounded border border-red-200"
                        >
                           Rollback
                        </button>
                     </div>
                  ) : (
                     <div className="bg-green-100 text-green-800 p-4 rounded text-center font-bold border border-green-200">
                        Rollout Complete
                     </div>
                  )}
               </div>
             )}

          </div>
        </div>

      </div>

      {/* Deployment Management Section */}
      {activeSnapshotId ? (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-700 flex items-center gap-2">
              <Server className="h-5 w-5 text-indigo-600" />
              Active Nodes & Deployments Management
              <span className="text-xs font-normal text-gray-500">
                ({snapshotDeployments.length} deployment{snapshotDeployments.length !== 1 ? 's' : ''})
              </span>
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Manage deployments for snapshot: <span className="font-mono">{activeSnapshot?.version}</span>
            </p>
          </div>

          <div className="p-4">
            {deploymentMessage && (
              <div className={`mb-4 p-3 rounded text-sm ${
                deploymentMessage.startsWith('✅') 
                  ? 'bg-green-50 text-green-700 border border-green-200' 
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {deploymentMessage}
              </div>
            )}

            {snapshotDeployments.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <div className="text-sm mb-2">
                  No deployments for this snapshot. Deployments will appear here after deployment operations.
                </div>
                {draftSnapshot && draftSnapshot.artifactFormat === 'wasm' && !validationResult && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                    <strong>Next Step:</strong> Run Validation (click "Run Validation" button in the Validation & Deployment column)
                  </div>
                )}
                {validationResult && validationResult.success && deploymentPercent === 0 && (
                  <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded text-xs text-green-800">
                    <strong>Ready to Deploy:</strong> Click "Proceed to Canary Deployment" button in the Validation & Deployment column to create your first deployment
                  </div>
                )}
                <div className="text-xs text-gray-500 mt-3 space-y-1">
                  <p><strong>How to initialize deployments:</strong></p>
                  <ol className="list-decimal list-inside space-y-1 text-left max-w-md mx-auto">
                    <li>Complete the pipeline: Evolution → Build → Promote to WASM → Validate</li>
                    <li>After validation passes, click "Proceed to Canary Deployment"</li>
                    <li>Deployments will be created automatically and appear here</li>
                    <li>You can then edit, rollback, or deactivate them using the action buttons</li>
                  </ol>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {snapshotDeployments.map(dep => {
                  const snap = snapshots.find(s => s.id === dep.snapshotId);
                  const isEditing = editingDeployment?.id === dep.id;
                  
                  return (
                    <div key={dep.id} className={`p-4 rounded-lg border-2 ${
                      dep.isActive 
                        ? 'bg-green-50 border-green-200' 
                        : 'bg-gray-50 border-gray-200'
                    }`}>
                      {isEditing ? (
                        // Edit mode
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <Radio className={`h-4 w-4 ${dep.isActive ? 'text-green-500' : 'text-gray-300'}`} />
                              <span className="font-medium text-gray-700 capitalize">{dep.target}</span>
                              <span className="text-gray-400 text-xs">({dep.region})</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={editDeploymentPercent}
                              onChange={(e) => setEditDeploymentPercent(Math.max(0, Math.min(100, Number(e.target.value))))}
                              className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
                              disabled={updatingDeployment}
                            />
                            <span className="text-sm text-gray-500">%</span>
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={handleUpdateDeployment}
                              disabled={updatingDeployment}
                              className="flex-1 px-3 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {updatingDeployment ? 'Updating...' : 'Save'}
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              disabled={updatingDeployment}
                              className="px-3 py-2 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        // View mode
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2">
                              <Radio className={`h-4 w-4 ${dep.isActive ? 'text-green-500' : 'text-gray-300'}`} />
                              <span className="font-medium text-gray-700 capitalize">{dep.target}</span>
                              <span className="text-gray-400 text-xs">({dep.region})</span>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">{snap?.version}</span>
                              <span className={`font-bold ${
                                dep.percent === 100 ? 'text-green-600' :
                                dep.percent > 0 ? 'text-blue-600' : 'text-gray-600'
                              }`}>
                                {dep.percent ?? 0}%
                              </span>
                            </div>
                          </div>
                          {dep.isActive && (
                            <div className="flex items-center gap-2 mt-3">
                              <button
                                onClick={() => handleEditDeployment(dep)}
                                className="flex items-center gap-1 px-2 py-1 text-blue-600 hover:bg-blue-50 rounded text-xs"
                                title="Edit deployment"
                              >
                                <Edit className="h-3 w-3" />
                                Edit
                              </button>
                              {dep.percent > 0 && (
                                <button
                                  onClick={() => handleRollbackDeployment(dep)}
                                  className="flex items-center gap-1 px-2 py-1 text-amber-600 hover:bg-amber-50 rounded text-xs"
                                  title="Rollback deployment"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Rollback
                                </button>
                              )}
                              <button
                                onClick={() => handleDeactivateDeployment(dep)}
                                className="flex items-center gap-1 px-2 py-1 text-red-600 hover:bg-red-50 rounded text-xs"
                                title="Deactivate deployment"
                              >
                                <Pause className="h-3 w-3" />
                                Deactivate
                              </button>
                            </div>
                          )}
                          {dep.activatedBy && dep.activatedBy !== 'system' && (
                            <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Activated by: {dep.activatedBy} at {new Date(dep.activatedAt).toLocaleString()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recent Rollout Events */}
            {rolloutEvents.length > 0 && (
              <div className="mt-6 pt-4 border-t border-gray-200">
                <div className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Recent Rollout Events
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {rolloutEvents.slice(0, 10).map((event, idx) => (
                    <div key={idx} className="text-xs text-gray-600 flex items-center justify-between p-2 bg-gray-50 rounded">
                      <div className="flex items-center gap-2">
                        <span className="capitalize font-medium">{event.target}</span>
                        <span className="text-gray-400">({event.region})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${
                          event.isRollback ? 'text-red-600' : 'text-green-600'
                        }`}>
                          {event.fromPercent !== null ? `${event.fromPercent}% → ` : ''}{event.toPercent}%
                        </span>
                        {event.isRollback && (
                          <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">ROLLBACK</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="text-xs text-gray-500">
                <strong>Note:</strong> Only one active deployment per (target, region) lane. 
                Updating a deployment will deactivate previous active deployments for the same lane.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-700 flex items-center gap-2">
              <Server className="h-5 w-5 text-indigo-600" />
              Active Nodes & Deployments Management
            </h3>
          </div>
          <div className="p-4">
            <div className="text-center py-8 text-gray-400">
              <div className="text-sm mb-2">
                No active snapshot selected. Deployments will appear here after deployment operations.
              </div>
              <div className="text-xs text-gray-500 mt-3 space-y-1">
                <p><strong>How to initialize deployments:</strong></p>
                <ol className="list-decimal list-inside space-y-1 text-left max-w-md mx-auto">
                  <li>Complete the pipeline: Evolution → Build → Promote to WASM → Validate</li>
                  <li>After validation passes, click "Proceed to Canary Deployment"</li>
                  <li>Deployments will be created automatically and appear here</li>
                  <li>You can then edit, rollback, or deactivate them using the action buttons</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Terminal Log */}
      <div className="h-48 bg-slate-900 rounded-lg shadow-inner overflow-hidden flex flex-col">
        <div className="p-2 bg-slate-800 border-b border-slate-700 flex items-center space-x-2">
           <Terminal className="text-slate-400 h-4 w-4" />
           <span className="text-xs text-slate-400 font-mono">Agent Event Stream</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1">
          {agentLogs.length === 0 && <span className="text-slate-600 italic">System ready. Waiting for events...</span>}
          {agentLogs.map((log) => (
            <div key={log.id} className="flex space-x-3">
               <span className="text-slate-500">[{log.timestamp}]</span>
               <span className={`${
                 log.agent === 'EVOLUTION' ? 'text-indigo-400' :
                 log.agent === 'VALIDATION' ? 'text-emerald-400' : 'text-amber-400'
               } font-bold w-24`}>{log.agent}</span>
               <span className={`${
                 log.level === 'ERROR' ? 'text-red-400' : 
                 log.level === 'WARN' ? 'text-yellow-400' : 
                 log.level === 'SUCCESS' ? 'text-green-300' : 'text-slate-300'
               }`}>{log.message}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};