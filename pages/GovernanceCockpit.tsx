import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowRightLeft,
  Eye,
  Play,
  ScanLine,
  Shield,
  TriangleAlert,
} from 'lucide-react';
import { Fact, PkgEnv, Snapshot, ValidationRun } from '../types';
import { getFacts, getValidationRuns } from '../mockData';
import { listSnapshots } from '../services/snapshotService';
import { getActiveFactsAtTime } from '../services/temporalPolicyService';

const ZONE_CONFIG = {
  INGRESS: { name: 'Event Ingress', icon: ScanLine, accent: 'text-sky-400', bg: 'bg-sky-500/10' },
  VAULT: { name: 'Vault Control', icon: Archive, accent: 'text-amber-400', bg: 'bg-amber-500/10' },
  TRANSFER: { name: 'Transfer Corridor', icon: ArrowRightLeft, accent: 'text-indigo-400', bg: 'bg-indigo-500/10' },
  QUARANTINE: { name: 'Quarantine Bay', icon: TriangleAlert, accent: 'text-rose-400', bg: 'bg-rose-500/10' },
} as const;

type ZoneId = keyof typeof ZONE_CONFIG;

type HardwareConstraints = NonNullable<ValidationRun['report']>['hardwareConstraints'];

export const GovernanceCockpit: React.FC = () => {
  const [activeZone, setActiveZone] = useState<ZoneId>('VAULT');
  const [isStreaming, setIsStreaming] = useState(false);
  const [simTime, setSimTime] = useState(new Date());
  const [facts, setFacts] = useState<Fact[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [validations, setValidations] = useState<ValidationRun[]>([]);
  const [activeSnapshot, setActiveSnapshot] = useState<Snapshot | null>(null);
  const [hardwareConstraints, setHardwareConstraints] = useState<HardwareConstraints | null>(null);

  useEffect(() => {
    const load = async () => {
      const [loadedFacts, loadedValidations, loadedSnapshots] = await Promise.all([
        getFacts(),
        getValidationRuns(),
        listSnapshots({ env: PkgEnv.PROD, includeInactive: false, limit: 10 }),
      ]);
      setFacts(loadedFacts || []);
      setValidations(loadedValidations || []);
      setSnapshots(loadedSnapshots || []);
      setActiveSnapshot(loadedSnapshots.find((snapshot) => snapshot.isActive) || loadedSnapshots[0] || null);
      const latestWithConstraints = loadedValidations.find((validation) => validation.report?.hardwareConstraints);
      setHardwareConstraints(latestWithConstraints?.report?.hardwareConstraints || null);
    };
    load().catch((error) => console.error('Failed to load governance cockpit data:', error));
  }, []);

  useEffect(() => {
    if (!isStreaming) return undefined;
    const timer = window.setInterval(() => setSimTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [isStreaming]);

  const zoneFacts = useMemo(() => {
    return facts.filter((fact) => fact.subject?.toUpperCase().includes(activeZone) || fact.tags?.some((tag) => tag.toUpperCase().includes(activeZone)));
  }, [facts, activeZone]);

  const activeFacts = useMemo(() => getActiveFactsAtTime(zoneFacts, simTime.toISOString()), [zoneFacts, simTime]);

  const alerts = useMemo(() => {
    const findings: Array<{ level: 'critical' | 'warning' | 'info'; message: string }> = [];
    activeFacts.forEach((fact) => {
      const payload = typeof fact.object === 'object' && fact.object ? fact.object : {};
      const serialized = JSON.stringify(payload).toLowerCase();
      if (serialized.includes('broken') || serialized.includes('quarantine') || fact.tags?.includes('anomaly')) {
        findings.push({ level: 'critical', message: `${fact.subject} indicates quarantine or tamper state.` });
      } else if (serialized.includes('dualapproval') || serialized.includes('releasewindow')) {
        findings.push({ level: 'info', message: `${fact.subject} is contributing release-control policy.` });
      }
    });
    if (findings.length === 0) {
      findings.push({ level: 'info', message: 'No immediate policy violations detected for the selected runtime surface.' });
    }
    return findings.slice(0, 5);
  }, [activeFacts]);

  const latestValidation = useMemo(() => {
    if (!activeSnapshot) return null;
    return validations
      .filter((validation) => validation.snapshotId === activeSnapshot.id)
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0] || null;
  }, [activeSnapshot, validations]);

  const activeTheme = ZONE_CONFIG[activeZone];

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-300 font-sans">
      <header className="bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Governance Cockpit</h1>
            <p className="text-xs text-slate-500">Perception, temporal policy, and custody state</p>
          </div>
        </div>

        <div className="flex bg-slate-800 p-1 rounded-xl">
          {Object.entries(ZONE_CONFIG).map(([id, config]) => (
            <button
              key={id}
              onClick={() => setActiveZone(id as ZoneId)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                activeZone === id ? 'bg-slate-700 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <config.icon className={`h-4 w-4 ${activeZone === id ? config.accent : ''}`} />
              {config.name}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
        <section className="col-span-12 lg:col-span-4 flex flex-col gap-4">
          <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <Eye className="h-4 w-4" />
                Perception Stream
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full animate-pulse ${isStreaming ? 'bg-emerald-500' : 'bg-slate-700'}`} />
                <span className="text-[10px] font-mono">{isStreaming ? 'LIVE' : 'IDLE'}</span>
              </div>
            </div>

            <div className="flex-1 bg-black relative group p-6">
              <div className={`rounded-2xl border border-slate-800 h-full flex flex-col items-center justify-center gap-4 ${activeTheme.bg}`}>
                <activeTheme.icon className={`h-14 w-14 ${activeTheme.accent}`} />
                <div className="text-center">
                  <div className="text-sm font-bold text-white">{activeTheme.name}</div>
                  <div className="text-xs text-slate-500 mt-1">Snapshot: {activeSnapshot?.version || 'N/A'}</div>
                </div>
                <button
                  onClick={() => setIsStreaming((value) => !value)}
                  className="bg-white text-black px-6 py-2 rounded-full font-bold text-sm hover:bg-indigo-50 transition-colors flex items-center gap-2"
                >
                  <Play className="h-4 w-4" />
                  {isStreaming ? 'Pause Stream' : 'Initialize Stream'}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Temporal State</div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Simulation time</span>
                <span className="text-white font-mono">{simTime.toLocaleTimeString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Active facts</span>
                <span className="text-white">{activeFacts.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Latest validation</span>
                <span className="text-white">{latestValidation ? latestValidation.id : 'N/A'}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="col-span-12 lg:col-span-5 flex flex-col gap-4">
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 flex-1 overflow-auto">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Policy Alerts</div>
            <div className="space-y-3">
              {alerts.map((alert, index) => (
                <div
                  key={`${alert.message}-${index}`}
                  className={`rounded-xl border px-4 py-3 ${
                    alert.level === 'critical'
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                      : alert.level === 'warning'
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                        : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200'
                  }`}
                >
                  {alert.message}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 flex-1 overflow-auto">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Active Facts</div>
            <div className="space-y-3">
              {activeFacts.length === 0 ? (
                <div className="text-sm text-slate-500">No active facts for this runtime surface.</div>
              ) : (
                activeFacts.map((fact) => (
                  <div key={fact.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <div className="text-sm font-semibold text-white">{fact.subject}</div>
                    <div className="text-xs text-slate-400 mt-1">{fact.predicate}</div>
                    <div className="text-xs text-slate-500 mt-2 break-all">{JSON.stringify(fact.object)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="col-span-12 lg:col-span-3 flex flex-col gap-4">
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Digital Twin</div>
            {hardwareConstraints ? (
              <div className="space-y-4 text-sm">
                <div>
                  <div className="text-slate-400 mb-1">Robotic Handler</div>
                  <div className="text-white">Max payload: {hardwareConstraints.roboticHandler?.maxPayloadKg ?? 'N/A'} kg</div>
                  <div className="text-slate-500 text-xs mt-1">
                    {hardwareConstraints.roboticHandler?.allowedZoneTransitions?.join(' -> ') || 'No transitions loaded'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400 mb-1">Seal Scanner</div>
                  <div className="text-white">Confidence floor: {hardwareConstraints.sealScanner?.minimumConfidence ?? 'N/A'}</div>
                </div>
                <div>
                  <div className="text-slate-400 mb-1">Vault Door</div>
                  <div className="text-white">Open window: {hardwareConstraints.vaultDoor?.maxOpenSeconds ?? 'N/A'} sec</div>
                  <div className="text-slate-500 text-xs mt-1">{hardwareConstraints.vaultDoor?.failMode || 'N/A'}</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500">No digital twin constraints are loaded for the active snapshot.</div>
            )}
          </div>

          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Validation Summary</div>
            {latestValidation ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Run</span>
                  <span className="text-white">#{latestValidation.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Type</span>
                  <span className="text-white">{latestValidation.report?.type || 'validation'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Status</span>
                  <span className={latestValidation.success ? 'text-emerald-300' : 'text-rose-300'}>
                    {latestValidation.success ? 'passed' : 'failed'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500">No validation history found.</div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
