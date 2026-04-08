import React from 'react';
import { PolicyAssistantIntentInput } from '../../types/policyAssistant';

interface Props {
  value: PolicyAssistantIntentInput;
  onChange: (next: PolicyAssistantIntentInput) => void;
}

export const PolicyIntentStep: React.FC<Props> = ({ value, onChange }) => {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Owner ID</label>
        <input className="w-full rounded border border-gray-300 px-3 py-2" value={value.ownerId} onChange={(e) => onChange({ ...value, ownerId: e.target.value })} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Policy intent</label>
        <textarea className="w-full rounded border border-gray-300 px-3 py-2" rows={4} value={value.intentText} onChange={(e) => onChange({ ...value, intentText: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Action family</label>
          <select className="w-full rounded border border-gray-300 px-3 py-2" value={value.actionFamily} onChange={(e) => onChange({ ...value, actionFamily: e.target.value })}>
            <option value="purchase">purchase</option>
            <option value="publish">publish</option>
            <option value="transfer">transfer</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Risk baseline</label>
          <select className="w-full rounded border border-gray-300 px-3 py-2" value={value.riskLevel} onChange={(e) => onChange({ ...value, riskLevel: e.target.value as PolicyAssistantIntentInput['riskLevel'] })}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Blocked merchants (CSV, optional)</label>
        <input className="w-full rounded border border-gray-300 px-3 py-2" value={value.blockedMerchantsText} onChange={(e) => onChange({ ...value, blockedMerchantsText: e.target.value })} />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={value.requiresApprovalForHighRisk} onChange={(e) => onChange({ ...value, requiresApprovalForHighRisk: e.target.checked })} />
        Require human approval for high-risk operations
      </label>
    </div>
  );
};
