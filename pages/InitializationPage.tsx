import React, { useState } from 'react';
import { Sparkles, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { cleanupPreferredOrgans, initializeGovernedRuntimeScenario } from '../services/initializationService';
import { clearCache } from '../mockData';
import { PkgEnv } from '../types';

/**
 * InitializationPage - System Bootstrap & Scenario Seeding
 * 
 * Purpose: One-time or rare system bootstrap, scenario seeding, environment preparation
 * 
 * Characteristics:
 * - Protected / admin-only (future: add guards)
 * - Explicit warnings
 * - Not visited daily
 * - Idempotent operations
 */
export const InitializationPage: React.FC = () => {
  const [initializing, setInitializing] = useState(false);
  const [cleaningOrgans, setCleaningOrgans] = useState(false);
  const [initMessage, setInitMessage] = useState<string | null>(null);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [includeGuestOverlays, setIncludeGuestOverlays] = useState(false);
  const [selectedEnv, setSelectedEnv] = useState<PkgEnv>(PkgEnv.PROD);

  const handleInitialize = async () => {
    setInitializing(true);
    setInitMessage(null);
    try {
      // Only initialize for the selected environment (single environment support)
      const result = await initializeGovernedRuntimeScenario(selectedEnv);
      if (result.success) {
        const envLabel = selectedEnv === PkgEnv.PROD ? 'production' : 
                        selectedEnv === PkgEnv.STAGING ? 'staging' : 'development';
        const governedFactsInfo = result.created.governedFacts 
          ? ` (${result.created.governedFacts} linked to rules)` 
          : '';
        setInitMessage(
          `✅ Initialization successful for ${envLabel} environment! Created: ${result.created.snapshots} snapshot(s), ` +
          `${result.created.subtaskTypes} subtask type(s), ${result.created.rules} rule(s), ` +
          `${result.created.facts} fact(s)${governedFactsInfo}`
        );
        // Clear cache after successful initialization
        clearCache();
      } else {
        setInitMessage(`❌ ${result.message}`);
      }
    } catch (error: any) {
      setInitMessage(`❌ Error: ${error.message}`);
    } finally {
      setInitializing(false);
      setTimeout(() => setInitMessage(null), 10000);
    }
  };

  const handleCleanupPreferredOrgans = async () => {
    setCleaningOrgans(true);
    setCleanupMessage(null);

    try {
      const result = await cleanupPreferredOrgans({ includeGuestOverlays });
      const guestPart = includeGuestOverlays
        ? `, ${result.updatedGuestCapabilities.length} guest overlay(s) updated`
        : '';
      const guestMissingNote = includeGuestOverlays && !result.guestCapabilitiesTableFound
        ? ' (guest_capabilities table not found)'
        : '';

      if (result.remainingDeprecatedInActiveSnapshots.length === 0) {
        setCleanupMessage(
          `✅ Cleanup complete. ${result.updatedSubtaskTypes.length} subtask type(s) updated${guestPart}. ` +
          `${result.audit.length} active-row(s) audited${guestMissingNote}.`
        );
      } else {
        setCleanupMessage(
          `⚠️ Cleanup ran, but ${result.remainingDeprecatedInActiveSnapshots.length} active subtask type(s) still have deprecated organs.${guestMissingNote}`
        );
      }
      clearCache();
    } catch (error: any) {
      setCleanupMessage(`❌ Error: ${error.message}`);
    } finally {
      setCleaningOrgans(false);
      setTimeout(() => setCleanupMessage(null), 12000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">System Initialization</h2>
            <p className="text-sm text-gray-500 mt-1">
              Bootstrap the SeedCore governed runtime baseline with ingress, vault, transfer,
              quarantine, and actuator-control surfaces aligned to the current product definition.
            </p>
            
            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start">
                <AlertTriangle className="h-5 w-5 text-amber-600 mr-2 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-semibold mb-1">Warning: Bootstrap Operation</p>
                  <p className="text-xs">
                    This operation creates the baseline snapshot, subtask library, policy rules, and
                    governed facts for one environment at a time. If the baseline already exists for
                    the selected environment, the initializer exits without duplicating it.
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label htmlFor="env-select" className="text-sm font-medium text-gray-700">
                Environment:
              </label>
              <select
                id="env-select"
                value={selectedEnv}
                onChange={(e) => setSelectedEnv(e.target.value as PkgEnv)}
                disabled={initializing}
                className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value={PkgEnv.PROD}>Production</option>
                <option value={PkgEnv.STAGING}>Staging</option>
                <option value={PkgEnv.DEV}>Development</option>
              </select>
            </div>
            <button
              onClick={handleInitialize}
              disabled={initializing}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                initializing
                  ? 'bg-gray-400 cursor-not-allowed text-white'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {initializing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Initializing...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-5 w-5" />
                  <span>Initialize Runtime Baseline</span>
                </>
              )}
            </button>
          </div>
        </div>
        
        {initMessage && (
          <div className={`mt-4 p-3 rounded-lg text-sm ${
            initMessage.startsWith('✅') 
              ? 'bg-green-50 text-green-800 border border-green-200' 
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            {initMessage}
          </div>
        )}
      </div>

      <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h3 className="text-md font-semibold text-gray-900">Subtask Routing Cleanup</h3>
            <p className="text-sm text-gray-500 mt-1">
              Normalizes deprecated routing organs in active snapshots using a DB-side JSONB patch:
              <code className="mx-1">memory_organ</code> and <code>policy_organ</code> to <code>utility_organ</code>.
            </p>
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={includeGuestOverlays}
                onChange={(e) => setIncludeGuestOverlays(e.target.checked)}
                disabled={cleaningOrgans}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
              />
              Also patch <code>guest_capabilities.custom_params</code> overrides
            </label>
          </div>
          <button
            onClick={handleCleanupPreferredOrgans}
            disabled={cleaningOrgans}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              cleaningOrgans
                ? 'bg-gray-400 cursor-not-allowed text-white'
                : 'bg-slate-700 hover:bg-slate-800 text-white'
            }`}
          >
            {cleaningOrgans ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Cleaning...</span>
              </>
            ) : (
              <>
                <RefreshCw className="h-5 w-5" />
                <span>Run Preferred Organ Cleanup</span>
              </>
            )}
          </button>
        </div>

        {cleanupMessage && (
          <div className={`mt-4 p-3 rounded-lg text-sm ${
            cleanupMessage.startsWith('✅')
              ? 'bg-green-50 text-green-800 border border-green-200'
              : cleanupMessage.startsWith('⚠️')
                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            {cleanupMessage}
          </div>
        )}
      </div>

      <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
        <h3 className="text-md font-semibold text-gray-900 mb-3">What gets initialized</h3>
        <ul className="space-y-2 text-sm text-gray-600">
          <li className="flex items-start">
            <span className="text-green-500 mr-2">✓</span>
            <span><strong>Snapshots:</strong> Single environment snapshot (selected environment) with baseline configuration</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-500 mr-2">✓</span>
            <span><strong>Subtask Types:</strong> Identity verification, release authorization, robotic handoff, playback capture, quarantine, and control-plane notifications</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-500 mr-2">✓</span>
            <span><strong>Policy Rules:</strong> Deny-by-default release gates, seal-integrity quarantine, dual approval, route drift containment, actuator routing, and playback archival</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-500 mr-2">✓</span>
            <span><strong>Temporal Facts:</strong> Runtime zones, actuator systems, release policies, and custody constraints with temporal validity and PKG governance fields so rules become active immediately</span>
          </li>
          <li className="flex items-start">
            <span className="text-gray-400 mr-2">○</span>
            <span><strong>Deployments:</strong> <em>Not created during initialization.</em> Deployments must be created through the Control Plane workflow (Promote → Validate → Deploy).</span>
          </li>
        </ul>
      </div>
    </div>
  );
};
