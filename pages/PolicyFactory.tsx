import React, { useState, useEffect } from 'react';
import { getRules, getSnapshots } from '../mockData';
import { Rule, Snapshot } from '../types';
import { generateRuleFromNaturalLanguage } from '../services/geminiService';
import { Sparkles, Save, Plus, Trash2 } from 'lucide-react';

export const PolicyFactory: React.FC = () => {
  const [rules, setRules] = useState<Rule[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [ruls, snaps] = await Promise.all([getRules(), getSnapshots()]);
        setRules(ruls);
        setSnapshots(snaps);
        if (snaps.length > 0) {
          setSelectedSnapshot(snaps[0].id);
        }
      } catch (error) {
        console.error('Error loading policy factory data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleGenerate = async () => {
    if (!aiPrompt.trim() || !selectedSnapshot) return;
    setIsGenerating(true);
    const newRule = await generateRuleFromNaturalLanguage(aiPrompt, selectedSnapshot);
    if (newRule) {
      setRules([...rules, newRule]);
      setAiPrompt('');
    }
    setIsGenerating(false);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-gray-500">Loading policy data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col space-y-6">
      
      {/* Header Actions */}
      <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm">
        <div className="flex items-center space-x-4">
           <select 
             className="form-select block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md border"
             value={selectedSnapshot || ''}
             onChange={(e) => setSelectedSnapshot(Number(e.target.value))}
           >
             {snapshots.map(s => (
               <option key={s.id} value={s.id}>{s.version} ({s.env})</option>
             ))}
           </select>
        </div>
        <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700">
          <Save className="h-4 w-4 mr-2" />
          Commit Snapshot
        </button>
      </div>

      {/* AI Assistant */}
      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 p-6 rounded-lg shadow-sm border border-indigo-100">
        <div className="flex items-start space-x-4">
          <div className="p-2 bg-indigo-600 rounded-lg shadow-lg">
             <Sparkles className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-medium text-gray-900">AI Policy Architect</h3>
            <p className="text-sm text-gray-500 mb-4">Describe a policy in plain English, and I'll generate the PKG rule structure for you.</p>
            <div className="flex space-x-2">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g., If the temperature is above 28 degrees in the server room, order emergency cooling."
                className="flex-1 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-3 border"
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              />
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${isGenerating ? 'bg-gray-400' : 'bg-indigo-600 hover:bg-indigo-700'}`}
              >
                {isGenerating ? 'Thinking...' : 'Generate Rule'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Rule List */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md flex-1 overflow-y-auto">
        <ul className="divide-y divide-gray-200">
          {rules.filter(r => r.snapshotId === selectedSnapshot).map((rule) => (
            <li key={rule.id}>
              <div className="px-4 py-4 sm:px-6 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-indigo-600 truncate">{rule.ruleName}</p>
                  <div className="ml-2 flex-shrink-0 flex">
                    <p className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                      Priority: {rule.priority}
                    </p>
                  </div>
                </div>
                <div className="mt-2 sm:flex sm:justify-between">
                  <div className="sm:flex flex-col space-y-1">
                    <p className="flex items-center text-sm text-gray-500">
                       <span className="font-semibold mr-2">Conditions:</span> 
                       {rule.conditions.map((c, i) => (
                         <span key={i} className="mr-2 bg-gray-100 px-2 py-0.5 rounded text-xs">
                           {c.conditionKey} {c.operator} {c.value || 'EXIST'}
                         </span>
                       ))}
                    </p>
                    <p className="flex items-center text-sm text-gray-500">
                       <span className="font-semibold mr-2">Emissions:</span>
                       {rule.emissions.map((e, i) => (
                         <span key={i} className="mr-2 bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs border border-blue-100">
                           {e.relationshipType} &rarr; {e.subtaskName}
                         </span>
                       ))}
                    </p>
                  </div>
                  <div className="mt-2 flex items-center text-sm text-gray-500 sm:mt-0">
                    <button onClick={() => setRules(rules.filter(r => r.id !== rule.id))} className="text-red-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
          {rules.length === 0 && (
            <li className="p-8 text-center text-gray-400">No rules found for this snapshot.</li>
          )}
        </ul>
      </div>
    </div>
  );
};