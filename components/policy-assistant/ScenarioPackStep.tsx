import React from 'react';
import { PolicyScenarioResult } from '../../types/policyAssistant';

interface Props {
  results: PolicyScenarioResult[];
  onRun: () => Promise<void>;
  running: boolean;
}

export const ScenarioPackStep: React.FC<Props> = ({ results, onRun, running }) => {
  const allow = results.filter((r) => r.decision === 'allow').length;
  const block = results.filter((r) => r.decision === 'block').length;
  const needsApproval = results.filter((r) => r.decision === 'needs approval').length;
  const error = results.filter((r) => r.decision === 'error').length;

  return (
    <div className="space-y-4">
      <button onClick={onRun} disabled={running} className={`px-4 py-2 rounded text-white ${running ? 'bg-gray-400' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
        {running ? 'Running scenarios...' : 'Run Scenarios'}
      </button>

      {results.length > 0 && (
        <>
          <div className="text-sm text-gray-700">allow: {allow} | block: {block} | needs approval: {needsApproval} | error: {error}</div>
          <div className="overflow-auto">
            <table className="min-w-full text-sm border border-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left">Scenario</th>
                  <th className="p-2 text-left">Decision</th>
                  <th className="p-2 text-left">Reason</th>
                  <th className="p-2 text-left">Trust gaps</th>
                  <th className="p-2 text-left">Required approvals</th>
                  <th className="p-2 text-left">Triggering policy fields</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr key={row.scenario_id} className="border-t">
                    <td className="p-2">{row.scenario_id}</td>
                    <td className="p-2">{row.decision}</td>
                    <td className="p-2">{row.reason_code}</td>
                    <td className="p-2">{row.trust_gaps.join(', ') || 'None'}</td>
                    <td className="p-2">{row.required_approvals.join(', ') || 'None'}</td>
                    <td className="p-2">{row.triggering_policy_fields.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
