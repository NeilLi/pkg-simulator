import React from 'react';
import { OwnerContextPreflightResult } from '../../types/policyAssistant';

interface Props {
  result: OwnerContextPreflightResult | null;
  onRun: () => Promise<void>;
  running: boolean;
}

export const PreflightStep: React.FC<Props> = ({ result, onRun, running }) => {
  return (
    <div className="space-y-4">
      <button onClick={onRun} disabled={running} className={`px-4 py-2 rounded text-white ${running ? 'bg-gray-400' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
        {running ? 'Running preflight...' : 'Run Preflight'}
      </button>

      {result && (
        <div className="rounded border border-gray-200 p-4 space-y-3">
          <div className="text-sm"><span className="font-semibold">Decision:</span> {result.decision}</div>
          <div className="text-sm"><span className="font-semibold">Reason code:</span> {result.reason_code}</div>
          <div className="text-sm"><span className="font-semibold">Trust gaps:</span> {result.trust_gaps.join(', ') || 'None'}</div>
          <div className="text-sm"><span className="font-semibold">Required approvals:</span> {result.required_approvals.join(', ') || 'None'}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="font-semibold text-sm mb-1">Facts</p>
              <ul className="text-xs list-disc pl-5">
                {result.facts.map((f) => (<li key={f.path}>{f.path}: {f.value}</li>))}
              </ul>
            </div>
            <div>
              <p className="font-semibold text-sm mb-1">Inferences</p>
              <ul className="text-xs list-disc pl-5">
                {result.inferences.map((inf, idx) => (<li key={idx}>{inf.statement} (from {inf.based_on_paths.join(', ')})</li>))}
              </ul>
            </div>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer font-semibold">Technical detail</summary>
            <pre className="mt-2 bg-gray-50 border rounded p-2 overflow-auto">{JSON.stringify(result.technical_details || {}, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
};
