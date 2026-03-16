import React, { useMemo, useState } from 'react';
import {
  BadgeCheck,
  Bot,
  FileCheck2,
  FileLock2,
  Fingerprint,
  Play,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  GovernedExecutionResult,
  runGovernedExecutionScenario,
} from '../services/governedExecutionService';

const PRESETS = [
  {
    name: 'Vault Release Without Approval',
    tags: 'zone=VAULT, actor=ai_assistant, asset=lot_042, release, high_value, seal, custody, actuator',
    signals:
      'identity_verified=0, approval_count=1, release_window_open=0, provenance_score=0.82, seal_integrity=0.99, route_drift=0.02, payload_kg=4',
    description:
      'The assistant proposes a high-value vault release, but the operator identity and dual approval chain are incomplete.',
  },
  {
    name: 'Compliant Robotic Handoff',
    tags: 'zone=TRANSFER, destination=QUARANTINE, transition=TRANSFER->QUARANTINE, actor=governed_agent, endpoint=robotic_handler, asset=sealed_case_77, transfer, actuator, route, handoff, high_value',
    signals:
      'identity_verified=1, approval_count=2, release_window_open=1, provenance_score=0.97, seal_integrity=0.99, route_drift=0.12, payload_kg=2',
    description:
      'A governed robotic transfer is proposed with full custody evidence, valid release window, and digital twin compliant routing.',
  },
  {
    name: 'Route Drift Containment',
    tags: 'zone=TRANSFER, destination=VAULT, transition=TRANSFER->VAULT, actor=ai_assistant, endpoint=robotic_handler, asset=assay_lot_9, transfer, actuator, route, seal',
    signals:
      'identity_verified=1, approval_count=2, release_window_open=1, provenance_score=0.91, seal_integrity=0.97, route_drift=0.81, payload_kg=3',
    description:
      'An apparently valid transfer begins drifting off the modeled route and should be contained before execution.',
  },
  {
    name: 'Broken Seal Quarantine',
    tags: 'zone=QUARANTINE, actor=ai_assistant, asset=sample_case_13, quarantine, seal, custody',
    signals:
      'identity_verified=1, approval_count=1, release_window_open=0, provenance_score=0.68, seal_integrity=0.22, route_drift=0.09, payload_kg=1',
    description:
      'The assistant recommends quarantine intake because the seal scanner reports a critical integrity failure.',
  },
];

const statusClasses: Record<'completed' | 'blocked', string> = {
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  blocked: 'border-rose-200 bg-rose-50 text-rose-800',
};

const checkClasses: Record<'pass' | 'fail' | 'warn', string> = {
  pass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  fail: 'border-rose-200 bg-rose-50 text-rose-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
};

const formatSignalValue = (value: number | string) => (typeof value === 'number' ? value.toString() : value);

