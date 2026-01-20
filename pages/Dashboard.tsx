import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import {
  getRules,
  getFacts,
  getDeployments,
  getValidationRuns,
  getSubtaskTypes,
} from '../mockData';
import { 
  ShieldCheck, Activity, Database, Server, Radio, CheckCircle2, AlertTriangle, RefreshCw,
  Workflow, Layers, TrendingUp, FileText, Clock
} from 'lucide-react';
import { Snapshot, Rule, Fact, Deployment, ValidationRun, PkgEnv, SubtaskType, PkgRelation } from '../types';
import { listSnapshots } from '../services/snapshotService';

/**
 * Dashboard - Pure Read-Only System Observation
 * 
 * Purpose: Observe system behavior, verify health, see what's live
 * 
 * Characteristics:
 * - Read-only or near read-only
 * - Aggregates already-existing state
 * - Displays metrics, health, status, trends
 * - Does NOT mutate system topology
 * - Does NOT create or destroy core entities
 * 
 * Dashboard observes the system, it does not construct the system.
 */
export const Dashboard: React.FC = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [validations, setValidations] = useState<ValidationRun[]>([]);
  const [subtaskTypes, setSubtaskTypes] = useState<SubtaskType[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // User-selected environment (read-only context)
  const [selectedEnv, setSelectedEnv] = useState<PkgEnv>(PkgEnv.PROD);

  /** -----------------------------
   * Data loading (read-only)
   * ------------------------------*/

  const loadData = async (env: PkgEnv) => {
    try {
      const snaps = await listSnapshots({ env, includeInactive: true, limit: 200 });
      
      // Guard against null/undefined responses
      if (!snaps || !Array.isArray(snaps)) {
        console.warn('listSnapshots returned invalid data:', snaps);
        setSnapshots([]);
      } else {
        setSnapshots(snaps);
      }

      const [ruls, fcts, deps, vals, sts] = await Promise.all([
        getRules(),
        getFacts(),
        getDeployments(),
        getValidationRuns(),
        getSubtaskTypes(),
      ]);

      setRules(ruls || []);
      setFacts(fcts || []);
      setDeployments(deps || []);
      setValidations(vals || []);
      setSubtaskTypes(sts || []);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      // Set empty arrays on error to prevent null access
      setSnapshots([]);
      setRules([]);
      setFacts([]);
      setDeployments([]);
      setValidations([]);
      setSubtaskTypes([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadData(selectedEnv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEnv]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData(selectedEnv);
  };

  /** -----------------------------
   * Computed values (read-only)
   * ------------------------------*/

  const activeSnapshot = useMemo(
    () => snapshots.find(s => s.isActive && s.env === selectedEnv),
    [snapshots, selectedEnv],
  );

  const activeSnapshotId = activeSnapshot?.id;

  // Filter all data by active snapshot_id
  const snapshotRules = useMemo(() => {
    if (!activeSnapshotId) return [];
    return rules.filter(r => r.snapshotId === activeSnapshotId);
  }, [rules, activeSnapshotId]);

  const snapshotFacts = useMemo(() => {
    if (!activeSnapshotId) return [];
    return facts.filter(f => f.snapshotId === activeSnapshotId);
  }, [facts, activeSnapshotId]);

  const snapshotDeployments = useMemo(() => {
    if (!activeSnapshotId) return [];
    return deployments.filter(d => d.snapshotId === activeSnapshotId);
  }, [deployments, activeSnapshotId]);

  const snapshotValidations = useMemo(() => {
    if (!activeSnapshotId) return [];
    return validations.filter(v => v.snapshotId === activeSnapshotId);
  }, [validations, activeSnapshotId]);

  const snapshotSubtaskTypes = useMemo(() => {
    if (!activeSnapshotId) return [];
    return subtaskTypes.filter(st => st.snapshotId === activeSnapshotId);
  }, [subtaskTypes, activeSnapshotId]);

  // Enhanced stats with new fact schema support (filtered by snapshot)
  const activeFacts = useMemo(() => {
    return snapshotFacts.filter(f => {
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
  }, [snapshotFacts]);

  const structuredFacts = useMemo(() => {
    return snapshotFacts.filter(f => f.subject && f.predicate && f.object);
  }, [snapshotFacts]);

  const pkgGovernedFacts = useMemo(() => {
    return snapshotFacts.filter(f => f.pkgRuleId);
  }, [snapshotFacts]);

  // Rules statistics (filtered by snapshot)
  const rulesByEngine = useMemo(() => {
    const wasm = snapshotRules.filter(r => r.engine === 'wasm').length;
    const native = snapshotRules.filter(r => r.engine === 'native').length;
    return { wasm, native };
  }, [snapshotRules]);

  const rulesByStatus = useMemo(() => {
    const enabled = snapshotRules.filter(r => !r.disabled).length;
    const disabled = snapshotRules.filter(r => r.disabled).length;
    return { enabled, disabled };
  }, [snapshotRules]);

  // Emissions statistics (filtered by snapshot)
  const emissionsStats = useMemo(() => {
    const emits = snapshotRules.reduce((acc, r) => acc + (r.emissions?.filter(e => e.relationshipType === 'EMITS').length || 0), 0);
    const orders = snapshotRules.reduce((acc, r) => acc + (r.emissions?.filter(e => e.relationshipType === 'ORDERS').length || 0), 0);
    const gates = snapshotRules.reduce((acc, r) => acc + (r.emissions?.filter(e => e.relationshipType === 'GATE').length || 0), 0);
    return { emits, orders, gates, total: emits + orders + gates };
  }, [snapshotRules]);

  // Recent validations (last 5, filtered by snapshot)
  const recentValidations = useMemo(() => {
    return [...snapshotValidations]
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, 5);
  }, [snapshotValidations]);

  // Rules with emissions count (filtered by snapshot)
  const rulesWithEmissions = useMemo(() => {
    return snapshotRules.filter(r => r.emissions && r.emissions.length > 0).length;
  }, [snapshotRules]);

  const stats = [
    { title: 'Active Policy', value: activeSnapshot?.version || 'N/A', icon: ShieldCheck, color: 'bg-indigo-500' },
    { title: 'Total Rules', value: snapshotRules.length, icon: Activity, color: 'bg-emerald-500' },
    { title: 'Active Facts', value: activeFacts.length, icon: Database, color: 'bg-blue-500' },
    { title: 'Active Nodes', value: snapshotDeployments.filter(d => d.isActive).length, icon: Server, color: 'bg-amber-500' },
    { title: 'Subtask Types', value: snapshotSubtaskTypes.length, icon: Layers, color: 'bg-purple-500' },
    { title: 'Total Emissions', value: emissionsStats.total, icon: Workflow, color: 'bg-pink-500' },
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
      {/* Header */}
      <div className="bg-white shadow rounded-lg p-4 border border-gray-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">System Dashboard</h2>
            <p className="text-sm text-gray-500 mt-1">
              Real-time view of system health, deployments, and policy evaluations
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

              <div className="text-xs text-gray-500">Active Policy</div>
              <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
                {activeSnapshot?.version || 'N/A'}
              </span>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat) => {
           const Icon = stat.icon;
           return (
            <div key={stat.title} className="bg-white overflow-hidden shadow rounded-lg border border-gray-100">
              <div className="p-5">
                <div className="flex items-center">
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
              </div>
            </div>
           );
        })}
      </div>

      {/* Facts Overview (New Schema) - Filtered by Snapshot */}
      <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
        <h3 className="text-md font-semibold text-gray-900 mb-4">
          Facts Overview
          {activeSnapshotId && (
            <span className="text-xs font-normal text-gray-500 ml-2">
              (Snapshot: {activeSnapshot?.version})
            </span>
          )}
        </h3>
        {activeSnapshotId ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{snapshotFacts.length}</div>
                <div className="text-sm text-gray-500">Total Facts</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{activeFacts.length}</div>
                <div className="text-sm text-gray-500">Active Facts</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-emerald-600">{structuredFacts.length}</div>
                <div className="text-sm text-gray-500">Structured Triples</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{pkgGovernedFacts.length}</div>
                <div className="text-sm text-gray-500">PKG Governed</div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-gray-500">Expired:</span>
                  <span className="ml-2 font-semibold text-red-600">
                    {snapshotFacts.filter(f => f.status === 'expired').length}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Future:</span>
                  <span className="ml-2 font-semibold text-blue-600">
                    {snapshotFacts.filter(f => f.status === 'future').length}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Indefinite:</span>
                  <span className="ml-2 font-semibold text-green-600">
                    {snapshotFacts.filter(f => f.status === 'indefinite').length}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Text-Only:</span>
                  <span className="ml-2 font-semibold text-gray-600">
                    {snapshotFacts.filter(f => !f.subject || !f.predicate).length}
                  </span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-8 text-gray-400 text-sm">
            No active snapshot selected. Please activate a snapshot in Policy Studio.
          </div>
        )}
      </div>

      {/* Rules & Emissions Statistics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Rules Breakdown */}
        <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Rules Statistics
          </h3>
          <div className="space-y-4">
            <div>
              <div className="text-sm text-gray-500 mb-2">By Engine</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{rulesByEngine.wasm}</div>
                  <div className="text-xs text-gray-600">WASM</div>
                </div>
                <div className="p-3 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{rulesByEngine.native}</div>
                  <div className="text-xs text-gray-600">Native</div>
                </div>
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500 mb-2">By Status</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 bg-emerald-50 rounded-lg">
                  <div className="text-2xl font-bold text-emerald-600">{rulesByStatus.enabled}</div>
                  <div className="text-xs text-gray-600">Enabled</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl font-bold text-gray-600">{rulesByStatus.disabled}</div>
                  <div className="text-xs text-gray-600">Disabled</div>
                </div>
              </div>
            </div>
            <div className="pt-2 border-t border-gray-200">
              <div className="text-sm text-gray-500">Rules with Emissions</div>
              <div className="text-xl font-bold text-gray-900 mt-1">{rulesWithEmissions}</div>
            </div>
          </div>
        </div>

        {/* Emissions Breakdown */}
        <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Workflow className="h-5 w-5" />
            Emissions Statistics
          </h3>
          {emissionsStats.total > 0 ? (
            <div className="space-y-4">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'EMITS', value: emissionsStats.emits, color: '#8b5cf6' },
                        { name: 'ORDERS', value: emissionsStats.orders, color: '#3b82f6' },
                        { name: 'GATE', value: emissionsStats.gates, color: '#ef4444' },
                      ]}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(props: any) => {
                        const percent = props.percent || 0;
                        const name = props.name || '';
                        return `${name}: ${(percent * 100).toFixed(0)}%`;
                      }}
                      outerRadius={60}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {[
                        { name: 'EMITS', value: emissionsStats.emits, color: '#8b5cf6' },
                        { name: 'ORDERS', value: emissionsStats.orders, color: '#3b82f6' },
                        { name: 'GATE', value: emissionsStats.gates, color: '#ef4444' },
                      ].map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="text-center">
                  <div className="font-bold text-purple-600">{emissionsStats.emits}</div>
                  <div className="text-gray-500">EMITS</div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-blue-600">{emissionsStats.orders}</div>
                  <div className="text-gray-500">ORDERS</div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-red-600">{emissionsStats.gates}</div>
                  <div className="text-gray-500">GATE</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
              No emissions found
            </div>
          )}
        </div>

        {/* Subtask Types */}
        <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Subtask Types
            {activeSnapshotId && (
              <span className="text-xs font-normal text-gray-500">
                ({snapshotSubtaskTypes.length})
              </span>
            )}
          </h3>
          {activeSnapshotId ? (
            snapshotSubtaskTypes.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {snapshotSubtaskTypes.map((st) => (
                  <div key={st.id} className="p-2 bg-gray-50 rounded border border-gray-200">
                    <div className="font-medium text-sm text-gray-900">{st.name}</div>
                    {st.defaultParams && Object.keys(st.defaultParams).length > 0 && (
                      <div className="text-xs text-gray-500 mt-1">
                        {Object.keys(st.defaultParams).slice(0, 2).join(', ')}
                        {Object.keys(st.defaultParams).length > 2 && '...'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">
                No subtask types registered for this snapshot
                <div className="mt-2 text-xs">
                  <a href="#/policy-studio" className="text-indigo-600 hover:underline">
                    Register in Policy Studio
                  </a>
                </div>
              </div>
            )
          ) : (
            <div className="text-center py-8 text-gray-400 text-sm">
              No active snapshot selected
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Chart */}
        <div className="lg:col-span-2 bg-white shadow rounded-lg p-6 border border-gray-100">
          <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Policy Evaluations (24h)
          </h3>
          {chartData && chartData.length > 0 ? (
            <div className="h-72 min-h-[288px] w-full">
              <ResponsiveContainer width="100%" height={288}>
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
          ) : (
            <div className="h-72 min-h-[288px] flex items-center justify-center text-gray-500">
              No chart data available
            </div>
          )}
        </div>

        {/* Deployments & Validations */}
        <div className="lg:col-span-1 space-y-6">
            
            {/* Deployments - Read Only */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                 <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                   <Server className="h-5 w-5" />
                   Active Nodes & Deployments
                   {activeSnapshotId && (
                     <span className="text-xs font-normal text-gray-500">
                       ({snapshotDeployments.length})
                     </span>
                   )}
                 </h3>
                 <span className="text-xs text-gray-400">pkg_deployments</span>
              </div>

              <ul className="space-y-3">
                {!activeSnapshotId ? (
                  <li className="text-sm text-gray-500 text-center py-4">No active snapshot selected</li>
                ) : snapshotDeployments.length === 0 ? (
                  <li className="text-sm text-gray-500 text-center py-4">No deployments for this snapshot</li>
                ) : (
                  snapshotDeployments.map(dep => {
                    const snap = snapshots.find(s => s.id === dep.snapshotId);
                    return (
                      <li key={dep.id} className={`p-3 rounded-lg border-2 ${
                        dep.isActive 
                          ? 'bg-green-50 border-green-200' 
                          : 'bg-gray-50 border-gray-200'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Radio className={`h-4 w-4 ${dep.isActive ? 'text-green-500' : 'text-gray-300'}`} />
                            <span className="font-medium text-gray-700 capitalize">{dep.target}</span>
                            <span className="text-gray-400 text-xs">({dep.region})</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">{snap?.version}</span>
                            <span className={`font-bold ${
                              dep.percent === 100 ? 'text-green-600' :
                              dep.percent > 0 ? 'text-blue-600' : 'text-gray-600'
                            }`}>
                              {dep.percent ?? 0}%
                            </span>
                          </div>
                        </div>
                        {dep.activatedBy && dep.activatedBy !== 'system' && (
                          <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Activated by: {dep.activatedBy} at {new Date(dep.activatedAt).toLocaleString()}
                          </div>
                        )}
                      </li>
                    );
                  })
                )}
              </ul>

              {activeSnapshotId && snapshotDeployments.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="text-xs text-gray-500">
                    <strong>Note:</strong> View-only. Manage deployments in Control Plane.
                  </div>
                </div>
              )}
            </div>

            {/* Validation Runs */}
            <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                 <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                   <FileText className="h-5 w-5" />
                   Recent Validations
                   {activeSnapshotId && (
                     <span className="text-xs font-normal text-gray-500">
                       ({snapshotValidations.length})
                     </span>
                   )}
                 </h3>
                 <span className="text-xs text-gray-400">pkg_validation_runs</span>
              </div>
              <ul className="space-y-3">
                {!activeSnapshotId ? (
                  <li className="text-sm text-gray-500 text-center py-4">No active snapshot selected</li>
                ) : recentValidations.length === 0 ? (
                  <li className="text-sm text-gray-500 text-center py-4">No validation runs for this snapshot</li>
                ) : (
                  recentValidations.map(run => {
                    const snap = snapshots.find(s => s.id === run.snapshotId);
                    const report = run.report;
                    return (
                      <li key={run.id} className="flex items-start justify-between text-sm p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-indigo-600">{snap?.version || `Snapshot ${run.snapshotId}`}</span>
                            {report?.type && (
                              <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                                {report.type}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 flex items-center gap-2">
                            <Clock className="h-3 w-3" />
                            {new Date(run.startedAt).toLocaleString()}
                          </div>
                          {report && (
                            <div className="mt-2 text-xs text-gray-600 space-y-1">
                              {report.rulesEvaluated !== undefined && (
                                <div>Rules: {report.rulesEvaluated} evaluated, {report.rulesTriggered || 0} triggered</div>
                              )}
                              {report.passed !== undefined && report.failed !== undefined && (
                                <div className="flex gap-2">
                                  <span className="text-green-600">✓ {report.passed}</span>
                                  <span className="text-red-600">✗ {report.failed}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center ml-3">
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
                  })
                )}
              </ul>
            </div>

        </div>
      </div>
    </div>
  );
};
