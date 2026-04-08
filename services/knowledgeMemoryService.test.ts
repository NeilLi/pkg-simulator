import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSeedcoreService } = vi.hoisted(() => ({
  mockSeedcoreService: {
    listFacts: vi.fn(),
    listTasks: vi.fn(),
    listTrackingEvents: vi.fn(),
    getPKGStatus: vi.fn(),
  },
}));

vi.mock('./seedcoreService', () => ({
  seedcoreService: mockSeedcoreService,
}));

import { knowledgeMemoryService } from './knowledgeMemoryService';

describe('knowledgeMemoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps SeedCore facts into UI fact schema', async () => {
    mockSeedcoreService.listFacts.mockResolvedValue([
      {
        id: 'fact-1',
        text: 'zone:VAULT hasRuntimeSurface',
        tags: ['zone'],
        meta_data: {
          namespace: 'seedcore',
          subject: 'zone:VAULT',
          predicate: 'hasRuntimeSurface',
          object_data: { name: 'Vault' },
          snapshot_id: 42,
          status: 'active',
        },
        created_at: '2026-04-08T10:00:00Z',
        updated_at: '2026-04-08T10:05:00Z',
      },
    ]);

    const facts = await knowledgeMemoryService.getFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      id: 'fact-1',
      namespace: 'seedcore',
      subject: 'zone:VAULT',
      predicate: 'hasRuntimeSurface',
      snapshotId: 42,
      status: 'active',
      object: { name: 'Vault' },
    });
  });

  it('builds unified memory from tracking events, tasks, and facts with sorted tiers', async () => {
    mockSeedcoreService.listTasks.mockResolvedValue({
      total: 1,
      items: [
        {
          id: 'task-1',
          type: 'action',
          status: 'completed',
          description: 'Authorize release',
          params: { snapshot_id: 7 },
          created_at: '2026-04-08T09:00:00Z',
          updated_at: '2026-04-08T09:30:00Z',
        },
      ],
    });
    mockSeedcoreService.listTrackingEvents.mockResolvedValue([
      {
        id: 'evt-1',
        event_type: 'runtime_incident_detected',
        source_kind: 'runtime',
        payload: { message: 'Seal anomaly detected' },
        captured_at: '2026-04-08T11:00:00Z',
        created_at: '2026-04-08T11:00:00Z',
        snapshot_id: 7,
      },
    ]);
    mockSeedcoreService.listFacts.mockResolvedValue([
      {
        id: 'fact-1',
        text: 'zone:VAULT hasRuntimeSurface',
        tags: ['zone'],
        meta_data: {
          namespace: 'seedcore',
          subject: 'zone:VAULT',
          predicate: 'hasRuntimeSurface',
          object_data: { name: 'Vault' },
          snapshot_id: 7,
        },
        created_at: '2026-04-08T08:00:00Z',
        updated_at: '2026-04-08T08:05:00Z',
      },
    ]);

    const memory = await knowledgeMemoryService.getUnifiedMemory(50);
    expect(memory).toHaveLength(3);
    expect(memory[0].memoryTier).toBe('event_working');
    expect(memory[0].id).toBe('tracking:evt-1');
    expect(memory[1].memoryTier).toBe('knowledge_base');
    expect(memory[1].id).toBe('task:task-1');
    expect(memory[2].memoryTier).toBe('world_memory');
    expect(memory[2].id).toBe('fact:fact-1');
  });

  it('returns active snapshot info and falls back safely on errors', async () => {
    mockSeedcoreService.getPKGStatus.mockResolvedValue({
      initialized: true,
      snapshot_id: 99,
      snapshot_version: 'runtime-baseline-v99',
    });

    const active = await knowledgeMemoryService.getActiveSnapshotInfo();
    expect(active).toEqual({ snapshotId: 99, snapshotVersion: 'runtime-baseline-v99' });

    mockSeedcoreService.getPKGStatus.mockRejectedValue(new Error('unavailable'));
    const fallback = await knowledgeMemoryService.getActiveSnapshotInfo();
    expect(fallback).toEqual({});
  });
});

