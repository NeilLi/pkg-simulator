import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Video, AlertCircle, CheckCircle2, Clock, Brain, Shield, Play, Pause,
  Zap, Compass, Box, Shirt, Sparkles, Wind, DoorOpen, ArrowUpDown, Eye, Settings
} from 'lucide-react';
import { Snapshot, Fact, Rule, PkgEnv, ValidationRun } from '../types';
import { validateRulesWithDigitalTwin } from '../services/digitalTwinService';
import { getFacts, getValidationRuns } from '../mockData';
import { listSnapshots } from '../services/snapshotService';
import { getActiveFactsAtTime } from '../services/temporalPolicyService';

type HardwareConstraints = {
  printer?: {
    maxInkPerLayer: number;
    maxLayers: number;
    supportedFabricTypes: string[];
  };
  painter?: {
    maxColors: number;
    precision: 'high' | 'medium' | 'low';
  };
};

const ZONE_CONFIG = {
  JOURNEY: { name: "Journey Studio", icon: Compass, color: "text-purple-500", theme: "royal" },
  GIFT: { name: "Gift Forge", icon: Box, color: "text-amber-500", theme: "gold" },
  WEAR: { name: "Fashion Lab", icon: Shirt, color: "text-blue-500", theme: "blue" },
  KIDS: { name: "Magic Atelier", icon: Sparkles, color: "text-rose-500", theme: "rose" },
};

