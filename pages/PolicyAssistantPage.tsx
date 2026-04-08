import React, { useEffect, useMemo, useState } from 'react';
import { PolicyIntentStep } from '../components/policy-assistant/PolicyIntentStep';
import { PolicyDraftStep } from '../components/policy-assistant/PolicyDraftStep';
import { PreflightStep } from '../components/policy-assistant/PreflightStep';
import { ScenarioPackStep } from '../components/policy-assistant/ScenarioPackStep';
import { ReviewCommitStep } from '../components/policy-assistant/ReviewCommitStep';
import { policyAssistantService } from '../services/policyAssistantService';
import {
  OwnerContextPreflightResult,
  OwnerPolicyDraft,
  PolicyAssistantIntentInput,
  PolicyScenarioResult,
  TrustPreferencesDraft,
} from '../types/policyAssistant';

const STEPS = ['Capture Intent', 'Draft Policy', 'Run Owner Preflight', 'Run Scenario Pack', 'Review And Commit'] as const;

export const PolicyAssistantPage: React.FC = () => {
  const [step, setStep] = useState(0);
  const [intent, setIntent] = useState<PolicyAssistantIntentInput>({
    ownerId: 'owner-001',
    intentText: '',
    actionFamily: 'purchase',
    riskLevel: 'medium',
    requiresApprovalForHighRisk: true,
    blockedMerchantsText: '',
  });
  const [ownerPolicyDraft, setOwnerPolicyDraft] = useState<OwnerPolicyDraft | null>(null);
  const [trustPreferencesDraft, setTrustPreferencesDraft] = useState<TrustPreferencesDraft | null>(null);
  const [previousPolicy, setPreviousPolicy] = useState<OwnerPolicyDraft | null>(null);
  const [preflight, setPreflight] = useState<OwnerContextPreflightResult | null>(null);
  const [scenarioResults, setScenarioResults] = useState<PolicyScenarioResult[]>([]);
  const [confirmCommit, setConfirmCommit] = useState(false);
  const [commitMessage, setCommitMessage] = useState<string | null>(null);
  const [runningPreflight, setRunningPreflight] = useState(false);
  const [runningScenarios, setRunningScenarios] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [assistantRunId, setAssistantRunId] = useState('');
  const [scenarioPackVersion, setScenarioPackVersion] = useState('mvp-v1');
  const [ownerContextHash, setOwnerContextHash] = useState<string | null>(null);
  const [committedPolicy, setCommittedPolicy] = useState<OwnerPolicyDraft | null>(null);

  useEffect(() => {
    const nextRunId = policyAssistantService.makeAssistantRunId(intent.ownerId || 'owner');
    setAssistantRunId(nextRunId);
  }, [intent.ownerId]);

  useEffect(() => {
    const load = async () => {
      const initialized = await policyAssistantService.initialize(intent.ownerId);
      if (initialized.ownerPolicy) {
        setPreviousPolicy(initialized.ownerPolicy);
        setOwnerPolicyDraft(initialized.ownerPolicy);
      }
      if (initialized.trustPreferences) {
        setTrustPreferencesDraft(initialized.trustPreferences);
      }
    };
    load().catch(() => undefined);
  }, [intent.ownerId]);

  const canNext = useMemo(() => {
    if (step === 0) return Boolean(intent.ownerId.trim() && intent.intentText.trim());
    if (step === 1) return Boolean(ownerPolicyDraft && trustPreferencesDraft && ownerPolicyDraft.transaction_limit > 0);
    if (step === 2) return Boolean(preflight);
    if (step === 3) return scenarioResults.length > 0;
    return false;
  }, [step, intent, ownerPolicyDraft, trustPreferencesDraft, preflight, scenarioResults]);

  const handleGenerateDraft = () => {
    const draft = policyAssistantService.buildDraftFromIntent(intent);
    setOwnerPolicyDraft(draft.ownerPolicyDraft);
    setTrustPreferencesDraft(draft.trustPreferencesDraft);
    const defaults = policyAssistantService.buildScenarioPackDefaults();
    setScenarioPackVersion(defaults.version);
  };

  const runPreflight = async () => {
    if (!ownerPolicyDraft || !trustPreferencesDraft) return;
    setRunningPreflight(true);
    try {
      const result = await policyAssistantService.runPreflight(ownerPolicyDraft, trustPreferencesDraft);
      setPreflight(result);
      setOwnerContextHash(result.owner_context_hash || null);
    } finally {
      setRunningPreflight(false);
    }
  };

  const runScenarios = async () => {
    if (!ownerPolicyDraft || !trustPreferencesDraft) return;
    setRunningScenarios(true);
    try {
      const defaults = policyAssistantService.buildScenarioPackDefaults();
      const results = await policyAssistantService.runScenarioPack(
        ownerPolicyDraft,
        trustPreferencesDraft,
        defaults.scenarios,
        defaults.version,
      );
      setScenarioResults(results);
    } finally {
      setRunningScenarios(false);
    }
  };

  const commit = async () => {
    if (!ownerPolicyDraft || !trustPreferencesDraft || !confirmCommit) return;
    setCommitting(true);
    setCommitMessage(null);
    try {
      const result = await policyAssistantService.commit({
        trustPreferences: trustPreferencesDraft,
        ownerPolicy: ownerPolicyDraft,
        assistantRunId,
        uiVersion: 'policy-assistant-ui-mvp-v1',
        scenarioPackVersion,
        intentText: intent.intentText,
      });

      if (result.partialFailure) {
        setCommitMessage(
          `Partial failure: trust preferences saved, owner policy upsert failed.\nRetry payload:\n${JSON.stringify(result.partialFailure.retryPayload, null, 2)}`,
        );
        return;
      }

      setCommittedPolicy(result.ownerPolicyResult || ownerPolicyDraft);
      setCommitMessage('Commit succeeded: trust preferences and owner policy were saved.');
    } catch (error: any) {
      setCommitMessage(`Commit failed: ${error?.message || String(error)}`);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="text-lg font-semibold">Policy Assistant</h2>
        <p className="text-sm text-gray-600 mt-1">Guided policy setup for non-experts before Policy Studio authoring.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex flex-wrap gap-2">
          {STEPS.map((label, idx) => (
            <div key={label} className={`px-3 py-1 rounded text-sm ${idx === step ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
              {idx + 1}. {label}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        {step === 0 && <PolicyIntentStep value={intent} onChange={setIntent} />}
        {step === 1 && ownerPolicyDraft && trustPreferencesDraft && (
          <PolicyDraftStep
            policyDraft={ownerPolicyDraft}
            trustDraft={trustPreferencesDraft}
            previousPolicy={previousPolicy}
            onPolicyChange={setOwnerPolicyDraft}
            onTrustChange={setTrustPreferencesDraft}
          />
        )}
        {step === 2 && <PreflightStep result={preflight} onRun={runPreflight} running={runningPreflight} />}
        {step === 3 && <ScenarioPackStep results={scenarioResults} onRun={runScenarios} running={runningScenarios} />}
        {step === 4 && (
          <ReviewCommitStep
            confirm={confirmCommit}
            onConfirmChange={setConfirmCommit}
            committing={committing}
            commitMessage={commitMessage}
            onCommit={commit}
            committedPolicy={committedPolicy}
            ownerContextHash={ownerContextHash}
          />
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">assistant_run_id: <span className="font-mono">{assistantRunId || '-'}</span></div>
        <div className="flex gap-2">
          <button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} className="px-3 py-2 border rounded bg-white hover:bg-gray-50 disabled:opacity-50">Back</button>
          {step === 0 && (
            <button onClick={handleGenerateDraft} disabled={!canNext} className="px-3 py-2 rounded text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
              Generate Draft
            </button>
          )}
          <button disabled={!canNext || step === STEPS.length - 1} onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} className="px-3 py-2 rounded text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
            Next
          </button>
        </div>
      </div>
    </div>
  );
};
