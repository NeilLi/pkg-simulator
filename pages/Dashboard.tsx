import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { getSnapshots, getRules, getFacts, getDeployments, getValidationRuns } from '../mockData';
import { ShieldCheck, Activity, Database, Server, Radio, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Snapshot, Rule, Fact, Deployment, ValidationRun } from '../types';

export const Dashboard: React.FC = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [validations, setValidations] = useState<ValidationRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [snaps, ruls, fcts, deps, vals] = await Promise.all([
          getSnapshots(),
          getRules(),
          getFacts(),
          getDeployments(),
          getValidationRuns(),
        ]);
        setSnapshots(snaps);
        setRules(ruls);
        setFacts(fcts);
        setDeployments(deps);
        setValidations(vals);
      } catch (error) {
        console.error('Error loading dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const activeSnapshot = snapshots.find(s => s.isActive && s.env === 'prod');
  const nextSnapshot = snapshots.find(s => !s.isActive && s.env === 'prod'); // Canary usually

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
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
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
                {deployments.map(dep => {
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
                })}
              </ul>
            </div>

            {/* Validation Runs */}
            <div className="bg-white shadow rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                 <h3 className="text-lg font-medium text-gray-900">Validation Status</h3>
                 <span className="text-xs text-gray-400">pkg_validation_runs</span>
              </div>
              <ul className="space-y-3">
                {validations.map(run => {
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
                })}
              </ul>
            </div>

        </div>
      </div>
    </div>
  );
};