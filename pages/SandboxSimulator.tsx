import React, { useState } from 'react';
import { Layers, Play, ScanLine, ShieldCheck, TriangleAlert, Zap } from 'lucide-react';

const PRESETS = [
  {
    name: 'Vault Release Without Approval',
    tags: 'zone=VAULT, release, high_value, seal, custody',
    signals: 'identity_verified=0, release_window_open=0, seal_integrity=1',
    description: 'Tests deny-by-default release behavior when approval and identity are missing.',
  },
  {
    name: 'Transfer Route Drift',
    tags: 'zone=TRANSFER, actuator, route, handoff, anomaly',
    signals: 'identity_verified=1, route_drift=0.8, seal_integrity=0.98',
    description: 'Verifies that route anomalies trigger containment and control-plane notification.',
  },
  {
    name: 'Quarantine Seal Break',
    tags: 'zone=QUARANTINE, seal, anomaly, custody',
    signals: 'identity_verified=1, seal_integrity=0.2, release_window_open=0',
    description: 'Simulates broken-seal intake into quarantine before irreversible movement.',
  },
];

export const Simulator: React.FC = () => {
  const [tagsText, setTagsText] = useState(PRESETS[0].tags);
  const [signalsText, setSignalsText] = useState(PRESETS[0].signals);
  const [runHistory, setRunHistory] = useState<any[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);

  const systemFacts = [
    'Vault release requires verified identity and a live release window.',
    'Broken seals are quarantined before transfer.',
    'Route drift above 0.5 triggers containment.',
    'Playback evidence must be captured after successful handoff.',
    'Unknown actors never receive direct actuator authority.',
  ];

  const handleRunSimulation = async () => {
    setIsSimulating(true);
    setTimeout(() => {
      const critical = signalsText.includes('seal_integrity=0.2') || signalsText.includes('route_drift=0.8');
      const blocked = signalsText.includes('identity_verified=0') || critical;
      const result = {
        id: Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        triggered: critical ? 'quarantine_broken_seal' : blocked ? 'deny_unknown_actor_release' : 'route_robotic_handoff_under_policy',
        emissions: critical
          ? ['quarantine_asset_lot', 'capture_playback_evidence']
          : blocked
            ? ['lock_zone_access', 'dispatch_operator_review']
            : ['verify_identity_and_provenance', 'route_robotic_handoff'],
        status: blocked ? 'BLOCKED' : 'ALLOWED',
      };
      setRunHistory((previous) => [result, ...previous]);
      setIsSimulating(false);
    }, 700);
  };

  return (
    <div className="grid grid-cols-12 gap-6 p-6 bg-slate-50 min-h-screen font-sans">
      <div className="col-span-12 lg:col-span-4 space-y-4">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
          <div className="flex items-center gap-2 mb-6">
            <ShieldCheck className="h-5 w-5 text-indigo-600" />
            <h2 className="font-bold text-slate-800">Scenario Configuration</h2>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => {
                    setTagsText(preset.tags);
                    setSignalsText(preset.signals);
                  }}
                  className="text-[10px] font-bold p-3 rounded-lg border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 transition-all text-slate-600 text-left"
                >
                  {preset.name}
                </button>
              ))}
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase">Tags</label>
              <textarea
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                className="w-full mt-1 bg-slate-900 text-indigo-300 font-mono p-3 rounded-lg text-xs h-24"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase">Signals</label>
              <textarea
                value={signalsText}
                onChange={(event) => setSignalsText(event.target.value)}
                className="w-full mt-1 bg-slate-900 text-emerald-400 font-mono p-3 rounded-lg text-xs h-24"
              />
            </div>

            <button
              onClick={handleRunSimulation}
              className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700"
            >
              {isSimulating ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
              Execute Simulation
            </button>
          </div>
        </div>

        <div className="bg-slate-900 p-6 rounded-2xl text-white">
          <h3 className="text-xs font-bold text-slate-500 uppercase mb-4">Runtime Guardrails</h3>
          <ul className="space-y-2">
            {systemFacts.map((fact) => (
              <li key={fact} className="text-[11px] flex gap-2 text-slate-400">
                <span className="text-indigo-500">#</span>
                {fact}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="col-span-12 lg:col-span-8 space-y-4">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 min-h-[500px] flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Layers className="h-5 w-5 text-indigo-500" />
              Execution Plan
            </h3>
            <button onClick={() => setRunHistory([])} className="text-slate-400 hover:text-rose-500">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {runHistory.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
              <ScanLine className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm">Enter scenario tags and signals to begin.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {runHistory.map((run) => (
                <div key={run.id} className="p-4 rounded-2xl border border-slate-100 bg-slate-50">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[10px] font-mono text-slate-400">[{run.timestamp}]</span>
                      <h4 className="font-bold text-slate-800 mt-1">{run.triggered}</h4>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-[10px] font-bold ${
                        run.status === 'ALLOWED' ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {run.status}
                    </span>
                  </div>

                  <div className="mt-4 flex gap-2 flex-wrap">
                    {run.emissions.map((emission: string) => (
                      <div
                        key={emission}
                        className="flex items-center gap-1 bg-white px-3 py-1 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-600"
                      >
                        {emission.includes('quarantine') ? (
                          <TriangleAlert className="h-3 w-3 text-rose-500" />
                        ) : emission.includes('route') ? (
                          <Zap className="h-3 w-3 text-indigo-500" />
                        ) : (
                          <ShieldCheck className="h-3 w-3 text-emerald-500" />
                        )}
                        {emission}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const RefreshCw = ({ className }: { className?: string }) => (
  <svg
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);
