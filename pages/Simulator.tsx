import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  RotateCcw,
  CheckCircle,
  XCircle,
  Zap,
  Layers,
  Server,
  Copy,
  AlertTriangle,
  Filter,
} from 'lucide-react';

import { getRules, getFacts, getUnifiedMemory, getSnapshots } from '../mockData';
import { hydrateContext, HydratedContext, runSimulation } from '../services/pkgEngine';
import { startValidationRun, finishValidationRun } from '../services/validationService';
import {
  SimulationResult,
  Snapshot,
  Rule,
  Fact,
  UnifiedMemoryItem,
  PkgEnv,
} from '../types';

type KV = Record<string, any>;

type RunRecord = {
  id: string;
  snapshotId: number;
  snapshotVersion?: string;
  env?: string;
  createdAt: string;
  tags: KV;
  signals: KV;
  hydrationLogs: string[];
  results: SimulationResult[];
  summary: {
    totalRules: number;
    evaluated: number;
    triggered: number;
    emissions: number;
  };
};

const nowId = () =>
  `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

function parseKV(input: string, mode: 'string' | 'numberish' = 'string') {
  // Parses "a=1, b=true, c=hello" -> object
  // - ignores empty tokens
  // - supports ":" too (a:1)
  // - supports quoted values "hello, world"
  const out: KV = {};
  const errors: string[] = [];

  const raw = input.trim();
  if (!raw) return { value: out, errors };

  // Split on commas, but keep it simple (users can paste JSON below if needed)
  const tokens = raw
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const sepIdx = token.indexOf('=');
    const altIdx = token.indexOf(':');
    const idx =
      sepIdx >= 0 && altIdx >= 0 ? Math.min(sepIdx, altIdx) : Math.max(sepIdx, altIdx);

    if (idx <= 0) {
      errors.push(`Invalid pair "${token}". Use key=value.`);
      continue;
    }

    const k = token.slice(0, idx).trim();
    let v = token.slice(idx + 1).trim();

    if (!k) {
      errors.push(`Missing key in "${token}".`);
      continue;
    }

    // Strip surrounding quotes
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }

    if (mode === 'numberish') {
      // boolean
      if (v === 'true') out[k] = true;
      else if (v === 'false') out[k] = false;
      // null
      else if (v === 'null') out[k] = null;
      // number
      else if (!Number.isNaN(Number(v)) && v !== '') out[k] = Number(v);
      else out[k] = v;
    } else {
      out[k] = v;
    }
  }

  return { value: out, errors };
}

function safeJsonParse(input: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Invalid JSON' };
  }
}

const PRESETS = [
  {
    name: 'Smoke detected (high confidence)',
    tags: 'event_type=smoke_detected, room=1208',
    signals: 'confidence=0.95',
  },
  {
    name: 'Toaster false-positive pattern',
    tags: 'event_type=smoke_detected, room=standard_room',
    signals: 'confidence=0.62, source=toaster_oven',
  },
  {
    name: 'HVAC overheating',
    tags: 'event_type=temperature_alert, room=1208',
    signals: 'temp=29.5, confidence=0.90',
  },
];

export const Simulator: React.FC = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [unifiedMemory, setUnifiedMemory] = useState<UnifiedMemoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtering / selection
  const [env, setEnv] = useState<PkgEnv>(PkgEnv.PROD);
  const [snapshotId, setSnapshotId] = useState<number | null>(null);

  // Input context
  const [tagsText, setTagsText] = useState(PRESETS[0].tags);
  const [signalsText, setSignalsText] = useState(PRESETS[0].signals);

  // Optional advanced JSON editor
  const [advancedMode, setAdvancedMode] = useState(false);
  const [tagsJsonText, setTagsJsonText] = useState<string>('{}');
  const [signalsJsonText, setSignalsJsonText] = useState<string>('{}');

  // UI state
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [hydrationPreview, setHydrationPreview] = useState<string[]>([]);
  const [runHistory, setRunHistory] = useState<RunRecord[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    const load = async () => {
      setLoading(true);
      try {
        const [snaps, ruls, fcts, mem] = await Promise.all([
          getSnapshots(),
          getRules(),
          getFacts(),
          getUnifiedMemory(),
        ]);

        if (!isMounted.current) return;

        setSnapshots(snaps);
        setRules(ruls);
        setFacts(fcts);
        setUnifiedMemory(mem);

        // Default snapshot: active snapshot in env → latest in env → first
        const activeInEnv = snaps.find(s => s.env === env && s.isActive);
        const latestInEnv = [...snaps]
          .filter(s => s.env === env)
          .sort((a, b) => {
            const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
            const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
            if (tb !== ta) return tb - ta;
            return (b.id ?? 0) - (a.id ?? 0);
          })[0];

        const fallback = activeInEnv || latestInEnv || snaps[0] || null;
        setSnapshotId(fallback?.id ?? null);
      } catch (e) {
        console.error('Error loading simulator data:', e);
      } finally {
        if (isMounted.current) setLoading(false);
      }
    };

    load();

    return () => {
      isMounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If env changes, pick a sensible snapshot in that env (don’t keep an invalid id)
  useEffect(() => {
    if (!snapshots.length) return;

    const inEnv = snapshots.filter(s => s.env === env);
    if (!inEnv.length) {
      setSnapshotId(null);
      return;
    }

    const current = snapshotId ? snapshots.find(s => s.id === snapshotId) : null;
    if (current && current.env === env) return;

    const activeInEnv = inEnv.find(s => s.isActive);
    const latestInEnv = [...inEnv].sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      if (tb !== ta) return tb - ta;
      return (b.id ?? 0) - (a.id ?? 0);
    })[0];

    setSnapshotId((activeInEnv || latestInEnv).id);
    // Clear preview/run context to avoid confusing “stale run”
    setHydrationPreview([]);
    setParseErrors([]);
    setActiveRunId(null);
  }, [env, snapshots]); // intentionally not depending on snapshotId

  const selectedSnapshot = useMemo(
    () => (snapshotId ? snapshots.find(s => s.id === snapshotId) : null),
    [snapshotId, snapshots],
  );

  const snapshotRules = useMemo(
    () => (snapshotId ? rules.filter(r => r.snapshotId === snapshotId) : []),
    [rules, snapshotId],
  );

  const snapshotFacts = useMemo(
    () => (snapshotId ? facts.filter(f => f.snapshotId === snapshotId) : facts),
    [facts, snapshotId],
  );

  const handleApplyPreset = (idx: number) => {
    const p = PRESETS[idx];
    setTagsText(p.tags);
    setSignalsText(p.signals);
    setParseErrors([]);
    setHydrationPreview([]);
  };

  const computeContext = (): { ok: true; tags: KV; signals: KV; hydrated: HydratedContext } | { ok: false; errors: string[] } => {
    const errors: string[] = [];

    let tags: KV = {};
    let signals: KV = {};

    if (advancedMode) {
      const t = safeJsonParse(tagsJsonText);
      const s = safeJsonParse(signalsJsonText);
      if (t.ok === false) errors.push(`Tags JSON error: ${t.error}`);
      else tags = t.value ?? {};
      if (s.ok === false) errors.push(`Signals JSON error: ${s.error}`);
      else signals = s.value ?? {};
    } else {
      const pt = parseKV(tagsText, 'string');
      const ps = parseKV(signalsText, 'numberish');
      tags = pt.value;
      signals = ps.value;
      errors.push(...pt.errors, ...ps.errors);
    }

    if (!snapshotId) errors.push('Select a snapshot to simulate.');
    if (errors.length) return { ok: false, errors };

    const hydrated = hydrateContext(tags, signals, snapshotFacts, unifiedMemory);
    return { ok: true, tags, signals, hydrated };
  };

  const handlePreviewHydration = () => {
    const ctx = computeContext();
    if (ctx.ok === false) {
      setParseErrors(ctx.errors);
      setHydrationPreview([]);
      return;
    }
    setParseErrors([]);
    setHydrationPreview(ctx.hydrated.hydrationLogs || []);
  };

  const handleRun = async () => {
    const ctx = computeContext();
    if (ctx.ok === false) {
      setParseErrors(ctx.errors);
      setHydrationPreview([]);
      return;
    }

    const { hydrated, tags, signals } = ctx;
    setParseErrors([]);
    setHydrationPreview(hydrated.hydrationLogs || []);

    // Start validation run persistence
    let validationRunId: number | null = null;
    const startTime = performance.now();
    try {
      if (snapshotId) {
        const runStart = await startValidationRun(snapshotId);
        validationRunId = runStart.id;
      }
    } catch (error) {
      console.error('Failed to start validation run:', error);
      // Continue with simulation even if persistence fails
    }

    // Run simulation
    const hydrationTime = performance.now() - startTime;
    const executionStartTime = performance.now();
    const results = runSimulation(snapshotRules, hydrated);
    const executionTime = performance.now() - executionStartTime;
    const totalTime = performance.now() - startTime;

    const triggered = results.filter(r => r.success);
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const emissions = triggered.reduce((acc, r) => acc + (r.emissions?.length || 0), 0);

    // Collect all emissions for report
    const allEmissions = triggered.flatMap(r => 
      r.emissions.map(e => ({
        rule: r.ruleName,
        subtask: e.subtaskName || e.subtaskTypeId,
        params: e.params,
      }))
    );

    // Collect all logs
    const allLogs = [
      ...(hydrated.hydrationLogs || []),
      ...results.flatMap(r => r.logs || []),
    ];

    // Calculate simulation score (simple: passed / total)
    const simulationScore = results.length > 0 ? passed / results.length : 0;

    // Detect conflicts (rules that both triggered but might conflict)
    const conflicts: string[] = [];
    if (triggered.length > 1) {
      // Simple conflict detection: if multiple rules trigger, note potential conflicts
      const triggeredRuleNames = triggered.map(r => r.ruleName);
      if (triggeredRuleNames.length > 1) {
        // This is a simplified conflict detection - in real system, you'd check rule priorities and emissions
        conflicts.push(`Multiple rules triggered: ${triggeredRuleNames.join(', ')}`);
      }
    }

    const record: RunRecord = {
      id: nowId(),
      snapshotId: snapshotId!,
      snapshotVersion: selectedSnapshot?.version,
      env: selectedSnapshot?.env,
      createdAt: new Date().toISOString(),
      tags,
      signals,
      hydrationLogs: hydrated.hydrationLogs || [],
      results,
      summary: {
        totalRules: snapshotRules.length,
        evaluated: results.length,
        triggered: triggered.length,
        emissions,
      },
    };

    setRunHistory(prev => [record, ...prev]);
    setActiveRunId(record.id);

    // Finish validation run persistence
    if (validationRunId !== null) {
      try {
        await finishValidationRun({
          id: validationRunId,
          success: failed === 0,
          report: {
            type: 'simulation',
            engine: 'wasm', // Default to wasm for now
            rulesEvaluated: results.length,
            rulesTriggered: triggered.length,
            passed,
            failed,
            conflicts,
            simulationScore,
            timingMs: {
              total: Math.round(totalTime),
              hydration: Math.round(hydrationTime),
              execution: Math.round(executionTime),
            },
            emissions: allEmissions,
            logs: allLogs,
          },
        });
      } catch (error) {
        console.error('Failed to finish validation run:', error);
        // Don't block UI - simulation already completed
      }
    }
  };

  const handleClearRuns = () => {
    setRunHistory([]);
    setActiveRunId(null);
    setHydrationPreview([]);
    setParseErrors([]);
  };

  const handleHotSwap = () => {
    // simulate “switch to next snapshot in env” (more realistic than global)
    const inEnv = snapshots.filter(s => s.env === env);
    if (inEnv.length < 2 || !snapshotId) return;

    const idx = inEnv.findIndex(s => s.id === snapshotId);
    const next = inEnv[(idx + 1) % inEnv.length];
    setSnapshotId(next.id);

    // record a lightweight “run-like” marker in history
    const record: RunRecord = {
      id: nowId(),
      snapshotId: next.id,
      snapshotVersion: next.version,
      env: next.env,
      createdAt: new Date().toISOString(),
      tags: {},
      signals: {},
      hydrationLogs: [`[HOT-SWAP] Active snapshot switched to ${next.version} (${next.env})`],
      results: [],
      summary: { totalRules: 0, evaluated: 0, triggered: 0, emissions: 0 },
    };
    setRunHistory(prev => [record, ...prev]);
    setActiveRunId(record.id);
  };

  const activeRun = useMemo(
    () => (activeRunId ? runHistory.find(r => r.id === activeRunId) : runHistory[0] || null),
    [activeRunId, runHistory],
  );

  const handleCopyActiveRun = async () => {
    if (!activeRun) return;
    const payload = {
      id: activeRun.id,
      snapshotId: activeRun.snapshotId,
      snapshotVersion: activeRun.snapshotVersion,
      env: activeRun.env,
      createdAt: activeRun.createdAt,
      tags: activeRun.tags,
      signals: activeRun.signals,
      summary: activeRun.summary,
      hydrationLogs: activeRun.hydrationLogs,
      results: activeRun.results,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="h-[calc(100vh-140px)] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-gray-500">Loading simulator data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-140px)]">
      {/* Left: Configuration */}
      <div className="lg:col-span-1 bg-white rounded-lg shadow flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-800">Simulator</h3>
            <p className="text-xs text-gray-500">Hydrate context → evaluate snapshot rules → inspect emissions</p>
          </div>
          <button
            onClick={handleHotSwap}
            className="p-2 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded transition-colors"
            title="Simulate Redis hot-swap (next snapshot in current env)"
          >
            <Zap className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 flex-1 overflow-y-auto">
          {/* Env + Snapshot */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                <span className="inline-flex items-center gap-1">
                  <Filter className="h-3 w-3" /> Environment
                </span>
              </label>
              <select
                value={env}
                onChange={(e) => setEnv(e.target.value as PkgEnv)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value={PkgEnv.PROD}>prod</option>
                <option value={PkgEnv.STAGING}>staging</option>
                <option value={PkgEnv.DEV}>dev</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Snapshot</label>
              <select
                value={snapshotId ?? ''}
                onChange={(e) => setSnapshotId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="" disabled>Select snapshot…</option>
                {snapshots
                  .filter(s => s.env === env)
                  .sort((a, b) => {
                    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
                    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
                    if (tb !== ta) return tb - ta;
                    return (b.id ?? 0) - (a.id ?? 0);
                  })
                  .map(s => (
                    <option key={s.id} value={s.id}>
                      {s.isActive ? '★ ' : ''}{s.version}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {selectedSnapshot && (
            <div className="p-3 rounded-lg border bg-slate-50">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500">Selected Snapshot</div>
                  <div className="font-mono text-sm font-semibold text-slate-900">{selectedSnapshot.version}</div>
                  <div className="text-[11px] text-slate-500">
                    rules: {snapshotRules.length} • facts: {snapshotFacts.length}
                  </div>
                </div>
                <div className="text-[11px] text-slate-500 text-right">
                  <div>{selectedSnapshot.env}</div>
                  <div>{selectedSnapshot.isActive ? 'active' : 'inactive'}</div>
                </div>
              </div>
            </div>
          )}

          {/* Presets */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">Presets</label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p, i) => (
                <button
                  key={p.name}
                  onClick={() => handleApplyPreset(i)}
                  className="text-xs px-2.5 py-1.5 rounded border border-gray-200 hover:bg-gray-50"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Advanced mode toggle */}
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-gray-700">Context Input</div>
            <label className="text-xs text-gray-600 flex items-center gap-2">
              <input
                type="checkbox"
                checked={advancedMode}
                onChange={(e) => setAdvancedMode(e.target.checked)}
              />
              Advanced JSON
            </label>
          </div>

          {/* Inputs */}
          {!advancedMode ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Incoming Tags (string)</label>
                <textarea
                  className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm border p-2 h-20 font-mono text-xs"
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="key=value, key2=value2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sensor Signals (typed)</label>
                <textarea
                  className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm border p-2 h-20 font-mono text-xs"
                  value={signalsText}
                  onChange={(e) => setSignalsText(e.target.value)}
                  placeholder="confidence=0.95, temp=29.5, source=toaster"
                />
                <p className="mt-1 text-[11px] text-gray-500">Signals auto-cast numbers/booleans/null when possible.</p>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tags (JSON)</label>
                <textarea
                  className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm border p-2 h-24 font-mono text-xs"
                  value={tagsJsonText}
                  onChange={(e) => setTagsJsonText(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Signals (JSON)</label>
                <textarea
                  className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm border p-2 h-24 font-mono text-xs"
                  value={signalsJsonText}
                  onChange={(e) => setSignalsJsonText(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Errors */}
          {parseErrors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-red-800 text-xs font-semibold mb-2">
                <AlertTriangle className="h-4 w-4" />
                Input errors
              </div>
              <ul className="list-disc pl-5 text-xs text-red-700 space-y-1">
                {parseErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Hydration preview */}
          {(hydrationPreview?.length ?? 0) > 0 && (
            <div className="bg-slate-50 p-3 rounded border border-slate-200">
              <div className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center">
                <Layers className="h-3 w-3 mr-1" /> Context Hydration
              </div>
              <div className="space-y-1">
                {hydrationPreview.map((log, i) => (
                  <div key={i} className="text-xs text-slate-600 font-mono break-words border-l-2 border-indigo-200 pl-2">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex gap-2">
          <button
            onClick={handlePreviewHydration}
            className="inline-flex justify-center items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
            title="Preview hydration logs without running rules"
          >
            <Layers className="h-4 w-4 mr-2" />
            Preview
          </button>

          <button
            onClick={handleRun}
            className="flex-1 inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
          >
            <Play className="h-4 w-4 mr-2" />
            Evaluate
          </button>

          <button
            onClick={handleClearRuns}
            className="inline-flex justify-center items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
            title="Clear run history"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Right: Runs + Results */}
      <div className="lg:col-span-2 bg-white rounded-lg shadow flex flex-col h-full overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-800">Execution</h3>
            <p className="text-xs text-gray-500">
              Runs: {runHistory.length} {activeRun?.summary ? `• Triggered: ${activeRun.summary.triggered}` : ''}
            </p>
          </div>
          <button
            onClick={handleCopyActiveRun}
            disabled={!activeRun}
            className="inline-flex items-center px-3 py-2 rounded-md border border-gray-200 hover:bg-gray-50 text-sm disabled:opacity-50"
            title="Copy active run as JSON"
          >
            <Copy className="h-4 w-4 mr-2" />
            Copy JSON
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3">
          {/* Run list */}
          <div className="border-r border-gray-200 bg-white overflow-y-auto">
            {runHistory.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-400 p-6">
                <Server className="h-10 w-10 mb-3 opacity-40" />
                <p className="text-sm text-center">No runs yet. Evaluate to generate an execution plan.</p>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {runHistory.map(r => {
                  const isActive = r.id === activeRunId || (!activeRunId && runHistory[0]?.id === r.id);
                  return (
                    <button
                      key={r.id}
                      onClick={() => setActiveRunId(r.id)}
                      className={`w-full text-left p-3 rounded border transition-colors ${
                        isActive ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-gray-500">
                          {new Date(r.createdAt).toLocaleTimeString()}
                        </div>
                        <div className="text-[11px] text-gray-500 font-mono">
                          {r.env}
                        </div>
                      </div>
                      <div className="mt-1 text-sm font-semibold text-gray-900 font-mono truncate">
                        {r.snapshotVersion || `snapshot:${r.snapshotId}`}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        triggered {r.summary.triggered} / {r.summary.totalRules} • emissions {r.summary.emissions}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Run detail */}
          <div className="lg:col-span-2 bg-slate-900 overflow-y-auto p-5 font-mono text-sm">
            {!activeRun ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500">
                <Server className="h-12 w-12 mb-4 opacity-50" />
                <p>Waiting for events...</p>
              </div>
            ) : activeRun.results.length === 0 && activeRun.hydrationLogs.length === 1 && activeRun.hydrationLogs[0].startsWith('[HOT-SWAP]') ? (
              <div className="space-y-2 text-slate-300">
                <div className="text-indigo-300 font-semibold">Hot-swap event</div>
                <div className="text-xs text-slate-400">{activeRun.hydrationLogs[0]}</div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Summary header */}
                <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-400">Snapshot</div>
                      <div className="text-slate-100 font-bold">{activeRun.snapshotVersion}</div>
                      <div className="text-xs text-slate-500 mt-1">
                        rules {activeRun.summary.totalRules} • triggered {activeRun.summary.triggered} • emissions {activeRun.summary.emissions}
                      </div>
                    </div>
                    <div className="text-right text-xs text-slate-400">
                      <div>{new Date(activeRun.createdAt).toLocaleString()}</div>
                      <div className="font-mono">{activeRun.id}</div>
                    </div>
                  </div>
                </div>

                {/* Hydration logs */}
                {activeRun.hydrationLogs.length > 0 && (
                  <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                    <div className="text-indigo-300 text-xs font-semibold mb-2 flex items-center">
                      <Layers className="h-4 w-4 mr-2" />
                      Hydration
                    </div>
                    <div className="space-y-1">
                      {activeRun.hydrationLogs.map((l, i) => (
                        <div key={i} className="text-xs text-slate-400 border-l-2 border-indigo-500/40 pl-2">
                          {l}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Rule results */}
                {activeRun.results.map((log, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded border-l-4 ${
                      log.success ? 'bg-slate-800 border-green-500' : 'bg-slate-800 border-slate-600 opacity-70'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`font-bold ${log.success ? 'text-green-300' : 'text-slate-300'}`}>
                        {log.ruleName}
                      </span>
                      {log.success ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-slate-500" />
                      )}
                    </div>

                    {log.logs?.length ? (
                      <div className="space-y-1">
                        {log.logs.map((l, i) => (
                          <div key={i} className="text-slate-400 text-xs">
                            {l}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 italic">No evaluation logs</div>
                    )}

                    {log.success && log.emissions?.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-700">
                        <div className="text-indigo-300 text-xs font-semibold mb-2">EMISSIONS (PROTO-PLAN)</div>
                        {log.emissions.map((e, i) => (
                          <div key={i} className="text-indigo-200 text-xs pl-2 mb-2">
                            • {e.relationshipType} →{' '}
                            <span className="text-white font-bold">{e.subtaskName}</span>
                            {e.params && (
                              <div className="text-slate-500 pl-4 break-words">
                                {JSON.stringify(e.params)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
