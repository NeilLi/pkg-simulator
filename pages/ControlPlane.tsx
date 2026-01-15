import React, { useEffect, useState } from 'react';
import { 
  Bot, GitMerge, ShieldAlert, Rocket, Terminal, 
  ArrowRight, CheckCircle, XCircle, Loader2, Play 
} from 'lucide-react';
import { getSnapshots, getRules } from '../mockData';
import { EvolutionProposal, AgentLog, Snapshot, ValidationRun, Rule } from '../types';
import { proposeEvolution, buildSnapshotFromProposal, runValidationAgent, calculateCanaryStep } from '../services/agentSystem';

export const ControlPlane: React.FC = () => {
  // State for the pipeline
  const [intent, setIntent] = useState("We are seeing too many false positive fire alarms from toaster ovens in standard rooms. Adjust threshold.");
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [proposal, setProposal] = useState<EvolutionProposal | null>(null);
  const [draftSnapshot, setDraftSnapshot] = useState<Snapshot | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationRun | null>(null);
  const [deploymentPercent, setDeploymentPercent] = useState<number>(0);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  
  // Loaders
  const [isEvolving, setIsEvolving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [snaps, ruls] = await Promise.all([getSnapshots(), getRules()]);
        setSnapshots(snaps);
        setRules(ruls);
      } catch (error) {
        console.error('Error loading control plane data:', error);
      } finally {
        setLoadingData(false);
      }
    };
    loadData();
  }, []);

  const addLog = (agent: AgentLog['agent'], message: string, level: AgentLog['level'] = 'INFO') => {
    setAgentLogs(prev => [{
      id: Math.random().toString(),
      agent,
      message,
      timestamp: new Date().toLocaleTimeString(),
      level
    }, ...prev]);
  };

  const handleEvolution = async () => {
    if (loadingData) return;
    setIsEvolving(true);
    addLog('EVOLUTION', 'Analyzing intent and historical failure patterns...', 'INFO');
    
    // Use the latest PROD snapshot as base
    const baseSnapshot = snapshots.find(s => s.env === 'prod' && s.isActive) || snapshots[0];
    if (!baseSnapshot) {
      addLog('EVOLUTION', 'No snapshots available. Load snapshots first.', 'ERROR');
      setIsEvolving(false);
      return;
    }
    
    const prop = await proposeEvolution(intent, baseSnapshot);
    
    if (prop) {
      setProposal(prop);
      addLog('EVOLUTION', `Generated proposal: ${prop.newVersion}`, 'SUCCESS');
    } else {
      addLog('EVOLUTION', 'Failed to generate proposal. Check API Key.', 'ERROR');
    }
    setIsEvolving(false);
  };

  const handleBuildAndValidate = async () => {
    if (!proposal) return;
    
    // 1. Build Snapshot
    addLog('EVOLUTION', 'Building draft snapshot...', 'INFO');
    const { snapshot, newRules } = buildSnapshotFromProposal(proposal, rules);
    setDraftSnapshot(snapshot);
    addLog('EVOLUTION', `Snapshot ${snapshot.version} built. Size: ${snapshot.sizeBytes} bytes.`, 'SUCCESS');

    // 2. Run Validation
    setIsValidating(true);
    addLog('VALIDATION', 'Initializing simulation suite...', 'INFO');
    const result = await runValidationAgent(snapshot.id, newRules);
    setValidationResult(result);
    
    if (result.success) {
      addLog('VALIDATION', `Validation PASSED. Score: ${result.report?.simulationScore}`, 'SUCCESS');
    } else {
      addLog('VALIDATION', `Validation FAILED. Conflicts: ${result.report?.conflicts.length}`, 'ERROR');
    }
    setIsValidating(false);
  };

  const handleDeployStep = () => {
    const nextStep = calculateCanaryStep(deploymentPercent);
    setDeploymentPercent(nextStep);
    addLog('DEPLOYMENT', `Canary rollout increased to ${nextStep}%`, 'WARN');
    if (nextStep === 100) {
      addLog('DEPLOYMENT', 'Full rollout complete. Snapshot promoted to PROD.', 'SUCCESS');
    }
  };

  return (
    <div className="h-full flex flex-col space-y-4">
      
      {/* Top Status Bar */}
      <div className="bg-slate-900 text-white p-4 rounded-lg flex items-center justify-between shadow-md">
         <div className="flex items-center space-x-3">
           <Bot className="text-indigo-400 h-6 w-6" />
           <span className="font-semibold text-lg">Autonomous Control Plane</span>
         </div>
         <div className="flex space-x-6 text-sm text-slate-400">
           <div className="flex items-center"><span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>Evolution Agent: IDLE</div>
           <div className="flex items-center"><span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>Validation Agent: ACTIVE</div>
           <div className="flex items-center"><span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>Deployment Agent: LISTENING</div>
         </div>
      </div>
      {loadingData && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">
          Loading snapshots and rules from the proxy server...
        </div>
      )}

      {/* Main Pipeline Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        
        {/* COL 1: Evolution (Input -> Proposal) */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col">
          <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-700 flex items-center"><GitMerge className="w-4 h-4 mr-2 text-indigo-500"/> Policy Evolution</h3>
            <span className="text-xs font-mono bg-gray-200 px-2 py-1 rounded">AGENT-1</span>
          </div>
          <div className="p-4 flex-1 overflow-y-auto space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Human Intent / Incident Log</label>
              <textarea 
                className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm border p-3 h-32"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="Describe what needs to change..."
              />
            </div>
            
            <button 
              onClick={handleEvolution}
              disabled={loadingData || isEvolving || !!proposal}
              className={`w-full flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${isEvolving || !!proposal ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`}
            >
              {isEvolving ? <Loader2 className="animate-spin mr-2 h-4 w-4"/> : <Bot className="mr-2 h-4 w-4"/>}
              Analyze & Propose
            </button>

            {proposal && (
              <div className="mt-4 bg-indigo-50 border border-indigo-100 rounded-md p-4">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-bold text-indigo-800 uppercase">PROPOSAL GENERATED</span>
                  <span className="text-xs font-mono text-gray-500">{proposal.generatedAt}</span>
                </div>
                <h4 className="font-bold text-gray-900">{proposal.newVersion}</h4>
                <p className="text-sm text-gray-600 mt-1 mb-3">{proposal.reason}</p>
                <div className="space-y-2">
                   {proposal.changes.map((c, i) => (
                     <div key={i} className="text-xs bg-white p-2 rounded border border-indigo-100">
                       <span className={`font-bold mr-2 ${c.action === 'DELETE' ? 'text-red-600' : 'text-green-600'}`}>{c.action}</span>
                       <span className="text-gray-500">{c.rationale}</span>
                     </div>
                   ))}
                </div>
                <div className="mt-4 flex space-x-2">
                   <button 
                     onClick={handleBuildAndValidate}
                     disabled={!!draftSnapshot}
                     className="flex-1 bg-indigo-600 text-white text-xs py-2 rounded hover:bg-indigo-700 disabled:bg-gray-400"
                   >
                     Approve & Build
                   </button>
                   <button 
                     onClick={() => { setProposal(null); setDraftSnapshot(null); setValidationResult(null); }}
                     className="px-3 py-2 bg-white border border-gray-300 text-gray-700 text-xs rounded hover:bg-gray-50"
                   >
                     Reject
                   </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* COL 2: Validation (Snapshot -> Result) */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col">
           <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-700 flex items-center"><ShieldAlert className="w-4 h-4 mr-2 text-emerald-500"/> Validation Gate</h3>
            <span className="text-xs font-mono bg-gray-200 px-2 py-1 rounded">AGENT-2</span>
          </div>
          <div className="p-4 flex-1 flex flex-col items-center justify-center space-y-6">
             {!draftSnapshot && (
               <div className="text-center text-gray-400">
                 <ShieldAlert className="h-12 w-12 mx-auto mb-2 opacity-20" />
                 <p className="text-sm">Waiting for built snapshot...</p>
               </div>
             )}

             {draftSnapshot && (
               <div className="w-full">
                  <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-lg mb-4 text-center">
                    <div className="text-xs font-bold text-emerald-800 uppercase mb-1">CANDIDATE SNAPSHOT</div>
                    <div className="font-mono text-lg font-bold">{draftSnapshot.version}</div>
                    <div className="text-xs text-emerald-600 mt-1">Checksum: {draftSnapshot.checksum.substring(0, 12)}</div>
                  </div>

                  {isValidating && (
                    <div className="flex flex-col items-center py-8">
                       <Loader2 className="h-8 w-8 text-emerald-500 animate-spin mb-2" />
                       <span className="text-sm text-gray-500">Running simulation suite...</span>
                    </div>
                  )}

                  {!isValidating && validationResult && (
                    <div className={`border rounded-lg p-4 ${validationResult.success ? 'bg-white border-green-200' : 'bg-red-50 border-red-200'}`}>
                       <div className="flex items-center justify-between mb-4">
                         <span className="font-bold text-gray-700">Validation Report</span>
                         {validationResult.success ? <CheckCircle className="text-green-500"/> : <XCircle className="text-red-500"/>}
                       </div>
                       <div className="grid grid-cols-2 gap-4 text-center mb-4">
                          <div className="bg-gray-50 p-2 rounded">
                            <div className="text-xl font-bold text-gray-800">{validationResult.report?.passed}</div>
                            <div className="text-xs text-gray-500">Passed Checks</div>
                          </div>
                          <div className="bg-gray-50 p-2 rounded">
                            <div className="text-xl font-bold text-gray-800">{validationResult.report?.failed}</div>
                            <div className="text-xs text-gray-500">Failures</div>
                          </div>
                       </div>
                       {validationResult.success && (
                         <button 
                           onClick={() => handleDeployStep()}
                           disabled={deploymentPercent > 0}
                           className="w-full bg-emerald-600 text-white py-2 rounded shadow hover:bg-emerald-700 flex justify-center items-center disabled:bg-gray-300"
                         >
                           <ArrowRight className="h-4 w-4 mr-2" />
                           Proceed to Deployment
                         </button>
                       )}
                    </div>
                  )}
               </div>
             )}
          </div>
        </div>

        {/* COL 3: Deployment (Result -> Production) */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col">
           <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-700 flex items-center"><Rocket className="w-4 h-4 mr-2 text-amber-500"/> Canary Deployment</h3>
            <span className="text-xs font-mono bg-gray-200 px-2 py-1 rounded">AGENT-3</span>
          </div>
          <div className="p-4 flex-1 flex flex-col">
             
             {deploymentPercent === 0 ? (
               <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                  <Rocket className="h-12 w-12 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No active canary rollout.</p>
               </div>
             ) : (
               <div className="space-y-6">
                  <div className="text-center">
                    <div className="text-sm text-gray-500 mb-1">Target Version</div>
                    <div className="text-2xl font-bold text-indigo-600">{draftSnapshot?.version}</div>
                  </div>

                  <div className="relative pt-1">
                    <div className="flex mb-2 items-center justify-between">
                      <div className="text-right">
                        <span className="text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-indigo-600 bg-indigo-200">
                          {deploymentPercent}% Traffic
                        </span>
                      </div>
                    </div>
                    <div className="overflow-hidden h-4 mb-4 text-xs flex rounded bg-indigo-200">
                      <div style={{ width: `${deploymentPercent}%` }} className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-indigo-500 transition-all duration-500"></div>
                    </div>
                  </div>

                  <div className="bg-amber-50 border border-amber-200 p-4 rounded text-sm text-amber-800">
                     <p className="font-bold flex items-center mb-2"><Play className="h-3 w-3 mr-2"/> Live Metrics (Simulated)</p>
                     <ul className="list-disc pl-5 space-y-1 text-xs">
                       <li>Error Rate: 0.01% (Stable)</li>
                       <li>Latency: 45ms (Normal)</li>
                       <li>Rule Evaluations: 1,204/sec</li>
                     </ul>
                  </div>

                  {deploymentPercent < 100 ? (
                    <div className="flex space-x-3">
                       <button onClick={handleDeployStep} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2 rounded shadow">
                         Promote Stage
                       </button>
                       <button onClick={() => setDeploymentPercent(0)} className="px-4 bg-red-100 text-red-700 hover:bg-red-200 rounded border border-red-200">
                         Rollback
                       </button>
                    </div>
                  ) : (
                    <div className="bg-green-100 text-green-800 p-4 rounded text-center font-bold border border-green-200">
                      Rollout Complete
                    </div>
                  )}
               </div>
             )}

          </div>
        </div>

      </div>

      {/* Terminal Log */}
      <div className="h-48 bg-slate-900 rounded-lg shadow-inner overflow-hidden flex flex-col">
        <div className="p-2 bg-slate-800 border-b border-slate-700 flex items-center space-x-2">
           <Terminal className="text-slate-400 h-4 w-4" />
           <span className="text-xs text-slate-400 font-mono">Agent Event Stream</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1">
          {agentLogs.length === 0 && <span className="text-slate-600 italic">System ready. Waiting for events...</span>}
          {agentLogs.map((log) => (
            <div key={log.id} className="flex space-x-3">
               <span className="text-slate-500">[{log.timestamp}]</span>
               <span className={`${
                 log.agent === 'EVOLUTION' ? 'text-indigo-400' :
                 log.agent === 'VALIDATION' ? 'text-emerald-400' : 'text-amber-400'
               } font-bold w-24`}>{log.agent}</span>
               <span className={`${
                 log.level === 'ERROR' ? 'text-red-400' : 
                 log.level === 'WARN' ? 'text-yellow-400' : 
                 log.level === 'SUCCESS' ? 'text-green-300' : 'text-slate-300'
               }`}>{log.message}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};