import React, { useState, useEffect, useMemo } from 'react';
import {
  getRules,
  getFacts,
  getSubtaskTypes,
  clearCache,
} from '../mockData';
import { Sparkles, Loader2, Plus, Copy, X, Shield, Save, XCircle, Search, Trash2, Edit } from 'lucide-react';
import { Snapshot, Rule, Fact, PkgEnv, PkgEngine, PkgConditionType, PkgOperator, PkgRelation, SubtaskType } from '../types';
import {
  createSnapshot,
  cloneSnapshot,
  generateVersion,
  listSnapshots,
  activateSnapshot,
} from '../services/snapshotService';
import { createFact } from '../services/factService';
import { createRule } from '../services/ruleService';
import { generateFactFromNaturalLanguage, generateRuleFromNaturalLanguage } from '../services/geminiService';
import { setupDesignGovernance } from '../services/designGovernanceSetup';

/**
 * PolicyStudio - Policy Authoring & Evolution
 * 
 * Purpose: Create & evolve policy artifacts (snapshots, rules, facts)
 * 
 * Characteristics:
 * - Heavy forms
 * - Modals
 * - AI assistance
 * - Draft mindset
 */
export const PolicyStudio: React.FC = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [subtaskTypes, setSubtaskTypes] = useState<SubtaskType[]>([]);
  const [loading, setLoading] = useState(true);

  // User-selected environment (for context)
  const [selectedEnv, setSelectedEnv] = useState<PkgEnv>(PkgEnv.PROD);

  // Snapshot creation/cloning state
  const [showNewSnapshotModal, setShowNewSnapshotModal] = useState(false);
  const [newSnapshotMode, setNewSnapshotMode] = useState<'create' | 'clone'>('create');
  const [newSnapshotVersion, setNewSnapshotVersion] = useState('');
  const [newSnapshotEnv, setNewSnapshotEnv] = useState<PkgEnv>(PkgEnv.PROD);
  const [newSnapshotNotes, setNewSnapshotNotes] = useState('');
  const [newSnapshotIsActive, setNewSnapshotIsActive] = useState(false);
  const [cloneSourceId, setCloneSourceId] = useState<number | null>(null);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);

  // Fact creation state
  const [showAddFactModal, setShowAddFactModal] = useState(false);
  const [factModalStep, setFactModalStep] = useState<'prompt' | 'form'>('prompt');
  const [factPrompt, setFactPrompt] = useState('');
  const [generatingFact, setGeneratingFact] = useState(false);
  const [newFact, setNewFact] = useState({
    snapshotId: null as number | null,
    namespace: 'hotel',
    subject: '',
    predicate: '',
    object: '{}',
    validFrom: '',
    validTo: '',
    createdBy: 'user',
    pkgRuleId: null as string | null, // Link fact to a rule for governance
  });
  const [creatingFact, setCreatingFact] = useState(false);
  const [factMessage, setFactMessage] = useState<string | null>(null);

  // Rule creation state
  const [showAddRuleModal, setShowAddRuleModal] = useState(false);
  const [ruleModalStep, setRuleModalStep] = useState<'prompt' | 'form'>('prompt');
  const [rulePrompt, setRulePrompt] = useState('');
  const [generatingRule, setGeneratingRule] = useState(false);
  const [newRule, setNewRule] = useState({
    snapshotId: null as number | null,
    ruleName: '',
    priority: 100,
    engine: PkgEngine.WASM as PkgEngine,
    ruleSource: '',
    conditions: [] as Array<{
      conditionType: PkgConditionType;
      conditionKey: string;
      operator: PkgOperator;
      value: string;
    }>,
    emissions: [] as Array<{
      subtaskTypeId: string;
      relationshipType: PkgRelation;
      params: string; // JSON string
    }>,
  });
  const [creatingRule, setCreatingRule] = useState(false);
  const [ruleMessage, setRuleMessage] = useState<string | null>(null);
  
  // AI Assistant: Draft rule preview (from PolicyFactory)
  const [draftRule, setDraftRule] = useState<Rule | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [originalPrompt, setOriginalPrompt] = useState('');

  // Design governance setup state
  const [settingUpDesignGov, setSettingUpDesignGov] = useState(false);
  const [designGovMessage, setDesignGovMessage] = useState<string | null>(null);

  // Rules list view state
  const [ruleSearch, setRuleSearch] = useState('');
  const [selectedRuleSnapshotId, setSelectedRuleSnapshotId] = useState<number | null>(null);

  /** -----------------------------
   * Data loading
   * ------------------------------*/

  const loadData = async (env: PkgEnv) => {
    try {
      const snaps = await listSnapshots({ env, includeInactive: true, limit: 200 });
      const [ruls, fcts, sts] = await Promise.all([
        getRules(),
        getFacts(),
        getSubtaskTypes(),
      ]);

      setSnapshots(snaps);
      setRules(ruls);
      setFacts(fcts);
      setSubtaskTypes(sts);
    } catch (error) {
      console.error('Error loading policy studio data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadData(selectedEnv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEnv]);

  const reloadData = async () => {
    clearCache();
    await loadData(selectedEnv);
  };

  const activeSnapshot = useMemo(
    () => snapshots.find(s => s.isActive && s.env === selectedEnv),
    [snapshots, selectedEnv],
  );

  const activeSnapshotId = activeSnapshot?.id ?? null;

  // Helper: Filter active facts (handles new status values) - filtered by active snapshot
  const getActiveFacts = useMemo(() => {
    return facts.filter(f => {
      // Filter by active snapshot_id
      if (activeSnapshotId && f.snapshotId !== activeSnapshotId) return false;
      
      // Handle new status values: 'active' | 'expired' | 'future' | 'indefinite'
      if (f.status === 'active' || f.status === 'indefinite') return true;
      // Also check temporal validity if status is not set
      if (!f.status && f.validFrom && f.validTo) {
        const now = new Date();
        const from = new Date(f.validFrom);
        const to = new Date(f.validTo);
        return now >= from && now <= to;
      }
      // Facts without temporal constraints are considered active
      if (!f.status && !f.validFrom && !f.validTo) return true;
      return false;
    });
  }, [facts, activeSnapshotId]);

  // Filtered rules for list view
  const filteredRules = useMemo(() => {
    const snapshotId = selectedRuleSnapshotId ?? activeSnapshotId;
    const list = snapshotId ? rules.filter(r => r.snapshotId === snapshotId) : rules;
    const q = ruleSearch.trim().toLowerCase();
    if (!q) return list;

    return list.filter(r => {
      const hay = [
        r.ruleName,
        String(r.engine),
        String(r.priority),
        ...(r.conditions || []).map(c => `${c.conditionKey} ${c.operator} ${c.value || ''}`),
        ...(r.emissions || []).map(e => `${e.relationshipType} ${e.subtaskName || e.subtaskTypeId}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return hay.includes(q);
    });
  }, [rules, selectedRuleSnapshotId, activeSnapshotId, ruleSearch]);

  /** -----------------------------
   * Snapshot create / clone
   * ------------------------------*/

  const handleOpenNewSnapshotModal = (mode: 'create' | 'clone' = 'create') => {
    setNewSnapshotMode(mode);
    setNewSnapshotNotes('');
    setNewSnapshotIsActive(false);
    setCloneSourceId(null);
    setSnapshotMessage(null);

    setNewSnapshotEnv(selectedEnv);

    const existingVersions = snapshots.map(s => s.version);
    const baseName = 'hotel-2030';
    setNewSnapshotVersion(generateVersion(baseName, existingVersions));

    setShowNewSnapshotModal(true);
  };

  const handleCreateSnapshot = async () => {
    if (!newSnapshotVersion.trim()) {
      setSnapshotMessage('❌ Version is required');
      return;
    }

    setCreatingSnapshot(true);
    setSnapshotMessage(null);

    try {
      let created: Snapshot;

      if (newSnapshotMode === 'clone') {
        if (!cloneSourceId) {
          setSnapshotMessage('❌ Please select a source snapshot to clone');
          setCreatingSnapshot(false);
          return;
        }
        created = await cloneSnapshot(cloneSourceId, {
          version: newSnapshotVersion,
          env: newSnapshotEnv,
          notes: newSnapshotNotes || undefined,
          isActive: false,
        });
      } else {
        created = await createSnapshot({
          version: newSnapshotVersion,
          env: newSnapshotEnv,
          notes: newSnapshotNotes || undefined,
          isActive: false,
        });
      }

      if (newSnapshotIsActive && created?.id) {
        await activateSnapshot(created.id);
      }

      setSnapshotMessage(`✅ Snapshot "${created.version}" created successfully!`);
      await reloadData();

      setTimeout(() => {
        setShowNewSnapshotModal(false);
        setSnapshotMessage(null);
      }, 1200);
    } catch (error: any) {
      setSnapshotMessage(`❌ Error: ${error.message}`);
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const handleActivateLatest = async () => {
    try {
      const sorted = [...snapshots]
        .filter(s => s.env === selectedEnv)
        .sort((a, b) => {
          const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
          const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
          if (tb !== ta) return tb - ta;
          return (b.id ?? 0) - (a.id ?? 0);
        });

      const candidate = sorted[0];
      if (!candidate?.id) return;

      await activateSnapshot(candidate.id);
      await reloadData();
    } catch (e: any) {
      console.error(e);
      setSnapshotMessage(`❌ Activate latest failed: ${e.message || e}`);
      setTimeout(() => setSnapshotMessage(null), 6000);
    }
  };

  /** -----------------------------
   * Design Governance Setup
   * ------------------------------*/

  const handleSetupDesignGovernance = async () => {
    const targetSnapshotId = activeSnapshotId || snapshots[0]?.id;
    if (!targetSnapshotId) {
      setDesignGovMessage('❌ Please select or create a snapshot first');
      setTimeout(() => setDesignGovMessage(null), 3000);
      return;
    }

    setSettingUpDesignGov(true);
    setDesignGovMessage(null);

    try {
      const result = await setupDesignGovernance(targetSnapshotId);
      
      if (result.success) {
        // Build detailed message showing idempotency results
        const parts: string[] = [];
        if (result.created.subtaskTypes > 0) {
          parts.push(`${result.created.subtaskTypes} new subtask type${result.created.subtaskTypes > 1 ? 's' : ''}`);
        }
        if (result.created.rules > 0) {
          parts.push(`${result.created.rules} new rule${result.created.rules > 1 ? 's' : ''}`);
        }
        if (parts.length === 0) {
          setDesignGovMessage(`✅ Design governance already set up (idempotent: no changes needed)`);
        } else {
          setDesignGovMessage(`✅ ${result.message}`);
        }
        await reloadData(); // Reload to show new subtask types and rules
        setTimeout(() => setDesignGovMessage(null), 7000); // Longer timeout for idempotency message
      } else {
        setDesignGovMessage(`❌ ${result.message}`);
      }
    } catch (error: any) {
      setDesignGovMessage(`❌ Error: ${error.message || String(error)}`);
    } finally {
      setSettingUpDesignGov(false);
    }
  };

  /** -----------------------------
   * Fact creation
   * ------------------------------*/

  const handleOpenAddFactModal = () => {
    const defaultSnapshotId = activeSnapshotId || snapshots[0]?.id || null;
    
    setNewFact({
      snapshotId: defaultSnapshotId,
      namespace: 'hotel', // Default namespace (will be trimmed on save)
      subject: '',
      predicate: '',
      object: '{}',
      validFrom: '',
      validTo: '',
      createdBy: 'user',
      pkgRuleId: null, // Link fact to a rule for governance
    });
    setFactPrompt('');
    setFactModalStep('prompt');
    setFactMessage(null);
    setShowAddFactModal(true);
  };

  const handleGenerateFactFromPrompt = async () => {
    if (!factPrompt.trim()) {
      setFactMessage('❌ Please enter a description');
      return;
    }

    setGeneratingFact(true);
    setFactMessage(null);

    try {
      const selectedSnapshot = newFact.snapshotId 
        ? snapshots.find(s => s.id === newFact.snapshotId)
        : activeSnapshot || snapshots[0];

      const generatedFact = await generateFactFromNaturalLanguage({
        prompt: factPrompt,
        snapshotId: selectedSnapshot?.id,
        snapshot: selectedSnapshot,
        existingFacts: facts.filter(f => {
          // Filter by snapshotId and active status
          if (selectedSnapshot?.id && f.snapshotId !== selectedSnapshot.id) return false;
          return f.status === 'active';
        }),
      });

      if (!generatedFact) {
        setFactMessage('❌ Failed to generate fact. Please try again or fill the form manually.');
        return;
      }

      let validFrom = '';
      let validTo = '';
      if (generatedFact.validFrom) {
        const date = new Date(generatedFact.validFrom);
        validFrom = date.toISOString().slice(0, 16);
      }
      if (generatedFact.validTo) {
        const date = new Date(generatedFact.validTo);
        validTo = date.toISOString().slice(0, 16);
      }

      setNewFact({
        snapshotId: selectedSnapshot?.id || null,
        namespace: (generatedFact.namespace || 'hotel').trim(), // Normalize namespace (trim spaces)
        subject: generatedFact.subject,
        predicate: generatedFact.predicate,
        object: JSON.stringify(generatedFact.object, null, 2),
        validFrom,
        validTo,
        createdBy: generatedFact.createdBy || 'user',
        pkgRuleId: null, // Rule linking must be done manually in the form
      });

      setFactMessage('✅ Fact generated! Review and edit if needed.');
      setFactModalStep('form');
    } catch (error: any) {
      setFactMessage(`❌ Error: ${error.message}`);
    } finally {
      setGeneratingFact(false);
    }
  };

  const handleCreateFact = async () => {
    // Normalize namespace: trim and validate (prevent "ghost namespaces")
    const normalizedNamespace = (newFact.namespace || 'hotel').trim();
    if (!normalizedNamespace || normalizedNamespace.length === 0) {
      setFactMessage('❌ Namespace cannot be empty');
      return;
    }

    if (!newFact.subject.trim() || !newFact.predicate.trim()) {
      setFactMessage('❌ Subject and predicate are required');
      return;
    }

    let parsedObject;
    try {
      parsedObject = JSON.parse(newFact.object || '{}');
    } catch (error) {
      setFactMessage('❌ Invalid JSON in object field');
      return;
    }

    setCreatingFact(true);
    setFactMessage(null);

    try {
      // Generate text representation for the fact (required in new schema)
      const factText = `${newFact.subject} ${newFact.predicate} ${JSON.stringify(parsedObject)}`;

      // Determine tags based on fact type and content
      const tags: string[] = [];
      if (newFact.snapshotId) tags.push('snapshot-scoped');
      if (newFact.validFrom || newFact.validTo) tags.push('temporal');
      if (parsedObject?.capabilities) tags.push('capabilities');
      if (parsedObject?.type) tags.push(`type:${parsedObject.type}`);
      tags.push('manual-entry'); // Tag all manual entries
      if (newFact.pkgRuleId) tags.push('pkg', 'governed'); // Tag governed facts

      // Build metadata with provenance
      const metaData = {
        source: 'PolicyStudio',
        created_via: 'manual',
        created_at: new Date().toISOString(),
        has_temporal: !!(newFact.validFrom || newFact.validTo),
        has_structured_triple: !!(newFact.subject && newFact.predicate && parsedObject),
        is_governed: !!newFact.pkgRuleId,
      };

      // For governed facts, ensure valid_from is set (defaults to now if not provided)
      // This ensures governed facts are active immediately, consistent with InitializationPage
      const now = new Date().toISOString();
      const validFrom = newFact.validFrom || (newFact.pkgRuleId ? now : undefined);
      const validTo = newFact.validTo || undefined;

      // Build PKG provenance if rule is linked
      let pkgProvenance: any = undefined;
      let validationStatus: string | undefined = undefined;
      
      if (newFact.pkgRuleId) {
        const linkedRule = rules.find(r => String(r.id) === newFact.pkgRuleId);
        pkgProvenance = {
          rule: linkedRule?.ruleName || 'unknown',
          engine: linkedRule?.engine || 'wasm',
          source: 'PolicyStudio',
          note: 'created via manual editor',
        };
        validationStatus = 'trusted'; // Trust manual entries from PolicyStudio
      }

      const fact = await createFact({
        text: factText, // Required field in new schema
        snapshotId: newFact.snapshotId || undefined,
        namespace: normalizedNamespace, // Use normalized namespace (trimmed)
        subject: newFact.subject.trim(),
        predicate: newFact.predicate.trim(),
        object: parsedObject,
        tags, // Include tags for faceting
        metaData, // Include provenance metadata
        validFrom, // Set to now() for governed facts if not provided
        validTo,
        pkgRuleId: newFact.pkgRuleId || undefined, // Link to rule for governance
        pkgProvenance, // PKG provenance metadata
        validationStatus, // Validation status for governed facts
        createdBy: (newFact.createdBy || 'user').trim(),
      });

      setFactMessage(`✅ Fact "${fact.subject} ${fact.predicate}" created successfully!`);
      await reloadData();
      
      setTimeout(() => {
        setShowAddFactModal(false);
        setFactMessage(null);
      }, 2000);
    } catch (error: any) {
      setFactMessage(`❌ Error: ${error.message}`);
    } finally {
      setCreatingFact(false);
    }
  };

  /** -----------------------------
   * Rule creation
   * ------------------------------*/

  const handleOpenAddRuleModal = () => {
    const defaultSnapshotId = activeSnapshotId || snapshots[0]?.id || null;
    setNewRule({
      snapshotId: defaultSnapshotId,
      ruleName: '',
      priority: 100,
      engine: PkgEngine.WASM,
      ruleSource: '',
      conditions: [],
      emissions: [],
    });
    setRulePrompt('');
    setRuleModalStep('prompt');
    setRuleMessage(null);
    setDraftRule(null);
    setOriginalPrompt('');
    setShowAddRuleModal(true);
  };

  const handleGenerateRuleFromPrompt = async () => {
    if (!rulePrompt.trim()) {
      setRuleMessage('❌ Please enter a description');
      return;
    }
    if (!newRule.snapshotId) {
      setRuleMessage('❌ Please select a snapshot');
      return;
    }
    setGeneratingRule(true);
    setRuleMessage(null);
    try {
      const selectedSnapshot = snapshots.find(s => s.id === newRule.snapshotId);
      const snapshotRules = rules.filter(r => r.snapshotId === newRule.snapshotId);
      // Use active facts helper (handles new status values: active, indefinite, etc.)
      const snapshotFacts = getActiveFacts.filter(f => f.snapshotId === newRule.snapshotId);
      const snapshotSubtaskTypes = subtaskTypes.filter(st => st.snapshotId === newRule.snapshotId);
      const generatedRule = await generateRuleFromNaturalLanguage({
        prompt: rulePrompt,
        snapshotId: newRule.snapshotId,
        snapshot: selectedSnapshot,
        existingRules: snapshotRules,
        existingFacts: snapshotFacts,
        subtaskTypes: snapshotSubtaskTypes,
      });
      if (!generatedRule) {
        setRuleMessage('❌ Failed to generate rule. Please try again or fill the form manually.');
        return;
      }
      const emissionsWithIds = generatedRule.emissions.map(em => {
        const subtaskType = snapshotSubtaskTypes.find(st => st.name === em.subtaskName);
        if (!subtaskType) throw new Error(`Subtask type "${em.subtaskName}" not found`);
        return {
          subtaskTypeId: subtaskType.id,
          relationshipType: em.relationshipType as PkgRelation,
          params: JSON.stringify(em.params || {}),
        };
      });
      // Create draft rule for preview (PolicyFactory pattern)
      const draftId = `draft-${Date.now()}`;
      const draft: Rule = {
        id: draftId,
        snapshotId: newRule.snapshotId!,
        ruleName: generatedRule.ruleName,
        priority: generatedRule.priority,
        engine: generatedRule.engine as PkgEngine,
        disabled: false,
        conditions: generatedRule.conditions.map(c => ({
          ruleId: draftId,
          conditionType: c.conditionType as PkgConditionType,
          conditionKey: c.conditionKey,
          operator: c.operator as PkgOperator,
          value: c.value || '',
        })),
        emissions: emissionsWithIds.map(e => ({
          ruleId: draftId,
          subtaskTypeId: e.subtaskTypeId,
          relationshipType: e.relationshipType,
          params: e.params ? JSON.parse(e.params) : undefined,
        })),
        ruleSource: generatedRule.ruleSource || '',
      };
      
      setDraftRule(draft);
      setOriginalPrompt(rulePrompt);
      
      // Also populate form for manual editing
      setNewRule({
        snapshotId: newRule.snapshotId,
        ruleName: generatedRule.ruleName,
        priority: generatedRule.priority,
        engine: generatedRule.engine as PkgEngine,
        ruleSource: generatedRule.ruleSource || '',
        conditions: generatedRule.conditions.map(c => ({
          conditionType: c.conditionType as PkgConditionType,
          conditionKey: c.conditionKey,
          operator: c.operator as PkgOperator,
          value: c.value || '',
        })),
        emissions: emissionsWithIds,
      });
      setRuleMessage('✅ Rule generated! Review draft below or edit in form.');
      setRuleModalStep('form');
    } catch (error: any) {
      setRuleMessage(`❌ Error: ${error.message}`);
    } finally {
      setGeneratingRule(false);
    }
  };

  // Save draft rule directly (PolicyFactory pattern)
  const handleSaveDraft = async () => {
    if (!draftRule || !draftRule.snapshotId) return;

    if (!draftRule.ruleName?.trim()) {
      setRuleMessage('❌ Draft missing ruleName.');
      return;
    }
    if (!draftRule.conditions?.length) {
      setRuleMessage('❌ Draft needs at least one condition.');
      return;
    }
    if (!draftRule.emissions?.length) {
      setRuleMessage('❌ Draft needs at least one emission.');
      return;
    }

    setSavingDraft(true);
    setRuleMessage(null);

    try {
      const snapshotSubtaskTypes = subtaskTypes.filter(st => st.snapshotId === draftRule.snapshotId);

      // Map emissions: ensure subtaskTypeId is present
      const mappedEmissions = draftRule.emissions.map((e, idx) => {
        let subtaskTypeId = e.subtaskTypeId;

        if (!subtaskTypeId && e.subtaskName) {
          const found = snapshotSubtaskTypes.find(st => st.name === e.subtaskName);
          if (found) {
            subtaskTypeId = found.id;
          } else {
            throw new Error(
              `Emission ${idx + 1}: Could not find subtask type "${e.subtaskName}" for snapshot ${draftRule.snapshotId}.`
            );
          }
        }

        if (!subtaskTypeId) {
          throw new Error(`Emission ${idx + 1}: subtaskTypeId is required.`);
        }

        return {
          subtaskTypeId,
          relationshipType: e.relationshipType,
          params: e.params,
        };
      });

      // Generate rule source from original prompt if available
      const generateRuleSource = (rule: Rule): string => {
        if (originalPrompt.trim()) {
          return `Generated from: "${originalPrompt.trim()}"`;
        }
        const conditionsStr = rule.conditions
          .map(c => `${c.conditionKey} ${c.operator} ${c.value || 'EXISTS'}`)
          .join(' AND ');
        const emissionsStr = rule.emissions
          .map(e => `${e.relationshipType} ${e.subtaskName || e.subtaskTypeId || 'subtask'}`)
          .join(', ');
        return `Rule: When ${conditionsStr}, then ${emissionsStr}`;
      };

      const ruleSource = draftRule.ruleSource?.trim() || generateRuleSource(draftRule);

      const created = await createRule({
        snapshotId: draftRule.snapshotId,
        ruleName: draftRule.ruleName,
        priority: draftRule.priority ?? 100,
        engine: draftRule.engine,
        ruleSource,
        conditions: draftRule.conditions.map(c => ({
          conditionType: c.conditionType,
          conditionKey: c.conditionKey,
          operator: c.operator,
          value: c.value,
        })),
        emissions: mappedEmissions,
      });

      setRules(prev => [...prev, created]);
      setDraftRule(null);
      setRulePrompt('');
      setOriginalPrompt('');
      setRuleMessage(`✅ Saved rule "${created.ruleName}".`);
      
      setTimeout(() => {
        setShowAddRuleModal(false);
        setRuleModalStep('prompt');
        setRuleMessage(null);
      }, 2000);
    } catch (e: any) {
      setRuleMessage(`❌ ${e.message || 'Failed to save rule.'}`);
    } finally {
      setSavingDraft(false);
    }
  };

  const handleCreateRule = async () => {
    // If draft exists, use it; otherwise use form data
    if (draftRule) {
      await handleSaveDraft();
      return;
    }

    if (!newRule.ruleName.trim() || !newRule.snapshotId) {
      setRuleMessage('❌ Rule name and snapshot are required');
      return;
    }
    if (newRule.conditions.length === 0) {
      setRuleMessage('❌ At least one condition is required');
      return;
    }
    if (newRule.emissions.length === 0) {
      setRuleMessage('❌ At least one emission is required');
      return;
    }
    setCreatingRule(true);
    setRuleMessage(null);
    try {
      // Resolve subtask names to IDs if needed
      const snapshotSubtaskTypes = subtaskTypes.filter(st => st.snapshotId === newRule.snapshotId);
      
      const emissions = newRule.emissions.map(em => {
        let subtaskTypeId = em.subtaskTypeId;
        
        // If subtaskTypeId is missing, try to find it by name
        if (!subtaskTypeId) {
          // This shouldn't happen if generation worked, but handle it gracefully
          throw new Error(`Emission missing subtaskTypeId`);
        }
        
        return {
          subtaskTypeId,
          relationshipType: em.relationshipType,
          params: em.params ? JSON.parse(em.params) : undefined,
        };
      });

      // Generate ruleSource if missing
      const ruleSource = newRule.ruleSource || `Generated rule: ${newRule.ruleName}`;

      const rule = await createRule({
        snapshotId: newRule.snapshotId,
        ruleName: newRule.ruleName,
        priority: newRule.priority,
        engine: newRule.engine,
        ruleSource,
        conditions: newRule.conditions,
        emissions,
      });
      setRuleMessage(`✅ Rule "${rule.ruleName}" created successfully!`);
      await reloadData();
      setTimeout(() => {
        setShowAddRuleModal(false);
        setRuleModalStep('prompt');
        setRuleMessage(null);
      }, 2000);
    } catch (error: any) {
      setRuleMessage(`❌ Error: ${error.message}`);
    } finally {
      setCreatingRule(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-gray-500">Loading policy studio data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white shadow rounded-lg p-4 border border-gray-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Policy Studio</h2>
            <p className="text-sm text-gray-500 mt-1">
              Create and evolve policy artifacts: snapshots, rules, and facts
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="text-xs text-gray-500">Environment</div>
              <select
                value={selectedEnv}
                onChange={(e) => setSelectedEnv(e.target.value as PkgEnv)}
                className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
              >
                <option value={PkgEnv.PROD}>prod</option>
                <option value={PkgEnv.STAGING}>staging</option>
                <option value={PkgEnv.DEV}>dev</option>
              </select>

              <div className="text-xs text-gray-500">Active</div>
              <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
                {activeSnapshot?.version || 'N/A'}
              </span>

              <button
                onClick={handleActivateLatest}
                className="text-xs px-2.5 py-1.5 rounded border border-gray-200 hover:bg-gray-50"
                title="Activates latest-created snapshot for this env"
              >
                Activate Latest
              </button>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => handleOpenNewSnapshotModal('create')}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors bg-gray-100 hover:bg-gray-200 text-gray-700"
            >
              <Plus className="h-5 w-5" />
              <span>New Snapshot</span>
            </button>
            <button
              onClick={() => handleOpenNewSnapshotModal('clone')}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors bg-gray-100 hover:bg-gray-200 text-gray-700"
            >
              <Copy className="h-5 w-5" />
              <span>Clone Snapshot</span>
            </button>
          </div>
        </div>
      </div>

      {/* Snapshot Modal - keep entire modal from Dashboard */}
      {showNewSnapshotModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                  {newSnapshotMode === 'clone' ? 'Clone Snapshot' : 'Create New Snapshot'}
                </h3>
                <button
                  onClick={() => setShowNewSnapshotModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              {newSnapshotMode === 'clone' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Source Snapshot
                  </label>
                  <select
                    value={cloneSourceId || ''}
                    onChange={(e) => setCloneSourceId(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select a snapshot to clone...</option>
                    {snapshots.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.version} ({s.env}) {s.isActive ? '★' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    This will copy all rules, subtask types, conditions, and emissions from the source snapshot.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Version <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newSnapshotVersion}
                  onChange={(e) => setNewSnapshotVersion(e.target.value)}
                  placeholder="e.g., hotel-2030-v1.0.1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Environment
                </label>
                <select
                  value={newSnapshotEnv}
                  onChange={(e) => setNewSnapshotEnv(e.target.value as PkgEnv)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value={PkgEnv.DEV}>Dev</option>
                  <option value={PkgEnv.STAGING}>Staging</option>
                  <option value={PkgEnv.PROD}>Production</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes (optional)
                </label>
                <textarea
                  value={newSnapshotNotes}
                  onChange={(e) => setNewSnapshotNotes(e.target.value)}
                  placeholder="Add notes about this snapshot..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={newSnapshotIsActive}
                  onChange={(e) => setNewSnapshotIsActive(e.target.checked)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label htmlFor="isActive" className="ml-2 block text-sm text-gray-700">
                  Activate after creation (recommended)
                </label>
              </div>

              {snapshotMessage && (
                <div className={`p-3 rounded-lg text-sm ${
                  snapshotMessage.startsWith('✅') 
                    ? 'bg-green-50 text-green-800 border border-green-200' 
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {snapshotMessage}
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => setShowNewSnapshotModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSnapshot}
                disabled={creatingSnapshot || !newSnapshotVersion.trim() || (newSnapshotMode === 'clone' && !cloneSourceId)}
                className={`px-4 py-2 text-sm font-medium text-white rounded-md ${
                  creatingSnapshot || !newSnapshotVersion.trim() || (newSnapshotMode === 'clone' && !cloneSourceId)
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {creatingSnapshot ? (
                  <>
                    <Loader2 className="h-4 w-4 inline animate-spin mr-2" />
                    Creating...
                  </>
                ) : (
                  newSnapshotMode === 'clone' ? 'Clone Snapshot' : 'Create Snapshot'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fact Modal - keep entire modal from Dashboard */}
      {showAddFactModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                  {factModalStep === 'prompt' ? 'Describe Fact (AI-Powered)' : 'Review & Edit Fact'}
                </h3>
                <button
                  onClick={() => {
                    setShowAddFactModal(false);
                    setFactModalStep('prompt');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            
            {factModalStep === 'prompt' ? (
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Snapshot (for context)
                  </label>
                  <select
                    value={newFact.snapshotId || ''}
                    onChange={(e) => setNewFact({ ...newFact, snapshotId: e.target.value ? Number(e.target.value) : null })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">None (global fact)</option>
                    {snapshots.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.version} ({s.env}) {s.isActive ? '★' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Selected snapshot will be used as context for fact generation
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Describe the fact in natural language <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={factPrompt}
                    onChange={(e) => setFactPrompt(e.target.value)}
                    placeholder="e.g., A delivery robot on floors 1-10 that works from 8am to 10pm with logistics skills"
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Examples:
                    <br />• "A cleaning robot on floor 1-10 that works 8am to 10pm"
                    <br />• "Room 1208 has HVAC, lighting, and privacy glass systems"
                    <br />• "External police service for emergency response, contact 911"
                    <br />• "A 3D printer in the workshop that can fabricate parts"
                  </p>
                </div>

                {factMessage && (
                  <div className={`p-3 rounded-lg text-sm ${
                    factMessage.startsWith('✅') 
                      ? 'bg-green-50 text-green-800 border border-green-200' 
                      : 'bg-red-50 text-red-800 border border-red-200'
                  }`}>
                    {factMessage}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Snapshot (optional)
                </label>
                <select
                  value={newFact.snapshotId || ''}
                  onChange={(e) => setNewFact({ ...newFact, snapshotId: e.target.value ? Number(e.target.value) : null })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">None (global fact)</option>
                  {snapshots.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.version} ({s.env}) {s.isActive ? '★' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Namespace <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newFact.namespace}
                  onChange={(e) => {
                    // Normalize namespace on input (trim leading/trailing spaces)
                    const normalized = e.target.value.trim();
                    setNewFact({ ...newFact, namespace: normalized || e.target.value });
                  }}
                  onBlur={(e) => {
                    // Final normalization on blur (prevent "ghost namespaces")
                    const normalized = e.target.value.trim();
                    if (normalized !== e.target.value) {
                      setNewFact({ ...newFact, namespace: normalized || 'hotel' });
                    }
                  }}
                  placeholder="e.g., hotel"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Namespace will be automatically trimmed (no leading/trailing spaces)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Subject <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newFact.subject}
                  onChange={(e) => setNewFact({ ...newFact, subject: e.target.value })}
                  placeholder="e.g., unit:robot_02"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Subject identifier (e.g., unit:robot_01, room:1208, guest:john_doe)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Predicate <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newFact.predicate}
                  onChange={(e) => setNewFact({ ...newFact, predicate: e.target.value })}
                  placeholder="e.g., hasCapabilities"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Predicate name (e.g., hasCapabilities, hasType, hasSystems)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Object (JSON) <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={newFact.object}
                  onChange={(e) => setNewFact({ ...newFact, object: e.target.value })}
                  placeholder='{"capabilities": ["deliver", "scan"], "constraints": ["floor=1-10"]}'
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">
                  JSON object data. Example: {"{"}"capabilities": ["deliver"], "skills": ["logistics"]{"}"}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Valid From (optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={newFact.validFrom}
                    onChange={(e) => setNewFact({ ...newFact, validFrom: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Valid To (optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={newFact.validTo}
                    onChange={(e) => setNewFact({ ...newFact, validTo: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Created By (optional)
                </label>
                <input
                  type="text"
                  value={newFact.createdBy}
                  onChange={(e) => setNewFact({ ...newFact, createdBy: e.target.value })}
                  placeholder="e.g., user, admin, system"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* PKG Governance Section */}
              <div className="border-t border-gray-200 pt-4 mt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="h-4 w-4 text-indigo-600" />
                  <h4 className="text-sm font-semibold text-gray-900">PKG Governance (Optional)</h4>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  Link this fact to a policy rule to make it a "governed fact". Governed facts are automatically 
                  validated and tracked by the PKG engine. If linked, valid_from will default to now() if not specified.
                </p>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Link to Rule (optional)
                  </label>
                  <select
                    value={newFact.pkgRuleId || ''}
                    onChange={(e) => setNewFact({ ...newFact, pkgRuleId: e.target.value || null })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">None (ungoverned fact)</option>
                    {rules
                      .filter(r => !r.snapshotId || r.snapshotId === newFact.snapshotId || !newFact.snapshotId)
                      .map(r => (
                        <option key={r.id} value={String(r.id)}>
                          {r.ruleName} (priority: {r.priority}, engine: {String(r.engine)})
                        </option>
                      ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    {newFact.pkgRuleId 
                      ? '✅ This fact will be linked to the selected rule and governed by PKG engine'
                      : 'Leave empty to create an ungoverned fact (not linked to any rule)'}
                  </p>
                </div>
              </div>

              {factMessage && (
                <div className={`p-3 rounded-lg text-sm ${
                  factMessage.startsWith('✅') 
                    ? 'bg-green-50 text-green-800 border border-green-200' 
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {factMessage}
                </div>
              )}
              </div>
            )}

            <div className="p-6 border-t border-gray-200 flex justify-between">
              {factModalStep === 'prompt' ? (
                <>
                  <button
                    onClick={() => {
                      setShowAddFactModal(false);
                      setFactModalStep('prompt');
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGenerateFactFromPrompt}
                    disabled={generatingFact || !factPrompt.trim()}
                    className={`px-4 py-2 text-sm font-medium text-white rounded-md ${
                      generatingFact || !factPrompt.trim()
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                  >
                    {generatingFact ? (
                      <>
                        <Loader2 className="h-4 w-4 inline animate-spin mr-2" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 inline mr-2" />
                        Generate Fact
                      </>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setFactModalStep('prompt');
                      setFactMessage(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    ← Back to Prompt
                  </button>
                  <div className="flex space-x-3">
                    <button
                      onClick={() => {
                        setShowAddFactModal(false);
                        setFactModalStep('prompt');
                      }}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateFact}
                      disabled={creatingFact || !newFact.subject.trim() || !newFact.predicate.trim() || !newFact.namespace.trim()}
                      className={`px-4 py-2 text-sm font-medium text-white rounded-md ${
                        creatingFact || !newFact.subject.trim() || !newFact.predicate.trim() || !newFact.namespace.trim()
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-indigo-600 hover:bg-indigo-700'
                      }`}
                    >
                      {creatingFact ? (
                        <>
                          <Loader2 className="h-4 w-4 inline animate-spin mr-2" />
                          Creating...
                        </>
                      ) : (
                        'Create Fact'
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rule Modal - keep entire modal from Dashboard */}
      {showAddRuleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                  {ruleModalStep === 'prompt' ? 'Describe Rule (AI-Powered)' : 'Review & Edit Rule'}
                </h3>
                <button
                  onClick={() => {
                    setShowAddRuleModal(false);
                    setRuleModalStep('prompt');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            
            {ruleModalStep === 'prompt' ? (
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Snapshot (required)
                  </label>
                  <select
                    value={newRule.snapshotId || ''}
                    onChange={(e) => setNewRule({ ...newRule, snapshotId: e.target.value ? Number(e.target.value) : null })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select a snapshot...</option>
                    {snapshots.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.version} ({s.env}) {s.isActive ? '★' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Selected snapshot will be used as context for rule generation
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Describe the rule in natural language <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={rulePrompt}
                    onChange={(e) => setRulePrompt(e.target.value)}
                    placeholder="e.g., If emergency keywords and HVAC issues are detected with high confidence, isolate the room HVAC, dispatch inspection robot, notify supervisor, and prepare guest relocation."
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Examples:
                    <br />• "If temperature is above 28 degrees in a room, order emergency cooling"
                    <br />• "When VIP guest detected and temp over 25, cool the room"
                    <br />• "If smoke detected and confidence high, activate emergency protocol and contact fire department"
                  </p>
                </div>

                {ruleMessage && (
                  <div className={`p-3 rounded-lg text-sm ${
                    ruleMessage.startsWith('✅') 
                      ? 'bg-green-50 text-green-800 border border-green-200' 
                      : 'bg-red-50 text-red-800 border border-red-200'
                  }`}>
                    {ruleMessage}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 space-y-4">
                {/* Draft Preview (PolicyFactory pattern) */}
                {draftRule && (
                  <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-lg p-4 mb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-indigo-700 uppercase mb-1">Draft Rule Preview</div>
                        <div className="font-semibold text-gray-900 truncate">{draftRule.ruleName}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          engine: <span className="font-mono">{String(draftRule.engine)}</span> · priority:{' '}
                          <span className="font-mono">{draftRule.priority}</span>
                        </div>
                        
                        <div className="mt-3">
                          <div className="text-xs font-semibold text-gray-700 mb-1">
                            Conditions ({draftRule.conditions.length})
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {draftRule.conditions.map((c, i) => (
                              <span key={i} className="bg-white px-2 py-1 rounded text-xs border border-gray-200">
                                {c.conditionKey} <span className="font-bold">{c.operator}</span> {c.value || 'EXISTS'}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="mt-3">
                          <div className="text-xs font-semibold text-gray-700 mb-1">
                            Emissions ({draftRule.emissions.length})
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {draftRule.emissions.map((e, i) => {
                              const subtaskType = subtaskTypes.find(st => st.id === e.subtaskTypeId);
                              return (
                                <span
                                  key={i}
                                  className="bg-white text-blue-700 px-2 py-1 rounded text-xs border border-blue-200"
                                >
                                  {e.relationshipType} → {subtaskType?.name || e.subtaskTypeId}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setDraftRule(null);
                            setRuleMessage(null);
                          }}
                          className="inline-flex items-center px-2 py-2 text-sm rounded-md border bg-white hover:bg-gray-50 text-gray-700"
                          title="Discard draft"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                        <button
                          onClick={handleSaveDraft}
                          disabled={savingDraft}
                          className={`inline-flex items-center px-3 py-2 text-sm rounded-md text-white ${
                            savingDraft ? 'bg-gray-400' : 'bg-emerald-600 hover:bg-emerald-700'
                          }`}
                        >
                          <Save className="h-4 w-4 mr-2" />
                          {savingDraft ? 'Saving…' : 'Save Draft'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Rule Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={newRule.ruleName}
                      onChange={(e) => setNewRule({ ...newRule, ruleName: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Priority <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      value={newRule.priority}
                      onChange={(e) => setNewRule({ ...newRule, priority: parseInt(e.target.value) || 100 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">Lower number = higher priority</p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Rule Source (optional)
                  </label>
                  <textarea
                    value={newRule.ruleSource}
                    onChange={(e) => setNewRule({ ...newRule, ruleSource: e.target.value })}
                    placeholder="Description or source of this rule"
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Conditions ({newRule.conditions.length})
                  </label>
                  <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-200 rounded-md p-3">
                    {newRule.conditions.length === 0 ? (
                      <p className="text-sm text-gray-500">No conditions</p>
                    ) : (
                      newRule.conditions.map((cond, idx) => (
                        <div key={idx} className="flex items-center space-x-2 text-sm bg-gray-50 p-2 rounded">
                          <span className="font-medium">{cond.conditionType}</span>
                          <span>{cond.conditionKey}</span>
                          <span className="font-bold">{cond.operator}</span>
                          <span>{cond.value || 'EXIST'}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Emissions ({newRule.emissions.length})
                  </label>
                  <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-200 rounded-md p-3">
                    {newRule.emissions.length === 0 ? (
                      <p className="text-sm text-gray-500">No emissions</p>
                    ) : (
                      newRule.emissions.map((em, idx) => {
                        const subtaskType = subtaskTypes.find(st => st.id === em.subtaskTypeId);
                        return (
                          <div key={idx} className="flex items-center space-x-2 text-sm bg-gray-50 p-2 rounded">
                            <span className="font-medium">{em.relationshipType}</span>
                            <span>→</span>
                            <span className="font-bold">{subtaskType?.name || 'Unknown'}</span>
                            {em.params && em.params !== '{}' && (
                              <span className="text-xs text-gray-500">({em.params})</span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {ruleMessage && (
                  <div className={`p-3 rounded-lg text-sm ${
                    ruleMessage.startsWith('✅') 
                      ? 'bg-green-50 text-green-800 border border-green-200' 
                      : 'bg-red-50 text-red-800 border border-red-200'
                  }`}>
                    {ruleMessage}
                  </div>
                )}
              </div>
            )}

            <div className="p-6 border-t border-gray-200 flex justify-between">
              {ruleModalStep === 'prompt' ? (
                <>
                  <button
                    onClick={() => {
                      setShowAddRuleModal(false);
                      setRuleModalStep('prompt');
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGenerateRuleFromPrompt}
                    disabled={generatingRule || !rulePrompt.trim() || !newRule.snapshotId}
                    className={`px-4 py-2 text-sm font-medium text-white rounded-md ${
                      generatingRule || !rulePrompt.trim() || !newRule.snapshotId
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                  >
                    {generatingRule ? (
                      <>
                        <Loader2 className="h-4 w-4 inline animate-spin mr-2" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 inline mr-2" />
                        Generate Rule
                      </>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setRuleModalStep('prompt');
                      setRuleMessage(null);
                      setDraftRule(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    ← Back to Prompt
                  </button>
                  <div className="flex space-x-3">
                    <button
                      onClick={() => {
                        setShowAddRuleModal(false);
                        setRuleModalStep('prompt');
                        setDraftRule(null);
                      }}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    {draftRule ? (
                      <button
                        onClick={handleSaveDraft}
                        disabled={savingDraft}
                        className={`px-4 py-2 text-sm font-medium text-white rounded-md ${
                          savingDraft
                            ? 'bg-gray-400 cursor-not-allowed'
                            : 'bg-emerald-600 hover:bg-emerald-700'
                        }`}
                      >
                        {savingDraft ? (
                          <>
                            <Loader2 className="h-4 w-4 inline animate-spin mr-2" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4 inline mr-2" />
                            Save Draft
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={handleCreateRule}
                        disabled={creatingRule || !newRule.ruleName.trim() || !newRule.snapshotId || newRule.conditions.length === 0 || newRule.emissions.length === 0}
                        className={`px-4 py-2 text-sm font-medium text-white rounded-md ${
                          creatingRule || !newRule.ruleName.trim() || !newRule.snapshotId || newRule.conditions.length === 0 || newRule.emissions.length === 0
                            ? 'bg-gray-400 cursor-not-allowed'
                            : 'bg-indigo-600 hover:bg-indigo-700'
                        }`}
                      >
                        {creatingRule ? (
                          <>
                            <Loader2 className="h-4 w-4 inline animate-spin mr-2" />
                            Creating...
                          </>
                        ) : (
                          'Create Rule'
                        )}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Design Governance Setup Message */}
      {designGovMessage && (
        <div className={`mb-4 p-4 rounded-lg ${
          designGovMessage.startsWith('✅') 
            ? 'bg-green-50 border border-green-200 text-green-800' 
            : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          <p className="text-sm">{designGovMessage}</p>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          onClick={() => handleOpenNewSnapshotModal('create')}
          className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow text-left"
        >
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-indigo-100 rounded-lg">
              <Copy className="h-6 w-6 text-indigo-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Create Snapshot</h3>
              <p className="text-sm text-gray-500 mt-1">Start a new policy version</p>
            </div>
          </div>
        </button>

        <button
          onClick={handleOpenAddRuleModal}
          className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow text-left"
        >
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-emerald-100 rounded-lg">
              <Sparkles className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Create Rule</h3>
              <p className="text-sm text-gray-500 mt-1">AI-powered rule authoring</p>
            </div>
          </div>
        </button>

        <button
          onClick={handleOpenAddFactModal}
          className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow text-left"
        >
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Plus className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Create Fact</h3>
              <p className="text-sm text-gray-500 mt-1">Add temporal knowledge</p>
            </div>
          </div>
        </button>

        <button
          onClick={handleSetupDesignGovernance}
          disabled={settingUpDesignGov || !activeSnapshotId}
          className={`bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow text-left ${
            settingUpDesignGov || !activeSnapshotId ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-purple-100 rounded-lg">
              {settingUpDesignGov ? (
                <Loader2 className="h-6 w-6 text-purple-600 animate-spin" />
              ) : (
                <Shield className="h-6 w-6 text-purple-600" />
              )}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Setup Design Governance</h3>
              <p className="text-sm text-gray-500 mt-1">
                {settingUpDesignGov ? 'Setting up...' : 'Register subtask types & rules (idempotent)'}
              </p>
              {designGovMessage && (
                <p className={`text-xs mt-1 ${
                  designGovMessage.startsWith('✅') ? 'text-green-600' : 
                  designGovMessage.startsWith('❌') ? 'text-red-600' : 
                  'text-gray-600'
                }`}>
                  {designGovMessage}
                </p>
              )}
            </div>
          </div>
        </button>
      </div>

      {/* Summary Stats */}
      <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
        <h3 className="text-md font-semibold text-gray-900 mb-4">Current Environment Summary</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-2xl font-bold text-gray-900">{snapshots.filter(s => s.env === selectedEnv).length}</div>
            <div className="text-sm text-gray-500">Snapshots</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">{rules.length}</div>
            <div className="text-sm text-gray-500">Total Rules</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">{getActiveFacts.length}</div>
            <div className="text-sm text-gray-500">Active Facts</div>
          </div>
        </div>
      </div>

      {/* Rules List View */}
      <div className="bg-white shadow sm:rounded-md flex-1 overflow-hidden border border-gray-100 mt-6">
        <div className="p-4 border-b border-gray-200 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="h-4 w-4 text-gray-400 absolute left-3 top-3" />
            <input
              value={ruleSearch}
              onChange={(e) => setRuleSearch(e.target.value)}
              placeholder="Search rule name, conditions, emissions…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-500 uppercase">Snapshot:</label>
            <select
              value={selectedRuleSnapshotId ?? activeSnapshotId ?? ''}
              onChange={(e) => setSelectedRuleSnapshotId(e.target.value ? Number(e.target.value) : null)}
              className="px-3 py-2 text-sm border-gray-300 rounded-md border focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Snapshots</option>
              {snapshots.filter(s => s.env === selectedEnv).map(s => (
                <option key={s.id} value={s.id}>
                  {s.version} {s.isActive ? '★' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="text-xs text-gray-500 whitespace-nowrap">{filteredRules.length} rule(s)</div>
        </div>

        <div className="overflow-y-auto max-h-[600px]">
          <ul className="divide-y divide-gray-200">
            {filteredRules.map(rule => (
              <li key={rule.id}>
                <div className="px-4 py-4 sm:px-6 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-indigo-600 truncate">{rule.ruleName}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        engine: <span className="font-mono">{String(rule.engine)}</span> · priority:{' '}
                        <span className="font-mono">{rule.priority}</span>
                        {rule.disabled ? <span className="ml-2 text-red-600 font-semibold">DISABLED</span> : null}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          // Load rule into edit form
                          setNewRule({
                            snapshotId: rule.snapshotId,
                            ruleName: rule.ruleName,
                            priority: rule.priority,
                            engine: rule.engine,
                            ruleSource: rule.ruleSource || '',
                            conditions: rule.conditions.map(c => ({
                              conditionType: c.conditionType,
                              conditionKey: c.conditionKey,
                              operator: c.operator,
                              value: c.value || '',
                            })),
                            emissions: rule.emissions.map(e => ({
                              subtaskTypeId: e.subtaskTypeId,
                              relationshipType: e.relationshipType,
                              params: JSON.stringify(e.params || {}),
                            })),
                          });
                          setRulePrompt('');
                          setDraftRule(null);
                          setRuleModalStep('form');
                          setShowAddRuleModal(true);
                        }}
                        className="text-indigo-400 hover:text-indigo-600"
                        title="Edit rule"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete rule "${rule.ruleName}"?`)) {
                            setRules(prev => prev.filter(r => r.id !== rule.id));
                            // TODO: Add backend delete endpoint call
                          }
                        }}
                        className="text-red-400 hover:text-red-600"
                        title="Delete rule"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    <div className="text-sm text-gray-500">
                      <span className="font-semibold mr-2">Conditions:</span>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {rule.conditions.map((c, i) => (
                          <span key={i} className="bg-gray-100 px-2 py-0.5 rounded text-xs">
                            {c.conditionKey} <span className="font-bold">{c.operator}</span> {c.value || 'EXISTS'}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="text-sm text-gray-500">
                      <span className="font-semibold mr-2">Emissions:</span>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {rule.emissions.map((e, i) => {
                          const subtaskType = subtaskTypes.find(st => st.id === e.subtaskTypeId);
                          return (
                            <span
                              key={i}
                              className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs border border-blue-100"
                            >
                              {e.relationshipType} → {subtaskType?.name || e.subtaskTypeId}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))}

            {filteredRules.length === 0 && (
              <li className="p-10 text-center text-gray-400">
                {ruleSearch.trim() || selectedRuleSnapshotId
                  ? 'No rules found matching your search/filter.'
                  : 'No rules found. Create your first rule using the "Create Rule" button above.'}
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
};
