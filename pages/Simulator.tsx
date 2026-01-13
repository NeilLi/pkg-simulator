import React, { useState, useEffect } from 'react';
import { getRules, getFacts, getUnifiedMemory, getSnapshots } from '../mockData';
import { runSimulation, hydrateContext, HydratedContext } from '../services/pkgEngine';
import { SimulationResult, Snapshot, Rule, Fact, UnifiedMemoryItem } from '../types';
import { Play, RotateCcw, CheckCircle, XCircle, Zap, Layers, Server } from 'lucide-react';

export const Simulator: React.FC = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [unifiedMemory, setUnifiedMemory] = useState<UnifiedMemoryItem[]>([]);
  const [snapshotId, setSnapshotId] = useState<number | null>(null);
  const [simulationLogs, setSimulationLogs] = useState<SimulationResult[]>([]);
  const [hydrationLogs, setHydrationLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Context State
  const [tags, setTags] = useState<string>('event_type=smoke_detected, room=1208');
  const [signals, setSignals] = useState<string>('confidence=0.95');
  
  useEffect(() => {
    const loadData = async () => {
      try {
        const [snaps, ruls, fcts, mem] = await Promise.all([
          getSnapshots(),
          getRules(),
          getFacts(),
          getUnifiedMemory(),
        ]);
        setSnapshots(snaps);
        setRules(ruls);
        setFacts(fcts);
        setUnifiedMemory(mem);
        if (snaps.length > 0) {
          // Default to first non-active prod snapshot or first snapshot
          const defaultSnap = snaps.find(s => !s.isActive && s.env === 'prod') || snaps[0];
          setSnapshotId(defaultSnap.id);
        }
      } catch (error) {
        console.error('Error loading simulator data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);
  
  const activeSnapshot = snapshots.find(s => s.id === snapshotId);

  const handleRun = () => {
    if (!snapshotId) return;
    
    // 1. Parse Inputs (Reflex Layer)
    const parsedTags: Record<string, string> = {};
    tags.split(',').forEach(t => {
      const [k, v] = t.split('=');
      if(k && v) parsedTags[k.trim()] = v.trim();
    });

    const parsedSignals: Record<string, any> = {};
    signals.split(',').forEach(s => {
      const [k, v] = s.split('=');
      if(k && v) parsedSignals[k.trim()] = isNaN(Number(v)) ? v.trim() : Number(v);
    });

    // 2. Semantic Context Hydration
    const hydratedContext: HydratedContext = hydrateContext(
      parsedTags,
      parsedSignals,
      facts,
      unifiedMemory
    );
    setHydrationLogs(hydratedContext.hydrationLogs);

    // 3. Execution (PKG)
    const activeRules = rules.filter(r => r.snapshotId === snapshotId);
    const results = runSimulation(activeRules, hydratedContext);

    setSimulationLogs(results);
  };

  const handleHotSwap = () => {
     if (snapshots.length < 2) return;
     // Switch to next available snapshot to simulate Redis event
     const currentIndex = snapshots.findIndex(s => s.id === snapshotId);
     const nextIndex = (currentIndex + 1) % snapshots.length;
     const nextId = snapshots[nextIndex].id;
     setSnapshotId(nextId);
     // In a real app, this would be triggered by a socket event
     setHydrationLogs(prev => [...prev, `[REDIS] Hot-Swap event received. Active Snapshot set to: ${snapshots.find(s => s.id === nextId)?.version}`]);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-140px)]">
        <div className="col-span-3 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <p className="mt-4 text-gray-500">Loading simulator data...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-140px)]">
      
      {/* Configuration Panel */}
      <div className="lg:col-span-1 bg-white rounded-lg shadow flex flex-col overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
          <h3 className="font-semibold text-gray-700">Input Context (Reflex)</h3>
          <span className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded-full font-mono">FastEventizer</span>
        </div>
        
        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
          
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex justify-between items-start">
               <div>
                  <label className="block text-xs font-bold text-amber-800 uppercase mb-1">Active Snapshot</label>
                  <div className="text-lg font-mono text-gray-900">{activeSnapshot?.version}</div>
                  <div className="text-xs text-gray-500">{activeSnapshot?.env}</div>
               </div>
               <button 
                 onClick={handleHotSwap}
                 className="p-2 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded transition-colors"
                 title="Simulate Redis Hot-Swap"
               >
                 <Zap className="h-5 w-5" />
               </button>
            </div>
          </div>

          <div>
             <label className="block text-sm font-medium text-gray-700 mb-1">Incoming Tags</label>
             <textarea 
                className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm border p-2 h-20 font-mono text-xs"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="key=value, key2=value2"
             />
          </div>

          <div>
             <label className="block text-sm font-medium text-gray-700 mb-1">Sensor Signals</label>
             <textarea 
                className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm border p-2 h-20 font-mono text-xs"
                value={signals}
                onChange={(e) => setSignals(e.target.value)}
                placeholder="temp=25, light=on"
             />
          </div>

          {hydrationLogs.length > 0 && (
            <div className="bg-slate-50 p-3 rounded border border-slate-200">
               <div className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center">
                  <Layers className="h-3 w-3 mr-1" /> Context Hydration
               </div>
               <div className="space-y-1">
                 {hydrationLogs.map((log, i) => (
                   <div key={i} className="text-xs text-slate-600 font-mono break-words border-l-2 border-indigo-200 pl-2">
                     {log}
                   </div>
                 ))}
               </div>
            </div>
          )}

        </div>

        <div className="p-4 bg-gray-50 border-t border-gray-200 rounded-b-lg flex space-x-3">
          <button 
            onClick={handleRun}
            className="flex-1 inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
          >
            <Play className="h-4 w-4 mr-2" />
            Evaluate
          </button>
          <button 
             onClick={() => { setSimulationLogs([]); setHydrationLogs([]); }}
             className="inline-flex justify-center items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Execution Log */}
      <div className="lg:col-span-2 bg-white rounded-lg shadow flex flex-col h-full overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
          <h3 className="font-semibold text-gray-700">Execution Plan (Control Plane)</h3>
          {simulationLogs.length > 0 && (
             <span className="text-xs text-gray-500">
               {simulationLogs.filter(r => r.success).length} rules triggered
             </span>
          )}
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 bg-slate-900 font-mono text-sm">
          {simulationLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500">
              <Server className="h-12 w-12 mb-4 opacity-50" />
              <p>Waiting for events...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {simulationLogs.map((log, idx) => (
                <div key={idx} className={`p-3 rounded border-l-4 ${log.success ? 'bg-slate-800 border-green-500' : 'bg-slate-800 border-slate-600 opacity-60'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`font-bold ${log.success ? 'text-green-400' : 'text-slate-400'}`}>
                       {log.ruleName}
                    </span>
                    {log.success ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-slate-500" />}
                  </div>
                  
                  {log.logs.map((l, i) => (
                    <div key={i} className="text-slate-400 text-xs mb-1">
                      {l}
                    </div>
                  ))}

                  {log.success && log.emissions.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-700">
                      <div className="text-indigo-400 text-xs font-semibold mb-1">EMISSIONS (PROTO-PLAN):</div>
                      {log.emissions.map((e, i) => (
                        <div key={i} className="text-indigo-300 text-xs pl-2 mb-1">
                          • {e.relationshipType} &rarr; <span className="text-white font-bold">{e.subtaskName}</span>
                          <div className="text-slate-500 pl-4">{JSON.stringify(e.params)}</div>
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
  );
};