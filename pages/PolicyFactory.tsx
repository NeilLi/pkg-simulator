import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, Save, Trash2, Search, RefreshCw, XCircle } from 'lucide-react';

import { Rule, Snapshot, PkgEnv, Condition, Emission, SubtaskType } from '../types';

// compat: mock data getters
import { getRules as getRulesMock, getSnapshots as getSnapshotsMock, getSubtaskTypes as getSubtaskTypesMock, clearCache } from '../mockData';

// backend create
import { createRule } from '../services/ruleService';

// AI generator (your existing usage style)
import { generateRuleFromNaturalLanguage } from '../services/geminiService';

type UiMessage = { type: 'success' | 'error' | 'info'; text: string } | null;

// ---- helpers ----
const pickDefaultSnapshotId = (snaps: Snapshot[], env: PkgEnv): number | null => {
  const envSnaps = snaps.filter(s => s.env === env);
  if (envSnaps.length === 0) return snaps[0]?.id ?? null;

  const active = envSnaps.find(s => s.isActive);
  if (active) return active.id;

  // latest by createdAt
  const newest = [...envSnaps].sort(
    (a, b) => +new Date(b.createdAt || 0) - +new Date(a.createdAt || 0)
  )[0];
  return newest?.id ?? null;
};

const hydrateRule = (r: any): Rule => {
  const id = String(r.id);

  const conditions: Condition[] = (r.conditions || []).map((c: any) => ({
    ruleId: c.ruleId ?? id,
    conditionType: c.conditionType,
    conditionKey: c.conditionKey,
    operator: c.operator,
    value: c.value,
  }));

  const emissions: Emission[] = (r.emissions || []).map((e: any) => ({
    ruleId: e.ruleId ?? id,
    subtaskTypeId: e.subtaskTypeId,
    subtaskName: e.subtaskName, // optional (hydrated for UI)
    relationshipType: e.relationshipType,
    params: e.params,
  }));

  return {
    id,
    snapshotId: Number(r.snapshotId),
    ruleName: r.ruleName,
    priority: r.priority ?? 100,
    engine: r.engine,
    conditions,
    emissions,
    disabled: Boolean(r.disabled),
  };
};

