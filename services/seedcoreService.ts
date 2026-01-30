/**
 * SeedCore API Client Service
 * 
 * Provides a TypeScript client for interacting with the SeedCore API.
 * Supports task creation, task inspection, facts management, and health checks.
 * 
 * Based on SeedCore CLI v2.5 (multimodal support)
 * 
 * @example
 * ```typescript
 * import { seedcoreService } from './services/seedcoreService';
 * 
 * // Create a query task
 * const task = await seedcoreService.createQuery("Analyze energy usage");
 * 
 * // Create a device action
 * await seedcoreService.createDeviceAction("on", "light", { room: "1203" });
 * 
 * // Create a voice task with multimodal envelope
 * await seedcoreService.createVoiceTask(
 *   "Turn off the lights",
 *   "s3://hotel-assets/audio/clip_99.wav",
 *   { confidence: 0.98, location_context: "lobby" }
 * );
 * 
 * // List tasks with filters
 * const tasks = await seedcoreService.listTasks({
 *   status: "completed",
 *   type: "action",
 *   since: "24h",
 *   limit: 10
 * });
 * 
 * // Search tasks
 * const results = await seedcoreService.searchTasks("energy");
 * 
 * // Check health
 * const health = await seedcoreService.checkHealth();
 * 
 * // Compile PKG snapshot rules to WASM
 * const compileResult = await seedcoreService.compilePKGRules(123, {
 *   entrypoint: "data.pkg.result"
 * });
 * ```
 */

// ------------------- Types -------------------

export type TaskType = "query" | "action" | "graph" | "maintenance" | "chat";
export type TaskStatus = "queued" | "running" | "completed" | "failed";

export interface Task {
  id: string;
  type: TaskType;
  status: TaskStatus;
  description: string;
  params?: Record<string, any>;
  domain?: string;
  result?: any;
  error?: string;
  drift_score?: number;
  created_at?: string;
  updated_at?: string;
}

export interface TaskListResponse {
  items: Task[];
  total: number;
}

export interface Fact {
  id: string;
  text: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
}

export interface ReadinessResponse {
  status: string;
  deps?: Record<string, string>;
}

export type PKGMode = "advisory" | "control";

export interface HotelTaskFacts {
  namespace: string;
  subject: string;
  predicate: string; // e.g., "request_diy_print", "request_magic_atelier", etc.
  object_data?: Record<string, any>;
}

export interface PKGEvaluateAsyncRequest {
  task_facts: HotelTaskFacts;
  snapshot_id?: number;
  current_time?: string; // ISO8601 datetime string
  embedding?: number[]; // 1024d embedding vector
  mode?: PKGMode; // Default: "advisory"
  zone_id?: string; // e.g., "magic_atelier", "journey_studio"
}

export interface PKGEvaluateResponse {
  decision: {
    allowed: boolean;
    reason: string;
  };
  emissions: {
    subtasks: any[];
    dag: any[];
  };
  provenance: {
    rules: any[];
    snapshot?: any;
    governed_facts?: any;
    semantic_context?: any;
  };
  meta?: Record<string, any>;
}

export interface PKGCompileRulesRequest {
  entrypoint?: string; // Default: "data.pkg.result"
}

export interface PKGCompileRulesResponse {
  snapshot_id: number;
  compiled_count: number;
  rules: Array<{
    rule_id: number;
    rule_name: string;
    compiled: boolean;
    hash: string;
  }>;
  artifact_created: boolean;
  artifact_hash?: string; // May be undefined if API returns different field name
  sha256?: string; // Alternative field name (common in backend responses)
  checksum?: string; // Alternative field name
  bundle_sha256?: string; // Alternative field name
  size_bytes?: number;
}

export interface MultimodalVoice {
  source: "voice";
  media_uri: string;
  transcription: string;
  transcription_engine?: string;
  confidence?: number;
  duration_seconds?: number;
  language?: string;
  location_context?: string;
  is_real_time?: boolean;
  ttl_seconds?: number;
}

export interface MultimodalVision {
  source: "vision";
  media_uri: string;
  scene_description: string;
  detection_engine?: string;
  confidence?: number;
  timestamp?: string;
  camera_id?: string;
  location_context?: string;
  is_real_time?: boolean;
  ttl_seconds?: number;
  parent_stream_id?: string;
  detected_objects?: any;
}

