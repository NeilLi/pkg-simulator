import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { getSnapshots, getRules, getFacts, getDeployments, getValidationRuns, getSubtaskTypes, clearCache } from '../mockData';
import { ShieldCheck, Activity, Database, Server, Radio, CheckCircle2, AlertTriangle, Sparkles, Loader2, Plus, Copy, X } from 'lucide-react';
import { Snapshot, Rule, Fact, Deployment, ValidationRun, PkgEnv, PkgEngine, PkgConditionType, PkgOperator, PkgRelation, SubtaskType } from '../types';
import { initializeHotelScenario } from '../services/initializationService';
import { createSnapshot, cloneSnapshot, generateVersion } from '../services/snapshotService';
import { createFact } from '../services/factService';
import { createRule } from '../services/ruleService';
import { generateFactFromNaturalLanguage, generateRuleFromNaturalLanguage } from '../services/geminiService';

export const Dashboard: React.FC = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [validations, setValidations] = useState<ValidationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [initMessage, setInitMessage] = useState<string | null>(null);
  const [showNewSnapshotModal, setShowNewSnapshotModal] = useState(false);
  const [newSnapshotMode, setNewSnapshotMode] = useState<'create' | 'clone'>('create');
  const [newSnapshotVersion, setNewSnapshotVersion] = useState('');
  const [newSnapshotEnv, setNewSnapshotEnv] = useState<PkgEnv>(PkgEnv.PROD);
  const [newSnapshotNotes, setNewSnapshotNotes] = useState('');
  const [newSnapshotIsActive, setNewSnapshotIsActive] = useState(false);
  const [cloneSourceId, setCloneSourceId] = useState<number | null>(null);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
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
  });
  const [creatingFact, setCreatingFact] = useState(false);
  const [factMessage, setFactMessage] = useState<string | null>(null);
  const [showAddRuleModal, setShowAddRuleModal] = useState(false);
  const [ruleModalStep, setRuleModalStep] = useState<'prompt' | 'form'>('prompt');
  const [rulePrompt, setRulePrompt] = useState('');
  const [generatingRule, setGeneratingRule] = useState(false);
  const [subtaskTypes, setSubtaskTypes] = useState<SubtaskType[]>([]);
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

  useEffect(() => {
    const loadData = async () => {
      try {
        const [snaps, ruls, fcts, deps, vals, sts] = await Promise.all([
          getSnapshots(),
          getRules(),
          getFacts(),
          getDeployments(),
          getValidationRuns(),
          getSubtaskTypes(),
        ]);
        setSnapshots(snaps);
        setRules(ruls);
        setFacts(fcts);
        setDeployments(deps);
        setValidations(vals);
        setSubtaskTypes(sts);
      } catch (error) {
        console.error('Error loading dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const activeSnapshot = snapshots.find(s => s.isActive && s.env === 'prod');
  const nextSnapshot = snapshots.find(s => !s.isActive && s.env === 'prod'); // Canary usually

  const reloadData = async () => {
    clearCache();
    const [snaps, ruls, fcts, deps, vals] = await Promise.all([
      getSnapshots(),
      getRules(),
      getFacts(),
      getDeployments(),
      getValidationRuns(),
    ]);
    setSnapshots(snaps);
    setRules(ruls);
    setFacts(fcts);
    setDeployments(deps);
    setValidations(vals);
  };

  const handleInitialize = async () => {
    setInitializing(true);
    setInitMessage(null);
    try {
      const result = await initializeHotelScenario();
      if (result.success) {
        setInitMessage(
          `✅ Initialization successful! Created: ${result.created.snapshots} snapshot(s), ` +
          `${result.created.subtaskTypes} subtask type(s), ${result.created.rules} rule(s), ` +
          `${result.created.facts} fact(s)`
        );
        await reloadData();
      } else {
        setInitMessage(`❌ ${result.message}`);
      }
    } catch (error: any) {
      setInitMessage(`❌ Error: ${error.message}`);
    } finally {
      setInitializing(false);
      setTimeout(() => setInitMessage(null), 10000);
    }
  };

  const handleOpenNewSnapshotModal = (mode: 'create' | 'clone' = 'create') => {
    setNewSnapshotMode(mode);
    setNewSnapshotVersion('');
    setNewSnapshotNotes('');
    setNewSnapshotIsActive(false);
    setCloneSourceId(null);
    setSnapshotMessage(null);
    
    // Auto-generate version if creating new
    if (mode === 'create' && snapshots.length > 0) {
      const existingVersions = snapshots.map(s => s.version);
      const baseName = 'hotel-2030';
      setNewSnapshotVersion(generateVersion(baseName, existingVersions));
    }
    
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
      let newSnapshot: Snapshot;
      
      if (newSnapshotMode === 'clone') {
        if (!cloneSourceId) {
          setSnapshotMessage('❌ Please select a source snapshot to clone');
          setCreatingSnapshot(false);
          return;
        }
        newSnapshot = await cloneSnapshot(cloneSourceId, {
          version: newSnapshotVersion,
          env: newSnapshotEnv,
          notes: newSnapshotNotes || undefined,
          isActive: newSnapshotIsActive,
        });
      } else {
        newSnapshot = await createSnapshot({
          version: newSnapshotVersion,
          env: newSnapshotEnv,
          notes: newSnapshotNotes || undefined,
          isActive: newSnapshotIsActive,
        });
      }

      setSnapshotMessage(`✅ Snapshot "${newSnapshot.version}" created successfully!`);
      await reloadData();
      
      // Close modal after 2 seconds
      setTimeout(() => {
        setShowNewSnapshotModal(false);
        setSnapshotMessage(null);
      }, 2000);
    } catch (error: any) {
      setSnapshotMessage(`❌ Error: ${error.message}`);
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const handleOpenAddFactModal = () => {
    // Default to active snapshot or first snapshot
    const defaultSnapshotId = activeSnapshot?.id || snapshots[0]?.id || null;
    
    setNewFact({
      snapshotId: defaultSnapshotId,
      namespace: 'hotel',
      subject: '',
      predicate: '',
      object: '{}',
      validFrom: '',
      validTo: '',
      createdBy: 'user',
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
        existingFacts: facts.filter(f => f.status === 'active'),
      });

      if (!generatedFact) {
        setFactMessage('❌ Failed to generate fact. Please try again or fill the form manually.');
        return;
      }

      // Convert validFrom/validTo to datetime-local format if provided
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

      // Fill the form with generated fact
      setNewFact({
        snapshotId: selectedSnapshot?.id || null,
        namespace: generatedFact.namespace,
        subject: generatedFact.subject,
        predicate: generatedFact.predicate,
        object: JSON.stringify(generatedFact.object, null, 2),
        validFrom,
        validTo,
        createdBy: generatedFact.createdBy || 'user',
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
    if (!newFact.subject.trim() || !newFact.predicate.trim()) {
      setFactMessage('❌ Subject and predicate are required');
      return;
    }

    // Validate JSON object
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
      const fact = await createFact({
        snapshotId: newFact.snapshotId || undefined,
        namespace: newFact.namespace,
        subject: newFact.subject,
        predicate: newFact.predicate,
        object: parsedObject,
        validFrom: newFact.validFrom || undefined,
        validTo: newFact.validTo || undefined,
        createdBy: newFact.createdBy || 'user',
      });

      setFactMessage(`✅ Fact "${fact.subject} ${fact.predicate}" created successfully!`);
      await reloadData();
      
      // Close modal after 2 seconds
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

  const handleOpenAddRuleModal = () => {
    const defaultSnapshotId = activeSnapshot?.id || snapshots[0]?.id || null;
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
      const snapshotFacts = facts.filter(f => f.snapshotId === newRule.snapshotId && f.status === 'active');
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
      setRuleMessage('✅ Rule generated! Review and edit if needed.');
      setRuleModalStep('form');
    } catch (error: any) {
      setRuleMessage(`❌ Error: ${error.message}`);
    } finally {
      setGeneratingRule(false);
    }
  };

  const handleCreateRule = async () => {
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
      const emissions = newRule.emissions.map(em => ({
        subtaskTypeId: em.subtaskTypeId,
        relationshipType: em.relationshipType,
        params: em.params ? JSON.parse(em.params) : undefined,
      }));
      const rule = await createRule({
        snapshotId: newRule.snapshotId,
        ruleName: newRule.ruleName,
        priority: newRule.priority,
        engine: newRule.engine,
        ruleSource: newRule.ruleSource || undefined,
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

  const stats = [
    { title: 'Active Policy', value: activeSnapshot?.version || 'N/A', icon: ShieldCheck, color: 'bg-indigo-500' },
    { title: 'Total Rules', value: rules.length, icon: Activity, color: 'bg-emerald-500' },
    { title: 'Active Facts', value: facts.filter(f => f.status === 'active').length, icon: Database, color: 'bg-blue-500' },
    { title: 'Active Nodes', value: deployments.filter(d => d.isActive).length, icon: Server, color: 'bg-amber-500' },
  ];

  const chartData = [
    { name: '00:00', evals: 400 },
    { name: '04:00', evals: 300 },
    { name: '08:00', evals: 2400 },
    { name: '12:00', evals: 3200 },
    { name: '16:00', evals: 2800 },
    { name: '20:00', evals: 1800 },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-gray-500">Loading dashboard data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Initialize Button */}
      <div className="bg-white shadow rounded-lg p-4 border border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">SeedCore-Native Hotel (2030+)</h2>
            <p className="text-sm text-gray-500 mt-1">
              Initialize basic policy rules and snapshots for the hotel scenario with service robots, smart rooms, 3D printers, and external services
            </p>
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
            <button
              onClick={handleInitialize}
              disabled={initializing}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                initializing
                  ? 'bg-gray-400 cursor-not-allowed text-white'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {initializing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Initializing...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-5 w-5" />
                  <span>Initialize Hotel Scenario</span>
                </>
              )}
            </button>
          </div>
        </div>
        {initMessage && (
          <div className={`mt-3 p-3 rounded-lg text-sm ${
            initMessage.startsWith('✅') 
              ? 'bg-green-50 text-green-800 border border-green-200' 
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            {initMessage}
          </div>
        )}
      </div>

      {/* New Snapshot Modal */}
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
                  Set as active snapshot for this environment
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

      {/* Add Fact Modal */}
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
              /* Prompt Input Step */
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
              /* Form Step */
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
                  onChange={(e) => setNewFact({ ...newFact, namespace: e.target.value })}
                  placeholder="e.g., hotel"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
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

      {/* Add Rule Modal */}
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
                      }}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Cancel
                    </button>
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
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
           const Icon = stat.icon;
           return (
            <div key={stat.title} className="bg-white overflow-hidden shadow rounded-lg border border-gray-100">
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center flex-1">
                    <div className={`flex-shrink-0 rounded-md p-3 ${stat.color}`}>
                      <Icon className="h-6 w-6 text-white" />
                    </div>
                    <div className="ml-5 w-0 flex-1">
                      <dl>
                        <dt className="text-sm font-medium text-gray-500 truncate">{stat.title}</dt>
                        <dd className="text-lg font-bold text-gray-900">{stat.value}</dd>
                      </dl>
                    </div>
                  </div>
                  {stat.title === 'Active Facts' && (
                    <button
                      onClick={handleOpenAddFactModal}
                      className="ml-2 p-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-md transition-colors"
                      title="Add Fact"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                  {stat.title === 'Total Rules' && (
                    <button
                      onClick={handleOpenAddRuleModal}
                      className="ml-2 p-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-md transition-colors"
                      title="Add Rule"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
           );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Chart */}
        <div className="lg:col-span-2 bg-white shadow rounded-lg p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Policy Evaluations (24h)</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                  cursor={{ fill: '#f3f4f6' }}
                />
                <Bar dataKey="evals" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Deployments & Validations */}
        <div className="lg:col-span-1 space-y-6">
            
            {/* Deployments */}
            <div className="bg-white shadow rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                 <h3 className="text-lg font-medium text-gray-900">Active Deployments</h3>
                 <span className="text-xs text-gray-400">pkg_deployments</span>
              </div>
              <ul className="space-y-3">
                {deployments.map(dep => {
                  const snap = snapshots.find(s => s.id === dep.snapshotId);
                  return (
                    <li key={dep.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center space-x-2">
                        <Radio className={`h-4 w-4 ${dep.isActive ? 'text-green-500' : 'text-gray-300'}`} />
                        <span className="font-medium text-gray-700 capitalize">{dep.target}</span>
                        <span className="text-gray-400 text-xs">({dep.region})</span>
                      </div>
                      <div className="flex items-center space-x-2">
                         <span className="bg-gray-100 px-2 py-0.5 rounded text-xs">{snap?.version}</span>
                         <span className="font-bold text-gray-600">{dep.percent}%</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Validation Runs */}
            <div className="bg-white shadow rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                 <h3 className="text-lg font-medium text-gray-900">Validation Status</h3>
                 <span className="text-xs text-gray-400">pkg_validation_runs</span>
              </div>
              <ul className="space-y-3">
                {validations.map(run => {
                  const snap = snapshots.find(s => s.id === run.snapshotId);
                  return (
                    <li key={run.id} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded">
                      <div>
                        <div className="font-medium text-indigo-600">{snap?.version}</div>
                        <div className="text-xs text-gray-500">{new Date(run.startedAt).toLocaleTimeString()}</div>
                      </div>
                      <div className="flex items-center">
                        {run.success ? (
                          <span className="flex items-center text-green-600 text-xs font-bold">
                            <CheckCircle2 className="h-4 w-4 mr-1" /> PASS
                          </span>
                        ) : run.success === false ? (
                          <span className="flex items-center text-red-600 text-xs font-bold">
                            <AlertTriangle className="h-4 w-4 mr-1" /> FAIL
                          </span>
                        ) : (
                          <span className="text-amber-500 text-xs font-bold animate-pulse">RUNNING...</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

        </div>
      </div>
    </div>
  );
};