import { 
  Snapshot, SubtaskType, Rule, Fact, UnifiedMemoryItem, Deployment, ValidationRun 
} from './types';
import {
  fetchSnapshots,
  fetchSubtaskTypes,
  fetchRules,
  fetchFacts,
  fetchUnifiedMemory,
  fetchDeployments,
  fetchValidationRuns,
  testConnection
} from './services/database';

// Cache for data to avoid repeated queries
let snapshotsCache: Snapshot[] | null = null;
let subtasksCache: SubtaskType[] | null = null;
let rulesCache: Rule[] | null = null;
let factsCache: Fact[] | null = null;
let memoryCache: UnifiedMemoryItem[] | null = null;
let deploymentsCache: Deployment[] | null = null;
let validationsCache: ValidationRun[] | null = null;

// Cache TTL (5 minutes)
const CACHE_TTL = 5 * 60 * 1000;
let cacheTimestamp = 0;

// Check if cache is valid
function isCacheValid(): boolean {
  return Date.now() - cacheTimestamp < CACHE_TTL;
}

// Clear cache
export function clearCache(): void {
  snapshotsCache = null;
  subtasksCache = null;
  rulesCache = null;
  factsCache = null;
  memoryCache = null;
  deploymentsCache = null;
  validationsCache = null;
  cacheTimestamp = 0;
}

// Initialize database connection and test
let connectionTested = false;
export async function initializeDatabase(): Promise<boolean> {
  if (!connectionTested) {
    const connected = await testConnection();
    connectionTested = true;
    if (!connected) {
      console.error('Failed to connect to database. Please check your connection settings.');
      return false;
    }
  }
  return true;
}

// Fetch snapshots (with caching)
export async function getSnapshots(): Promise<Snapshot[]> {
  await initializeDatabase();
  if (!snapshotsCache || !isCacheValid()) {
    try {
      snapshotsCache = await fetchSnapshots();
      cacheTimestamp = Date.now();
    } catch (error) {
      console.error('Error fetching snapshots:', error);
      return [];
    }
  }
  return snapshotsCache;
}

// Fetch subtasks (with caching)
export async function getSubtaskTypes(): Promise<SubtaskType[]> {
  await initializeDatabase();
  if (!subtasksCache || !isCacheValid()) {
    try {
      subtasksCache = await fetchSubtaskTypes();
      cacheTimestamp = Date.now();
    } catch (error) {
      console.error('Error fetching subtask types:', error);
      return [];
    }
  }
  return subtasksCache;
}

// Fetch rules (with caching)
export async function getRules(): Promise<Rule[]> {
  await initializeDatabase();
  if (!rulesCache || !isCacheValid()) {
    try {
      rulesCache = await fetchRules();
      cacheTimestamp = Date.now();
    } catch (error) {
      console.error('Error fetching rules:', error);
      return [];
    }
  }
  return rulesCache;
}

// Fetch facts (with caching)
export async function getFacts(): Promise<Fact[]> {
  await initializeDatabase();
  if (!factsCache || !isCacheValid()) {
    try {
      factsCache = await fetchFacts();
      cacheTimestamp = Date.now();
    } catch (error) {
      console.error('Error fetching facts:', error);
      return [];
    }
  }
  return factsCache;
}

// Fetch unified memory (with caching)
export async function getUnifiedMemory(limit?: number): Promise<UnifiedMemoryItem[]> {
  await initializeDatabase();
  if (!memoryCache || !isCacheValid()) {
    try {
      memoryCache = await fetchUnifiedMemory(limit);
      cacheTimestamp = Date.now();
    } catch (error) {
      console.error('Error fetching unified memory:', error);
      return [];
    }
  }
  return memoryCache;
}

// Fetch deployments (with caching)
export async function getDeployments(activeOnly: boolean = false): Promise<Deployment[]> {
  await initializeDatabase();
  if (!deploymentsCache || !isCacheValid()) {
    try {
      deploymentsCache = await fetchDeployments(activeOnly);
      cacheTimestamp = Date.now();
    } catch (error) {
      console.error('Error fetching deployments:', error);
      return [];
    }
  }
  return deploymentsCache;
}

// Fetch validation runs (with caching)
export async function getValidationRuns(): Promise<ValidationRun[]> {
  await initializeDatabase();
  if (!validationsCache || !isCacheValid()) {
    try {
      validationsCache = await fetchValidationRuns();
      cacheTimestamp = Date.now();
    } catch (error) {
      console.error('Error fetching validation runs:', error);
      return [];
    }
  }
  return validationsCache;
}

// Legacy exports for backward compatibility (now async)
// These will be updated by components to use async/await
export const mockSnapshots: Snapshot[] = [];
export const mockSubtasks: SubtaskType[] = [];
export const mockRules: Rule[] = [];
export const mockFacts: Fact[] = [];
export const mockUnifiedMemory: UnifiedMemoryItem[] = [];
export const mockDeployments: Deployment[] = [];
export const mockValidations: ValidationRun[] = [];