export interface CreateTaskOptions {
  type: TaskType;
  description: string;
  params?: Record<string, any>;
  domain?: string;
  run_immediately?: boolean;
}

export interface TaskFilters {
  status?: TaskStatus;
  type?: TaskType;
  since?: string; // e.g., "1h", "24h", "2d", "YYYY-MM-DD"
  limit?: number;
}

// ------------------- Client Class -------------------

class SeedCoreService {
  private apiBase: string;
  private apiV1Base: string;

  constructor() {
    // Vite-native environment loading: prioritize import.meta.env for browser context
    // Fallback to process.env for Node.js/SSR contexts, then default to localhost
    let apiUrl: string = "";
    
    // Check import.meta.env (Vite browser context)
    // Use try-catch since import.meta may not be available in all contexts
    try {
      // @ts-ignore - import.meta is a Vite-specific feature
      if (import.meta?.env?.VITE_SEEDCORE_API) {
        // @ts-ignore
        apiUrl = import.meta.env.VITE_SEEDCORE_API;
      }
    } catch {
      // import.meta not available, will fall back to process.env
    }
    
    // Fallback to process.env if import.meta.env didn't provide a value
    if (!apiUrl && typeof process !== 'undefined' && process.env) {
      apiUrl = process.env.VITE_SEEDCORE_API || process.env.SEEDCORE_API || "";
    }
    
    // Default to localhost if no environment variable is set
    this.apiBase = apiUrl || "http://127.0.0.1:8002";
    this.apiV1Base = `${this.apiBase}/api/v1`;
  }

  /**
   * Parse time string like "1h", "24h", "2d", "30m", or ISO date "YYYY-MM-DD"
   */
  private parseSince(val: string): Date | null {
    if (!val) return null;
    
    const trimmed = val.trim().toLowerCase();
    const match = trimmed.match(/^(\d+)([smhd])$/);
    
    if (match) {
      const n = parseInt(match[1], 10);
      const unit = match[2];
      const now = new Date();
      const deltaMs = {
        s: n * 1000,
        m: n * 60 * 1000,
        h: n * 60 * 60 * 1000,
        d: n * 24 * 60 * 60 * 1000,
      }[unit];
      return new Date(now.getTime() - deltaMs);
    }
    
    // Try ISO date
    try {
      return new Date(trimmed);
    } catch {
      return null;
    }
  }

  /**
   * Format datetime for display
   */
  private formatDateTime(isoString?: string): string {
    if (!isoString) return "N/A";
    try {
      const dt = new Date(isoString);
      return dt.toLocaleString();
    } catch {
      return isoString;
    }
  }

