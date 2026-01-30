import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  CartesianGrid, PieChart, Pie, Cell, LineChart, Line 
} from 'recharts';
import { 
  ShieldCheck, Activity, Database, Server, Radio, CheckCircle2, 
  AlertTriangle, RefreshCw, Workflow, Layers, TrendingUp, 
  FileText, Clock, Compass, Box, Shirt, Sparkles, Wind, DoorOpen, ArrowUpDown, Image
} from 'lucide-react';
import { 
  Snapshot, Rule, Fact, Deployment, ValidationRun, 
  PkgEnv, SubtaskType, PkgRelation 
} from '../types';
import { listSnapshots } from '../services/snapshotService';
import { getRules, getFacts, getDeployments, getValidationRuns, getSubtaskTypes } from '../mockData';

const ZONE_THEMES = {
  JOURNEY: { name: "Journey Studio", icon: Compass, color: "#8b5cf6", bg: "bg-purple-50" }, // Royal
  GIFT: { name: "Gift Forge", icon: Box, color: "#f59e0b", bg: "bg-amber-50" }, // Gold
  WEAR: { name: "Fashion Lab", icon: Shirt, color: "#3b82f6", bg: "bg-blue-50" }, // Blue
  KIDS: { name: "Magic Atelier", icon: Sparkles, color: "#f43f5e", bg: "bg-rose-50" }, // Rose
};

