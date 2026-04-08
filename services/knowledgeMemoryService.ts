import { Fact, UnifiedMemoryItem } from '../types';
import { seedcoreService } from './seedcoreService';

type SeedcoreRawFact = {
  id: string;
  text: string;
  tags?: string[];
  metadata?: Record<string, any>;
  meta_data?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
};

const asObject = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};

const toFact = (raw: SeedcoreRawFact): Fact => {
  const metadata = asObject(raw.metadata || raw.meta_data);
  const objectData = metadata.object_data ?? metadata.object ?? metadata.payload ?? {};

  return {
    id: raw.id,
    snapshotId:
      typeof metadata.snapshot_id === 'number'
        ? metadata.snapshot_id
        : typeof metadata.snapshotId === 'number'
          ? metadata.snapshotId
          : undefined,
    namespace: String(metadata.namespace || 'seedcore'),
    text: raw.text,
    tags: raw.tags || [],
    metaData: metadata,
    subject: metadata.subject ? String(metadata.subject) : undefined,
    predicate: metadata.predicate ? String(metadata.predicate) : undefined,
    object: objectData,
    validFrom: typeof metadata.valid_from === 'string' ? metadata.valid_from : undefined,
    validTo: typeof metadata.valid_to === 'string' ? metadata.valid_to : undefined,
    pkgRuleId: typeof metadata.pkg_rule_id === 'string' ? metadata.pkg_rule_id : undefined,
    pkgProvenance: metadata.pkg_provenance,
    validationStatus: typeof metadata.validation_status === 'string' ? metadata.validation_status : undefined,
    createdBy: typeof metadata.created_by === 'string' ? metadata.created_by : undefined,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    status: typeof metadata.status === 'string' ? (metadata.status as Fact['status']) : undefined,
  };
};

const toTaskMemory = (task: any): UnifiedMemoryItem => {
  const params = asObject(task.params);
  const result = asObject(task.result);
  const taskMeta = asObject(result.meta);
  const snapshotId =
    typeof task.snapshot_id === 'number'
      ? task.snapshot_id
      : typeof params.snapshot_id === 'number'
        ? params.snapshot_id
        : typeof taskMeta.snapshot_id === 'number'
          ? taskMeta.snapshot_id
          : undefined;

  return {
    id: `task:${task.id}`,
    category: `task:${task.type || 'unknown'}`,
    content: String(task.description || ''),
    memoryTier: 'knowledge_base',
    status: task.status,
    snapshotId,
    metadata: {
      source: 'seedcore.tasks',
      task_id: task.id,
      domain: task.domain,
      params,
      result,
      error: task.error,
      occurred_at: task.updated_at || task.created_at,
      created_at: task.created_at,
      updated_at: task.updated_at,
    },
  };
};

const toTrackingMemory = (event: any): UnifiedMemoryItem => ({
  id: `tracking:${event.id}`,
  category: `tracking:${event.event_type || 'event'}`,
  content:
    String(
      event.payload?.summary
      || event.payload?.message
      || event.payload?.reason
      || event.event_type
      || 'tracking_event',
    ),
  memoryTier: 'event_working',
  status: 'completed',
  snapshotId: typeof event.snapshot_id === 'number' ? event.snapshot_id : undefined,
  metadata: {
    source: 'seedcore.tracking_events',
    event_id: event.id,
    event_type: event.event_type,
    source_kind: event.source_kind,
    payload: event.payload,
    subject_type: event.subject_type,
    subject_id: event.subject_id,
    producer_id: event.producer_id,
    correlation_id: event.correlation_id,
    occurred_at: event.captured_at || event.created_at,
    captured_at: event.captured_at,
    created_at: event.created_at,
  },
});

const toWorldMemoryFromFact = (raw: SeedcoreRawFact): UnifiedMemoryItem => {
  const metadata = asObject(raw.metadata || raw.meta_data);
  const namespace = String(metadata.namespace || 'seedcore');
  const subject = metadata.subject ? String(metadata.subject) : 'fact';
  const predicate = metadata.predicate ? String(metadata.predicate) : 'text';
  const snapshotId =
    typeof metadata.snapshot_id === 'number'
      ? metadata.snapshot_id
      : typeof metadata.snapshotId === 'number'
        ? metadata.snapshotId
        : undefined;

  return {
    id: `fact:${raw.id}`,
    category: `fact:${namespace}.${predicate}`,
    content: String(raw.text || `${subject} ${predicate}`),
    memoryTier: 'world_memory',
    status: 'active',
    snapshotId,
    metadata: {
      source: 'seedcore.facts',
      fact_id: raw.id,
      namespace,
      subject,
      predicate,
      object_data: metadata.object_data ?? metadata.object ?? null,
      tags: raw.tags || [],
      occurred_at: raw.updated_at || raw.created_at,
      created_at: raw.created_at,
      updated_at: raw.updated_at,
    },
  };
};

const byOccurredAtDesc = (a: UnifiedMemoryItem, b: UnifiedMemoryItem) => {
  const at = Date.parse(String(a.metadata?.occurred_at || a.metadata?.captured_at || a.metadata?.created_at || ''));
  const bt = Date.parse(String(b.metadata?.occurred_at || b.metadata?.captured_at || b.metadata?.created_at || ''));
  return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
};

class KnowledgeMemoryService {
  async getFacts(): Promise<Fact[]> {
    const rawFacts = (await seedcoreService.listFacts()) as SeedcoreRawFact[];
    return rawFacts.map(toFact);
  }

  async getUnifiedMemory(limit = 500): Promise<UnifiedMemoryItem[]> {
    const [tasksResponse, trackingEvents, rawFacts] = await Promise.all([
      seedcoreService.listTasks({ limit }).catch(() => ({ items: [], total: 0 })),
      seedcoreService.listTrackingEvents({ limit }).catch(() => []),
      seedcoreService.listFacts().catch(() => []),
    ]);

    const taskRows = Array.isArray(tasksResponse?.items) ? tasksResponse.items : [];
    const eventRows = Array.isArray(trackingEvents) ? trackingEvents : [];
    const factRows = Array.isArray(rawFacts) ? (rawFacts as SeedcoreRawFact[]) : [];

    return [
      ...taskRows.map(toTaskMemory),
      ...eventRows.map(toTrackingMemory),
      ...factRows.map(toWorldMemoryFromFact),
    ]
      .sort(byOccurredAtDesc)
      .slice(0, limit);
  }

  async getActiveSnapshotInfo(): Promise<{ snapshotId?: number; snapshotVersion?: string }> {
    try {
      const status = await seedcoreService.getPKGStatus();
      return {
        snapshotId: typeof status.snapshot_id === 'number' ? status.snapshot_id : undefined,
        snapshotVersion: typeof status.snapshot_version === 'string' ? status.snapshot_version : undefined,
      };
    } catch {
      return {};
    }
  }
}

export const knowledgeMemoryService = new KnowledgeMemoryService();
