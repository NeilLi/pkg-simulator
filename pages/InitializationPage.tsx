import React, { useState } from 'react';
import { Sparkles, Loader2, AlertTriangle } from 'lucide-react';
import { initializeHotelScenario } from '../services/initializationService';
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
  const [initMessage, setInitMessage] = useState<string | null>(null);
  const [selectedEnv, setSelectedEnv] = useState<PkgEnv>(PkgEnv.PROD);

  const handleInitialize = async () => {
    setInitializing(true);
    setInitMessage(null);
    try {
      // Only initialize for the selected environment (single environment support)
      const result = await initializeHotelScenario(selectedEnv);
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

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6 border border-gray-100">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">System Initialization</h2>
            <p className="text-sm text-gray-500 mt-1">
              Bootstrap the SeedCore-Native Hotel (2030+) baseline environment with service robots, 
              smart rooms, 3D printers, wearable guest devices, digital concierges, human staff, 
              and external city services.
            </p>
            
            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start">
                <AlertTriangle className="h-5 w-5 text-amber-600 mr-2 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-semibold mb-1">Warning: Bootstrap Operation</p>
                  <p className="text-xs">
                    This operation creates baseline snapshots, rules, and facts for a single environment (prod, staging, or dev). 
                    The initialization is idempotent - running it multiple times will not create duplicates.
                    To initialize multiple environments, run this operation separately for each environment.
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
                  <span>Initialize Hotel Scenario</span>
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
        <h3 className="text-md font-semibold text-gray-900 mb-3">What gets initialized</h3>
        <ul className="space-y-2 text-sm text-gray-600">
          <li className="flex items-start">
            <span className="text-green-500 mr-2">✓</span>
            <span><strong>Snapshots:</strong> Single environment snapshot (selected environment) with baseline configuration</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-500 mr-2">✓</span>
            <span><strong>Subtask Types:</strong> Service robot capabilities, smart room systems, 3D printer operations, etc.</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-500 mr-2">✓</span>
            <span><strong>Policy Rules:</strong> Emergency protocols, HVAC management, external service integration, self-repair policies</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-500 mr-2">✓</span>
            <span><strong>Temporal Facts:</strong> Plug-in unit registrations (zones, systems, building maps) with proper temporal validity (valid_from, valid_to), system access grants, persona preferences, and PKG governance fields (pkg_rule_id, pkg_provenance, validation_status) - all facts are active immediately and ready for rule matching</span>
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