export const Dashboard: React.FC = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [validations, setValidations] = useState<ValidationRun[]>([]);
  const [subtaskTypes, setSubtaskTypes] = useState<SubtaskType[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEnv, setSelectedEnv] = useState<PkgEnv>(PkgEnv.PROD);

  const loadData = async (env: PkgEnv) => {
    setRefreshing(true);
    try {
      const snaps = await listSnapshots({ env, includeInactive: true, limit: 100 });
      const [ruls, fcts, deps, vals, sts] = await Promise.all([
        getRules(), getFacts(), getDeployments(), getValidationRuns(), getSubtaskTypes(),
      ]);
      setSnapshots(snaps || []);
      setRules(ruls || []);
      setFacts(fcts || []);
      setDeployments(deps || []);
      setValidations(vals || []);
      setSubtaskTypes(sts || []);
    } catch (error) {
      console.error('Dashboard load failed:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadData(selectedEnv); }, [selectedEnv]);

  const activeSnapshot = useMemo(() => snapshots.find(s => s.isActive && s.env === selectedEnv), [snapshots, selectedEnv]);
  const activeSnapshotId = activeSnapshot?.id;

  // Filter Data by Active Snapshot
  const snapshotData = useMemo(() => {
    if (!activeSnapshotId) return { rules: [], facts: [], subtasks: [] };
    return {
      rules: rules.filter(r => r.snapshotId === activeSnapshotId),
      facts: facts.filter(f => f.snapshotId === activeSnapshotId),
      subtasks: subtaskTypes.filter(st => st.snapshotId === activeSnapshotId),
    };
  }, [rules, facts, subtaskTypes, activeSnapshotId]);

  // Zone Health Calculation
  const zoneStats = useMemo(() => {
    return Object.keys(ZONE_THEMES).map(zoneId => {
      const zoneRules = snapshotData.rules.filter(r => r.ruleSource?.includes(zoneId));
      const hasEmergency = snapshotData.facts.some(f => f.subject === `zone:${zoneId}` && f.tags?.includes('emergency'));
      return { id: zoneId, ruleCount: zoneRules.length, status: hasEmergency ? 'ALERT' : 'STABLE' };
    });
  }, [snapshotData]);

  if (loading) return <div className="p-10 text-center animate-pulse text-gray-400">Synchronizing with Cortex...</div>;

  return (
    <div className="space-y-6 bg-gray-50 min-h-screen p-6">
      {/* 1. System Header & Env Selector */}
      <div className="bg-white shadow-sm rounded-2xl p-6 border border-gray-200 flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-slate-900 p-3 rounded-xl text-white">
            <Activity className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Hotel 2030+ Observer</h2>
            <p className="text-sm text-slate-500 font-mono">Snapshot: {activeSnapshot?.version || 'N/A'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select 
            value={selectedEnv} 
            onChange={(e) => setSelectedEnv(e.target.value as PkgEnv)}
            className="bg-gray-100 border-none rounded-lg px-4 py-2 text-sm font-bold text-slate-700"
          >
            {Object.values(PkgEnv).map(e => <option key={e} value={e}>{e.toUpperCase()}</option>)}
          </select>
          <button onClick={() => loadData(selectedEnv)} className="p-2 hover:bg-gray-100 rounded-lg text-slate-400 transition-all">
            <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 2. Zone Health Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {zoneStats.map(zone => {
          const theme = ZONE_THEMES[zone.id as keyof typeof ZONE_THEMES];
          const Icon = theme.icon;
          return (
            <div key={zone.id} className={`${theme.bg} border border-white p-5 rounded-2xl shadow-sm relative overflow-hidden`}>
              <div className="flex justify-between items-start relative z-10">
                <div className={`p-2 rounded-lg bg-white shadow-sm ${theme.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${zone.status === 'STABLE' ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>
                  {zone.status}
                </span>
              </div>
              <div className="mt-4 relative z-10">
                <h3 className="font-bold text-slate-800 text-sm">{theme.name}</h3>
                <p className="text-[10px] text-slate-500 uppercase tracking-tighter mt-1">{zone.ruleCount} Active Rules</p>
              </div>
              <div className="absolute -right-4 -bottom-4 opacity-5">
                <Icon className="h-24 w-24" />
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. Infrastructure & Fact Cortex */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Fact Triple Distribution */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 lg:col-span-2">
          <h3 className="text-sm font-bold text-slate-500 uppercase mb-6 flex items-center gap-2">
            <Database className="h-4 w-4" /> Knowledge Base Triples (Triples/Subject)
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[
                { 
                  subject: 'HVAC', 
                  count: snapshotData.facts.filter(f => 
                    f.subject && f.predicate && f.object !== undefined && 
                    f.subject.toLowerCase().includes('hvac')
                  ).length 
                },
                { 
                  subject: 'ELEVATORS', 
                  count: snapshotData.facts.filter(f => 
                    f.subject && f.predicate && f.object !== undefined && 
                    f.subject.toLowerCase().includes('elevator')
                  ).length 
                },
                { 
                  subject: 'ACCESS', 
                  count: snapshotData.facts.filter(f => 
                    f.subject && f.predicate && f.object !== undefined && 
                    (f.subject.toLowerCase().includes('door') || f.subject.toLowerCase().includes('access'))
                  ).length 
                },
                { 
                  subject: 'ZONES', 
                  count: snapshotData.facts.filter(f => 
                    f.subject && f.predicate && f.object !== undefined && 
                    f.subject.toLowerCase().includes('zone')
                  ).length 
                },
              ]}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="subject" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
                <Bar dataKey="count" fill="#6366f1" radius={[6, 6, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Subtask Type Capability Registry */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
          <h3 className="text-sm font-bold text-slate-500 uppercase mb-4 flex items-center gap-2">
            <Layers className="h-4 w-4" /> Capabilities
          </h3>
          <div className="space-y-3">
            {snapshotData.subtasks.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-4">No capabilities registered</div>
            ) : (
              snapshotData.subtasks.map(st => (
                <div key={st.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div>
                    <div className="text-xs font-bold text-slate-800">{st.name}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Executor: {st.defaultParams?.engine || 'native'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {st.name === 'generate_precision_mockups' && <Image className="h-4 w-4 text-indigo-500" />}
                    {st.name.includes('hvac') && <Wind className="h-4 w-4 text-sky-500" />}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 4. Deployment & Safety Log */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Deployments (Canary Status) */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 lg:col-span-1">
          <h3 className="text-sm font-bold text-slate-500 uppercase mb-4 flex items-center gap-2">
            <Server className="h-4 w-4" /> Traffic Allocation
          </h3>
          <ul className="space-y-4">
            {deployments.filter(d => d.snapshotId === activeSnapshotId && d.isActive).length === 0 ? (
              <li className="text-xs text-slate-400 text-center py-4">No active deployments</li>
            ) : (
              deployments.filter(d => d.snapshotId === activeSnapshotId && d.isActive).map(dep => (
                <li key={dep.id} className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="font-bold text-slate-700 uppercase">{dep.target} ({dep.region})</span>
                    <span className="text-indigo-600 font-mono">{dep.percent}%</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div className="bg-indigo-500 h-full transition-all duration-1000" style={{ width: `${dep.percent}%` }} />
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* Validation & Safety Events */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 lg:col-span-2">
          <h3 className="text-sm font-bold text-slate-500 uppercase mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Safety & Validation Audit
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-100">
                  <th className="pb-3">Timestamp</th>
                  <th className="pb-3">Event</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {validations.filter(v => v.snapshotId === activeSnapshotId).slice(0, 5).map(run => (
                  <tr key={run.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 font-mono text-slate-400">{new Date(run.startedAt).toLocaleTimeString()}</td>
                    <td className="py-3 font-bold text-slate-700">{run.report?.type || 'Simulation'}</td>
                    <td className="py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${run.success ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>
                        {run.success ? 'PASSED' : 'FAILED'}
                      </span>
                    </td>
                    <td className="py-3 font-mono text-slate-500">{run.report?.simulationScore || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};