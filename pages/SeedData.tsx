import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  Download,
  XCircle,
  CheckCircle2,
  Loader2,
  Play,
  Shield,
  Database,
  Brain,
  Zap,
  Search,
  AlertTriangle,
  Clock,
  Workflow,
  Eye,
} from "lucide-react";
import { seedDataService, SeedResult } from "../src/services/seedDataService";
import { validateRulesWithDigitalTwin } from "../services/digitalTwinService";
import { Snapshot, Rule } from "../types";

const DEFAULT_DB_PROXY = "http://localhost:3001";

type SeedProfile = "wearable_story" | "magic_atelier" | "journey_studio" | "mixed";
type MemoryWriteMode = "dry_run" | "event_working" | "event_then_approve";

type NormalizedSeed = SeedResult & {
  // normalized fields for UI
  id?: string;
  title?: string;
  seedHash?: string;
  allowed?: boolean;
  reason?: string;
  memoryTierIntended?: "event_working" | "knowledge_base";
  written?: boolean;
  // Step 5: Digital Twin Critic
  criticReport?: {
    passed: boolean;
    issues: Array<{
      severity: "critical" | "warning" | "info";
      issue: string;
      recommendation?: string;
    }>;
    validationScore: number;
  };
  // Step 6: Temporal Awareness
  validity?: {
    from: string; // ISO timestamp
    to?: string; // ISO timestamp (null = indefinite)
  };
  // Emission Blueprinting
  emissions?: Array<{
    subtaskName: string;
    relationshipType: "EMITS" | "ORDERS" | "GATE";
    params?: any;
    position?: number;
  }>;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeJsonStringify(v: any) {
  try {
    return JSON.stringify(v, Object.keys(v).sort(), 2);
  } catch {
    return JSON.stringify(v);
  }
}

function formatSummary(items: NormalizedSeed[]) {
  const allowed = items.filter((r) => r.allowed).length;
  const blocked = items.length - allowed;
  const written = items.filter((r) => r.written).length;
  return `Generated ${items.length} seeds. Allowed: ${allowed}. Blocked: ${blocked}. Written: ${written}.`;
}

function normalizeSeed(r: SeedResult): NormalizedSeed {
  const allowed = Boolean(r.policyDecision?.allowed);
  const reason =
    (r as any)?.policyDecision?.reason ||
    (r as any)?.policyDecision?.message ||
    (allowed ? "Allowed by policy" : "Blocked by policy");
  const title = (r as any)?.ticket?.title || (r as any)?.title || (r as any)?.name;
  const id = String((r as any)?.id || (r as any)?.ticketId || (r as any)?.taskId || "");

  // Step 6: Capture temporal validity from Migration 016 integration
  const temporalContext = (r as any)?.temporalContext;
  const validity = temporalContext ? {
    from: temporalContext.from || new Date().toISOString(),
    to: temporalContext.to || undefined,
  } : {
    from: new Date().toISOString(),
    to: undefined,
  };
  
  // Capture subtask emissions from policy decision (Migration 013)
  const emissions = (r as any)?.policyDecision?.matchedRules?.[0]?.emissions || 
                    (r as any)?.policyDecision?.emissions || 
                    [];

  // Step 5: Critic report (will be populated after Digital Twin validation)
  const criticReport = (r as any)?.criticReport;

  return {
    ...r,
    id: id || undefined,
    title: title || undefined,
    allowed,
    reason,
    validity, // For Step 6: Temporal Awareness
    emissions, // For Emission Blueprinting
    criticReport, // For Step 5: Digital Twin Critic
    written: Boolean((r as any)?.written || (r as any)?.appended || (r as any)?.stored),
  };
}

/**
 * SeedDataEnhanced
 *
 * Purpose:
 * - Generate wearable seeds (structured tickets)
 * - Evaluate with PKG policy
 * - Optionally write to Unified Memory's *underlying* sources:
 *   - event_working => tasks + task_multimodal_embeddings (Tier A)
 *   - approve flow => later promotion to graph_embeddings_1024 (Tier B/C)
 */
export const SeedDataEnhanced: React.FC = () => {
  const [count, setCount] = useState(8);
  const [dbProxyUrl, setDbProxyUrl] = useState(DEFAULT_DB_PROXY);

  const [profile, setProfile] = useState<SeedProfile>("wearable_story");
  const [includeKnowledge, setIncludeKnowledge] = useState(true);

  const [writeMode, setWriteMode] = useState<MemoryWriteMode>("event_working");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<NormalizedSeed[]>([]);

  const [query, setQuery] = useState("");
  const [showOnlyAllowed, setShowOnlyAllowed] = useState(false);

  // Step 5 & 6: Snapshot and rules for Digital Twin & Temporal evaluation
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  
  // Emission Blueprint modal
  const [selectedBlueprint, setSelectedBlueprint] = useState<NormalizedSeed | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const summary = useMemo(() => (results.length ? formatSummary(results) : ""), [results]);

  const filtered = useMemo(() => {
    let out = [...results];
    if (showOnlyAllowed) out = out.filter((x) => x.allowed);
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter((x) => safeJsonStringify(x).toLowerCase().includes(q));
    }
    return out;
  }, [results, showOnlyAllowed, query]);

  // Load active snapshot and rules on mount
  useEffect(() => {
    loadActiveSnapshot();
  }, [dbProxyUrl]);
  
  const loadActiveSnapshot = async () => {
    try {
      const res = await fetch(`${dbProxyUrl}/api/snapshots`);
      if (res.ok) {
        const snapshots = await res.json();
        const active = snapshots.find((s: Snapshot) => s.isActive) || snapshots[0];
        if (active) {
          setSnapshot(active);
          // Load rules for this snapshot
          const rulesRes = await fetch(`${dbProxyUrl}/api/rules?snapshotId=${active.id}`);
          if (rulesRes.ok) {
            const rulesData = await rulesRes.json();
            setRules(rulesData);
          }
        }
      }
    } catch (error) {
      console.error('Error loading snapshot:', error);
    }
  };

  const appendLog = (message: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    appendLog("Cancel requested.");
    setIsRunning(false);
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seed-results-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerate = async () => {
    if (isRunning) return;

    const total = clamp(Number(count) || 1, 1, 50);
    setCount(total);

    setIsRunning(true);
    setResults([]);
    setLogs([]);
    setProgress({ done: 0, total });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      appendLog("Starting seed generation...");

      // We pass options in a backward-compatible way:
      // if your seedDataService ignores unknown fields, this won’t break.
      const generated: SeedResult[] = await seedDataService.generateSeeds({
        count: total,
        dbProxyUrl,
        includeKnowledgeBase: includeKnowledge,
        profile, // scene-aware seed profile
        mode: writeMode, // dry_run | event_working | event_then_approve
        signal: controller.signal, // for fetch abort support (if implemented)
        onProgress: (done: number, totalN: number) => setProgress({ done, total: totalN }), // if supported
      } as any);

      appendLog(`Seed generation complete (${generated.length} items). Normalizing + hashing...`);

      // Normalize + compute dedupe hash (client-side)
      const normalized: NormalizedSeed[] = [];
      for (let i = 0; i < generated.length; i++) {
        const n = normalizeSeed(generated[i]);
        // Canonical-ish hash from the ticket/payload
        const basis = (n as any)?.ticket ? (n as any).ticket : n;
        n.seedHash = await sha256Hex(safeJsonStringify(basis));
        // Intended tier by mode
        n.memoryTierIntended =
          writeMode === "event_working" || writeMode === "event_then_approve"
            ? "event_working"
            : "event_working";
        
        // Step 5: Run Digital Twin validation if snapshot and rules are available
        if (snapshot && rules.length > 0 && n.allowed && n.emissions && n.emissions.length > 0) {
          try {
            // Create a mock rule from the seed for validation
            const mockRule: Rule = {
              id: `seed-${n.seedHash}`,
              snapshotId: snapshot.id!,
              ruleName: `Seed: ${n.title || 'Untitled'}`,
              priority: 100,
              engine: 'wasm' as any,
              disabled: false,
              conditions: [],
              emissions: n.emissions.map((e: any) => ({
                ruleId: `seed-${n.seedHash}`,
                subtaskTypeId: `mock-${e.subtaskName}`,
                subtaskName: e.subtaskName,
                relationshipType: e.relationshipType as any,
                params: e.params,
              })),
            };
            
            const criticResult = await validateRulesWithDigitalTwin([mockRule], snapshot);
            n.criticReport = criticResult;
            
            if (!criticResult.passed) {
              appendLog(`⚠️ Critic flagged seed "${n.title}": ${criticResult.issues[0]?.issue || 'Hardware constraint violation'}`);
            }
          } catch (error) {
            console.warn('Digital Twin validation failed for seed:', error);
            // Continue without critic report
          }
        }
        
        normalized.push(n);
        setProgress((p) => ({ ...p, done: i + 1 }));
      }

      // Basic local dedupe: keep first instance of same seedHash
      const seen = new Set<string>();
      const deduped = normalized.filter((x) => {
        const k = x.seedHash || "";
        if (!k) return true;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      if (deduped.length !== normalized.length) {
        appendLog(`Deduped ${normalized.length - deduped.length} duplicates by seedHash.`);
      }

      setResults(deduped);

      // Guidance log depending on write mode
      if (writeMode === "dry_run") {
        appendLog("Dry-run mode: policy evaluated, nothing written to memory.");
      } else if (writeMode === "event_working") {
        appendLog("Write mode: allowed items should be written to event_working (tasks + multimodal embeddings).");
      } else {
        appendLog("Write mode: allowed items written to event_working; you can later APPROVE to promote into knowledge_base.");
      }
    } catch (error: any) {
      if (error?.name === "AbortError") {
        appendLog("Run aborted.");
      } else {
        appendLog(`Error: ${error?.message || String(error)}`);
      }
    } finally {
      abortRef.current = null;
      setIsRunning(false);
    }
  };

  // Approve & Promote: Wire to backend promotion endpoint
  const handleApproveAndPromote = async (seed: NormalizedSeed) => {
    if (!seed.seedHash || !seed.id) {
      appendLog(`⚠️ Cannot promote seed: missing seedHash or id`);
      return;
    }
    
    if (!seed.allowed) {
      appendLog(`⚠️ Cannot promote blocked seed: ${seed.title || seed.seedHash}`);
      return;
    }
    
    // Check if critic flagged critical issues
    if (seed.criticReport && !seed.criticReport.passed) {
      const criticalIssues = seed.criticReport.issues.filter(i => i.severity === 'critical');
      if (criticalIssues.length > 0) {
        appendLog(`⚠️ Cannot promote seed with critical hardware violations: ${seed.title || seed.seedHash}`);
        return;
      }
    }
    
    try {
      appendLog(`Promoting seed "${seed.title || seed.seedHash}" to knowledge_base...`);
      
      const response = await fetch(`${dbProxyUrl}/api/memory/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: seed.id,
          seedHash: seed.seedHash,
          label: 'wearable.ticket',
          actor: 'user', // Could be enhanced to track actual user
          snapshotId: snapshot?.id || null,
          deleteSource: true // Clean up event_working after promotion
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Promotion failed: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      // Update UI state to reflect promotion
      setResults((prev) =>
        prev.map((x) =>
          x.seedHash === seed.seedHash
            ? {
                ...x,
                memoryTierIntended: 'knowledge_base' as const,
                written: true,
                id: result.nodeId, // Update to new node_id
              }
            : x
        )
      );
      
      appendLog(`✅ Successfully promoted seed to knowledge_base as node ${result.nodeId}`);
    } catch (error: any) {
      appendLog(`❌ Promotion failed: ${error?.message || String(error)}`);
    }
  };
  
  // Client-side "approval" toggle (for UI state only, actual promotion via handleApproveAndPromote)
  const toggleApprove = (seedHash?: string) => {
    if (!seedHash) return;
    const seed = results.find(r => r.seedHash === seedHash);
    if (seed) {
      // If toggling to knowledge_base, trigger actual promotion
      if (seed.memoryTierIntended !== 'knowledge_base') {
        handleApproveAndPromote(seed);
      } else {
        // Toggling back to event_working (just UI state change)
        setResults((prev) =>
          prev.map((x) =>
            x.seedHash === seedHash
              ? {
                  ...x,
                  memoryTierIntended: 'event_working' as const,
                }
              : x
          )
        );
      }
    }
  };

  const TierPill = ({ tier }: { tier?: string }) => {
    if (tier === "knowledge_base") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          <Brain className="h-3 w-3" /> knowledge_base
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        <Zap className="h-3 w-3" /> event_working
      </span>
    );
  };

  // Step 5: Critic Report Component
  const CriticIndicator = ({ seed }: { seed: NormalizedSeed }) => {
    if (!seed.criticReport) return null;
    
    const { passed, issues, validationScore } = seed.criticReport;
    const hasCriticalIssues = issues.some(i => i.severity === "critical");
    
    return (
      <div className="relative group">
        <button
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${
            hasCriticalIssues
              ? "bg-red-50 text-red-700 border-red-200"
              : passed
              ? "bg-green-50 text-green-700 border-green-200"
              : "bg-yellow-50 text-yellow-700 border-yellow-200"
          }`}
          title={`Critic Score: ${(validationScore * 100).toFixed(0)}%`}
        >
          <AlertTriangle className="h-3 w-3" />
          {hasCriticalIssues ? "Critical" : passed ? "Valid" : "Warning"}
        </button>
        
        {/* Tooltip */}
        <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-64 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl">
          <div className="font-semibold mb-2">Digital Twin Validation</div>
          <div className="mb-2">Score: {(validationScore * 100).toFixed(1)}%</div>
          {issues.length > 0 && (
            <div className="space-y-1">
              {issues.slice(0, 3).map((issue, idx) => (
                <div key={idx} className={`text-xs ${
                  issue.severity === "critical" ? "text-red-300" :
                  issue.severity === "warning" ? "text-yellow-300" :
                  "text-gray-300"
                }`}>
                  • {issue.issue}
                  {issue.recommendation && (
                    <div className="text-gray-400 ml-2 mt-0.5">→ {issue.recommendation}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Step 6: Temporal Validity Component
  const ValidityIndicator = ({ seed }: { seed: NormalizedSeed }) => {
    if (!seed.validity) return <span className="text-xs text-gray-400">—</span>;
    
    const { from, to } = seed.validity;
    const now = new Date();
    const fromDate = new Date(from);
    const toDate = to ? new Date(to) : null;
    
    if (toDate) {
      const totalMs = toDate.getTime() - fromDate.getTime();
      const elapsedMs = now.getTime() - fromDate.getTime();
      const remainingMs = toDate.getTime() - now.getTime();
      const progress = Math.max(0, Math.min(100, (elapsedMs / totalMs) * 100));
      
      const hoursRemaining = remainingMs / (1000 * 60 * 60);
      const isExpired = remainingMs < 0;
      const isCritical = hoursRemaining > 0 && hoursRemaining < 1;
      
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <Clock className={`h-3 w-3 ${isExpired ? "text-red-500" : isCritical ? "text-yellow-500" : "text-gray-400"}`} />
            <span className={isExpired ? "text-red-600" : isCritical ? "text-yellow-600" : "text-gray-600"}>
              {isExpired ? "Expired" : isCritical ? `${Math.round(hoursRemaining * 60)}m left` : `${Math.round(hoursRemaining)}h left`}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full ${
                isExpired ? "bg-red-500" : isCritical ? "bg-yellow-500" : "bg-blue-500"
              }`}
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
          <div className="text-xs text-gray-500">
            {fromDate.toLocaleDateString()} → {toDate.toLocaleDateString()}
          </div>
        </div>
      );
    }
    
    // Indefinite validity
    return (
      <div className="flex items-center gap-1 text-xs text-gray-600">
        <CheckCircle2 className="h-3 w-3 text-green-500" />
        <span>Indefinite</span>
      </div>
    );
  };

  // Emission Blueprint Component
  const EmissionBlueprint = ({ emissions }: { emissions?: Array<any> }) => {
    if (!emissions || emissions.length === 0) {
      return <span className="text-xs text-gray-400">No emissions</span>;
    }
    
    return (
      <div className="flex flex-wrap gap-1">
        {emissions.map((e, i) => (
          <span
            key={i}
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
              e.relationshipType === "GATE"
                ? "bg-red-100 border-red-200 text-red-700"
                : e.relationshipType === "ORDERS"
                ? "bg-blue-100 border-blue-200 text-blue-700"
                : "bg-gray-100 border-gray-200 text-gray-700"
            }`}
            title={JSON.stringify(e.params || {}, null, 2)}
          >
            {e.relationshipType}
          </span>
        ))}
      </div>
    );
  };

  // Emission Blueprint Modal
  const EmissionBlueprintModal = ({ seed, onClose }: { seed: NormalizedSeed | null; onClose: () => void }) => {
    if (!seed || !seed.emissions || seed.emissions.length === 0) return null;
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full m-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="p-6 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Workflow className="h-5 w-5" />
              Emission Blueprint: {seed.title || "Untitled Seed"}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <XCircle className="h-5 w-5" />
            </button>
          </div>
          
          <div className="p-6 space-y-4">
            <div className="text-sm text-gray-600 mb-4">
              Task DAG (Directed Acyclic Graph) that would be triggered by this seed:
            </div>
            
            <div className="space-y-3">
              {seed.emissions
                .sort((a, b) => (a.position || 0) - (b.position || 0))
                .map((emission, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-lg border-2 ${
                      emission.relationshipType === "GATE"
                        ? "border-red-300 bg-red-50"
                        : emission.relationshipType === "ORDERS"
                        ? "border-blue-300 bg-blue-50"
                        : "border-gray-300 bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono bg-white px-2 py-1 rounded">
                          {idx + 1}
                        </span>
                        <span className={`font-semibold ${
                          emission.relationshipType === "GATE" ? "text-red-700" :
                          emission.relationshipType === "ORDERS" ? "text-blue-700" :
                          "text-gray-700"
                        }`}>
                          {emission.relationshipType}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-gray-700">
                        {emission.subtaskName}
                      </span>
                    </div>
                    
                    {emission.params && Object.keys(emission.params).length > 0 && (
                      <div className="mt-2 text-xs">
                        <div className="font-medium text-gray-600 mb-1">Parameters:</div>
                        <pre className="bg-white p-2 rounded border border-gray-200 overflow-x-auto">
                          {JSON.stringify(emission.params, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
            </div>
            
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
              <strong>Note:</strong> This blueprint shows the sequence of subtasks that would be executed if this seed is approved. 
              GATE emissions block execution, ORDERS emissions trigger actions, and EMITS emissions send notifications.
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">PKG Simulator</p>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Wearable Seed Generator</h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                <Database className="h-4 w-4" />
                Unified Cortex Memory bootstrap
              </span>
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                <Shield className="h-4 w-4" />
                PKG policy gate
              </span>
            </div>
          </div>

          <div className="text-right">
            {isRunning ? (
              <div className="text-xs text-gray-500">
                Progress: <span className="font-mono">{progress.done}/{progress.total}</span>
              </div>
            ) : (
              <div className="text-xs text-gray-500">Ready</div>
            )}
          </div>
        </div>

        {isRunning && (
          <div className="mt-4">
            <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
              <div
                className="h-2 bg-indigo-600"
                style={{
                  width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Config */}
      <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Seed Count</label>
            <input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(clamp(Number(e.target.value) || 1, 1, 50))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-500">Recommended: 8–20 for good coverage without noise.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">DB Proxy URL</label>
            <input
              value={dbProxyUrl}
              onChange={(e) => setDbProxyUrl(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-500">Points to your db-proxy that writes tasks/embeddings.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Seed Profile</label>
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value as SeedProfile)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="wearable_story">WearableStoryStudio</option>
              <option value="magic_atelier">MagicAtelier</option>
              <option value="journey_studio">JourneyStudio</option>
              <option value="mixed">Mixed batch</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">Aligns generations with your three scenes.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Knowledge Base Seed</label>
            <select
              value={includeKnowledge ? "yes" : "no"}
              onChange={(e) => setIncludeKnowledge(e.target.value === "yes")}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="yes">Include approved tickets</option>
              <option value="no">Working memory only</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">If “yes”, Gemini can reference prior approved designs.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Write Mode</label>
            <select
              value={writeMode}
              onChange={(e) => setWriteMode(e.target.value as MemoryWriteMode)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="dry_run">Dry run (policy only)</option>
              <option value="event_working">Write allowed → event_working</option>
              <option value="event_then_approve">Write allowed → event_working, then approve → knowledge_base</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Matches your view tiers: event_working = tasks+multimodal; knowledge_base = graph embeddings.
            </p>
          </div>

          <div className="flex items-end gap-3">
            <button
              onClick={handleGenerate}
              disabled={isRunning}
              className="flex-1 inline-flex justify-center items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {isRunning ? "Generating..." : "Generate Seeds"}
            </button>

            <button
              onClick={handleCancel}
              disabled={!isRunning}
              className="inline-flex justify-center items-center gap-2 px-4 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Cancel run"
            >
              <XCircle className="h-4 w-4" />
            </button>

            <button
              onClick={handleExport}
              disabled={!results.length}
              className="inline-flex justify-center items-center gap-2 px-4 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Export JSON"
            >
              <Download className="h-4 w-4" />
            </button>
          </div>
        </div>

        {summary && (
          <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800">{summary}</p>
          </div>
        )}

        {logs.length > 0 && (
          <div className="mt-6 p-4 bg-gray-900 text-gray-100 rounded-lg font-mono text-xs overflow-auto max-h-80">
            <pre className="whitespace-pre-wrap">{logs.join("\n")}</pre>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="bg-white shadow rounded-lg border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900">Seed Results</h3>
            <span className="text-xs text-gray-500">({filtered.length}/{results.length})</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="h-4 w-4 text-gray-400 absolute left-3 top-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search payload…"
                className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={showOnlyAllowed}
                onChange={(e) => setShowOnlyAllowed(e.target.checked)}
              />
              Allowed only
            </label>
          </div>
        </div>

        {results.length === 0 ? (
          <div className="p-10 text-center text-gray-500">No seeds yet. Generate a batch to populate working memory.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Decision</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Title</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Tier</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Seed Hash</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Reason</th>
                  {writeMode === "event_then_approve" && (
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Approve</th>
                  )}
                </tr>
              </thead>

              <tbody className="bg-white divide-y divide-gray-200">
                {filtered.map((r) => (
                  <tr key={r.seedHash || r.id || Math.random()}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {r.allowed ? (
                        <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full text-xs font-semibold">
                          <CheckCircle2 className="h-3 w-3" /> Allowed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full text-xs font-semibold">
                          <XCircle className="h-3 w-3" /> Blocked
                        </span>
                      )}
                    </td>

                    {/* Step 5: Critic Indicator */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {r.allowed ? (
                        <CriticIndicator seed={r} />
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{r.title || "Untitled ticket"}</div>
                      <div className="text-xs text-gray-500 font-mono">{r.id ? `id=${r.id}` : ""}</div>
                    </td>

                    {/* Step 6: Temporal Validity */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <ValidityIndicator seed={r} />
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      <TierPill tier={r.memoryTierIntended} />
                    </td>

                    {/* Emission Blueprint */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {r.emissions && r.emissions.length > 0 ? (
                        <div className="flex items-center gap-2">
                          <EmissionBlueprint emissions={r.emissions} />
                          <button
                            onClick={() => setSelectedBlueprint(r)}
                            className="text-blue-600 hover:text-blue-800"
                            title="View full blueprint"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap font-mono text-xs text-gray-600">
                      {r.seedHash ? r.seedHash.slice(0, 12) + "…" : "—"}
                    </td>

                    <td className="px-6 py-4 text-gray-700 max-w-xl">
                      <span className="text-xs">{r.reason}</span>
                    </td>

                    {writeMode === "event_then_approve" && (
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          disabled={!r.allowed || (r.criticReport && !r.criticReport.passed && r.criticReport.issues.some(i => i.severity === 'critical'))}
                          onClick={() => toggleApprove(r.seedHash)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                            !r.allowed
                              ? "bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed"
                              : r.memoryTierIntended === "knowledge_base"
                              ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                          }`}
                          title={
                            !r.allowed
                              ? "Cannot approve blocked seed"
                              : r.criticReport && !r.criticReport.passed && r.criticReport.issues.some(i => i.severity === 'critical')
                              ? "Cannot approve: Critical hardware violations detected"
                              : r.memoryTierIntended === "knowledge_base"
                              ? "Promoted to knowledge_base (click to undo)"
                              : "Approve & Promote to knowledge_base"
                          }
                        >
                          {r.memoryTierIntended === "knowledge_base" ? (
                            <span className="flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Promoted
                            </span>
                          ) : (
                            "Approve → KB"
                          )}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="px-6 py-4 bg-gray-50 text-xs text-gray-600">
              Tip: In production, only “Approved → KB” items should be promoted into graph embeddings (Tier B/C). Keep noisy seeds in event_working.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Export as SeedData for backward compatibility
export const SeedData = SeedDataEnhanced;
