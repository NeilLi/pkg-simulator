import React, { useState, useEffect } from 'react';
import { getFacts, getUnifiedMemory } from '../mockData';
import { Clock, Brain, Globe, Zap, Database } from 'lucide-react';
import { Fact, UnifiedMemoryItem } from '../types';

interface KnowledgeBaseProps {
  view: string;
}

export const KnowledgeBase: React.FC<KnowledgeBaseProps> = ({ view }) => {
  const isMemory = view === 'memory';
  const [facts, setFacts] = useState<Fact[]>([]);
  const [unifiedMemory, setUnifiedMemory] = useState<UnifiedMemoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        // Always load facts for stats display, and load unified memory if needed
        const [fcts, mem] = await Promise.all([
          getFacts(),
          isMemory ? getUnifiedMemory(100) : Promise.resolve([]),
        ]);
        setFacts(fcts);
        if (isMemory) {
          setUnifiedMemory(mem);
        }
      } catch (error) {
        console.error('Error loading knowledge base data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [isMemory]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-gray-500">Loading knowledge base data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Header Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="bg-white overflow-hidden shadow rounded-lg px-4 py-5 sm:p-6">
          <dt className="text-sm font-medium text-gray-500 truncate">Active Facts</dt>
          <dd className="mt-1 text-3xl font-semibold text-gray-900">{facts.filter(f => f.status === 'active').length}</dd>
        </div>
        <div className="bg-white overflow-hidden shadow rounded-lg px-4 py-5 sm:p-6">
          <dt className="text-sm font-medium text-gray-500 truncate">Unified Memory Items</dt>
          <dd className="mt-1 text-3xl font-semibold text-gray-900">{unifiedMemory.length}</dd>
        </div>
        <div className="bg-white overflow-hidden shadow rounded-lg px-4 py-5 sm:p-6">
          <dt className="text-sm font-medium text-gray-500 truncate">Memory Tiers</dt>
          <dd className="mt-1 text-3xl font-semibold text-gray-900">3</dd>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-4 py-5 border-b border-gray-200 sm:px-6 flex justify-between items-center">
          <div>
            <h3 className="text-lg leading-6 font-medium text-gray-900">
              {isMemory ? 'Unified Cortex Memory' : 'Temporal Facts Registry'}
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              {isMemory 
                ? 'v_unified_cortex_memory view: Integrates Working Memory, Knowledge Base, and World Memory.' 
                : 'Governed facts (pkg_facts + facts) with temporal validity windows used for policy evaluation.'}
            </p>
          </div>
          {isMemory && (
             <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
               Vector-Ready
             </span>
          )}
        </div>

        <div className="overflow-x-auto">
          {isMemory ? (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tier</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Content</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Metadata</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {unifiedMemory.map((mem) => {
                  let TierIcon = Database;
                  let colorClass = "bg-gray-100 text-gray-800";
                  
                  if (mem.memoryTier === 'event_working') {
                     TierIcon = Zap;
                     colorClass = "bg-yellow-100 text-yellow-800";
                  } else if (mem.memoryTier === 'knowledge_base') {
                     TierIcon = Brain;
                     colorClass = "bg-blue-100 text-blue-800";
                  } else if (mem.memoryTier === 'world_memory') {
                     TierIcon = Globe;
                     colorClass = "bg-green-100 text-green-800";
                  }

                  return (
                    <tr key={mem.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                         <span className={`px-2 py-1 inline-flex items-center text-xs leading-5 font-semibold rounded-full ${colorClass}`}>
                           <TierIcon className="w-3 h-3 mr-1" />
                           {mem.memoryTier.replace('_', ' ')}
                         </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {mem.category}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-md truncate">
                        {mem.content}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <pre className="text-xs font-mono bg-gray-50 p-1 rounded">{JSON.stringify(mem.metadata).slice(0, 50)}...</pre>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Namespace</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subject</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Predicate</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Object</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Validity</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {facts.map((fact) => (
                  <tr key={fact.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">{fact.namespace}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600">{fact.subject}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                         {fact.predicate}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                       <pre className="text-xs truncate max-w-xs">{JSON.stringify(fact.object)}</pre>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex flex-col">
                        <span className="flex items-center text-xs text-green-600">
                           <Clock className="h-3 w-3 mr-1" /> From: {new Date(fact.validFrom).toLocaleDateString()}
                        </span>
                        {fact.validTo && (
                          <span className="flex items-center text-xs text-red-400">
                             <Clock className="h-3 w-3 mr-1" /> To: {new Date(fact.validTo).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};