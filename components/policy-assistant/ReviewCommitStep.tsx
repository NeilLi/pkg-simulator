import React from 'react';
import { OwnerPolicyDraft } from '../../types/policyAssistant';

interface Props {
  confirm: boolean;
  onConfirmChange: (value: boolean) => void;
  committing: boolean;
  commitMessage: string | null;
  onCommit: () => Promise<void>;
  committedPolicy: OwnerPolicyDraft | null;
  ownerContextHash: string | null;
}

export const ReviewCommitStep: React.FC<Props> = ({
  confirm,
  onConfirmChange,
  committing,
  commitMessage,
  onCommit,
  committedPolicy,
  ownerContextHash,
}) => {
  return (
    <div className="space-y-4">
      <div className="text-sm rounded border border-amber-200 bg-amber-50 p-3 space-y-1">
        <div>This assistant is advisory.</div>
        <div>Final runtime authorization still happens in SeedCore policy evaluation.</div>
        <div>Simulation results are predictive and based on current policy snapshot and inputs.</div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={confirm} onChange={(e) => onConfirmChange(e.target.checked)} />
        I confirm I want to commit trust preferences and owner policy.
      </label>

      <button
        onClick={onCommit}
        disabled={!confirm || committing}
        className={`px-4 py-2 rounded text-white ${!confirm || committing ? 'bg-gray-400' : 'bg-emerald-600 hover:bg-emerald-700'}`}
      >
        {committing ? 'Committing...' : 'Commit'}
      </button>

      {commitMessage && <div className="text-sm rounded border border-gray-200 bg-gray-50 p-3 whitespace-pre-wrap">{commitMessage}</div>}

      {committedPolicy && (
        <div className="text-sm rounded border border-green-200 bg-green-50 p-3">
          <div><span className="font-semibold">policy_version:</span> {committedPolicy.policy_version || 'latest'}</div>
          <div><span className="font-semibold">owner_context_hash:</span> {ownerContextHash || 'n/a'}</div>
        </div>
      )}
    </div>
  );
};
