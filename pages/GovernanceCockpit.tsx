/**
 * Governance Cockpit - Mission Control Center for PKG Simulator
 * 
 * Three-Column Layout:
 * 1. Perception Feed (Step 7) - Live stream with violation detection
 * 2. Contextual Brain (Step 6) - Temporal timeline and active facts
 * 3. Simulation Lab (Step 5) - Digital Twin Critic feedback
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Video, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Brain, 
  Shield, 
  Play, 
  Pause,
  SkipForward,
  Settings,
  Activity,
  Zap
} from 'lucide-react';
import { Snapshot, Fact, Rule } from '../types';
import { getActiveFactsAtTime, evaluateTemporalPolicy, TEMPORAL_FIXTURES } from '../services/temporalPolicyService';
import { validateRulesWithDigitalTwin, runPreFlightValidation } from '../services/digitalTwinService';
import { processStreamFrame, StreamFrame, StreamGovernanceResult } from '../services/multimodalGovernanceService';
import { DesignContext } from '../services/designGovernanceService';

const API_BASE_URL = import.meta.env.VITE_DB_PROXY_URL || 'http://localhost:3001';

interface GovernanceCockpitProps {
  snapshotId?: number;
}

export const GovernanceCockpit: React.FC<GovernanceCockpitProps> = ({ snapshotId }) => {
  // State
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [activeSnapshotId, setActiveSnapshotId] = useState<number | null>(snapshotId || null);
  
  // Column 1: Perception Feed (Step 7)
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamResult, setStreamResult] = useState<StreamGovernanceResult | null>(null);
  const [violationOverlay, setViolationOverlay] = useState<{ x: number; y: number; width: number; height: number; type: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  
  // Column 2: Contextual Brain (Step 6)
  const [simulatedTime, setSimulatedTime] = useState<string>(new Date().toISOString());
  const [timeSliderValue, setTimeSliderValue] = useState(0); // 0-100 for simulation
  const [activeFacts, setActiveFacts] = useState<Fact[]>([]);
  const [temporalEvaluation, setTemporalEvaluation] = useState<any>(null);
  
  // Column 3: Simulation Lab (Step 5)
  const [criticLog, setCriticLog] = useState<Array<{ role: 'mother' | 'critic'; message: string; timestamp: string }>>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);
  
  // Load snapshots list on mount
  useEffect(() => {
    loadSnapshots();
  }, []);
  
  // Load snapshot and data when activeSnapshotId changes
  useEffect(() => {
    if (activeSnapshotId) {
      loadSnapshotData(activeSnapshotId);
    }
  }, [activeSnapshotId]);
  
  const loadSnapshots = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/snapshots`);
      if (res.ok) {
        const snapshots = await res.json();
        if (snapshots.length > 0 && !activeSnapshotId) {
          const active = snapshots.find((s: Snapshot) => s.isActive) || snapshots[0];
          setActiveSnapshotId(active.id);
        }
      }
    } catch (error) {
      console.error('Error loading snapshots:', error);
    }
  };
  
  // Update active facts when time changes
  useEffect(() => {
    if (facts.length > 0) {
      const active = getActiveFactsAtTime(facts, simulatedTime);
      setActiveFacts(active);
      
      // Re-evaluate temporal policy
      if (rules.length > 0) {
        const evalResult = evaluateTemporalPolicy(rules, {
          currentTime: simulatedTime,
          facts: active,
          tags: {},
          signals: {},
        });
        setTemporalEvaluation(evalResult);
      }
    }
  }, [simulatedTime, facts, rules]);
  
  const loadSnapshotData = async (snapshotId: number) => {
    try {
      // Load snapshot
      const snapshotRes = await fetch(`${API_BASE_URL}/api/snapshots/${snapshotId}`);
      if (snapshotRes.ok) {
        const snap = await snapshotRes.json();
        setSnapshot(snap);
      }
      
      // Load facts
      const factsRes = await fetch(`${API_BASE_URL}/api/facts?snapshotId=${snapshotId}`);
      if (factsRes.ok) {
        const factsData = await factsRes.json();
        setFacts(factsData);
      }
      
      // Load rules
      const rulesRes = await fetch(`${API_BASE_URL}/api/rules?snapshotId=${snapshotId}`);
      if (rulesRes.ok) {
        const rulesData = await rulesRes.json();
        setRules(rulesData);
      }
    } catch (error) {
      console.error('Error loading snapshot data:', error);
    }
  };
  
  // Column 1: Start/Stop stream
  const handleStartStream = useCallback(async () => {
    if (!videoRef.current || !activeSnapshotId) return;
    
    setIsStreaming(true);
    
    // Capture frame every 500ms
    const interval = setInterval(async () => {
      if (!videoRef.current || !isStreaming) {
        clearInterval(interval);
        return;
      }
      
      try {
        // Capture frame to canvas
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        canvas.width = videoRef.current.videoWidth || 640;
        canvas.height = videoRef.current.videoHeight || 480;
        ctx.drawImage(videoRef.current, 0, 0);
        
        // Convert to base64
        const imageData = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        
        // Create stream frame
        const frame: StreamFrame = {
          frameId: `frame_${Date.now()}`,
          timestamp: new Date().toISOString(),
          imageData,
          sensorData: {
            inkLevel: Math.random() * 100,
            printerStatus: 'printing' as const,
          },
          guestContext: {
            guestId: 'guest_123',
            room: '301',
          },
        };
        
        // Create design context
        const designContext: DesignContext = {
          guestId: 'guest_123',
          guestTags: ['VIP'],
          guestCredits: 100,
          designMetadata: {
            title: 'Live Stream Design',
            fabricType: 'silk',
            designType: 'dress',
            inkConsumption: 45,
          },
          requestType: 'print',
        };
        
        // Process frame
        const result = await processStreamFrame(
          frame,
          designContext,
          activeSnapshotId,
          API_BASE_URL
        );
        
        setStreamResult(result);
        
        // Update violation overlay if detected
        if (result.violationDetected && result.violationType) {
          setViolationOverlay({
            x: 100,
            y: 100,
            width: 200,
            height: 150,
            type: result.violationType,
          });
        } else {
          setViolationOverlay(null);
        }
        
        // Add to critic log
        if (result.gateSignal) {
          addCriticLog('critic', `Violation detected: ${result.gateSignal.reason}`, result.timestamp);
        }
      } catch (error) {
        console.error('Error processing frame:', error);
      }
    }, 500);
    
    return () => clearInterval(interval);
  }, [activeSnapshotId, isStreaming]);
  
  const handleStopStream = () => {
    setIsStreaming(false);
    setStreamResult(null);
    setViolationOverlay(null);
  };
  
  // Column 2: Time slider handler
  const handleTimeSliderChange = (value: number) => {
    setTimeSliderValue(value);
    
    // Calculate simulated time (0 = now, 100 = 24 hours from now)
    const now = new Date();
    const hoursOffset = (value / 100) * 24;
    const simulated = new Date(now.getTime() + hoursOffset * 60 * 60 * 1000);
    setSimulatedTime(simulated.toISOString());
  };
  
  // Column 3: Run Digital Twin validation
  const handleRunValidation = async () => {
    if (!snapshot || rules.length === 0) return;
    
    setIsValidating(true);
    addCriticLog('mother', `Validating ${rules.length} rules against hardware constraints...`, new Date().toISOString());
    
    try {
      const result = await validateRulesWithDigitalTwin(rules, snapshot);
      setValidationResult(result);
      
      // Add critic feedback to log
      if (result.passed) {
        addCriticLog('critic', '✅ All rules passed hardware validation', new Date().toISOString());
      } else {
        result.issues.forEach(issue => {
          addCriticLog('critic', `⚠️ ${issue.severity.toUpperCase()}: ${issue.issue}`, new Date().toISOString());
        });
      }
    } catch (error) {
      addCriticLog('critic', `❌ Validation error: ${error instanceof Error ? error.message : String(error)}`, new Date().toISOString());
    } finally {
      setIsValidating(false);
    }
  };
  
  const addCriticLog = (role: 'mother' | 'critic', message: string, timestamp: string) => {
    setCriticLog(prev => [...prev.slice(-49), { role, message, timestamp }]);
  };
  
  // Get gate signal color
  const getGateSignalColor = (action?: string) => {
    switch (action) {
      case 'BLOCK': return 'bg-red-500';
      case 'PAUSE': return 'bg-yellow-500';
      case 'GO': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };
  
  // Get fact expiration status
  const getFactExpirationStatus = (fact: Fact) => {
    if (!fact.validTo) return 'indefinite';
    const validTo = new Date(fact.validTo);
    const now = new Date(simulatedTime);
    const hoursUntilExpiry = (validTo.getTime() - now.getTime()) / (1000 * 60 * 60);
    
    if (hoursUntilExpiry < 0) return 'expired';
    if (hoursUntilExpiry < 1) return 'critical';
    if (hoursUntilExpiry < 6) return 'warning';
    return 'normal';
  };
  
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Governance Cockpit</h1>
            <p className="text-sm text-gray-500 mt-1">Mission Control Center for PKG Simulator</p>
          </div>
          <div className="flex items-center space-x-4">
            <select
              value={activeSnapshotId || ''}
              onChange={(e) => setActiveSnapshotId(Number(e.target.value))}
              className="px-4 py-2 border border-gray-300 rounded-md"
            >
              <option value="">Select Snapshot</option>
              {/* Snapshot options loaded dynamically */}
            </select>
            <button
              onClick={handleRunValidation}
              disabled={isValidating || !snapshot}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {isValidating ? 'Validating...' : 'Run Digital Twin Validation'}
            </button>
          </div>
        </div>
      </div>
      
      {/* Three-Column Layout */}
      <div className="flex-1 grid grid-cols-3 gap-4 p-4 overflow-hidden">
        {/* Column 1: Perception Feed (Step 7) */}
        <div className="bg-white rounded-lg shadow border border-gray-200 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 flex items-center">
              <Video className="h-5 w-5 mr-2" />
              Perception Feed
            </h2>
            <div className="flex items-center space-x-2">
              {isStreaming ? (
                <button
                  onClick={handleStopStream}
                  className="px-3 py-1 bg-red-500 text-white rounded text-sm flex items-center"
                >
                  <Pause className="h-4 w-4 mr-1" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleStartStream}
                  className="px-3 py-1 bg-green-500 text-white rounded text-sm flex items-center"
                >
                  <Play className="h-4 w-4 mr-1" />
                  Start
                </button>
              )}
            </div>
          </div>
          
          <div className="flex-1 relative overflow-hidden">
            {/* Video/Canvas */}
            <div className="relative w-full h-full bg-black">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-contain"
                style={{ display: isStreaming ? 'block' : 'none' }}
              />
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full"
                style={{ display: 'none' }}
              />
              
              {/* Violation Overlay */}
              {violationOverlay && (
                <div
                  className="absolute border-4 border-red-500 bg-red-500 bg-opacity-20"
                  style={{
                    left: `${violationOverlay.x}px`,
                    top: `${violationOverlay.y}px`,
                    width: `${violationOverlay.width}px`,
                    height: `${violationOverlay.height}px`,
                  }}
                >
                  <div className="absolute -top-6 left-0 bg-red-500 text-white px-2 py-1 text-xs rounded">
                    {violationOverlay.type}
                  </div>
                </div>
              )}
              
              {!isStreaming && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <Video className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Stream not active</p>
                  </div>
                </div>
              )}
            </div>
            
            {/* Reflex Indicators */}
            {streamResult && (
              <div className="absolute bottom-4 left-4 right-4">
                <div className={`${getGateSignalColor(streamResult.gateSignal?.action)} text-white px-4 py-2 rounded-lg flex items-center justify-between`}>
                  <div className="flex items-center">
                    {streamResult.gateSignal?.action === 'BLOCK' && <AlertCircle className="h-5 w-5 mr-2" />}
                    {streamResult.gateSignal?.action === 'PAUSE' && <Clock className="h-5 w-5 mr-2" />}
                    {streamResult.gateSignal?.action === 'GO' && <CheckCircle2 className="h-5 w-5 mr-2" />}
                    <span className="font-semibold">{streamResult.gateSignal?.action || 'PENDING'}</span>
                  </div>
                  <div className="text-sm opacity-90">
                    {streamResult.latency}ms latency
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Stream Stats */}
          {streamResult && (
            <div className="px-4 py-2 border-t border-gray-200 text-xs text-gray-600">
              <div className="grid grid-cols-2 gap-2">
                <div>Violation: {streamResult.violationDetected ? 'Yes' : 'No'}</div>
                <div>Type: {streamResult.violationType || 'None'}</div>
              </div>
            </div>
          )}
        </div>
        
        {/* Column 2: Contextual Brain (Step 6) */}
        <div className="bg-white rounded-lg shadow border border-gray-200 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900 flex items-center">
              <Brain className="h-5 w-5 mr-2" />
              Contextual Brain
            </h2>
          </div>
          
          {/* Temporal Timeline */}
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Simulated Time</label>
              <span className="text-xs text-gray-500">{new Date(simulatedTime).toLocaleTimeString()}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={timeSliderValue}
              onChange={(e) => handleTimeSliderChange(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Now</span>
              <span>+24h</span>
            </div>
          </div>
          
          {/* Active Facts Panel */}
          <div className="flex-1 overflow-y-auto px-4 py-2">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Active Facts ({activeFacts.length})</h3>
            <div className="space-y-2">
              {activeFacts.map((fact) => {
                const status = getFactExpirationStatus(fact);
                return (
                  <div
                    key={fact.id}
                    className={`p-2 rounded border ${
                      status === 'critical' ? 'border-red-500 bg-red-50 animate-pulse' :
                      status === 'warning' ? 'border-yellow-500 bg-yellow-50' :
                      status === 'expired' ? 'border-gray-300 bg-gray-50 opacity-50' :
                      'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="text-xs font-medium text-gray-900">
                          {fact.namespace}:{fact.predicate}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          {fact.subject}
                        </div>
                        {fact.validTo && (
                          <div className="text-xs text-gray-500 mt-1">
                            Expires: {new Date(fact.validTo).toLocaleTimeString()}
                          </div>
                        )}
                      </div>
                      {status === 'critical' && (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                  </div>
                );
              })}
              {activeFacts.length === 0 && (
                <div className="text-center text-gray-400 py-8 text-sm">No active facts</div>
              )}
            </div>
          </div>
          
          {/* Temporal Evaluation Result */}
          {temporalEvaluation && (
            <div className="px-4 py-2 border-t border-gray-200">
              <div className={`text-sm p-2 rounded ${
                temporalEvaluation.allowed ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
              }`}>
                <div className="font-medium">
                  {temporalEvaluation.allowed ? '✅ Allowed' : '❌ Blocked'}
                </div>
                <div className="text-xs mt-1">{temporalEvaluation.reason}</div>
              </div>
            </div>
          )}
        </div>
        
        {/* Column 3: Simulation Lab (Step 5) */}
        <div className="bg-white rounded-lg shadow border border-gray-200 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900 flex items-center">
              <Shield className="h-5 w-5 mr-2" />
              Simulation Lab
            </h2>
          </div>
          
          {/* Mother vs Critic Log */}
          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
            {criticLog.map((log, idx) => (
              <div
                key={idx}
                className={`p-2 rounded text-sm ${
                  log.role === 'mother' ? 'bg-blue-50 border border-blue-200' : 'bg-purple-50 border border-purple-200'
                }`}
              >
                <div className="flex items-start">
                  <div className={`font-medium mr-2 ${
                    log.role === 'mother' ? 'text-blue-700' : 'text-purple-700'
                  }`}>
                    {log.role === 'mother' ? '🤖 Mother' : '🔍 Critic'}:
                  </div>
                  <div className="flex-1 text-gray-700">{log.message}</div>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
            {criticLog.length === 0 && (
              <div className="text-center text-gray-400 py-8 text-sm">
                No validation logs yet. Run Digital Twin validation to start.
              </div>
            )}
          </div>
          
          {/* Validation Result Summary */}
          {validationResult && (
            <div className="px-4 py-2 border-t border-gray-200">
              <div className={`text-sm p-2 rounded ${
                validationResult.passed ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
              }`}>
                <div className="font-medium">
                  Validation Score: {(validationResult.validationScore * 100).toFixed(1)}%
                </div>
                <div className="text-xs mt-1">
                  Issues: {validationResult.issues.length}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
