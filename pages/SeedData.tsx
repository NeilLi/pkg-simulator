import React, { useState } from "react";
import {
  CheckCircle2, Loader2, Play, Shield, Database,
  Layers, Compass, Box, Shirt, Sparkles, Wind, ArrowUpDown
} from "lucide-react";
import { seedDataService, SeedResult } from "../services/seedDataService";

const DEFAULT_DB_PROXY = "http://localhost:3011";

// Support for all 2030+ Hotel Scenes
type SeedProfile = "JOURNEY" | "GIFT" | "WEAR" | "KIDS" | "INFRASTRUCTURE" | "MIXED";
type MemoryWriteMode = "dry_run" | "event_working" | "event_then_approve";

const ZONES = [
  { id: "JOURNEY", name: "Journey Studio", icon: Compass, color: "text-purple-600", bg: "bg-purple-50" },
  { id: "GIFT", name: "Gift Forge", icon: Box, color: "text-amber-600", bg: "bg-amber-50" },
  { id: "WEAR", name: "Fashion Lab", icon: Shirt, color: "text-blue-600", bg: "bg-blue-50" },
  { id: "KIDS", name: "Magic Atelier", icon: Sparkles, color: "text-rose-600", bg: "bg-rose-50" },
  { id: "INFRASTRUCTURE", name: "Building Systems", icon: Wind, color: "text-slate-600", bg: "bg-slate-50" }
];

export const SeedData: React.FC = () => {
  const [count, setCount] = useState(10);
  const [profile, setProfile] = useState<SeedProfile>("MIXED");
  const [writeMode, setWriteMode] = useState<MemoryWriteMode>("event_working");
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<SeedResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  // 1. Facts Summary (Constraint: < 10 items)
  const hotelFacts = [
    "Orchestrates 4 Creative Zones (Journey, Gift, Wear, Kids)",
    "Manages Smart HVAC & Environmental setpoints per zone",
    "Automates Door Access & Security based on Persona",
    "Smart Elevator Routing with Priority Handling",
    "Enforces Safety-First Policy for Magic Atelier (KIDS)",
    "Validates Hardware Constraints via Digital Twin Critic",
    "Archives Events into Unified Cortex Memory Tiers"
  ];

  const handleGenerate = async () => {
    setIsRunning(true);
    setLogs(["[SYSTEM] Initializing Multi-Zone Simulation..."]);
    
    try {
      const generated = await seedDataService.generateSeeds({
        count,
        profile,
        dbProxyUrl: DEFAULT_DB_PROXY,
        mode: writeMode,
        includeKnowledgeBase: false, // Can be made configurable later
      });

      setResults(generated.map(processSeed));
      setLogs(prev => [...prev, `[SUCCESS] Generated ${generated.length} seeds for ${profile}`]);
    } catch (e: any) {
      setLogs(prev => [...prev, `[ERROR] ${e.message}`]);
    } finally {
      setIsRunning(false);
    }
  };

  function processSeed(seed: SeedResult): SeedResult {
    // SeedResult now includes isSafety, isHvac, and zone from the service
    // No need to recompute, but ensure they're set
    return seed;
  }
  
  // Helper to get zone icon and color
  const getZoneInfo = (zone?: string) => {
    const zoneData = ZONES.find(z => z.id === zone);
    return zoneData || { icon: Database, color: "text-slate-400", name: zone || "Unknown" };
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 bg-gray-50 min-h-screen font-sans">
      {/* Header & Core Facts */}
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">SeedCore Scenario Generator</h1>
            <p className="text-slate-500 mt-2">Simulation Engine for Hotel 2030+ Operations</p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 mt-6">
              {hotelFacts.map((fact, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
                  <CheckCircle2 className="h-4 w-4 text-green-500" /> {fact}
                </div>
              ))}
            </div>
          </div>
          <div className="bg-indigo-600 text-white p-4 rounded-xl text-center min-w-[120px]">
            <div className="text-2xl font-bold">{results.length}</div>
            <div className="text-xs opacity-80">Active Seeds</div>
          </div>
        </div>
      </div>

      {/* Control Panel - Zone Selection */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
        <label className="block text-xs font-bold text-slate-500 uppercase mb-4">Select Zone Profile</label>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {ZONES.map((zone) => {
            const isSelected = profile === zone.id;
            const isInfrastructure = zone.id === "INFRASTRUCTURE";
            return (
              <button
                key={zone.id}
                onClick={() => setProfile(zone.id as SeedProfile)}
                className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-3 ${
                  isSelected 
                    ? "border-indigo-500 bg-white shadow-md scale-105" 
                    : "border-transparent bg-white/50 hover:bg-white hover:border-gray-200"
                }`}
              >
                <zone.icon className={`h-8 w-8 ${zone.color}`} />
                <span className="font-bold text-slate-800 text-sm text-center">{zone.name}</span>
                {isInfrastructure && (
                  <span className="text-[10px] text-slate-500">HVAC • Elevators • Doors</span>
                )}
                {zone.id === "KIDS" && (
                  <span className="text-[10px] text-rose-500">Safety Monitoring</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
        <div className="flex flex-wrap gap-6 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Simulation Volume</label>
            <input 
              type="range" min="1" max="50" value={count} 
              onChange={(e) => setCount(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between text-[10px] font-mono mt-2 text-slate-400">
              <span>1 UNIT</span>
              <span>CURRENT: {count}</span>
              <span>50 UNITS</span>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={isRunning}
            className="bg-slate-900 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-800 disabled:opacity-50"
          >
            {isRunning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
            Ignite Scenario
          </button>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-gray-200">
              <th className="p-4 text-xs font-bold text-slate-500 uppercase">Context</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase">Zone / Intent</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase">Operation</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase">Policy Gate</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase">Emissions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {results.map((res, i) => {
              const zoneInfo = getZoneInfo(res.zone);
              const ZoneIcon = zoneInfo.icon;
              const isInfrastructure = profile === "INFRASTRUCTURE" || ('operation' in res.intent);
              
              return (
                <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      {res.isSafety ? (
                        <Shield className="h-5 w-5 text-rose-500" />
                      ) : isInfrastructure ? (
                        <Wind className="h-5 w-5 text-slate-500" />
                      ) : (
                        <Database className="h-5 w-5 text-indigo-400" />
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <ZoneIcon className={`h-4 w-4 ${zoneInfo.color}`} />
                      <span className="text-xs font-semibold text-slate-600">{res.zone || profile}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">Tier: {writeMode}</div>
                  </td>
                  <td className="p-4">
                    <div className="font-bold text-slate-900">{res.title || "Operation"}</div>
                    {isInfrastructure && 'operation' in res.intent && (
                      <div className="text-xs text-slate-500 mt-1">
                        {res.intent.systemType} • Priority: {res.intent.priority}
                      </div>
                    )}
                  </td>
                  <td className="p-4">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold ${
                      res.allowed !== false ? "bg-green-100 text-green-700" : "bg-rose-100 text-rose-700"
                    }`}>
                      {res.allowed !== false ? "VALIDATED" : "REJECTED"}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-2 items-center">
                      {res.isHvac && <Wind className="h-4 w-4 text-sky-500" />}
                      {res.isSafety && <Shield className="h-4 w-4 text-rose-500" />}
                      {isInfrastructure && <ArrowUpDown className="h-4 w-4 text-slate-400" />}
                      {!isInfrastructure && <Layers className="h-4 w-4 text-indigo-400" />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};