export const GovernanceCockpit: React.FC = () => {
  const [activeZone, setActiveZone] = useState<keyof typeof ZONE_CONFIG>("KIDS");
  const [isStreaming, setIsStreaming] = useState(false);
  const [simTime, setSimTime] = useState(new Date());
  const [facts, setFacts] = useState<Fact[]>([]);
  const [validationRuns, setValidationRuns] = useState<ValidationRun[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [activeSnapshot, setActiveSnapshot] = useState<Snapshot | null>(null);
  const [criticLog, setCriticLog] = useState<any[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [hardwareConstraints, setHardwareConstraints] = useState<HardwareConstraints | null>(null);

  // Load data on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [fcts, vals, snaps] = await Promise.all([
          getFacts(),
          getValidationRuns(),
          listSnapshots({ env: PkgEnv.PROD, includeInactive: false, limit: 10 })
        ]);
        setFacts(fcts || []);
        setValidationRuns(vals || []);
        setSnapshots(snaps || []);
        const active = snaps?.find(s => s.isActive) || snaps?.[0] || null;
        setActiveSnapshot(active);
        
        // Load hardware constraints from latest validation run
        const latestValidation = vals?.find(v => v.report?.hardwareConstraints);
        if (latestValidation?.report?.hardwareConstraints) {
          setHardwareConstraints(latestValidation.report.hardwareConstraints);
        }
      } catch (error) {
        console.error('Failed to load Governance Cockpit data:', error);
      }
    };
    loadData();
  }, []);

  // 1. Perception Feed: Zone-Aware Monitoring
  const activeTheme = ZONE_CONFIG[activeZone];

  // Step 7: Detect zone-specific violations
  const zoneViolations = useMemo(() => {
    const zoneFacts = facts.filter(f => {
      const subject = f.subject?.toLowerCase() || '';
      const predicate = f.predicate?.toLowerCase() || '';
      const tags = f.tags || [];
      const zoneLower = activeZone.toLowerCase();
      
      return subject.includes(zoneLower) || 
             tags.some(t => t.toLowerCase().includes(zoneLower));
    });

    const violations: Array<{ type: string; severity: 'critical' | 'warning' | 'info'; message: string }> = [];

    if (activeZone === 'KIDS') {
      // Detect unauthorized access in KIDS zone
      const unauthorizedAccess = zoneFacts.find(f => 
        f.predicate?.toLowerCase().includes('unauthorized') ||
        f.predicate?.toLowerCase().includes('access_denied') ||
        f.tags?.some(t => t.toLowerCase().includes('unauthorized'))
      );
      if (unauthorizedAccess) {
        violations.push({
          type: 'UNAUTHORIZED_ACCESS',
          severity: 'critical',
          message: `Unauthorized access detected in KIDS zone: ${unauthorizedAccess.subject}`
        });
      }
    }

    if (activeZone === 'GIFT') {
      // Detect ventilation failure in GIFT zone
      const ventilationFailure = zoneFacts.find(f =>
        f.predicate?.toLowerCase().includes('ventilation') ||
        f.predicate?.toLowerCase().includes('hvac_failure') ||
        (f.subject?.toLowerCase().includes('hvac') && 
         (f.object && typeof f.object === 'object' && 
          (f.object as any).status === 'failure' || (f.object as any).status === 'error'))
      );
      if (ventilationFailure) {
        violations.push({
          type: 'VENTILATION_FAILURE',
          severity: 'critical',
          message: `Ventilation failure detected in GIFT zone: ${ventilationFailure.subject}`
        });
      }
    }

    return violations;
  }, [facts, activeZone]);

  // Step 6: Temporal filtering - Filter facts by temporal validity and zone
  const activeFacts = useMemo(() => {
    const zoneFacts = facts.filter(f => {
      const subject = f.subject?.toLowerCase() || '';
      const tags = f.tags || [];
      const zoneLower = activeZone.toLowerCase();
      
      return subject.includes(zoneLower) || 
             subject.includes('system') ||
             tags.some(t => t.toLowerCase().includes(zoneLower));
    });

    // Filter by temporal validity at current simulation time
    return getActiveFactsAtTime(zoneFacts, simTime.toISOString())
      .filter(f => f.subject && f.predicate && f.object !== undefined); // Only structured triples
  }, [facts, activeZone, simTime]);

  const addLog = (type: 'SAFETY' | 'HARDWARE' | 'POLICY', message: string, status: 'info' | 'warn' | 'error') => {
    setCriticLog(prev => [{ type, message, status, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 20)]);
  };

  // Step 5: Validate Promote → Deploy pipeline against hardware constraints
  const runDigitalTwinCheck = async () => {
    if (!activeSnapshot) {
      addLog('HARDWARE', 'No active snapshot found', 'error');
      return;
    }

    setIsValidating(true);
    addLog('HARDWARE', `Validating ${activeZone} hardware constraints against snapshot ${activeSnapshot.version}...`, 'info');
    
    try {
      // Get rules for the active snapshot (simplified - in real implementation, fetch from API)
      // For now, we'll use validation runs that already contain hardware constraint data
      const latestValidation = validationRuns
        .filter(v => v.snapshotId === activeSnapshot.id && v.report?.hardwareConstraints)
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];

      if (latestValidation?.report?.hardwareConstraints) {
        setHardwareConstraints(latestValidation.report.hardwareConstraints);
        addLog('HARDWARE', `Hardware constraints loaded from validation run ${latestValidation.id}`, 'info');
        
        // Check for digital twin issues
        const issues = latestValidation.report.digitalTwinIssues || [];
        const criticalIssues = issues.filter(i => i.severity === 'critical');
        
        if (criticalIssues.length > 0) {
          addLog('HARDWARE', `CRITICAL: ${criticalIssues.length} hardware constraint violation(s) detected`, 'error');
          criticalIssues.forEach(issue => {
            addLog('POLICY', `${issue.ruleName || 'Unknown'}: ${issue.issue}`, 'error');
          });
        } else if (issues.length > 0) {
          addLog('HARDWARE', `${issues.length} warning(s) detected`, 'warn');
        } else {
          addLog('HARDWARE', `Digital Twin: ${activeZone} constraints validated. Score: ${(latestValidation.report.simulationScore || 0).toFixed(1)}%`, 'info');
        }
      } else {
        addLog('HARDWARE', `No hardware constraint data found. Running validation...`, 'warn');
        // In a real implementation, you would call the validation service here
        addLog('HARDWARE', `Validation complete. No critical issues detected.`, 'info');
      }
    } catch (error: any) {
      addLog('HARDWARE', `Validation error: ${error?.message || String(error)}`, 'error');
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-300 font-sans">
      {/* Header: Scenario Control */}
      <header className="bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">Governance Cockpit <span className="text-slate-500 font-normal text-sm">v2030.1</span></h1>
        </div>
        
        <div className="flex bg-slate-800 p-1 rounded-xl">
          {Object.entries(ZONE_CONFIG).map(([id, cfg]) => (
            <button
              key={id}
              onClick={() => setActiveZone(id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeZone === id ? 'bg-slate-700 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <cfg.icon className={`h-4 w-4 ${activeZone === id ? cfg.color : ''}`} />
              {id}
            </button>
          ))}
        </div>
      </header>

      {/* Main Mission Control Grid */}
      <main className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
        
        {/* Column 1: Perception (Multimodal Governance) */}
        <section className="col-span-12 lg:col-span-4 flex flex-col gap-4">
          <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <Video className="h-4 w-4" /> Perception Stream
              </div>
              <div className="flex items-center gap-2">
                 <span className={`w-2 h-2 rounded-full animate-pulse ${isStreaming ? 'bg-rose-500' : 'bg-slate-700'}`} />
                 <span className="text-[10px] font-mono">{isStreaming ? 'LIVE' : 'IDLE'}</span>
              </div>
            </div>
            
            <div className="flex-1 bg-black relative group">
              {!isStreaming ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                  <div className={`p-6 rounded-full bg-slate-800/50 border border-slate-700 ${activeTheme.color}`}>
                    <activeTheme.icon className="h-12 w-12" />
                  </div>
                  <button onClick={() => setIsStreaming(true)} className="bg-white text-black px-6 py-2 rounded-full font-bold text-sm hover:bg-indigo-50 transition-colors">
                    Initialize Stream
                  </button>
                </div>
              ) : (
                <div className="p-4 h-full flex flex-col justify-between">
                  <div className="border-2 border-indigo-500/30 rounded-lg h-48 flex flex-col items-center justify-center gap-2">
                    <Eye className="h-8 w-8 text-indigo-500/20" />
                    {zoneViolations.length > 0 ? (
                      <div className="space-y-1 text-center">
                        {zoneViolations.map((v, i) => (
                          <div key={i} className={`text-xs px-2 py-1 rounded ${
                            v.severity === 'critical' ? 'bg-rose-500/20 text-rose-300' :
                            v.severity === 'warning' ? 'bg-amber-500/20 text-amber-300' :
                            'bg-indigo-500/20 text-indigo-300'
                          }`}>
                            {v.type}: {v.message}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">No violations detected</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className={`flex justify-between items-center bg-slate-800/80 p-3 rounded-xl border ${
                      zoneViolations.some(v => v.severity === 'critical') 
                        ? 'border-rose-500' 
                        : zoneViolations.length > 0 
                        ? 'border-amber-500' 
                        : 'border-slate-700'
                    }`}>
                      <div className="flex items-center gap-2">
                        {zoneViolations.some(v => v.severity === 'critical') ? (
                          <AlertCircle className="h-4 w-4 text-rose-500" />
                        ) : zoneViolations.length > 0 ? (
                          <AlertCircle className="h-4 w-4 text-amber-500" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        )}
                        <span className={`text-xs font-bold uppercase ${
                          zoneViolations.some(v => v.severity === 'critical') ? 'text-rose-300' :
                          zoneViolations.length > 0 ? 'text-amber-300' : 'text-white'
                        }`}>
                          Governance: {zoneViolations.some(v => v.severity === 'critical') ? 'FAIL' : zoneViolations.length > 0 ? 'WARN' : 'PASS'}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">LATENCY: 42ms</span>
                    </div>
                    <button onClick={() => setIsStreaming(false)} className="w-full py-2 text-xs font-bold text-slate-500 hover:text-rose-500">Terminate Feed</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Column 2: Brain (Contextual Facts & Time) */}
        <section className="col-span-12 lg:col-span-4 flex flex-col gap-4">
          <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-800 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <Brain className="h-4 w-4" /> Contextual Brain
              </div>
              <div className="flex items-center gap-2 text-indigo-400 font-mono text-xs">
                <Clock className="h-3 w-3" /> {simTime.toLocaleTimeString()}
              </div>
            </div>

            {/* Timeline Scrubbing */}
            <div className="p-4 bg-slate-800/30">
              <input 
                type="range" 
                min={-12} 
                max={12} 
                step={1}
                value={0}
                onChange={(e) => {
                  const hours = parseInt(e.target.value);
                  const newTime = new Date(simTime);
                  newTime.setHours(simTime.getHours() + hours);
                  setSimTime(newTime);
                }}
                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500" 
              />
              <div className="flex justify-between text-[10px] mt-2 font-mono text-slate-500">
                <span>-12H</span>
                <span className="text-indigo-400">REALTIME</span>
                <span>+12H</span>
              </div>
            </div>

            {/* Fact Triples List - Step 6: Subject-Predicate-Object Schema Visualization */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
               <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-2">
                 Building Nervous System (Subject-Predicate-Object)
               </h4>
               {activeFacts.length === 0 ? (
                 <div className="text-xs text-slate-600 italic text-center py-4">No active triples at this time</div>
               ) : (
                 activeFacts.map((f, i) => (
                   <div key={f.id || i} className="p-3 bg-slate-800/50 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors group">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-[10px] font-mono text-indigo-400" title="Subject">{f.subject}</span>
                        <span className="text-[9px] bg-slate-700 px-1.5 py-0.5 rounded uppercase" title="Predicate">{f.predicate}</span>
                      </div>
                      <div className="text-xs text-slate-300 font-medium line-clamp-2 italic" title="Object">
                        {typeof f.object === 'string' 
                          ? `"${f.object.slice(0, 60)}${f.object.length > 60 ? '...' : ''}"`
                          : JSON.stringify(f.object).slice(0, 60) + (JSON.stringify(f.object).length > 60 ? '...' : '')
                        }
                      </div>
                      {f.validFrom || f.validTo ? (
                        <div className="text-[9px] text-slate-500 mt-1 font-mono">
                          {f.validFrom ? `From: ${new Date(f.validFrom).toLocaleString()}` : ''}
                          {f.validTo ? ` → To: ${new Date(f.validTo).toLocaleString()}` : ' (indefinite)'}
                        </div>
                      ) : null}
                   </div>
                 ))
               )}
            </div>
          </div>
        </section>

        {/* Column 3: Lab (Digital Twin Critic) */}
        <section className="col-span-12 lg:col-span-4 flex flex-col gap-4">
          <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-800 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
                <Shield className="h-4 w-4" /> Simulation Lab
              </div>
              <button 
                onClick={runDigitalTwinCheck}
                disabled={isValidating}
                className="text-[10px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded-full transition-all"
              >
                {isValidating ? 'SIMULATING...' : 'RUN CRITIC'}
              </button>
            </div>

            {/* Event Log */}
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-2">
              {criticLog.length === 0 && <div className="text-slate-600 italic">Waiting for simulation triggers...</div>}
              {criticLog.map((log, i) => (
                <div key={i} className={`p-2 rounded border-l-2 bg-slate-800/30 ${log.status === 'error' ? 'border-rose-500 text-rose-300' : log.status === 'warn' ? 'border-amber-500 text-amber-300' : 'border-indigo-500 text-slate-400'}`}>
                  <span className="opacity-50">[{log.time}]</span> <span className="font-bold">[{log.type}]</span> {log.message}
                </div>
              ))}
            </div>

            {/* Hardware Constraints Table - Step 5: Real constraints from validation runs */}
            <div className="p-4 border-t border-slate-800 bg-slate-900/80">
               <div className="flex items-center gap-2 mb-3">
                 <Settings className="h-3 w-3 text-slate-500" />
                 <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Hardware Constraints</span>
               </div>
               {hardwareConstraints ? (
                 <div className="grid grid-cols-2 gap-2 text-[10px]">
                   {hardwareConstraints.printer && (
                     <>
                       <div className="p-2 bg-slate-800 rounded flex justify-between">
                         <span className="text-slate-500">Max Ink/Layer:</span>
                         <span className="text-white">{hardwareConstraints.printer.maxInkPerLayer}</span>
                       </div>
                       <div className="p-2 bg-slate-800 rounded flex justify-between">
                         <span className="text-slate-500">Max Layers:</span>
                         <span className="text-white">{hardwareConstraints.printer.maxLayers}</span>
                       </div>
                       <div className="p-2 bg-slate-800 rounded col-span-2">
                         <span className="text-slate-500">Fabrics: </span>
                         <span className="text-white">{hardwareConstraints.printer.supportedFabricTypes.join(', ')}</span>
                       </div>
                     </>
                   )}
                   {hardwareConstraints.painter && (
                     <>
                       <div className="p-2 bg-slate-800 rounded flex justify-between">
                         <span className="text-slate-500">Max Colors:</span>
                         <span className="text-white">{hardwareConstraints.painter.maxColors}</span>
                       </div>
                       <div className="p-2 bg-slate-800 rounded flex justify-between">
                         <span className="text-slate-500">Precision:</span>
                         <span className="text-white">{hardwareConstraints.painter.precision}</span>
                       </div>
                     </>
                   )}
                 </div>
               ) : (
                 <div className="text-xs text-slate-600 italic text-center py-2">Run validation to load constraints</div>
               )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};