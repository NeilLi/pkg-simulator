import React, { useState } from 'react';
import { 
  Play, Zap, Layers, ShieldCheck 
} from 'lucide-react';
import { PkgEnv } from '../types';

// Scenario-Driven Presets for 2030+ Hotel
const PRESETS = [
  {
    name: 'KIDS: Late Night Access',
    tags: 'zone=KIDS, persona=guest, action=entry',
    signals: 'hour=23, age_rating=8, confidence=1.0',
    description: 'Testing safety lock rules for Magic Atelier after hours.'
  },
  {
    name: 'WEAR: Design Approval',
    tags: 'zone=WEAR, action=generate_design, type=dress',
    signals: 'risk_score=0.1, complexity=high',
    description: 'Verifying if rendering pipeline subtasks trigger correctly.'
  },
  {
    name: 'INFRA: Emergency HVAC',
    tags: 'system=hvac, event=smoke_detected, zone=GIFT',
    signals: 'severity=0.9, air_quality=0.2',
    description: 'Simulating emergency isolation protocols.'
  }
];

export const Simulator: React.FC = () => {
  const [snapshotId, setSnapshotId] = useState<number | null>(1);
  const [env, setEnv] = useState<PkgEnv>(PkgEnv.DEV);
  const [tagsText, setTagsText] = useState(PRESETS[0].tags);
  const [signalsText, setSignalsText] = useState(PRESETS[0].signals);
  const [runHistory, setRunHistory] = useState<any[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);

  // Core Facts (Less than 10 items for the sandbox)
  const systemFacts = [
    "HVAC Operating Range: 18-28°C",
    "KIDS Zone requires 12x air exchange during occupancy",
    "Elevator Priority: 1. Emergency, 2. VIP, 3. Standard",
    "Doors fail-secure in GIFT, fail-safe in KIDS",
    "Rendering Pipeline requires 300DPI for WEAR studio"
  ];

  const handleRunSimulation = async () => {
    setIsSimulating(true);
    // 1. Parse Inputs -> 2. Hydrate with Facts -> 3. Run WASM Logic
    setTimeout(() => {
      const result = {
        id: Date.now(),
        timestamp: new Date().toLocaleTimeString(),
        triggered: tagsText.includes('KIDS') ? 'kids_zone_safety_monitoring' : 'smart_hvac_zone_control',
        emissions: tagsText.includes('WEAR') ? ['generate_precision_mockups'] : ['activate_zone_emergency'],
        status: tagsText.includes('severity=0.9') ? 'CRITICAL' : 'ALLOWED'
      };
      setRunHistory([result, ...runHistory]);
      setIsSimulating(false);
    }, 800);
  };

  return (
    <div className="grid grid-cols-12 gap-6 p-6 bg-slate-50 min-h-screen font-sans">
      
      {/* Left: Configuration & Input */}
      <div className="col-span-12 lg:col-span-4 space-y-4">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
          <div className="flex items-center gap-2 mb-6">
            <ShieldCheck className="h-5 w-5 text-indigo-600" />
            <h2 className="font-bold text-slate-800">Scenario Configuration</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase">Snapshot Context</label>
              <select className="w-full mt-1 bg-slate-50 border-none rounded-lg p-3 text-sm font-medium">
                <option>hotel-2030-v1.0.0 (Active)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p, i) => (
                <button 
                  key={i} 
                  onClick={() => { setTagsText(p.tags); setSignalsText(p.signals); }}
                  className="text-[10px] font-bold p-2 rounded-lg border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 transition-all text-slate-600"
                >
                  {p.name}
                </button>
              ))}
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase">Tags (JSON-like)</label>
              <textarea 
                value={tagsText} 
                onChange={e => setTagsText(e.target.value)}
                className="w-full mt-1 bg-slate-900 text-indigo-300 font-mono p-3 rounded-lg text-xs h-24" 
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase">Sensor Signals</label>
              <textarea 
                value={signalsText} 
                onChange={e => setSignalsText(e.target.value)}
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

        {/* Sandbox Facts Summary */}
        <div className="bg-slate-900 p-6 rounded-2xl text-white">
          <h3 className="text-xs font-bold text-slate-500 uppercase mb-4">Hardware Guardrails</h3>
          <ul className="space-y-2">
            {systemFacts.map((fact, i) => (
              <li key={i} className="text-[11px] flex gap-2 text-slate-400">
                <span className="text-indigo-500">#</span> {fact}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Right: Execution Log & Emission Plan */}
      <div className="col-span-12 lg:col-span-8 space-y-4">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 min-h-[500px] flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Layers className="h-5 w-5 text-indigo-500" /> Execution Plan
            </h3>
            <button onClick={() => setRunHistory([])} className="text-slate-400 hover:text-rose-500">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {runHistory.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
              <Zap className="h-12 w-12 mb-4 opacity-20" />
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
                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold ${run.status === 'ALLOWED' ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>
                      {run.status}
                    </span>
                  </div>
                  
                  <div className="mt-4 flex gap-2">
                    {run.emissions.map((em: string, i: number) => (
                      <div key={i} className="flex items-center gap-1 bg-white px-3 py-1 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-600">
                        <ArrowRight className="h-3 w-3 text-indigo-500" />
                        {em}
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
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
);

const ArrowRight = ({ className }: { className?: string }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
);