import React, { useEffect, useMemo, useState } from 'react';
import { getFacts, getUnifiedMemory, clearCache } from '../mockData';
import {
  Clock,
  Brain,
  Globe,
  Zap,
  Database,
  RefreshCw,
  Search,
  AlertTriangle,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Fact, UnifiedMemoryItem } from '../types';

interface KnowledgeBaseProps {
  view: string; // 'knowledge' | 'memory'
}

type MemoryTier = UnifiedMemoryItem['memoryTier']; // 'event_working' | 'knowledge_base' | 'world_memory'
type FactStatus = Fact['status']; // 'active' | 'expired' | 'future' | undefined

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

function safeStringify(v: any, space = 2) {
  try {
    return JSON.stringify(v, null, space);
  } catch {
    return String(v);
  }
}

function formatDateTime(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function formatDate(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

export const KnowledgeBase: React.FC<KnowledgeBaseProps> = ({ view }) => {
  const isMemory = view === 'memory';

  // Data
  const [facts, setFacts] = useState<Fact[]>([]);
  const [unifiedMemory, setUnifiedMemory] = useState<UnifiedMemoryItem[]>([]);

  // UX State
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters / query
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<MemoryTier | 'all'>('all');
  const [factStatusFilter, setFactStatusFilter] = useState<FactStatus | 'all'>('all');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(50);

  // JSON modal
  const [jsonModal, setJsonModal] = useState<{
    title: string;
    body: string;
  } | null>(null);

  const loadData = async (opts?: { force?: boolean }) => {
    const force = !!opts?.force;

    try {
      setError(null);
      if (!force) setLoading(true);

      // Optional: if you use caching in mockData, this ensures fresh data
      // (safe even if it does nothing)
      if (force) clearCache?.();

      const [fcts, mem] = await Promise.all([
        getFacts(),
        isMemory ? getUnifiedMemory(500) : Promise.resolve([]),
      ]);

      // Stable default sort: newest first (facts by validFrom/createdBy not guaranteed, so use validFrom fallback)
      const sortedFacts = [...fcts].sort((a, b) => {
        const ta = a.validFrom ? Date.parse(a.validFrom) : 0;
        const tb = b.validFrom ? Date.parse(b.validFrom) : 0;
        return tb - ta;
      });

      setFacts(sortedFacts);
      setUnifiedMemory(isMemory ? mem : []);

      // Reset paging when switching view / refresh
      setPage(1);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMemory]);

  // Derived stats
  const activeFactsCount = useMemo(
    () => facts.filter(f => f.status === 'active').length,
    [facts]
  );

  const memoryTierCounts = useMemo(() => {
    const base = { event_working: 0, knowledge_base: 0, world_memory: 0 };
    for (const m of unifiedMemory) base[m.memoryTier] = (base[m.memoryTier] || 0) + 1;
    return base;
  }, [unifiedMemory]);

  // Filtered rows
  const filteredMemory = useMemo(() => {
    const q = query.trim().toLowerCase();
    return unifiedMemory.filter(m => {
      if (tierFilter !== 'all' && m.memoryTier !== tierFilter) return false;
      if (!q) return true;
      return (
        (m.category || '').toLowerCase().includes(q) ||
        (m.content || '').toLowerCase().includes(q) ||
        safeStringify(m.metadata || {}).toLowerCase().includes(q)
      );
    });
  }, [unifiedMemory, query, tierFilter]);

  const filteredFacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return facts.filter(f => {
      if (factStatusFilter !== 'all' && f.status !== factStatusFilter) return false;
      if (!q) return true;
      return (
        (f.namespace || '').toLowerCase().includes(q) ||
        (f.subject || '').toLowerCase().includes(q) ||
        (f.predicate || '').toLowerCase().includes(q) ||
        safeStringify(f.object).toLowerCase().includes(q)
      );
    });
  }, [facts, query, factStatusFilter]);

  const rows = isMemory ? filteredMemory : filteredFacts;

  // Paging
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    // keep page in range if filters reduce result count
    setPage(p => Math.min(p, totalPages));
  }, [totalPages]);

  // Tier badge helper
  const tierBadge = (tier: MemoryTier) => {
    let Icon = Database;
    let cls = 'bg-gray-100 text-gray-800';
    let label = tier.replace('_', ' ');

    if (tier === 'event_working') { Icon = Zap; cls = 'bg-yellow-100 text-yellow-800'; }
    if (tier === 'knowledge_base') { Icon = Brain; cls = 'bg-blue-100 text-blue-800'; }
    if (tier === 'world_memory') { Icon = Globe; cls = 'bg-green-100 text-green-800'; }

    return (
      <span className={`px-2 py-1 inline-flex items-center text-xs leading-5 font-semibold rounded-full ${cls}`}>
        <Icon className="w-3 h-3 mr-1" />
        {label}
      </span>
    );
  };

  const renderTopBar = () => (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h3 className="text-lg leading-6 font-medium text-gray-900">
          {isMemory ? 'Unified Cortex Memory' : 'Temporal Facts Registry'}
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          {isMemory
            ? 'Unified memory feed across tiers (Working, Knowledge Base, World).'
            : 'Governed facts with temporal validity windows used for policy evaluation.'}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => { setRefreshing(true); loadData({ force: true }); }}
          className="inline-flex items-center px-3 py-2 rounded-md border border-gray-200 hover:bg-gray-50 text-sm"
          disabled={loading || refreshing}
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>

        {isMemory && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
            Vector-Ready
          </span>
        )}
      </div>
    </div>
  );

  const renderControls = () => (
    <div className="mt-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
      <div className="relative w-full lg:max-w-md">
        <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          placeholder={isMemory ? 'Search category/content/metadata…' : 'Search namespace/subject/predicate/object…'}
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {isMemory ? (
          <select
            value={tierFilter}
            onChange={(e) => { setTierFilter(e.target.value as any); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            title="Tier filter"
          >
            <option value="all">All tiers</option>
            <option value="event_working">event_working</option>
            <option value="knowledge_base">knowledge_base</option>
            <option value="world_memory">world_memory</option>
          </select>
        ) : (
          <select
            value={factStatusFilter as any}
            onChange={(e) => { setFactStatusFilter(e.target.value as any); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            title="Status filter"
          >
            <option value="all">All statuses</option>
            <option value="active">active</option>
            <option value="future">future</option>
            <option value="expired">expired</option>
          </select>
        )}

        <select
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value) as any); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          title="Rows per page"
        >
          {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}/page</option>)}
        </select>
      </div>
    </div>
  );

  const renderPagination = () => (
    <div className="flex items-center justify-between py-3 text-sm text-gray-600">
      <div>
        Showing <span className="font-semibold">{rows.length === 0 ? 0 : pageStart + 1}</span>–
        <span className="font-semibold">{Math.min(pageStart + pageSize, rows.length)}</span> of{' '}
        <span className="font-semibold">{rows.length}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={currentPage <= 1}
          className="inline-flex items-center px-2.5 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-mono text-xs">
          Page {currentPage} / {totalPages}
        </span>
        <button
          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          disabled={currentPage >= totalPages}
          className="inline-flex items-center px-2.5 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  // Loading / error / empty
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

  if (error) {
    return (
      <div className="space-y-6">
        <div className="bg-white shadow rounded-lg p-6 border border-red-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-gray-900">Failed to load</div>
              <div className="text-sm text-gray-600 mt-1">{error}</div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => loadData({ force: true })}
                  className="px-3 py-2 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700"
                >
                  Retry
                </button>
                <button
                  onClick={() => setError(null)}
                  className="px-3 py-2 rounded-md border border-gray-200 text-sm hover:bg-gray-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="bg-white overflow-hidden shadow rounded-lg px-4 py-5 sm:p-6 border border-gray-100">
          <dt className="text-sm font-medium text-gray-500 truncate">Active Facts</dt>
          <dd className="mt-1 text-3xl font-semibold text-gray-900">{activeFactsCount}</dd>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg px-4 py-5 sm:p-6 border border-gray-100">
          <dt className="text-sm font-medium text-gray-500 truncate">Unified Memory Items</dt>
          <dd className="mt-1 text-3xl font-semibold text-gray-900">
            {isMemory ? unifiedMemory.length : '—'}
          </dd>
          <div className="mt-2 text-xs text-gray-500">
            {isMemory
              ? `event_working=${memoryTierCounts.event_working}, knowledge_base=${memoryTierCounts.knowledge_base}, world_memory=${memoryTierCounts.world_memory}`
              : 'Switch to Memory view to load.'}
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg px-4 py-5 sm:p-6 border border-gray-100">
          <dt className="text-sm font-medium text-gray-500 truncate">Rows (after filter)</dt>
          <dd className="mt-1 text-3xl font-semibold text-gray-900">{rows.length}</dd>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden border border-gray-100">
        <div className="px-4 py-5 border-b border-gray-200 sm:px-6">
          {renderTopBar()}
          {renderControls()}
        </div>

        <div className="overflow-x-auto">
          {/* Empty state */}
          {rows.length === 0 ? (
            <div className="p-10 text-center text-gray-500">
              <div className="text-sm font-medium text-gray-900">
                No {isMemory ? 'memory items' : 'facts'} found
              </div>
              <div className="text-sm mt-1">
                Try adjusting your search or filters.
              </div>
            </div>
          ) : isMemory ? (
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
                {(pageRows as UnifiedMemoryItem[]).map((mem) => (
                  <tr key={mem.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">{tierBadge(mem.memoryTier)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{mem.category}</td>
                    <td className="px-6 py-4 text-sm text-gray-900 max-w-xl truncate" title={mem.content}>
                      {mem.content}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <button
                        className="text-xs font-mono bg-gray-50 hover:bg-gray-100 border border-gray-200 px-2 py-1 rounded"
                        onClick={() =>
                          setJsonModal({
                            title: `Memory Metadata • ${mem.id}`,
                            body: safeStringify(mem.metadata, 2),
                          })
                        }
                      >
                        View JSON
                      </button>
                    </td>
                  </tr>
                ))}
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
                {(pageRows as Fact[]).map((fact) => (
                  <tr key={fact.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-mono">{fact.namespace}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600">{fact.subject}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                        {fact.predicate}
                      </span>
                      {fact.status && (
                        <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          fact.status === 'active' ? 'bg-green-100 text-green-800' :
                          fact.status === 'future' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {fact.status}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <button
                        className="text-xs font-mono bg-gray-50 hover:bg-gray-100 border border-gray-200 px-2 py-1 rounded"
                        onClick={() =>
                          setJsonModal({
                            title: `Fact Object • ${fact.namespace}:${fact.subject}:${fact.predicate}`,
                            body: safeStringify(fact.object, 2),
                          })
                        }
                      >
                        View JSON
                      </button>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex flex-col">
                        <span className="flex items-center text-xs text-gray-700">
                          <Clock className="h-3 w-3 mr-1" /> From: {formatDate(fact.validFrom)}
                        </span>
                        {fact.validTo ? (
                          <span className="flex items-center text-xs text-gray-500">
                            <Clock className="h-3 w-3 mr-1" /> To: {formatDate(fact.validTo)}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">To: —</span>
                        )}
                        <span className="text-xs text-gray-400 mt-1">
                          {formatDateTime(fact.validFrom)}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 sm:px-6 border-t border-gray-200">
          {renderPagination()}
        </div>
      </div>

      {/* JSON modal */}
      {jsonModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <div className="font-semibold text-gray-900">{jsonModal.title}</div>
              <button
                onClick={() => setJsonModal(null)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4">
              <pre className="text-xs font-mono bg-gray-50 border border-gray-200 rounded p-3 max-h-[65vh] overflow-auto whitespace-pre-wrap">
                {jsonModal.body}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
