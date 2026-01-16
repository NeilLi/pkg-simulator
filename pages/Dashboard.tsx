import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  getRules,
  getFacts,
  getDeployments,
  getValidationRuns,
} from '../mockData';
import { ShieldCheck, Activity, Database, Server, Radio, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Snapshot, Rule, Fact, Deployment, ValidationRun, PkgEnv } from '../types';
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

      const [ruls, fcts, deps, vals] = await Promise.all([
        getRules(),
        getFacts(),
        getDeployments(),
        getValidationRuns(),
      ]);

      setRules(ruls || []);
      setFacts(fcts || []);
      setDeployments(deps || []);
      setValidations(vals || []);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      // Set empty arrays on error to prevent null access
      setSnapshots([]);
      setRules([]);
      setFacts([]);
      setDeployments([]);
      setValidations([]);
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
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Chart */}
        <div className="lg:col-span-2 bg-white shadow rounded-lg p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Policy Evaluations (24h)</h3>
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
            
            {/* Deployments */}
            <div className="bg-white shadow rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                 <h3 className="text-lg font-medium text-gray-900">Active Deployments</h3>
                 <span className="text-xs text-gray-400">pkg_deployments</span>
              </div>
              <ul className="space-y-3">
                {deployments.length === 0 ? (
                  <li className="text-sm text-gray-500 text-center py-4">No active deployments</li>
                ) : (
                  deployments.map(dep => {
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
                  })
                )}
              </ul>
            </div>

            {/* Validation Runs */}
            <div className="bg-white shadow rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                 <h3 className="text-lg font-medium text-gray-900">Validation Status</h3>
                 <span className="text-xs text-gray-400">pkg_validation_runs</span>
              </div>
              <ul className="space-y-3">
                {validations.length === 0 ? (
                  <li className="text-sm text-gray-500 text-center py-4">No validation runs</li>
                ) : (
                  validations.map(run => {
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
                  })
                )}
              </ul>
            </div>

        </div>
      </div>
    </div>
  );
};