export const PolicyFactory: React.FC = () => {
  const [rules, setRules] = useState<Rule[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [subtaskTypes, setSubtaskTypes] = useState<SubtaskType[]>([]);

  const [selectedEnv, setSelectedEnv] = useState<PkgEnv>(PkgEnv.PROD);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);

  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Store the original prompt for rule source generation
  const [originalPrompt, setOriginalPrompt] = useState('');

  // draft preview before saving
  const [draftRule, setDraftRule] = useState<Rule | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [message, setMessage] = useState<UiMessage>(null);

  const showMsg = (msg: UiMessage, ttlMs = 6000) => {
    setMessage(msg);
    if (!msg) return;
    window.setTimeout(() => setMessage(null), ttlMs);
  };

  const loadData = async (envOverride?: PkgEnv) => {
    const envToUse = envOverride ?? selectedEnv;

    const [rulsRaw, snaps, sts] = await Promise.all([
      getRulesMock(),
      getSnapshotsMock(),
      getSubtaskTypesMock(),
    ]);
    const ruls = (rulsRaw || []).map(hydrateRule);

    setRules(ruls);
    setSnapshots(snaps);
    setSubtaskTypes(sts || []);

    // keep selection stable if possible, otherwise pick default
    const nextSelected =
      selectedSnapshotId &&
      snaps.some(s => s.id === selectedSnapshotId && s.env === envToUse)
        ? selectedSnapshotId
        : pickDefaultSnapshotId(snaps, envToUse);

    setSelectedSnapshotId(nextSelected);
  };

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await loadData(PkgEnv.PROD);
      } catch (e: any) {
        console.error(e);
        showMsg({ type: 'error', text: e?.message || 'Failed to load policy data.' });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // when env changes, re-pick a sensible snapshot
  useEffect(() => {
    if (snapshots.length === 0) return;
    setDraftRule(null);
    setMessage(null);

    const nextId = pickDefaultSnapshotId(snapshots, selectedEnv);
    setSelectedSnapshotId(nextId);
  }, [selectedEnv, snapshots]);

  const envSnapshots = useMemo(
    () => snapshots.filter(s => s.env === selectedEnv),
    [snapshots, selectedEnv]
  );

  const selectedSnapshot = useMemo(
    () => snapshots.find(s => s.id === selectedSnapshotId) || null,
    [snapshots, selectedSnapshotId]
  );

  const snapshotSubtaskTypes = useMemo(
    () => subtaskTypes.filter(st => st.snapshotId === selectedSnapshotId),
    [subtaskTypes, selectedSnapshotId]
  );

  const filteredRules = useMemo(() => {
    const list = rules.filter(r => r.snapshotId === selectedSnapshotId);
    const q = search.trim().toLowerCase();
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
  }, [rules, selectedSnapshotId, search]);

  const handleReload = async () => {
    setReloading(true);
    try {
      clearCache?.();
      await loadData();
      showMsg({ type: 'success', text: 'Reloaded.' }, 2000);
    } catch (e: any) {
      showMsg({ type: 'error', text: e?.message || 'Reload failed.' });
    } finally {
      setReloading(false);
    }
  };

  // ---- AI generate -> draft preview ----
  const handleGenerate = async () => {
    if (!aiPrompt.trim() || !selectedSnapshotId) return;

    setIsGenerating(true);
    setDraftRule(null);
    setMessage(null);

    try {
      // Get context for the selected snapshot
      const snapshotRules = rules.filter(r => r.snapshotId === selectedSnapshotId);

      const generated: any = await generateRuleFromNaturalLanguage({
        prompt: aiPrompt,
        snapshotId: selectedSnapshotId,
        snapshot: selectedSnapshot || undefined,
        existingRules: snapshotRules,
        existingFacts: [], // Could load facts if needed
        subtaskTypes: snapshotSubtaskTypes, // Use memoized value
      });

      if (!generated) {
        showMsg({ type: 'error', text: 'Failed to generate rule. Try a different prompt.' });
        return;
      }

      // normalize into Rule for UI
      const draftId = `draft-${Date.now()}`;
      const normalized: Rule = hydrateRule({
        ...generated,
        id: generated.id ?? draftId,
        snapshotId: selectedSnapshotId,
        disabled: generated.disabled ?? false,
        conditions: (generated.conditions || []).map((c: any) => ({ ...c, ruleId: c.ruleId ?? draftId })),
        emissions: (generated.emissions || []).map((e: any) => ({ ...e, ruleId: e.ruleId ?? draftId })),
      });

      setDraftRule(normalized);
      setOriginalPrompt(aiPrompt); // Store prompt for rule source generation
      showMsg({ type: 'success', text: 'Draft generated. Review then save.' }, 4000);
    } catch (e: any) {
      showMsg({ type: 'error', text: e?.message || 'Rule generation failed.' });
    } finally {
      setIsGenerating(false);
    }
  };

  // ---- save draft to backend ----
  const handleSaveDraft = async () => {
    if (!draftRule || !selectedSnapshotId) return;

    if (!draftRule.ruleName?.trim()) return showMsg({ type: 'error', text: 'Draft missing ruleName.' });
    if (!draftRule.conditions?.length) return showMsg({ type: 'error', text: 'Draft needs at least one condition.' });
    if (!draftRule.emissions?.length) return showMsg({ type: 'error', text: 'Draft needs at least one emission.' });

    setSavingDraft(true);
    setMessage(null);

    try {
      // Get subtask types for the selected snapshot to map names to IDs
      const snapshotSubtaskTypes = subtaskTypes.filter(st => st.snapshotId === selectedSnapshotId);

      // Map emissions: if subtaskTypeId is missing, look it up by subtaskName
      const mappedEmissions = draftRule.emissions.map((e, idx) => {
        let subtaskTypeId = e.subtaskTypeId;

        // If subtaskTypeId is missing or empty, try to find it by subtaskName
        if (!subtaskTypeId && e.subtaskName) {
          const found = snapshotSubtaskTypes.find(st => st.name === e.subtaskName);
          if (found) {
            subtaskTypeId = found.id;
          } else {
            throw new Error(
              `Emission ${idx + 1}: Could not find subtask type "${e.subtaskName}" for snapshot ${selectedSnapshotId}. Please ensure the subtask type exists.`
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

      // Generate a rule source description - database requires rule_source to be NOT NULL
      // Prefer original prompt if available, otherwise generate from rule structure
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
        snapshotId: selectedSnapshotId,
        ruleName: draftRule.ruleName,
        priority: draftRule.priority ?? 100,
        engine: draftRule.engine,
        ruleSource: ruleSource, // Required by database - generate from rule if not provided
        conditions: draftRule.conditions.map(c => ({
          conditionType: c.conditionType,
          conditionKey: c.conditionKey,
          operator: c.operator,
          value: c.value,
        })),
        emissions: mappedEmissions,
      });

      // hydrate to satisfy UI types (ruleId in condition/emission)
      const hydratedCreated = hydrateRule(created);

      setRules(prev => [...prev, hydratedCreated]);
      setDraftRule(null);
      setAiPrompt('');
      showMsg({ type: 'success', text: `Saved rule "${hydratedCreated.ruleName}".` });
    } catch (e: any) {
      showMsg({ type: 'error', text: e?.message || 'Failed to save rule.' });
    } finally {
      setSavingDraft(false);
    }
  };

  // ---- delete (UI only unless you add a delete endpoint) ----
  const handleDeleteRuleUiOnly = (ruleId: string) => {
    setRules(prev => prev.filter(r => r.id !== ruleId));
    showMsg({ type: 'info', text: 'Removed from UI. Hook up delete endpoint to persist.' }, 3000);
  };

  const messageStyle =
    message?.type === 'success'
      ? 'bg-green-50 text-green-800 border-green-200'
      : message?.type === 'error'
      ? 'bg-red-50 text-red-800 border-red-200'
      : 'bg-blue-50 text-blue-800 border-blue-200';

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-gray-500">Loading policy data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col space-y-6">
      {/* Header */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {/* env */}
            <select
              className="block w-40 px-3 py-2 text-sm border-gray-300 rounded-md border focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={selectedEnv}
              onChange={(e) => setSelectedEnv(e.target.value as PkgEnv)}
            >
              <option value={PkgEnv.PROD}>prod</option>
              <option value={PkgEnv.STAGING}>staging</option>
              <option value={PkgEnv.DEV}>dev</option>
            </select>

            {/* snapshot */}
            <select
              className="block min-w-[320px] px-3 py-2 text-sm border-gray-300 rounded-md border focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={selectedSnapshotId || ''}
              onChange={(e) => setSelectedSnapshotId(Number(e.target.value))}
            >
              {envSnapshots.length === 0 && <option value="">No snapshots in this env</option>}
              {envSnapshots.map(s => (
                <option key={s.id} value={s.id}>
                  {s.version} {s.isActive ? '★' : ''} · {s.stage} · id={s.id}
                </option>
              ))}
            </select>

            {/* snapshot badge */}
            {selectedSnapshot && (
              <div className="text-xs text-gray-500">
                Selected: <span className="font-mono">{selectedSnapshot.version}</span>{' '}
                {selectedSnapshot.isActive ? <span className="ml-2 text-green-700 font-semibold">ACTIVE</span> : null}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReload}
              disabled={reloading}
              className={`inline-flex items-center px-3 py-2 text-sm rounded-md border ${
                reloading ? 'bg-gray-100 text-gray-400' : 'bg-white hover:bg-gray-50 text-gray-700'
              }`}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${reloading ? 'animate-spin' : ''}`} />
              Reload
            </button>

            <button
              onClick={() =>
                showMsg({
                  type: 'info',
                  text: 'Commit Snapshot is a UI stub here. Wire it to promote/validate/activate endpoints.',
                })
              }
              className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
            >
              <Save className="h-4 w-4 mr-2" />
              Commit Snapshot
            </button>
          </div>
        </div>

        {message && <div className={`p-3 rounded-lg text-sm border ${messageStyle}`}>{message.text}</div>}
      </div>

      {/* AI Assistant */}
      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 p-6 rounded-lg shadow-sm border border-indigo-100">
        <div className="flex items-start space-x-4">
          <div className="p-2 bg-indigo-600 rounded-lg shadow-lg">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-medium text-gray-900">AI Policy Architect</h3>
            <p className="text-sm text-gray-500 mb-4">
              Generate a draft rule for the selected snapshot. You’ll review it before saving.
            </p>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g., If temperature > 28 in server room, order emergency cooling."
                className="flex-1 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-3 border"
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              />
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !aiPrompt.trim() || !selectedSnapshotId}
                className={`inline-flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${
                  isGenerating || !aiPrompt.trim() || !selectedSnapshotId
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {isGenerating ? 'Thinking…' : 'Generate Draft'}
              </button>
            </div>

            {/* Draft preview */}
            {draftRule && (
              <div className="mt-4 bg-white border border-indigo-100 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-indigo-700 uppercase">Draft Rule</div>
                    <div className="font-semibold text-gray-900 truncate">{draftRule.ruleName}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      engine: <span className="font-mono">{String(draftRule.engine)}</span> · priority:{' '}
                      <span className="font-mono">{draftRule.priority}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setDraftRule(null)}
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
                      {savingDraft ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="text-xs font-semibold text-gray-700 mb-1">
                    Conditions ({draftRule.conditions.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {draftRule.conditions.map((c, i) => (
                      <span key={i} className="bg-gray-100 px-2 py-1 rounded text-xs">
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
                    {draftRule.emissions.map((e, i) => (
                      <span
                        key={i}
                        className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs border border-blue-100"
                      >
                        {e.relationshipType} → {e.subtaskName || e.subtaskTypeId}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search + Rule List */}
      <div className="bg-white shadow sm:rounded-md flex-1 overflow-hidden border border-gray-100">
        <div className="p-4 border-b border-gray-200 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="h-4 w-4 text-gray-400 absolute left-3 top-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rule name, conditions, emissions…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="text-xs text-gray-500 whitespace-nowrap">{filteredRules.length} rule(s)</div>
        </div>

        <div className="overflow-y-auto h-full">
          <ul className="divide-y divide-gray-200">
            {filteredRules.map(rule => (
              <li key={rule.id}>
                <div className="px-4 py-4 sm:px-6 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-indigo-600 truncate">{rule.ruleName}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        engine: <span className="font-mono">{String(rule.engine)}</span> · priority:{' '}
                        <span className="font-mono">{rule.priority}</span>
                        {rule.disabled ? <span className="ml-2 text-red-600 font-semibold">DISABLED</span> : null}
                      </p>
                    </div>

                    <button
                      onClick={() => handleDeleteRuleUiOnly(rule.id)}
                      className="text-red-400 hover:text-red-600"
                      title="Remove (UI only)"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
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
                        {rule.emissions.map((e, i) => (
                          <span
                            key={i}
                            className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs border border-blue-100"
                          >
                            {e.relationshipType} → {e.subtaskName || e.subtaskTypeId}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))}

            {selectedSnapshotId && filteredRules.length === 0 && (
              <li className="p-10 text-center text-gray-400">
                No rules found for this snapshot{search.trim() ? ' (after filtering)' : ''}.
              </li>
            )}

            {!selectedSnapshotId && (
              <li className="p-10 text-center text-gray-400">Select a snapshot to view rules.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
};
