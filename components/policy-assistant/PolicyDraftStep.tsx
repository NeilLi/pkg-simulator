import React from 'react';
import { OwnerPolicyDraft, TrustPreferencesDraft } from '../../types/policyAssistant';

interface Props {
  policyDraft: OwnerPolicyDraft;
  trustDraft: TrustPreferencesDraft;
  previousPolicy: OwnerPolicyDraft | null;
  onPolicyChange: (value: OwnerPolicyDraft) => void;
  onTrustChange: (value: TrustPreferencesDraft) => void;
}

export const PolicyDraftStep: React.FC<Props> = ({
  policyDraft,
  trustDraft,
  previousPolicy,
  onPolicyChange,
  onTrustChange,
}) => {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Transaction limit</label>
          <input type="number" className="w-full rounded border border-gray-300 px-3 py-2" value={policyDraft.transaction_limit} onChange={(e) => onPolicyChange({ ...policyDraft, transaction_limit: Number(e.target.value) || 0 })} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Approval threshold</label>
          <input type="number" className="w-full rounded border border-gray-300 px-3 py-2" value={trustDraft.approval_required_above_amount} onChange={(e) => onTrustChange({ ...trustDraft, approval_required_above_amount: Number(e.target.value) || 0 })} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={trustDraft.high_risk_requires_manual_approval} onChange={(e) => onTrustChange({ ...trustDraft, high_risk_requires_manual_approval: e.target.checked })} />
        High-risk requires manual approval
      </label>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Previous policy vs candidate draft</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <pre className="bg-gray-50 border border-gray-200 rounded p-3 overflow-auto">{JSON.stringify(previousPolicy, null, 2) || 'No previous active policy'}</pre>
          <pre className="bg-indigo-50 border border-indigo-200 rounded p-3 overflow-auto">{JSON.stringify(policyDraft, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
};