export const Simulator: React.FC = () => {
  const [selectedPreset, setSelectedPreset] = useState(PRESETS[1]);
  const [tagsText, setTagsText] = useState(PRESETS[1].tags);
  const [signalsText, setSignalsText] = useState(PRESETS[1].signals);
  const [runs, setRuns] = useState<GovernedExecutionResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const latestRun = runs[0];

  const baselineSummary = useMemo(() => {
    if (!latestRun) {
      return {
        snapshot: 'Pending simulation',
        governedFacts: 0,
        status: 'Run a scenario to inspect the active policy baseline and audit chain.',
      };
    }

    return {
      snapshot: latestRun.snapshot?.version || 'No active snapshot',
      governedFacts: latestRun.activeFacts.length,
      status: latestRun.complianceSummary,
    };
  }, [latestRun]);

  const handleSelectPreset = (presetName: string) => {
    const preset = PRESETS.find((item) => item.name === presetName) || PRESETS[0];
    setSelectedPreset(preset);
    setTagsText(preset.tags);
    setSignalsText(preset.signals);
  };

  const handleRun = async () => {
    if (isRunning) return;
    setIsRunning(true);
    try {
      const result = await runGovernedExecutionScenario(
        {
          label: selectedPreset.name,
          description: selectedPreset.description,
          tagsText,
          signalsText,
        },
        latestRun?.audit.hash,
      );
      setRuns((previous) => [result, ...previous]);
    } catch (error) {
      console.error('Failed to execute governed scenario:', error);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="min-h-screen rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.15),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#eef6ff_45%,_#f8fafc_100%)] p-6 text-slate-900">
      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="space-y-6">
          <div className="rounded-[24px] border border-slate-200 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">SeedCore Goal</p>
                <h2 className="text-xl font-semibold text-slate-900">Auditable Governed Execution</h2>
              </div>
            </div>

            <p className="mt-4 text-sm leading-6 text-slate-600">
              Every action should move through assistant proposal, policy evaluation, digital twin verification,
              ExecutionToken issuance, and immutable audit recording before it can execute.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Baseline Snapshot</div>
                <div className="mt-2 text-lg font-semibold text-slate-900">{baselineSummary.snapshot}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Governed Facts Used</div>
                <div className="mt-2 text-lg font-semibold text-slate-900">{baselineSummary.governedFacts}</div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              {baselineSummary.status}
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white/90 p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-sky-600" />
              <h3 className="text-lg font-semibold text-slate-900">Scenario Input</h3>
            </div>

            <div className="mt-5 grid gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => handleSelectPreset(preset.name)}
                  className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                    preset.name === selectedPreset.name
                      ? 'border-sky-300 bg-sky-50 text-sky-900'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <div className="font-semibold">{preset.name}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">{preset.description}</div>
                </button>
              ))}
            </div>

            <div className="mt-5">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Tags</label>
              <textarea
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                className="mt-2 h-28 w-full rounded-2xl border border-slate-200 bg-slate-950 p-4 font-mono text-xs text-emerald-300 outline-none ring-0"
              />
            </div>

            <div className="mt-4">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Signals</label>
              <textarea
                value={signalsText}
                onChange={(event) => setSignalsText(event.target.value)}
                className="mt-2 h-28 w-full rounded-2xl border border-slate-200 bg-slate-950 p-4 font-mono text-xs text-sky-300 outline-none ring-0"
              />
            </div>

            <button
              type="button"
              onClick={handleRun}
              disabled={isRunning}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play className="h-4 w-4" />
              {isRunning ? 'Evaluating policy pipeline...' : 'Run Governed Execution'}
            </button>
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-[24px] border border-slate-200 bg-white/90 p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Current Run</p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-900">
                  {latestRun ? latestRun.scenario.label : 'SeedCore Policy Flow'}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  {latestRun
                    ? latestRun.scenario.description
                    : 'The baseline inspection showed the simulator was missing first-class policy stages. This workbench now surfaces them directly.'}
                </p>
              </div>

              <div
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] ${
                  latestRun?.token ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                }`}
              >
                {latestRun ? (latestRun.token ? 'Execution Allowed' : 'Execution Blocked') : 'Awaiting Run'}
              </div>
            </div>

            {latestRun && (
              <div className="mt-6 grid gap-4 lg:grid-cols-5">
                {latestRun.stages.map((stage) => (
                  <div key={stage.key} className={`rounded-2xl border p-4 ${statusClasses[stage.status]}`}>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em]">{stage.title}</div>
                    <div className="mt-3 text-sm leading-6">{stage.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <div className="rounded-[24px] border border-slate-200 bg-white/90 p-6 shadow-sm">
                <div className="flex items-center gap-2">
                  <ScanSearch className="h-5 w-5 text-sky-600" />
                  <h3 className="text-lg font-semibold text-slate-900">Policy Evaluation</h3>
                </div>

                {latestRun ? (
                  <>
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                      {latestRun.policySummary}
                    </div>

                    <div className="mt-4 grid gap-3">
                      {latestRun.policyTraces.map((trace) => (
                        <div
                          key={trace.ruleName}
                          className={`rounded-2xl border p-4 ${
                            trace.outcome === 'allow'
                              ? 'border-emerald-200 bg-emerald-50'
                              : trace.outcome === 'require_control'
                                ? 'border-amber-200 bg-amber-50'
                                : 'border-rose-200 bg-rose-50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-slate-900">{trace.ruleName}</div>
                            <div className="rounded-full bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                              {trace.outcome.replace('_', ' ')}
                            </div>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-700">{trace.rationale}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {trace.emissions.map((emission) => (
                              <span
                                key={emission}
                                className="rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-600"
                              >
                                {emission}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Controls Satisfied</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {latestRun.controlsSatisfied.map((control) => (
                            <span key={control} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-900">
                              {control}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Controls Violated</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {latestRun.controlsViolated.length > 0 ? (
                            latestRun.controlsViolated.map((control) => (
                              <span key={control} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-rose-900">
                                {control}
                              </span>
                            ))
                          ) : (
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-900">
                              No violations
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
                    Run a scenario to inspect matched rules, control requirements, and emissions.
                  </div>
                )}
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-white/90 p-6 shadow-sm">
                <div className="flex items-center gap-2">
                  <Fingerprint className="h-5 w-5 text-amber-600" />
                  <h3 className="text-lg font-semibold text-slate-900">Digital Twin + Evidence</h3>
                </div>

                {latestRun ? (
                  <>
                    <div className="mt-4 grid gap-3">
                      {latestRun.digitalTwinChecks.map((check) => (
                        <div key={check.name} className={`rounded-2xl border p-4 ${checkClasses[check.status]}`}>
                          <div className="text-sm font-semibold">{check.name}</div>
                          <div className="mt-2 text-sm leading-6">{check.detail}</div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Relevant Governed Facts</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {latestRun.activeFacts.map((fact) => (
                          <span key={fact.id} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700">
                            {fact.subject}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
                    Digital twin constraint checks and evidence packs will appear here.
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[24px] border border-slate-200 bg-white/90 p-6 shadow-sm">
                <div className="flex items-center gap-2">
                  {latestRun?.token ? (
                    <BadgeCheck className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 text-rose-600" />
                  )}
                  <h3 className="text-lg font-semibold text-slate-900">ExecutionToken</h3>
                </div>

                {latestRun?.token ? (
                  <div className="mt-4 space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    <div>
                      <span className="font-semibold">Token ID:</span> {latestRun.token.id}
                    </div>
                    <div>
                      <span className="font-semibold">Scope:</span> {latestRun.token.scope}
                    </div>
                    <div>
                      <span className="font-semibold">Valid Until:</span> {new Date(latestRun.token.expiresAt).toLocaleString()}
                    </div>
                    <div className="break-all">
                      <span className="font-semibold">Digest:</span> {latestRun.token.signedDigest}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900">
                    No ExecutionToken issued. The action remains fully auditable, but SeedCore withheld permission to execute.
                  </div>
                )}
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-white/90 p-6 shadow-sm">
                <div className="flex items-center gap-2">
                  <FileLock2 className="h-5 w-5 text-slate-700" />
                  <h3 className="text-lg font-semibold text-slate-900">Immutable Audit Trail</h3>
                </div>

                {runs.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {runs.map((run) => (
                      <div key={run.audit.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{run.audit.id}</div>
                            <div className="mt-1 text-xs text-slate-500">{new Date(run.audit.timestamp).toLocaleString()}</div>
                          </div>
                          <div
                            className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                              run.audit.decision === 'ALLOWED' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {run.audit.decision}
                          </div>
                        </div>

                        <div className="mt-3 text-xs leading-5 text-slate-600">
                          <div>
                            <span className="font-semibold text-slate-700">Hash:</span> {run.audit.hash}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-700">Previous:</span> {run.audit.previousHash || 'GENESIS'}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {run.audit.evidence.map((entry) => (
                            <span key={entry} className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-slate-600">
                              {entry}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
                    Each run appends a hash-chained audit record containing the proposal, decision, evidence, and token outcome.
                  </div>
                )}
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-white/90 p-6 shadow-sm">
                <div className="flex items-center gap-2">
                  <FileCheck2 className="h-5 w-5 text-slate-700" />
                  <h3 className="text-lg font-semibold text-slate-900">Parsed Runtime Context</h3>
                </div>

                {latestRun ? (
                  <div className="mt-4 grid gap-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Tags</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {latestRun.scenario.tags.map((tag) => (
                          <span key={tag} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Signals</div>
                      <div className="mt-3 grid gap-2">
                        {Object.entries(latestRun.scenario.signals).map(([key, value]) => (
                          <div key={key} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                            <span className="font-medium text-slate-600">{key}</span>
                            <span className="font-mono text-slate-900">{formatSignalValue(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
                    Parsed tags and signal telemetry will appear here after the first governed execution run.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