  /**
   * Make API request with error handling
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: any
  ): Promise<T> {
    const url = `${this.apiV1Base}${endpoint}`;
    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `API error (${response.status}): ${errorText}`;
        
        // Check for database constraint errors (server not initialized)
        if (errorText.includes('snapshot_id') || errorText.includes('null value') || errorText.includes('violates not-null constraint')) {
          errorMessage = 'SERVER_NOT_INITIALIZED';
        }
        
        const error = new Error(errorMessage);
        (error as any).status = response.status;
        (error as any).originalMessage = errorText;
        throw error;
      }
      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        // Check if it's a network error (server not running)
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError') || error.message.includes('ECONNREFUSED')) {
          const networkError = new Error('SERVER_NOT_RUNNING');
          (networkError as any).originalError = error;
          throw networkError;
        }
        throw error;
      }
      throw new Error(`Request failed: ${String(error)}`);
    }
  }

  // ------------------- Health Checks -------------------

  /**
   * Check API health status
   */
  async checkHealth(): Promise<HealthResponse> {
    try {
      const response = await fetch(`${this.apiBase}/health`);
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      throw new Error(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check API readiness (including database connectivity)
   */
  async checkReadiness(): Promise<ReadinessResponse> {
    try {
      const response = await fetch(`${this.apiBase}/readyz`);
      if (!response.ok) {
        throw new Error(`Readiness check failed: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      throw new Error(`Readiness check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ------------------- Task Creation -------------------

  /**
   * Create a task
   */
  async createTask(options: CreateTaskOptions): Promise<Task> {
    const payload = {
      type: options.type,
      description: options.description,
      params: options.params || {},
      run_immediately: options.run_immediately !== false, // default true
      ...(options.domain && { domain: options.domain }),
    };

    return this.request<Task>("POST", "/tasks", payload);
  }

  /**
   * Create a QUERY task (reasoning, analysis, planning)
   */
  async createQuery(description: string, params?: Record<string, any>): Promise<Task> {
    return this.createTask({
      type: "query",
      description,
      params: params || { task_description: description },
    });
  }

  /**
   * Create an ACTION task for device control
   */
  async createDeviceAction(
    action: "on" | "off",
    deviceType: string,
    params?: Record<string, any>
  ): Promise<Task> {
    const description = `${action} ${deviceType}`;
    return this.createTask({
      type: "action",
      description,
      domain: "device",
      params: {
        domain: "device",
        action,
        device: deviceType,
        ...params,
      },
    });
  }

  /**
   * Create an ACTION task for robot control
   */
  async createRobotAction(
    action: "dispatch" | "stop",
    task: string,
    params?: Record<string, any>
  ): Promise<Task> {
    const description = `robot ${action} ${task}`;
    return this.createTask({
      type: "action",
      description,
      domain: "robot",
      params: {
        domain: "robot",
        action,
        task,
        ...params,
      },
    });
  }

  /**
   * Create a GRAPH task for knowledge graph operations
   */
  async createGraphTask(
    operation: string,
    args?: string[],
    params?: Record<string, any>
  ): Promise<Task> {
    const description = operation + (args ? ` ${args.join(" ")}` : "");
    return this.createTask({
      type: "graph",
      description,
      params: {
        operation,
        args: args || [],
        ...params,
      },
    });
  }

  /**
   * Create a MAINTENANCE task for system operations
   */
  async createMaintenanceTask(
    operation: string,
    args?: string[],
    params?: Record<string, any>
  ): Promise<Task> {
    const description = operation + (args ? ` ${args.join(" ")}` : "");
    return this.createTask({
      type: "maintenance",
      description,
      params: {
        operation,
        args: args || [],
        ...params,
      },
    });
  }

  /**
   * Create a CHAT task with multimodal voice envelope
   */
  async createVoiceTask(
    transcription: string,
    mediaUri: string,
    options?: Partial<MultimodalVoice>
  ): Promise<Task> {
    const multimodal: MultimodalVoice = {
      source: "voice",
      media_uri: mediaUri,
      transcription,
      ...options,
    };

    return this.createTask({
      type: "chat",
      description: transcription,
      params: {
        multimodal,
        chat: {
          message: transcription,
        },
      },
    });
  }

  /**
   * Create an ACTION or QUERY task with multimodal vision envelope
   */
  async createVisionTask(
    sceneDescription: string,
    mediaUri: string,
    type: "action" | "query" = "action",
    options?: Partial<MultimodalVision>
  ): Promise<Task> {
    const multimodal: MultimodalVision = {
      source: "vision",
      media_uri: mediaUri,
      scene_description: sceneDescription,
      ...options,
    };

    return this.createTask({
      type,
      description: sceneDescription,
      params: {
        multimodal,
      },
    });
  }

  // ------------------- Task Inspection -------------------

  /**
   * List all tasks with optional filters
   * 
   * Filters are passed as URL query parameters to the backend for server-side filtering,
   * reducing bandwidth and improving performance for large datasets.
   */
  async listTasks(filters?: TaskFilters): Promise<TaskListResponse> {
    // Build query parameters for server-side filtering
    const params = new URLSearchParams();
    
    if (filters?.status) {
      params.append("status", filters.status);
    }
    
    if (filters?.type) {
      params.append("type", filters.type);
    }
    
    if (filters?.since) {
      params.append("since", filters.since);
    }
    
    if (filters?.limit && filters.limit > 0) {
      params.append("limit", String(filters.limit));
    }
    
    const queryString = params.toString();
    const endpoint = queryString ? `/tasks?${queryString}` : "/tasks";
    
    return this.request<TaskListResponse>("GET", endpoint);
  }

  /**
   * Get detailed task status by ID (accepts short IDs)
   */
  async getTaskStatus(taskId: string): Promise<Task> {
    // First, try to fetch all tasks to find matching ID
    const tasks = await this.request<TaskListResponse>("GET", "/tasks");
    const matches = tasks.items.filter((t) => t.id.startsWith(taskId));
    
    if (matches.length === 0) {
      throw new Error(`No task found with ID starting with ${taskId}`);
    }
    
    if (matches.length > 1) {
      throw new Error(
        `Multiple tasks match prefix ${taskId}. Use a longer prefix to disambiguate.`
      );
    }
    
    // Fetch full task details
    return this.request<Task>("GET", `/tasks/${matches[0].id}`);
  }

  /**
   * Quick status check (returns basic info)
   */
  async getQuickStatus(taskId: string): Promise<{
    id: string;
    type: string;
    status: string;
    description: string;
    updated_at?: string;
    error?: string;
    hasResult: boolean;
  }> {
    const tasks = await this.request<TaskListResponse>("GET", "/tasks");
    const matches = tasks.items.filter((t) => t.id.startsWith(taskId));
    
    if (matches.length === 0) {
      throw new Error(`No task found with ID starting with ${taskId}`);
    }
    
    if (matches.length > 1) {
      throw new Error(
        `Multiple tasks match prefix ${taskId}. Use getTaskStatus() for details.`
      );
    }
    
    const task = matches[0];
    return {
      id: task.id,
      type: task.type,
      status: task.status,
      description: task.description,
      updated_at: task.updated_at,
      error: task.error,
      hasResult: !!task.result,
    };
  }

  /**
   * Search tasks with fuzzy matching across id/type/description/result
   * 
   * Search query and filters are passed as URL query parameters to the backend
   * for server-side filtering and search, reducing bandwidth and improving performance.
   */
  async searchTasks(
    query: string,
    filters?: TaskFilters
  ): Promise<TaskListResponse> {
    // Build query parameters for server-side search and filtering
    const params = new URLSearchParams();
    params.append("q", query);
    
    if (filters?.status) {
      params.append("status", filters.status);
    }
    
    if (filters?.type) {
      params.append("type", filters.type);
    }
    
    if (filters?.since) {
      params.append("since", filters.since);
    }
    
    if (filters?.limit && filters.limit > 0) {
      params.append("limit", String(filters.limit));
    }
    
    const endpoint = `/tasks?${params.toString()}`;
    return this.request<TaskListResponse>("GET", endpoint);
  }

  // ------------------- Facts Management -------------------

  /**
   * List all facts
   */
  async listFacts(): Promise<Fact[]> {
    const response = await this.request<{ items: Fact[]; total: number }>(
      "GET",
      "/facts"
    );
    return response.items;
  }

  /**
   * Create a new fact
   */
  async createFact(text: string, metadata?: Record<string, any>): Promise<Fact> {
    return this.request<Fact>("POST", "/facts", {
      text,
      metadata: metadata || { source: "seedcore-client" },
    });
  }

  /**
   * Delete a fact by ID (accepts short IDs)
   */
  async deleteFact(factId: string): Promise<void> {
    // First, try to find the fact
    const facts = await this.listFacts();
    const matches = facts.filter((f) => f.id.startsWith(factId));
    
    if (matches.length === 0) {
      throw new Error(`No fact found with ID starting with ${factId}`);
    }
    
    if (matches.length > 1) {
      throw new Error(
        `Multiple facts match prefix ${factId}. Use a longer prefix to disambiguate.`
      );
    }
    
    await this.request<void>("DELETE", `/facts/${matches[0].id}`);
  }

  // ------------------- PKG Evaluation -------------------

  /**
   * Evaluate a task using PKG (Policy Knowledge Graph) async evaluation
   * 
   * This is a hotel-simulator friendly wrapper around PKGManager/PKGEvaluator.
   * It takes a simple SPO-style triple (namespace/subject/predicate/object_data)
   * and returns a policy decision with emissions and provenance.
   * 
   * The endpoint is `/api/v1/pkg/evaluate_async` (matching the FastAPI router prefix).
   * 
   * @param options - PKG evaluation request options
   * @returns Policy decision with emissions and provenance
   * 
   * @example
   * ```typescript
   * const result = await seedcoreService.evaluatePKGAsync({
   *   task_facts: {
   *     namespace: "hospitality",
   *     subject: "guest:neil",
   *     predicate: "request_diy_print",
   *     object_data: { material: "PLA", size: 12 }
   *   },
   *   snapshot_id: 1,
   *   zone_id: "wearable_studio"
   * });
   * 
   * if (result.decision.allowed) {
   *   console.log("Request allowed:", result.emissions.subtasks);
   * } else {
   *   console.log("Request blocked:", result.decision.reason);
   * }
   * ```
   */
  async evaluatePKGAsync(options: PKGEvaluateAsyncRequest): Promise<PKGEvaluateResponse> {
    const payload: PKGEvaluateAsyncRequest = {
      mode: options.mode || "advisory",
      ...options,
    };

    try {
      const response = await fetch(`${this.apiV1Base}/pkg/evaluate_async`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `PKG evaluation error (${response.status}): ${errorText}`;
        
        // Handle 403 Forbidden (policy gate blocked)
        // FastAPI HTTPException with status_code=403 returns detail as JSON
        if (response.status === 403) {
          try {
            const errorDetail = JSON.parse(errorText);
            // FastAPI returns error details in 'detail' field when it's a dict
            const detail = errorDetail.detail || errorDetail;
            const ruleId = detail.rule_id || detail.rule_name || "unknown_gate";
            const reason = detail.reason || detail.error || String(detail) || "Request blocked by policy gate";
            const error = new Error(`POLICY_BLOCKED: ${reason}`);
            (error as any).status = 403;
            (error as any).ruleId = ruleId;
            (error as any).ruleName = detail.rule_name;
            (error as any).originalMessage = errorText;
            throw error;
          } catch {
            // If parsing fails, throw generic 403 error
            const error = new Error(`POLICY_BLOCKED: Request blocked by policy gate`);
            (error as any).status = 403;
            (error as any).originalMessage = errorText;
            throw error;
          }
        }
        
        // Handle 503 Service Unavailable (PKG not available)
        // FastAPI HTTPException with status_code=503 returns detail as string or dict
        if (response.status === 503) {
          try {
            const errorDetail = JSON.parse(errorText);
            const detail = errorDetail.detail || errorDetail;
            errorMessage = `PKG_NOT_AVAILABLE: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
          } catch {
            errorMessage = 'PKG_NOT_AVAILABLE';
          }
        }
        
        // Check for database constraint errors (server not initialized)
        if (errorText.includes('snapshot_id') || errorText.includes('null value') || errorText.includes('violates not-null constraint')) {
          errorMessage = 'SERVER_NOT_INITIALIZED';
        }
        
        const error = new Error(errorMessage);
        (error as any).status = response.status;
        (error as any).originalMessage = errorText;
        throw error;
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        // Check if it's a network error (server not running)
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError') || error.message.includes('ECONNREFUSED')) {
          const networkError = new Error('SERVER_NOT_RUNNING');
          (networkError as any).originalError = error;
          throw networkError;
        }
        throw error;
      }
      throw new Error(`PKG evaluation failed: ${String(error)}`);
    }
  }

  /**
   * Execute emissions from a PKG policy decision (Reflex helper)
   * 
   * This helper automatically creates SeedCore tasks from the `emissions.subtasks` array
   * returned by `evaluatePKGAsync`. This simplifies React components by handling the
   * "Reflex" logic automatically, allowing the UI to focus on displaying results rather
   * than orchestrating task creation.
   * 
   * @param emissions - Emissions object from PKG evaluation response
   * @param options - Optional configuration for task creation
   * @returns Array of created tasks with their corresponding emission metadata
   * 
   * @example
   * ```typescript
   * const result = await seedcoreService.evaluatePKGAsync({
   *   task_facts: {
   *     namespace: "hospitality",
   *     subject: "guest:neil",
   *     predicate: "request_diy_print",
   *     object_data: { material: "PLA", size: 12 }
   *   }
   * });
   * 
   * if (result.decision.allowed) {
   *   // Automatically create tasks from emissions
   *   const createdTasks = await seedcoreService.executeEmissions(result.emissions);
   *   console.log(`Created ${createdTasks.length} tasks from policy emissions`);
   * }
   * ```
   */
  async executeEmissions(
    emissions: PKGEvaluateResponse['emissions'],
    options?: {
      runImmediately?: boolean;
      domain?: string;
    }
  ): Promise<Array<{ task: Task; emission: any }>> {
    const { subtasks = [] } = emissions;
    const results: Array<{ task: Task; emission: any }> = [];

    // Execute each subtask emission as a SeedCore task
    for (const emission of subtasks) {
      try {
        // Extract task type and description from emission
        const subtaskType = emission.subtask_type || emission.type || "action";
        const description = emission.description || emission.name || JSON.stringify(emission.params || {});
        const params = emission.params || {};

        // Map subtask_type to TaskType (default to "action" if unknown)
        const taskType: TaskType = 
          (subtaskType === "query" || subtaskType === "action" || subtaskType === "graph" || subtaskType === "maintenance" || subtaskType === "chat")
            ? subtaskType as TaskType
            : "action";

        // Create the task
        const task = await this.createTask({
          type: taskType,
          description,
          params: {
            ...params,
            // Preserve emission metadata for provenance
            _emission: {
              subtask_type: subtaskType,
              position: emission.position,
              original_emission: emission,
            },
          },
          domain: options?.domain || params.domain,
          run_immediately: options?.runImmediately !== false,
        });

        results.push({ task, emission });
      } catch (error) {
        // Log error but continue processing other emissions
        console.error(`Failed to execute emission:`, emission, error);
        // Optionally, you could collect failed emissions and return them separately
      }
    }

    return results;
  }

  /**
   * Get PKG status with detailed error information
   * 
   * This endpoint provides diagnostic information about the PKG system state,
   * including any errors that occurred during snapshot loading, integrity checks,
   * or evaluator creation.
   * 
   * @returns PKG status object with detailed error information if any issues exist
   * 
   * @example
   * ```typescript
   * const status = await seedcoreService.getPKGStatus();
   * if (status.error) {
   *   console.error('PKG Error:', status.error);
   *   console.log('Diagnostic SQL:', status.diagnostic_sql);
   * }
   * ```
   */
  async getPKGStatus(): Promise<{
    initialized: boolean;
    snapshot_id?: number;
    snapshot_version?: string;
    error?: string;
    error_type?: 'snapshot_integrity' | 'missing_artifacts' | 'missing_rules' | 'evaluator_creation' | 'unknown';
    diagnostic_sql?: string[];
    suggestion?: string;
  }> {
    try {
      const response = await fetch(`${this.apiV1Base}/pkg/status`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`PKG status check failed (${response.status}): ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        // Check if it's a network error (server not running)
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError') || error.message.includes('ECONNREFUSED')) {
          const networkError = new Error('SERVER_NOT_RUNNING');
          (networkError as any).originalError = error;
          throw networkError;
        }
        throw error;
      }
      throw new Error(`Unknown error checking PKG status: ${error}`);
    }
  }

  /**
   * Manually reload PKG snapshot
   * 
   * This endpoint triggers a manual reload of the PKG snapshot, which can help
   * diagnose and recover from snapshot loading errors. The response includes
   * detailed error information if the reload fails.
   * 
   * @param snapshotId - Optional snapshot ID to reload. If not provided, reloads the active snapshot.
   * @returns Reload result with detailed error information if reload fails
   * 
   * @example
   * ```typescript
   * try {
   *   const result = await seedcoreService.reloadPKG();
   *   console.log('PKG reloaded successfully:', result.snapshot_version);
   * } catch (error) {
   *   console.error('PKG reload failed:', error);
   * }
   * ```
   */
  async reloadPKG(snapshotId?: number): Promise<{
    success: boolean;
    snapshot_id?: number;
    snapshot_version?: string;
    error?: string;
    error_type?: 'snapshot_integrity' | 'missing_artifacts' | 'missing_rules' | 'evaluator_creation' | 'unknown';
    diagnostic_sql?: string[];
    suggestion?: string;
  }> {
    try {
      const response = await fetch(`${this.apiV1Base}/pkg/reload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(snapshotId ? { snapshot_id: snapshotId } : {}),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `PKG reload failed (${response.status}): ${errorText}`;
        
        // Try to parse detailed error information
        try {
          const errorDetail = JSON.parse(errorText);
          const detail = errorDetail.detail || errorDetail;
          if (typeof detail === 'object' && detail.error) {
            errorMessage = detail.error;
          } else if (typeof detail === 'string') {
            errorMessage = detail;
          }
        } catch {
          // If parsing fails, use the raw error text
        }
        
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        // Check if it's a network error (server not running)
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError') || error.message.includes('ECONNREFUSED')) {
          const networkError = new Error('SERVER_NOT_RUNNING');
          (networkError as any).originalError = error;
          throw networkError;
        }
        throw error;
      }
      throw new Error(`Unknown error reloading PKG: ${error}`);
    }
  }

  /**
   * Compile PKG snapshot rules to WASM
   * 
   * This endpoint compiles all rules for a given snapshot into a WASM artifact using
   * the production-grade OPA compiler. The compilation process:
   * 1. Fetches all rules for the snapshot
   * 2. Translates PKG rules to OPA-compatible Rego (using Rego v1 syntax)
   * 3. Compiles Rego to WASM using `opa build -t wasm -e {entrypoint} -o bundle.tar.gz policy.rego`
   * 4. Stores the WASM artifact in the database
   * 5. Updates snapshot checksums
   * 
   * **Critical Requirements for SeedCore Backend Rego Compiler:**
   * 
   * **1. Rego v1 Syntax Compliance:**
   * - All rule bodies MUST use `if { ... }` syntax (not `{ ... }`)
   * - All partial set rules MUST use `contains` keyword (not `[var] { }`)
   * 
   * **2. Value Formatting (Prevents Safety Violations):**
   * - **ALWAYS use `_format_value()`** when writing Python values to Rego code
   * - Python booleans MUST be converted: `True` → `"true"`, `False` → `"false"`
   * - Python `None` MUST be converted: `None` → `"null"`
   * - **Critical locations:**
   *   - Provenance block (`weight`, `priority`, etc.) - **MOST IMPORTANT**
   *   - Condition values (signals, tags, facts)
   *   - Emission parameters
   *   - Rule metadata (disabled, enabled flags)
   * 
   * **Common Error:** `var False is unsafe` occurs when Python `False` is written directly
   * into Rego code. OPA interprets capitalized `False` as an undefined variable.
   * 
   * See `docs/REGO_SAFETY_VIOLATIONS.md` for complete boolean/value formatting requirements.
   * 
   * The endpoint is `/api/v1/pkg/snapshots/{snapshot_id}/compile-rules` (matching the SeedCore backend).
   * 
   * @param snapshotId - The snapshot ID to compile rules for
   * @param options - Optional compilation options
   * @returns Compilation result with artifact information
   * 
   * @example
   * ```typescript
   * const result = await seedcoreService.compilePKGRules(123, {
   *   entrypoint: "data.pkg.result"
   * });
   * 
   * console.log(`Compiled ${result.compiled_count} rules`);
   * console.log(`Artifact hash: ${result.artifact_hash}`);
   * ```
   */
  async compilePKGRules(
    snapshotId: number,
    options?: PKGCompileRulesRequest
  ): Promise<PKGCompileRulesResponse> {
    try {
      const payload: PKGCompileRulesRequest = {
        entrypoint: options?.entrypoint || "data.pkg.result",
      };

      const response = await fetch(`${this.apiV1Base}/pkg/snapshots/${snapshotId}/compile-rules`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `PKG compilation error (${response.status}): ${errorText}`;
        
        // Try to parse detailed error information
        try {
          const errorDetail = JSON.parse(errorText);
          const detail = errorDetail.detail || errorDetail;
          if (typeof detail === 'object' && detail.error) {
            errorMessage = detail.error;
          } else if (typeof detail === 'string') {
            errorMessage = detail;
          }
        } catch {
          // If parsing fails, use the raw error text
        }
        
        // Handle 404 (snapshot not found)
        if (response.status === 404) {
          const error = new Error(`SNAPSHOT_NOT_FOUND: Snapshot ${snapshotId} not found`);
          (error as any).status = 404;
          (error as any).originalMessage = errorText;
          throw error;
        }
        
        // Handle 503 (OPA not available or compilation failed)
        if (response.status === 503) {
          const error = new Error(`COMPILATION_FAILED: ${errorMessage}`);
          (error as any).status = 503;
          (error as any).originalMessage = errorText;
          throw error;
        }
        
        const error = new Error(errorMessage);
        (error as any).status = response.status;
        (error as any).originalMessage = errorText;
        throw error;
      }

      const result = await response.json();
      
      // Debug logging: Log the actual response structure to help diagnose field name mismatches
      if (typeof window !== 'undefined' && (window as any).DEBUG_SEEDCORE) {
        console.log('[SeedCore API] Compile response:', result);
        console.log('[SeedCore API] Available hash fields:', {
          artifact_hash: result.artifact_hash,
          sha256: result.sha256,
          checksum: result.checksum,
          bundle_sha256: result.bundle_sha256
        });
      }
      
      return result;
    } catch (error) {
      if (error instanceof Error) {
        // Check if it's a network error (server not running)
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError') || error.message.includes('ECONNREFUSED')) {
          const networkError = new Error('SERVER_NOT_RUNNING');
          (networkError as any).originalError = error;
          throw networkError;
        }
        throw error;
      }
      throw new Error(`PKG compilation failed: ${String(error)}`);
    }
  }
}

// Export singleton instance
export const seedcoreService = new SeedCoreService();
