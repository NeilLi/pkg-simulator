import React, { useState } from 'react';
import {
  ArrowRightLeft,
  Archive,
  CheckCircle2,
  Database,
  Loader2,
  Lock,
  Play,
  ScanLine,
  Shield,
  TriangleAlert,
  Waypoints,
} from 'lucide-react';
import { RUNTIME_FOUNDATION_FACTS, RUNTIME_ZONES, RuntimeZoneId } from '../runtimeDomain';
import { seedDataService, SeedResult } from '../services/seedDataService';

const DEFAULT_DB_PROXY = 'http://localhost:3011';

type MemoryWriteMode = 'dry_run' | 'event_working' | 'event_then_approve';

const PROFILE_OPTIONS: Array<{
  id: RuntimeZoneId;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  helper?: string;
}> = [
  { id: 'INGRESS', name: 'Event Ingress', icon: ScanLine, color: 'text-sky-600', bg: 'bg-sky-50' },
  { id: 'VAULT', name: 'Vault Control', icon: Archive, color: 'text-amber-600', bg: 'bg-amber-50' },
  { id: 'TRANSFER', name: 'Transfer Corridor', icon: ArrowRightLeft, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'QUARANTINE', name: 'Quarantine Bay', icon: TriangleAlert, color: 'text-rose-600', bg: 'bg-rose-50', helper: 'Containment first' },
  { id: 'INFRASTRUCTURE', name: 'Infrastructure Events', icon: Waypoints, color: 'text-slate-600', bg: 'bg-slate-50', helper: 'Endpoints and controllers' },
  { id: 'MIXED', name: 'Mixed Missions', icon: Database, color: 'text-emerald-600', bg: 'bg-emerald-50', helper: 'Cross-surface sampling' },
];

const zoneIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  INGRESS: ScanLine,
  VAULT: Archive,
  TRANSFER: ArrowRightLeft,
  QUARANTINE: TriangleAlert,
  INFRASTRUCTURE: Waypoints,
};

export const SeedData: React.FC = () => {
  const [count, setCount] = useState(10);
  const [profile, setProfile] = useState<RuntimeZoneId>('MIXED');
  const [writeMode] = useState<MemoryWriteMode>('event_working');
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<SeedResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  const handleGenerate = async () => {
    setIsRunning(true);
    setLogs(['[SYSTEM] Generating governed runtime missions...']);

    try {
      const generated = await seedDataService.generateSeeds({
        count,
        profile,
        dbProxyUrl: DEFAULT_DB_PROXY,
        mode: writeMode,
        includeKnowledgeBase: false,
      });
      setResults(generated);
      setLogs((previous) => [...previous, `[SUCCESS] Generated ${generated.length} governed mission seeds for ${profile}`]);
    } catch (error: any) {
      setLogs((previous) => [...previous, `[ERROR] ${error.message}`]);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 bg-gray-50 min-h-screen font-sans">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
        <div className="flex justify-between items-start gap-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">SeedCore Mission Seed Generator</h1>
            <p className="text-slate-500 mt-2">Generate runtime requests consistent with the governed execution model.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 mt-6">
              {RUNTIME_FOUNDATION_FACTS.map((fact) => (
                <div key={fact} className="flex items-center gap-2 text-sm text-slate-600">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  {fact}
                </div>
              ))}
            </div>
          </div>
          <div className="bg-slate-900 text-white p-4 rounded-xl text-center min-w-[140px]">
            <div className="text-2xl font-bold">{results.length}</div>
            <div className="text-xs opacity-80">Mission Seeds</div>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
        <label className="block text-xs font-bold text-slate-500 uppercase mb-4">Select Runtime Surface</label>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {PROFILE_OPTIONS.map((option) => {
            const selected = profile === option.id;
            return (
              <button
                key={option.id}
                onClick={() => setProfile(option.id)}
                className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-3 ${
                  selected ? 'border-indigo-500 bg-white shadow-md scale-105' : 'border-transparent hover:border-gray-200'
                }`}
              >
                <option.icon className={`h-8 w-8 ${option.color}`} />
                <span className="font-bold text-slate-800 text-sm text-center">{option.name}</span>
                {option.helper && <span className="text-[10px] text-slate-500">{option.helper}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
        <div className="flex flex-wrap gap-6 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Mission Volume</label>
            <input
              type="range"
              min="1"
              max="50"
              value={count}
              onChange={(event) => setCount(parseInt(event.target.value, 10))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between text-[10px] font-mono mt-2 text-slate-400">
              <span>1 REQUEST</span>
              <span>CURRENT: {count}</span>
              <span>50 REQUESTS</span>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={isRunning}
            className="bg-slate-900 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-800 disabled:opacity-50"
          >
            {isRunning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
            Generate Missions
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-gray-200">
              <th className="p-4 text-xs font-bold text-slate-500 uppercase">Surface</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase">Mission</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase">Intent</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase">Policy Gate</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase">Runtime Signal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {results.map((result) => {
              const Icon = zoneIconMap[result.zone || 'INFRASTRUCTURE'] || Database;
              const zoneDefinition = RUNTIME_ZONES.find((zone) => zone.id === result.zone);
              const isInfra = result.isInfra;

              return (
                <tr key={result.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-indigo-500" />
                      <span className="text-xs font-semibold text-slate-600">
                        {zoneDefinition?.name || result.zone || 'Infrastructure'}
                      </span>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="font-bold text-slate-900">{result.title || 'Mission'}</div>
                    <div className="text-xs text-slate-500 mt-1">Tier: {writeMode}</div>
                  </td>
                  <td className="p-4">
                    <div className="text-xs text-slate-600">
                      {isInfra && 'operation' in result.intent
                        ? `${result.intent.endpoint} • ${result.intent.severity}`
                        : 'requestedAction' in result.intent
                          ? `${result.intent.assetClass} • ${result.intent.approvalMode}`
                          : 'runtime'}
                    </div>
                  </td>
                  <td className="p-4">
                    <span
                      className={`px-3 py-1 rounded-full text-[10px] font-bold ${
                        result.allowed !== false ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {result.allowed !== false ? 'ALLOWED' : 'BLOCKED'}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-2 items-center text-slate-500">
                      {result.isSafety ? <Shield className="h-4 w-4 text-rose-500" /> : null}
                      {isInfra ? <Waypoints className="h-4 w-4 text-slate-500" /> : <Lock className="h-4 w-4 text-indigo-500" />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {logs.length > 0 ? (
        <div className="bg-slate-900 text-slate-200 rounded-2xl p-4 font-mono text-xs whitespace-pre-wrap">
          {logs.join('\n')}
        </div>
      ) : null}
    </div>
  );
};
