/**
 * Simple Express proxy server for PKG Simulator database access
 * 
 * This server runs alongside the Vite dev server and proxies database queries
 * from the browser to PostgreSQL.
 * 
 * Usage:
 *   node server/db-proxy.js
 * 
 * Or with nodemon for auto-reload:
 *   npx nodemon server/db-proxy.js
 */

import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import crypto from 'crypto';

const app = express();
const PORT = process.env.DB_PROXY_PORT || 3001;

// CORS for Vite dev server (support both 3000 and 3010 for flexibility)
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow localhost on any port
    if (origin.match(/^http:\/\/localhost:\d+$/)) {
      return callback(null, true);
    }
    
    // Default: allow the request
    callback(null, true);
  },
  credentials: true
}));
app.use(express.json());

// Database configuration (from environment or defaults matching docker/env.example)
// Note: The actual database name is 'seedcore', not 'postgres' (see PG_DSN in env.example)
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'seedcore',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection and load enum defaults
pool.on('connect', async () => {
  console.log('✅ Database connection established');
  // Load task status enum default after first connection
  await loadTaskStatusDefault();
});

pool.on('error', (err) => {
  console.error('❌ Database pool error:', err);
});

// Cache for task status enum default value (loaded at startup)
let TASK_STATUS_DEFAULT = 'active';

// Load task status enum default value at startup
async function loadTaskStatusDefault() {
  try {
    const result = await pool.query(`
      SELECT e.enumlabel AS v
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = 'taskstatus'
      ORDER BY e.enumsortorder
      LIMIT 1
    `);
    if (result.rows[0]?.v) {
      TASK_STATUS_DEFAULT = result.rows[0].v;
      console.log(`✅ Loaded task status enum default: ${TASK_STATUS_DEFAULT}`);
    }
  } catch (e) {
    console.warn('⚠️  Could not load taskstatus enum; using fallback "active":', e.message);
  }
}


// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// Get snapshots
app.get('/api/snapshots', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, version, env, is_active, checksum, size_bytes, created_at, notes
      FROM pkg_snapshots
      ORDER BY created_at DESC
    `);
    res.json(result.rows.map(row => ({
      id: row.id,
      version: row.version,
      env: row.env,
      isActive: row.is_active,
      checksum: row.checksum,
      sizeBytes: row.size_bytes || 0,
      createdAt: row.created_at.toISOString(),
      notes: row.notes || undefined,
    })));
  } catch (error) {
    console.error('Error fetching snapshots:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get a single snapshot by ID
app.get('/api/snapshots/:id', async (req, res) => {
  try {
    const snapshotId = parseInt(req.params.id);
    const result = await pool.query(`
      SELECT 
        id, version, env, is_active, checksum, size_bytes, created_at, notes
      FROM pkg_snapshots
      WHERE id = $1
    `, [snapshotId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Snapshot ${snapshotId} not found` });
    }
    
    const row = result.rows[0];
    res.json({
      id: row.id,
      version: row.version,
      env: row.env,
      isActive: row.is_active,
      checksum: row.checksum,
      sizeBytes: row.size_bytes || 0,
      createdAt: row.created_at.toISOString(),
      notes: row.notes || undefined,
    });
  } catch (error) {
    console.error('Error fetching snapshot:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get subtask types
app.get('/api/subtask-types', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, snapshot_id, name, default_params
      FROM pkg_subtask_types
      ORDER BY snapshot_id, name
    `);
    res.json(result.rows.map(row => ({
      id: row.id,
      snapshotId: row.snapshot_id,
      name: row.name,
      defaultParams: row.default_params || {},
    })));
  } catch (error) {
    console.error('Error fetching subtask types:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get rules with conditions and emissions
app.get('/api/rules', async (req, res) => {
  try {
    // Fetch rules (matching PKG DAO pattern: filter disabled=FALSE, order by priority DESC)
    const includeDisabled = req.query.include_disabled === 'true';
    const disabledFilter = includeDisabled ? '' : 'AND r.disabled = FALSE';
    
    const rulesResult = await pool.query(`
      SELECT 
        r.id, 
        r.snapshot_id, 
        r.rule_name, 
        r.priority, 
        r.engine, 
        r.disabled,
        r.rule_source,
        r.compiled_rule,
        r.rule_hash,
        r.metadata
      FROM pkg_policy_rules r
      WHERE 1=1 ${disabledFilter}
      ORDER BY r.snapshot_id, r.priority DESC, r.rule_name
    `);
    
    // Fetch conditions
    const conditionsResult = await pool.query(`
      SELECT rule_id, condition_type, condition_key, operator, value, position
      FROM pkg_rule_conditions
      ORDER BY rule_id, position
    `);
    
    // Fetch emissions
    const emissionsResult = await pool.query(`
      SELECT 
        e.rule_id,
        e.subtask_type_id,
        e.relationship_type,
        e.params,
        e.position,
        st.name as subtask_name
      FROM pkg_rule_emissions e
      JOIN pkg_subtask_types st ON e.subtask_type_id = st.id
      ORDER BY e.rule_id, e.position
    `);
    
    // Group conditions and emissions by rule_id
    const conditionsByRule = new Map();
    const emissionsByRule = new Map();
    
    conditionsResult.rows.forEach(row => {
      if (!conditionsByRule.has(row.rule_id)) {
        conditionsByRule.set(row.rule_id, []);
      }
      conditionsByRule.get(row.rule_id).push({
        ruleId: row.rule_id,
        conditionType: row.condition_type,
        conditionKey: row.condition_key,
        operator: row.operator,
        value: row.value || undefined,
      });
    });
    
    emissionsResult.rows.forEach(row => {
      if (!emissionsByRule.has(row.rule_id)) {
        emissionsByRule.set(row.rule_id, []);
      }
      emissionsByRule.get(row.rule_id).push({
        ruleId: row.rule_id,
        subtaskTypeId: row.subtask_type_id,
        subtaskName: row.subtask_name,
        relationshipType: row.relationship_type,
        params: row.params || undefined,
      });
    });
    
    // Build rules with conditions and emissions (matching PKG DAO structure)
    const rules = rulesResult.rows.map(row => ({
      id: row.id,
      snapshotId: row.snapshot_id,
      ruleName: row.rule_name,
      priority: row.priority,
      engine: row.engine,
      disabled: row.disabled,
      ruleSource: row.rule_source || undefined,
      compiledRule: row.compiled_rule || undefined,
      ruleHash: row.rule_hash || undefined,
      metadata: row.metadata || undefined,
      conditions: conditionsByRule.get(row.id) || [],
      emissions: emissionsByRule.get(row.id) || [],
    }));
    
    res.json(rules);
  } catch (error) {
    console.error('Error fetching rules:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get deployments (matching PKG DAO pattern: join with snapshots for version)
app.get('/api/deployments', async (req, res) => {
  try {
    const activeOnly = req.query.active_only !== 'false'; // Default to true
    const activeFilter = activeOnly ? 'AND d.is_active = TRUE' : '';
    
    // Check if optional columns exist
    let hasValidationRunIdColumn = false;
    let hasDeploymentKeyColumn = false;
    
    try {
      const colCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'pkg_deployments' 
          AND column_name IN ('validation_run_id', 'deployment_key')
      `);
      const colNames = colCheck.rows.map(r => r.column_name);
      hasValidationRunIdColumn = colNames.includes('validation_run_id');
      hasDeploymentKeyColumn = colNames.includes('deployment_key');
    } catch (err) {
      // If we can't check, assume columns don't exist
      console.warn('Could not check column existence:', err.message);
    }
    
    const selectColumns = [
      'd.id', 
      'd.snapshot_id', 
      'd.target', 
      'd.region', 
      'd.percent', 
      'd.is_active', 
      'd.activated_at',
      'd.activated_by',
      's.version AS snapshot_version'
    ];
    
    if (hasValidationRunIdColumn) {
      selectColumns.splice(-1, 0, 'd.validation_run_id');
    }
    
    if (hasDeploymentKeyColumn) {
      selectColumns.splice(-1, 0, 'd.deployment_key');
    }
    
    const result = await pool.query(`
      SELECT ${selectColumns.join(', ')}
      FROM pkg_deployments d
      JOIN pkg_snapshots s ON s.id = d.snapshot_id
      WHERE 1=1 ${activeFilter}
      ORDER BY d.activated_at DESC
    `);
    
    res.json(result.rows.map(row => ({
      id: row.id,
      snapshotId: row.snapshot_id,
      target: row.target,
      region: row.region,
      percent: row.percent,
      isActive: row.is_active,
      activatedAt: row.activated_at.toISOString(),
      activatedBy: row.activated_by || undefined,
      snapshotVersion: row.snapshot_version,
      validationRunId: row.validation_run_id || undefined,
      deploymentKey: row.deployment_key || undefined,
    })));
  } catch (error) {
    console.error('Error fetching deployments:', error);
    res.status(500).json({ error: error.message });
  }
});

// Enhancement C: Get active deployments (read model for live system state)
app.get('/api/deployments/active', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        d.target,
        d.region,
        d.percent,
        d.activated_at,
        d.activated_by,
        s.version AS snapshot,
        s.id AS snapshot_id
      FROM pkg_deployments d
      JOIN pkg_snapshots s ON s.id = d.snapshot_id
      WHERE d.is_active = TRUE
      ORDER BY d.target, d.region, d.activated_at DESC
    `);
    
    res.json(result.rows.map(row => ({
      target: row.target,
      region: row.region,
      snapshot: row.snapshot,
      snapshotId: row.snapshot_id,
      percent: row.percent,
      activatedAt: row.activated_at.toISOString(),
      activatedBy: row.activated_by || 'system',
    })));
  } catch (error) {
    console.error('Error fetching active deployments:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get deployment coverage (intent vs reality: deployments vs device_versions)
app.get('/api/deployments/coverage', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        target,
        region,
        snapshot_id,
        version,
        devices_on_snapshot,
        devices_total
      FROM pkg_deployment_coverage
      ORDER BY target, region, snapshot_id DESC
    `);
    
    res.json(result.rows.map(row => ({
      target: row.target,
      region: row.region,
      snapshotId: row.snapshot_id,
      version: row.version,
      devicesOnSnapshot: Number(row.devices_on_snapshot || 0),
      devicesTotal: Number(row.devices_total || 0),
    })));
  } catch (error) {
    console.error('Error fetching deployment coverage:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get rollout events (audit trail for canary deployments)
app.get('/api/deployments/events', async (req, res) => {
  try {
    const target = req.query.target;
    const region = req.query.region;
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    
    let query = `
      SELECT 
        id,
        target,
        region,
        snapshot_id,
        from_percent,
        to_percent,
        is_rollback,
        actor,
        validation_run_id,
        created_at
      FROM pkg_rollout_events
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (target) {
      query += ` AND target = $${paramIndex++}`;
      params.push(target);
    }
    
    if (region) {
      query += ` AND region = $${paramIndex++}`;
      params.push(region);
    }
    
    query += ` ORDER BY created_at DESC`;
    
    if (limit && limit > 0) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(limit);
    }
    
    const result = await pool.query(query, params);
    
    res.json(result.rows.map(row => ({
      id: row.id,
      target: row.target,
      region: row.region,
      snapshotId: row.snapshot_id,
      fromPercent: row.from_percent ?? null,
      toPercent: row.to_percent ?? 0,
      isRollback: !!(row.is_rollback),
      actor: row.actor ?? 'system',
      validationRunId: row.validation_run_id ?? null,
      createdAt: row.created_at.toISOString(),
    })));
  } catch (error) {
    console.error('Error fetching rollout events:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create or update deployment (idempotent: upsert by snapshot_id + target + region + deployment_key)
app.post('/api/deployments', async (req, res) => {
  // Check column existence BEFORE starting transaction to avoid transaction abort issues
  let hasDeploymentKeyColumn = false;
  let hasValidationRunIdColumn = false;
  
  try {
    const colCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'pkg_deployments' 
        AND column_name IN ('deployment_key', 'validation_run_id')
    `);
    const colNames = colCheck.rows.map(r => r.column_name);
    hasDeploymentKeyColumn = colNames.includes('deployment_key');
    hasValidationRunIdColumn = colNames.includes('validation_run_id');
  } catch (err) {
    // If we can't check, assume columns don't exist
    console.warn('Could not check column existence:', err.message);
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { snapshotId, target, region, percent, isActive, activatedBy, deploymentKey, isRollback, validationRunId } = req.body;
    
    if (!snapshotId || !target || percent === undefined) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'snapshotId, target, and percent are required' });
    }
    
    // Validate percent is 0-100
    if (percent < 0 || percent > 100) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'percent must be between 0 and 100' });
    }
    
    const effectiveRegion = region || 'global';
    const effectiveActivatedBy = activatedBy || 'system';
    const effectiveDeploymentKey = deploymentKey || 'default';
    
    // Issue 2: Enforce percent=0 means inactive
    // Never allow percent=0 AND is_active=true
    const effectiveIsActive = (percent === 0) ? false : (isActive !== undefined ? isActive : true);
    
    // Enhancement A: Explicitly deactivate previous active deployment for same (target, region)
    // This ensures only one active deployment per (target, region) regardless of snapshot_id
    
    let previousActive;
    if (hasDeploymentKeyColumn) {
      previousActive = await client.query(`
        SELECT 
          d.id, 
          d.snapshot_id, 
          d.target, 
          d.region, 
          d.percent, 
          d.is_active, 
          d.activated_at,
          d.activated_by,
          s.version AS snapshot_version
        FROM pkg_deployments d
        JOIN pkg_snapshots s ON s.id = d.snapshot_id
        WHERE d.target = $1 
          AND d.region = $2 
          AND d.is_active = true
          AND (d.deployment_key IS NULL OR d.deployment_key = $3)
        ORDER BY d.activated_at DESC
        LIMIT 1
      `, [target, effectiveRegion, effectiveDeploymentKey]);
    } else {
      previousActive = await client.query(`
        SELECT 
          d.id, 
          d.snapshot_id, 
          d.target, 
          d.region, 
          d.percent, 
          d.is_active, 
          d.activated_at,
          d.activated_by,
          s.version AS snapshot_version
        FROM pkg_deployments d
        JOIN pkg_snapshots s ON s.id = d.snapshot_id
        WHERE d.target = $1 
          AND d.region = $2 
          AND d.is_active = true
        ORDER BY d.activated_at DESC
        LIMIT 1
      `, [target, effectiveRegion]);
    }
    
    let previousDeployment = null;
    if (previousActive.rows.length > 0) {
      previousDeployment = {
        id: previousActive.rows[0].id,
        snapshotId: previousActive.rows[0].snapshot_id,
        target: previousActive.rows[0].target,
        region: previousActive.rows[0].region,
        percent: previousActive.rows[0].percent,
        isActive: previousActive.rows[0].is_active,
        activatedAt: previousActive.rows[0].activated_at.toISOString(),
        activatedBy: previousActive.rows[0].activated_by || undefined,
        snapshotVersion: previousActive.rows[0].snapshot_version,
      };
      
      // Deactivate previous active deployment
      await client.query(`
        UPDATE pkg_deployments 
        SET is_active = false
        WHERE id = $1
      `, [previousActive.rows[0].id]);
    }
    
    // Issue 3: Validate monotonic increase (unless explicitly rolling back)
    // Check if deployment already exists for this snapshot + target + region + deployment_key
    let existingCheck;
    if (hasDeploymentKeyColumn) {
      existingCheck = await client.query(
        `SELECT id, percent, is_active 
         FROM pkg_deployments 
         WHERE snapshot_id = $1 AND target = $2 AND region = $3 
           AND (deployment_key IS NULL OR deployment_key = $4)
         ORDER BY activated_at DESC
         LIMIT 1`,
        [snapshotId, target, effectiveRegion, effectiveDeploymentKey]
      );
    } else {
      existingCheck = await client.query(
        `SELECT id, percent, is_active 
         FROM pkg_deployments 
         WHERE snapshot_id = $1 AND target = $2 AND region = $3 
         ORDER BY activated_at DESC
         LIMIT 1`,
        [snapshotId, target, effectiveRegion]
      );
    }
    
    // Fix 3: Server-side no-op detection
    if (existingCheck.rows.length > 0) {
      const existingPercent = existingCheck.rows[0].percent;
      const existingId = existingCheck.rows[0].id;
      
      // If percent is unchanged, return no-op response
      if (existingPercent === percent) {
        await client.query('COMMIT');
        
        // Fetch the existing deployment to return it
        const existingResult = await pool.query(`
          SELECT 
            d.id, 
            d.snapshot_id, 
            d.target, 
            d.region, 
            d.percent, 
            d.is_active, 
            d.activated_at,
            d.activated_by,
            s.version AS snapshot_version
          FROM pkg_deployments d
          JOIN pkg_snapshots s ON s.id = d.snapshot_id
          WHERE d.id = $1
        `, [existingId]);
        
        if (existingResult.rows.length > 0) {
          const row = existingResult.rows[0];
          return res.json({
            current: {
              id: row.id,
              snapshotId: row.snapshot_id,
              target: row.target,
              region: row.region,
              percent: row.percent,
              isActive: row.is_active,
              activatedAt: row.activated_at.toISOString(),
              activatedBy: row.activated_by || undefined,
              snapshotVersion: row.snapshot_version,
              noop: true, // Mark as no-op
            },
            previous: previousDeployment,
          });
        }
      }
      
      // Validate monotonic increase (unless explicitly rolling back)
      if (!isRollback && percent < existingPercent) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: `Deployment percent cannot decrease from ${existingPercent}% to ${percent}% unless explicitly rolling back. Set isRollback=true to allow decrease.` 
        });
      }
    }
    
    let deploymentId;
    if (existingCheck.rows.length > 0) {
      // Update existing deployment
      deploymentId = existingCheck.rows[0].id;
      
      // Build update query with optional validation_run_id
      // Check if validation_run_id column exists
      let hasValidationRunIdColumn = false;
      try {
        const colCheck = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'pkg_deployments' AND column_name = 'validation_run_id'
        `);
        hasValidationRunIdColumn = colCheck.rows.length > 0;
      } catch (err) {
        hasValidationRunIdColumn = false;
      }
      
      const updates = ['percent = $1', 'is_active = $2', 'activated_at = NOW()', 'activated_by = $3'];
      const values = [percent, effectiveIsActive, effectiveActivatedBy];
      let paramIndex = 4;
      
      if (hasValidationRunIdColumn && validationRunId !== undefined) {
        updates.push(`validation_run_id = $${paramIndex++}`);
        values.push(validationRunId);
      }
      
      values.push(deploymentId);
      updates.push(`WHERE id = $${paramIndex}`);
      
      await client.query(`
        UPDATE pkg_deployments 
        SET ${updates.join(', ')}
      `, values);
    } else {
      // Create new deployment
      // Build insert columns based on what exists in the database
      const insertColumns = ['snapshot_id', 'target', 'region', 'percent', 'is_active', 'activated_by'];
      const insertValues = [snapshotId, target, effectiveRegion, percent, effectiveIsActive, effectiveActivatedBy];
      
      // Add optional columns if they exist
      // (hasValidationRunIdColumn already checked before transaction)
      if (hasDeploymentKeyColumn) {
        insertColumns.push('deployment_key');
        insertValues.push(effectiveDeploymentKey);
      }
      
      if (hasValidationRunIdColumn && validationRunId !== undefined) {
        insertColumns.push('validation_run_id');
        insertValues.push(validationRunId);
      }
      
      const placeholders = insertColumns.map((_, i) => `$${i + 1}`).join(', ');
      const insertResult = await client.query(`
        INSERT INTO pkg_deployments (${insertColumns.join(', ')})
        VALUES (${placeholders})
        RETURNING id
      `, insertValues);
      deploymentId = insertResult.rows[0].id;
    }
    
    await client.query('COMMIT');
    
    // Fetch the complete deployment with snapshot version (using new connection since transaction is committed)
    // Build SELECT based on what columns exist
    const selectColumns = [
      'd.id', 
      'd.snapshot_id', 
      'd.target', 
      'd.region', 
      'd.percent', 
      'd.is_active', 
      'd.activated_at',
      'd.activated_by',
      's.version AS snapshot_version'
    ];
    
    if (hasDeploymentKeyColumn) {
      selectColumns.splice(-1, 0, 'd.deployment_key');
    }
    
    // (hasValidationRunIdColumn already checked before transaction)
    if (hasValidationRunIdColumn) {
      selectColumns.splice(-1, 0, 'd.validation_run_id');
    }
    
    const result = await pool.query(`
      SELECT ${selectColumns.join(', ')}
      FROM pkg_deployments d
      JOIN pkg_snapshots s ON s.id = d.snapshot_id
      WHERE d.id = $1
    `, [deploymentId]);
    
    const row = result.rows[0];
    
    // Enhancement B: Return both current and previous deployment
    res.json({
      current: {
        id: row.id,
        snapshotId: row.snapshot_id,
        target: row.target,
        region: row.region,
        percent: row.percent,
        isActive: row.is_active,
        activatedAt: row.activated_at.toISOString(),
        activatedBy: row.activated_by || undefined,
        snapshotVersion: row.snapshot_version,
        validationRunId: row.validation_run_id || undefined,
        deploymentKey: row.deployment_key || effectiveDeploymentKey,
        noop: false, // Not a no-op since we created/updated
      },
      previous: previousDeployment,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating/updating deployment:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Get validation runs (with optional snapshotId filter)
app.get('/api/validation-runs', async (req, res) => {
  try {
    const snapshotId = req.query.snapshotId ? parseInt(req.query.snapshotId) : null;
    let query = `
      SELECT id, snapshot_id, started_at, finished_at, success, report
      FROM pkg_validation_runs
    `;
    const params = [];
    
    if (snapshotId) {
      query += ` WHERE snapshot_id = $1`;
      params.push(snapshotId);
    }
    
    query += ` ORDER BY started_at DESC LIMIT 50`;
    
    const result = await pool.query(query, params);
    res.json(result.rows.map(row => ({
      id: row.id,
      snapshotId: row.snapshot_id,
      startedAt: row.started_at.toISOString(),
      finishedAt: row.finished_at?.toISOString(),
      success: row.success ?? undefined,
      report: row.report || undefined,
    })));
  } catch (error) {
    console.error('Error fetching validation runs:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start a validation run
app.post('/api/validation-runs/start', async (req, res) => {
  try {
    const { snapshotId } = req.body;
    
    if (!snapshotId || snapshotId < 1) {
      return res.status(400).json({ error: 'snapshotId is required and must be positive' });
    }
    
    const result = await pool.query(`
      INSERT INTO pkg_validation_runs (snapshot_id)
      VALUES ($1)
      RETURNING id, started_at
    `, [snapshotId]);
    
    const row = result.rows[0];
    res.json({
      id: row.id,
      startedAt: row.started_at.toISOString(),
    });
  } catch (error) {
    console.error('Error starting validation run:', error);
    res.status(500).json({ error: error.message });
  }
});

// Finish a validation run
app.post('/api/validation-runs/finish', async (req, res) => {
  try {
    const { id, success, report } = req.body;
    
    if (!id || id < 1) {
      return res.status(400).json({ error: 'id is required and must be positive' });
    }
    
    if (success === undefined || success === null) {
      return res.status(400).json({ error: 'success is required (boolean)' });
    }
    
    // Validate report is JSON-serializable if provided
    let reportJson = null;
    if (report !== undefined) {
      try {
        reportJson = typeof report === 'string' ? JSON.parse(report) : report;
        // Ensure it's valid JSON by stringifying
        JSON.stringify(reportJson);
      } catch (e) {
        return res.status(400).json({ error: 'report must be valid JSON' });
      }
    }
    
    const result = await pool.query(`
      UPDATE pkg_validation_runs
      SET
        finished_at = now(),
        success = $1,
        report = $2
      WHERE id = $3
      RETURNING id, snapshot_id, started_at, finished_at, success, report
    `, [success, reportJson, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Validation run ${id} not found` });
    }
    
    const row = result.rows[0];
    res.json({
      id: row.id,
      snapshotId: row.snapshot_id,
      startedAt: row.started_at.toISOString(),
      finishedAt: row.finished_at?.toISOString(),
      success: row.success,
      report: row.report || undefined,
    });
  } catch (error) {
    console.error('Error finishing validation run:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get facts
app.get('/api/facts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id::text as id,
        snapshot_id,
        namespace,
        subject,
        predicate,
        object_data as object,
        valid_from,
        valid_to,
        created_by,
        CASE
          WHEN valid_to IS NULL THEN 'active'
          WHEN valid_to > NOW() THEN 'active'
          ELSE 'expired'
        END as status
      FROM facts
      WHERE namespace IS NOT NULL
        AND subject IS NOT NULL
        AND predicate IS NOT NULL
      ORDER BY valid_from DESC
      LIMIT 100
    `);
    res.json(result.rows.map(row => ({
      id: row.id,
      snapshotId: row.snapshot_id || undefined,
      namespace: row.namespace,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object || {},
      validFrom: row.valid_from.toISOString(),
      validTo: row.valid_to?.toISOString(),
      status: row.status,
      createdBy: row.created_by || undefined,
    })));
  } catch (error) {
    console.error('Error fetching facts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get unified memory
app.get('/api/unified-memory', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50');
    const result = await pool.query(`
      SELECT 
        id,
        category,
        content,
        memory_tier,
        metadata
      FROM v_unified_cortex_memory
      ORDER BY 
        CASE memory_tier
          WHEN 'event_working' THEN 1
          WHEN 'knowledge_base' THEN 2
          ELSE 3
        END,
        id DESC
      LIMIT $1
    `, [limit]);
    res.json(result.rows.map(row => ({
      id: row.id,
      category: row.category || 'unknown',
      content: row.content || '',
      memoryTier: (row.memory_tier === 'event_working' ? 'event_working' :
                   row.memory_tier === 'knowledge_base' ? 'knowledge_base' :
                   'world_memory'),
      metadata: row.metadata || {},
    })));
  } catch (error) {
    console.error('Error fetching unified memory:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create snapshot
app.post('/api/snapshots', async (req, res) => {
  try {
    const { version, env, entrypoint, schemaVersion, checksum, sizeBytes, signature, notes, isActive } = req.body;
    
    // If isActive is true, deactivate other snapshots in the same env
    if (isActive) {
      await pool.query(
        'UPDATE pkg_snapshots SET is_active = FALSE WHERE env = $1',
        [env || 'prod']
      );
    }
    
    const result = await pool.query(`
      INSERT INTO pkg_snapshots (version, env, entrypoint, schema_version, checksum, size_bytes, signature, notes, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (version) DO UPDATE SET
        env = EXCLUDED.env,
        entrypoint = EXCLUDED.entrypoint,
        schema_version = EXCLUDED.schema_version,
        checksum = EXCLUDED.checksum,
        size_bytes = EXCLUDED.size_bytes,
        signature = EXCLUDED.signature,
        notes = EXCLUDED.notes,
        is_active = EXCLUDED.is_active
      RETURNING id, version, env, is_active, checksum, size_bytes, created_at, notes
    `, [
      version,
      env || 'prod',
      entrypoint || 'data.pkg',
      schemaVersion || '1',
      checksum || '0'.repeat(64),
      sizeBytes || 0,
      signature || null,
      notes || null,
      isActive || false
    ]);
    
    const row = result.rows[0];
    res.json({
      id: row.id,
      version: row.version,
      env: row.env,
      isActive: row.is_active,
      checksum: row.checksum,
      sizeBytes: row.size_bytes || 0,
      createdAt: row.created_at.toISOString(),
      notes: row.notes || undefined,
    });
  } catch (error) {
    console.error('Error creating snapshot:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create subtask type
app.post('/api/subtask-types', async (req, res) => {
  try {
    const { snapshotId, name, defaultParams } = req.body;
    const result = await pool.query(`
      INSERT INTO pkg_subtask_types (snapshot_id, name, default_params)
      VALUES ($1, $2, $3)
      ON CONFLICT (snapshot_id, name) DO UPDATE SET
        default_params = EXCLUDED.default_params
      RETURNING id, snapshot_id, name, default_params
    `, [snapshotId, name, defaultParams || {}]);
    
    const row = result.rows[0];
    res.json({
      id: row.id,
      snapshotId: row.snapshot_id,
      name: row.name,
      defaultParams: row.default_params || {},
    });
  } catch (error) {
    console.error('Error creating subtask type:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create rule with conditions and emissions
app.post('/api/rules', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { snapshotId, ruleName, priority, engine, ruleSource, compiledRule, ruleHash, metadata, conditions, emissions } = req.body;
    
    // Check if rule already exists (idempotent)
    const existingCheck = await client.query(
      'SELECT id FROM pkg_policy_rules WHERE snapshot_id = $1 AND rule_name = $2',
      [snapshotId, ruleName]
    );
    
    let ruleId;
    if (existingCheck.rows.length > 0) {
      // Rule exists, use existing ID
      ruleId = existingCheck.rows[0].id;
      // Update the rule with new values
      await client.query(`
        UPDATE pkg_policy_rules 
        SET priority = $1, engine = $2, rule_source = $3, compiled_rule = $4, rule_hash = $5, metadata = $6
        WHERE id = $7
      `, [
        priority || 100,
        engine || 'wasm',
        ruleSource || null,
        compiledRule || null,
        ruleHash || null,
        metadata || null,
        ruleId
      ]);
      // Delete existing conditions and emissions to recreate them
      await client.query('DELETE FROM pkg_rule_conditions WHERE rule_id = $1', [ruleId]);
      await client.query('DELETE FROM pkg_rule_emissions WHERE rule_id = $1', [ruleId]);
    } else {
      // Insert new rule
      const ruleResult = await client.query(`
        INSERT INTO pkg_policy_rules (snapshot_id, rule_name, priority, engine, rule_source, compiled_rule, rule_hash, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [
        snapshotId,
        ruleName,
        priority || 100,
        engine || 'wasm',
        ruleSource || null,
        compiledRule || null,
        ruleHash || null,
        metadata || null
      ]);
      ruleId = ruleResult.rows[0].id;
    }
    
    // Insert conditions
    if (conditions && conditions.length > 0) {
      for (let i = 0; i < conditions.length; i++) {
        const cond = conditions[i];
        await client.query(`
          INSERT INTO pkg_rule_conditions (rule_id, condition_type, condition_key, operator, value, position)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT DO NOTHING
        `, [
          ruleId,
          cond.conditionType,
          cond.conditionKey,
          cond.operator,
          cond.value || null,
          i
        ]);
      }
    }
    
    // Insert emissions
    if (emissions && emissions.length > 0) {
      for (let i = 0; i < emissions.length; i++) {
        const em = emissions[i];
        await client.query(`
          INSERT INTO pkg_rule_emissions (rule_id, subtask_type_id, relationship_type, params, position)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT DO NOTHING
        `, [
          ruleId,
          em.subtaskTypeId,
          em.relationshipType,
          em.params || null,
          i
        ]);
      }
    }
    
    await client.query('COMMIT');
    
    // Fetch the complete rule
    const completeRule = await pool.query(`
      SELECT 
        r.id, r.snapshot_id, r.rule_name, r.priority, r.engine, r.disabled,
        r.rule_source, r.compiled_rule, r.rule_hash, r.metadata
      FROM pkg_policy_rules r
      WHERE r.id = $1
    `, [ruleId]);
    
    const conditionsResult = await pool.query(`
      SELECT rule_id, condition_type, condition_key, operator, value, position
      FROM pkg_rule_conditions
      WHERE rule_id = $1
      ORDER BY position
    `, [ruleId]);
    
    const emissionsResult = await pool.query(`
      SELECT 
        e.rule_id, e.subtask_type_id, e.relationship_type, e.params, e.position,
        st.name as subtask_name
      FROM pkg_rule_emissions e
      JOIN pkg_subtask_types st ON e.subtask_type_id = st.id
      WHERE e.rule_id = $1
      ORDER BY e.position
    `, [ruleId]);
    
    const ruleRow = completeRule.rows[0];
    res.json({
      id: ruleRow.id,
      snapshotId: ruleRow.snapshot_id,
      ruleName: ruleRow.rule_name,
      priority: ruleRow.priority,
      engine: ruleRow.engine,
      disabled: ruleRow.disabled,
      ruleSource: ruleRow.rule_source || undefined,
      compiledRule: ruleRow.compiled_rule || undefined,
      ruleHash: ruleRow.rule_hash || undefined,
      metadata: ruleRow.metadata || undefined,
      conditions: conditionsResult.rows.map(c => ({
        ruleId: c.rule_id,
        conditionType: c.condition_type,
        conditionKey: c.condition_key,
        operator: c.operator,
        value: c.value || undefined,
      })),
      emissions: emissionsResult.rows.map(e => ({
        ruleId: e.rule_id,
        subtaskTypeId: e.subtask_type_id,
        subtaskName: e.subtask_name,
        relationshipType: e.relationship_type,
        params: e.params || undefined,
      })),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating rule:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Create fact
app.post('/api/facts', async (req, res) => {
  try {
    const { snapshotId, namespace, subject, predicate, object, validFrom, validTo, createdBy } = req.body;
    
    // Generate text representation of the fact (required field)
    const factText = `${subject} ${predicate} ${JSON.stringify(object || {})}`;
    
    const result = await pool.query(`
      INSERT INTO facts (snapshot_id, namespace, subject, predicate, object_data, text, valid_from, valid_to, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id::text as id, snapshot_id, namespace, subject, predicate, object_data as object, valid_from, valid_to, created_by
    `, [
      snapshotId || null,
      namespace || 'default',
      subject,
      predicate,
      JSON.stringify(object || {}),
      factText,
      validFrom ? new Date(validFrom) : new Date(),
      validTo ? new Date(validTo) : null,
      createdBy || 'system'
    ]);
    
    const row = result.rows[0];
    res.json({
      id: row.id,
      snapshotId: row.snapshot_id || undefined,
      namespace: row.namespace,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object || {},
      validFrom: row.valid_from.toISOString(),
      validTo: row.valid_to?.toISOString(),
      status: 'active',
      createdBy: row.created_by || undefined,
    });
  } catch (error) {
    console.error('Error creating fact:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clone snapshot (copy rules, subtask types, conditions, emissions to a new snapshot)
app.post('/api/snapshots/:sourceId/clone', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const sourceId = parseInt(req.params.sourceId);
    const { version, env, notes, isActive } = req.body;
    
    // Get source snapshot
    const sourceSnapshot = await client.query(
      'SELECT * FROM pkg_snapshots WHERE id = $1',
      [sourceId]
    );
    
    if (sourceSnapshot.rows.length === 0) {
      throw new Error(`Source snapshot ${sourceId} not found`);
    }
    
    const source = sourceSnapshot.rows[0];
    
    // If isActive is true, deactivate other snapshots in the same env
    if (isActive) {
      await client.query(
        'UPDATE pkg_snapshots SET is_active = FALSE WHERE env = $1',
        [env || source.env]
      );
    }
    
    // Create new snapshot
    const newSnapshotResult = await client.query(`
      INSERT INTO pkg_snapshots (version, env, entrypoint, schema_version, checksum, size_bytes, signature, notes, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, version, env, is_active, checksum, size_bytes, created_at, notes
    `, [
      version,
      env || source.env,
      source.entrypoint,
      source.schema_version,
      '0'.repeat(64), // New checksum
      source.size_bytes || 0,
      null, // No signature for cloned snapshot
      notes || `Cloned from ${source.version}`,
      isActive || false
    ]);
    
    const newSnapshotId = newSnapshotResult.rows[0].id;
    
    // Clone subtask types
    const subtaskTypesResult = await client.query(
      'SELECT id, name, default_params FROM pkg_subtask_types WHERE snapshot_id = $1',
      [sourceId]
    );
    
    const subtaskTypeMapping = new Map(); // old_id -> new_id
    
    for (const subtask of subtaskTypesResult.rows) {
      const newSubtaskResult = await client.query(`
        INSERT INTO pkg_subtask_types (snapshot_id, name, default_params)
        VALUES ($1, $2, $3)
        RETURNING id
      `, [newSnapshotId, subtask.name, subtask.default_params]);
      subtaskTypeMapping.set(subtask.id, newSubtaskResult.rows[0].id);
    }
    
    // Clone rules with conditions and emissions
    const rulesResult = await client.query(`
      SELECT id, rule_name, priority, engine, rule_source, compiled_rule, rule_hash, metadata
      FROM pkg_policy_rules
      WHERE snapshot_id = $1
    `, [sourceId]);
    
    for (const rule of rulesResult.rows) {
      // Insert new rule
      const newRuleResult = await client.query(`
        INSERT INTO pkg_policy_rules (snapshot_id, rule_name, priority, engine, rule_source, compiled_rule, rule_hash, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [
        newSnapshotId,
        rule.rule_name,
        rule.priority,
        rule.engine,
        rule.rule_source,
        rule.compiled_rule,
        rule.rule_hash,
        rule.metadata
      ]);
      
      const newRuleId = newRuleResult.rows[0].id;
      
      // Clone conditions
      const conditionsResult = await client.query(
        'SELECT condition_type, condition_key, operator, value, position FROM pkg_rule_conditions WHERE rule_id = $1 ORDER BY position',
        [rule.id]
      );
      
      for (const cond of conditionsResult.rows) {
        await client.query(`
          INSERT INTO pkg_rule_conditions (rule_id, condition_type, condition_key, operator, value, position)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          newRuleId,
          cond.condition_type,
          cond.condition_key,
          cond.operator,
          cond.value,
          cond.position
        ]);
      }
      
      // Clone emissions (with subtask type mapping)
      const emissionsResult = await client.query(
        'SELECT subtask_type_id, relationship_type, params, position FROM pkg_rule_emissions WHERE rule_id = $1 ORDER BY position',
        [rule.id]
      );
      
      for (const em of emissionsResult.rows) {
        const newSubtaskTypeId = subtaskTypeMapping.get(em.subtask_type_id);
        if (newSubtaskTypeId) {
          await client.query(`
            INSERT INTO pkg_rule_emissions (rule_id, subtask_type_id, relationship_type, params, position)
            VALUES ($1, $2, $3, $4, $5)
          `, [
            newRuleId,
            newSubtaskTypeId,
            em.relationship_type,
            em.params,
            em.position
          ]);
        }
      }
    }
    
    await client.query('COMMIT');
    
    // Fetch the complete new snapshot
    const newSnapshot = newSnapshotResult.rows[0];
    res.json({
      id: newSnapshot.id,
      version: newSnapshot.version,
      env: newSnapshot.env,
      isActive: newSnapshot.is_active,
      checksum: newSnapshot.checksum,
      sizeBytes: newSnapshot.size_bytes || 0,
      createdAt: newSnapshot.created_at.toISOString(),
      notes: newSnapshot.notes || undefined,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error cloning snapshot:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Update snapshot
// Promote snapshot to WASM (ID-based lookup)
app.post('/api/snapshots/:id/promote', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const snapshotId = parseInt(req.params.id);
    const { checksum, sizeBytes, artifactFormat } = req.body;
    
    console.log(`[POST /api/snapshots/${snapshotId}/promote] Looking up snapshot by id=${snapshotId}`);
    
    // Verify snapshot exists by ID (not version)
    const snapshotCheck = await client.query(
      'SELECT id, version, env, is_active FROM pkg_snapshots WHERE id = $1',
      [snapshotId]
    );
    
    if (snapshotCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      console.log(`[POST /api/snapshots/${snapshotId}/promote] Snapshot not found by id=${snapshotId}`);
      return res.status(404).json({ error: `Snapshot ${snapshotId} not found` });
    }
    
    const snapshot = snapshotCheck.rows[0];
    console.log(`[POST /api/snapshots/${snapshotId}/promote] Found snapshot: ${snapshot.version} (env: ${snapshot.env})`);
    
    // If promoting to active (implicit or explicit), deactivate other snapshots in same env
    // Note: For now, promotion just updates artifactFormat, not is_active
    // But if we want to make it active, we need to deactivate others first
    // const shouldActivate = req.body.isActive === true;
    // if (shouldActivate) {
    //   await client.query(
    //     'UPDATE pkg_snapshots SET is_active = false WHERE env = $1 AND is_active = true',
    //     [snapshot.env]
    //   );
    // }
    
    // Build update query
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (checksum !== undefined) {
      updates.push(`checksum = $${paramIndex++}`);
      values.push(checksum);
    }
    
    if (sizeBytes !== undefined) {
      updates.push(`size_bytes = $${paramIndex++}`);
      values.push(sizeBytes);
    }
    
    // Note: artifactFormat is not in DB schema yet, but we'll store it in notes or metadata for now
    // Or we can add it to the schema later
    if (updates.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No fields to update (checksum or sizeBytes required)' });
    }
    
    // Update snapshot by ID
    values.push(snapshotId);
    const updateQuery = `
      UPDATE pkg_snapshots 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, version, env, is_active, checksum, size_bytes, created_at, notes
    `;
    
    console.log(`[POST /api/snapshots/${snapshotId}/promote] Executing update query`);
    const result = await client.query(updateQuery, values);
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Snapshot ${snapshotId} not found during update` });
    }
    
    await client.query('COMMIT');
    
    const row = result.rows[0];
    console.log(`[POST /api/snapshots/${snapshotId}/promote] Promotion successful`);
    
    res.json({
      id: row.id,
      version: row.version,
      env: row.env,
      isActive: row.is_active,
      checksum: row.checksum,
      sizeBytes: row.size_bytes || 0,
      createdAt: row.created_at.toISOString(),
      notes: row.notes || undefined,
      artifactFormat: artifactFormat || 'wasm', // Include in response
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[POST /api/snapshots/:id/promote] Error:`, error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.patch('/api/snapshots/:id', async (req, res) => {
  try {
    const snapshotId = parseInt(req.params.id);
    const { artifactFormat, checksum, sizeBytes, stage, notes } = req.body;
    
    console.log(`[PATCH /api/snapshots/${snapshotId}] Looking up snapshot by id=${snapshotId}`);
    
    // Verify snapshot exists by ID first
    const snapshotCheck = await pool.query(
      'SELECT id FROM pkg_snapshots WHERE id = $1',
      [snapshotId]
    );
    
    if (snapshotCheck.rows.length === 0) {
      console.log(`[PATCH /api/snapshots/${snapshotId}] Snapshot not found by id=${snapshotId}`);
      return res.status(404).json({ error: `Snapshot ${snapshotId} not found` });
    }
    
    console.log(`[PATCH /api/snapshots/${snapshotId}] Snapshot found, updating`);
    
    // Build dynamic update query (only update fields that are provided)
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (checksum !== undefined) {
      updates.push(`checksum = $${paramIndex++}`);
      values.push(checksum);
    }
    
    if (sizeBytes !== undefined) {
      updates.push(`size_bytes = $${paramIndex++}`);
      values.push(sizeBytes);
    }
    
    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(notes);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    // Add snapshot ID as last parameter
    values.push(snapshotId);
    
    const updateQuery = `
      UPDATE pkg_snapshots 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, version, env, is_active, checksum, size_bytes, created_at, notes
    `;
    
    const result = await pool.query(updateQuery, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Snapshot ${snapshotId} not found during update` });
    }
    
    const row = result.rows[0];
    
    // Return updated snapshot (including artifactFormat if provided, even though it's not stored in DB yet)
    res.json({
      id: row.id,
      version: row.version,
      env: row.env,
      isActive: row.is_active,
      checksum: row.checksum,
      sizeBytes: row.size_bytes || 0,
      createdAt: row.created_at.toISOString(),
      notes: row.notes || undefined,
      artifactFormat: artifactFormat || undefined, // Include in response if provided
      stage: stage || undefined, // Include in response if provided
    });
  } catch (error) {
    console.error('Error updating snapshot:', error);
    res.status(500).json({ error: error.message });
  }
});

// Memory endpoints for Unified Cortex Memory integration
// POST /api/memory/append - Write to event_working (tasks + multimodal embeddings) or knowledge_base (graph embeddings)
app.post('/api/memory/append', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { tier, category, content, runId, metadata } = req.body;
    
    if (!tier || !category || !content) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'tier, category, and content are required' });
    }
    
    if (tier === 'event_working') {
      // Write to tasks + task_multimodal_embeddings (Tier A)
      // Generate a UUID for the task
      const taskIdResult = await client.query('SELECT gen_random_uuid() as id');
      const taskId = taskIdResult.rows[0].id;
      
      // Map category to valid task type enum values
      // Valid types: "chat", "query", "action", "graph", "maintenance", "unknown"
      const validTaskTypes = ['chat', 'query', 'action', 'graph', 'maintenance', 'unknown'];
      let taskType = 'action'; // Default to 'action' for wearable design seeds
      
      // Try to map category to a valid type
      if (category.includes('design') || category.includes('wearable') || category.includes('seed')) {
        taskType = 'action'; // Design/wearable tasks are actions
      } else if (category.includes('query') || category.includes('search')) {
        taskType = 'query';
      } else if (category.includes('chat') || category.includes('conversation')) {
        taskType = 'chat';
      } else if (category.includes('graph') || category.includes('knowledge')) {
        taskType = 'graph';
      } else if (validTaskTypes.includes(category.toLowerCase())) {
        taskType = category.toLowerCase();
      }
      
      // Store original category in metadata
      const taskMetadata = {
        ...(metadata || {}),
        original_category: category,
        task_category: category
      };
      
      // Insert into tasks table
      // Use SAVEPOINT before the insert to allow safe rollback on failure
      await client.query('SAVEPOINT sp_task_insert');
      
      try {
        // Always include status with the cached default value
        // This prevents NOT NULL constraint violations
        await client.query(`
          INSERT INTO tasks (id, type, description, params, status)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          taskId,
          taskType,
          content,
          JSON.stringify(taskMetadata),
          TASK_STATUS_DEFAULT
        ]);
        
        await client.query('RELEASE SAVEPOINT sp_task_insert');
      } catch (insertError) {
        // Log the root cause error (not just the 25P02 symptom)
        console.error('❌ tasks insert failed (root cause):', {
          code: insertError.code,
          message: insertError.message,
          detail: insertError.detail,
          constraint: insertError.constraint,
          column: insertError.column,
          dataType: insertError.dataType
        });
        
        // Rollback to savepoint (this prevents transaction abort)
        await client.query('ROLLBACK TO SAVEPOINT sp_task_insert');
        await client.query('RELEASE SAVEPOINT sp_task_insert');
        
        // Re-throw the error - don't continue in the same transaction
        throw insertError;
      }
      
      // Generate a dummy embedding vector (1024 dimensions) - in production, this would come from an embedding service
      // For now, we'll use a zero vector or a simple hash-based vector
      const embeddingVector = Array(1024).fill(0).map(() => Math.random() * 0.01 - 0.005); // Small random values
      const embeddingStr = `[${embeddingVector.join(',')}]`;
      
      // Insert into task_multimodal_embeddings
      await client.query(`
        INSERT INTO task_multimodal_embeddings (task_id, emb, source_modality, model_version)
        VALUES ($1, $2::vector, $3, $4)
      `, [
        taskId,
        embeddingStr,
        metadata?.source_modality || 'text',
        metadata?.model_version || 'default'
      ]);
      
      await client.query('COMMIT');
      
      res.json({
        id: taskId,
        tier: 'event_working',
        category,
        content,
        metadata: metadata || {}
      });
    } else if (tier === 'knowledge_base') {
      // Write to graph_embeddings_1024 (Tier B/C)
      // Generate a dummy embedding vector (1024 dimensions)
      const embeddingVector = Array(1024).fill(0).map(() => Math.random() * 0.01 - 0.005);
      const embeddingStr = `[${embeddingVector.join(',')}]`;
      
      // Compute content SHA256 for deduplication
      const contentSha256 = crypto.createHash('sha256').update(content).digest('hex');
      
      // Generate node_id - Option A: Check sequence existence first (industry-grade)
      // This avoids transaction abort by never calling nextval on non-existent sequence
      let nodeId;
      
      try {
        // Safe existence check that never errors
        const seqExists = await client.query(`
          SELECT to_regclass('graph_nodes_node_id_seq') IS NOT NULL AS ok
        `);
        
        if (seqExists.rows[0]?.ok) {
          // Sequence exists, use it
          const seqResult = await client.query(`
            SELECT nextval('graph_nodes_node_id_seq') AS node_id
          `);
          nodeId = seqResult.rows[0]?.node_id;
          
          if (!nodeId) {
            throw new Error('Sequence returned null');
          }
        } else {
          // Sequence doesn't exist, use fallback generator
          const ts = Date.now();
          const rnd = Math.floor(Math.random() * 1_000_000);
          nodeId = parseInt(`${ts}${String(rnd).padStart(6, '0')}`, 10);
        }
      } catch (seqError) {
        // Log root cause if sequence check/usage fails
        console.error('❌ node_id generation failed (root cause):', {
          code: seqError.code,
          message: seqError.message,
          detail: seqError.detail
        });
        
        // Fallback generator (guaranteed to work)
        const ts = Date.now();
        const rnd = Math.floor(Math.random() * 1_000_000);
        nodeId = parseInt(`${ts}${String(rnd).padStart(6, '0')}`, 10);
      }
      
      // Validate nodeId before using it
      if (!nodeId || !Number.isFinite(nodeId) || nodeId <= 0) {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: `Invalid node_id generated: ${nodeId}` });
      }
      
      // Insert into graph_embeddings_1024
      // Use SAVEPOINT before the insert to allow safe rollback on failure
      await client.query('SAVEPOINT sp_graph_insert');
      
      let result;
      try {
        result = await client.query(`
          INSERT INTO graph_embeddings_1024 (node_id, label, emb, model, props, content_sha256)
          VALUES ($1, $2, $3::vector, $4, $5, $6)
          RETURNING node_id
        `, [
          nodeId,
          category,
          embeddingStr,
          metadata?.model || 'default',
          JSON.stringify(metadata || {}),
          contentSha256
        ]);
        
        await client.query('RELEASE SAVEPOINT sp_graph_insert');
      } catch (insertError) {
        // Log root cause (25P02 is just a symptom - the real error happened earlier)
        console.error('❌ graph_embeddings_1024 insert failed (root cause):', {
          code: insertError.code,
          message: insertError.message,
          detail: insertError.detail,
          constraint: insertError.constraint,
          column: insertError.column,
          dataType: insertError.dataType
        });
        
        // Rollback to savepoint (this prevents transaction abort)
        await client.query('ROLLBACK TO SAVEPOINT sp_graph_insert');
        await client.query('RELEASE SAVEPOINT sp_graph_insert');
        
        // Re-throw the error - don't continue in the same transaction
        throw insertError;
      }
      
      const insertedNodeId = result.rows[0].node_id;
      
      // If metadata contains a task_id, create a mapping in graph_node_map
      if (metadata?.task_id) {
        try {
          await client.query(`
            INSERT INTO graph_node_map (task_id, node_id, relationship_type)
            VALUES ($1::uuid, $2, 'references')
            ON CONFLICT DO NOTHING
          `, [metadata.task_id, insertedNodeId]);
        } catch (err) {
          // graph_node_map might not exist or have different schema, ignore
          console.warn('Could not create graph_node_map entry:', err.message);
        }
      }
      
      await client.query('COMMIT');
      
      res.json({
        id: insertedNodeId.toString(),
        tier: 'knowledge_base',
        category,
        content,
        metadata: metadata || {}
      });
    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Invalid tier: ${tier}. Must be 'event_working' or 'knowledge_base'` });
    }
  } catch (error) {
    // Always rollback on error (safe even if already rolled back)
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Ignore rollback errors - transaction might already be rolled back
      // This is safe and expected
    }
    console.error('Error appending to memory:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// POST /api/memory/promote - Promote an item from event_working to knowledge_base
app.post('/api/memory/promote', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { seedHash, taskId, label } = req.body;
    
    if (!taskId && !seedHash) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Either taskId or seedHash is required' });
    }
    
    const memoryLabel = label || 'wearable.ticket';
    
    // Find the task by taskId (UUID) or by searching metadata for seedHash
    let task;
    if (taskId) {
      const taskResult = await client.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
      if (taskResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Task ${taskId} not found` });
      }
      task = taskResult.rows[0];
    } else {
      // Search for task by seedHash in metadata (less efficient, but supports seedHash lookup)
      const tasksResult = await client.query('SELECT * FROM tasks WHERE params::text LIKE $1', [`%${seedHash}%`]);
      if (tasksResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Task with seedHash ${seedHash} not found` });
      }
      task = tasksResult.rows[0];
    }
    
    // Get the embedding from task_multimodal_embeddings
    const embeddingResult = await client.query(`
      SELECT emb FROM task_multimodal_embeddings WHERE task_id = $1
    `, [task.id]);
    
    if (embeddingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `No embedding found for task ${task.id}` });
    }
    
    const embedding = embeddingResult.rows[0].emb;
    
    // Compute content SHA256
    const contentSha256 = crypto.createHash('sha256').update(task.description || '').digest('hex');
    
    // Generate node_id - Option A: Check sequence existence first (industry-grade)
    let nodeId;
    
    try {
      // Safe existence check that never errors
      const seqExists = await client.query(`
        SELECT to_regclass('graph_nodes_node_id_seq') IS NOT NULL AS ok
      `);
      
      if (seqExists.rows[0]?.ok) {
        // Sequence exists, use it
        const seqResult = await client.query(`
          SELECT nextval('graph_nodes_node_id_seq') AS node_id
        `);
        nodeId = seqResult.rows[0]?.node_id;
        
        if (!nodeId) {
          throw new Error('Sequence returned null');
        }
      } else {
        // Sequence doesn't exist, use fallback generator
        const ts = Date.now();
        const rnd = Math.floor(Math.random() * 1_000_000);
        nodeId = parseInt(`${ts}${String(rnd).padStart(6, '0')}`, 10);
      }
    } catch (seqError) {
      // Log root cause if sequence check/usage fails
      console.error('❌ node_id generation failed (root cause):', {
        code: seqError.code,
        message: seqError.message,
        detail: seqError.detail
      });
      
      // Fallback generator (guaranteed to work)
      const ts = Date.now();
      const rnd = Math.floor(Math.random() * 1_000_000);
      nodeId = parseInt(`${ts}${String(rnd).padStart(6, '0')}`, 10);
    }
    
    // Validate nodeId before using it
    if (!nodeId || !Number.isFinite(nodeId) || nodeId <= 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: `Invalid node_id generated: ${nodeId}` });
    }
    
    // Insert into graph_embeddings_1024
    const graphResult = await client.query(`
      INSERT INTO graph_embeddings_1024 (node_id, label, emb, model, props, content_sha256)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING node_id
    `, [
      nodeId,
      memoryLabel,
      embedding,
      'promoted',
      JSON.stringify({
        task_id: task.id,
        task_type: task.type,
        promoted_at: new Date().toISOString(),
        seed_hash: seedHash
      }),
      contentSha256
    ]);
    
    const insertedNodeId = graphResult.rows[0].node_id;
    
    // Create mapping in graph_node_map
    try {
      await client.query(`
        INSERT INTO graph_node_map (task_id, node_id, relationship_type)
        VALUES ($1::uuid, $2, 'promoted')
        ON CONFLICT DO NOTHING
      `, [task.id, insertedNodeId]);
    } catch (err) {
      console.warn('Could not create graph_node_map entry:', err.message);
    }
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      taskId: task.id,
      nodeId: insertedNodeId.toString(),
      label: memoryLabel,
      message: `Task ${task.id} promoted to knowledge_base as node ${nodeId}`
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error promoting memory:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// POST /api/policy/evaluate - Evaluate policy for a given context (stub implementation)
app.post('/api/policy/evaluate', async (req, res) => {
  try {
    const { snapshotId, context } = req.body;
    
    if (!snapshotId || !context) {
      return res.status(400).json({ error: 'snapshotId and context are required' });
    }
    
    // Stub implementation - in production, this would evaluate against PKG rules
    // For now, return a simple allowed/blocked decision based on risk_score
    const riskScore = context.signals?.risk_score || 0;
    const allowed = riskScore < 0.8; // Simple threshold
    
    res.json({
      allowed,
      reason: allowed 
        ? 'Allowed by policy (risk score below threshold)' 
        : 'Blocked by policy (risk score too high)',
      message: allowed ? 'Policy evaluation passed' : 'Policy evaluation failed',
      riskScore
    });
  } catch (error) {
    console.error('Error evaluating policy:', error);
    res.status(500).json({ error: error.message });
  }
});

// Catch-all for debugging unmatched routes
app.use('/api/snapshots', (req, res, next) => {
  console.log(`[UNMATCHED ROUTE] ${req.method} ${req.path}`);
  next();
});

// Catch-all for all unmatched API routes (for debugging)
app.use('/api/*', (req, res) => {
  console.log(`[UNMATCHED API ROUTE] ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: `Route not found: ${req.method} ${req.originalUrl}`,
    hint: 'Make sure the server has been restarted after adding new routes'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Database proxy server running on http://localhost:${PORT}`);
  console.log(`📋 Registered routes:`);
  console.log(`   GET    /api/snapshots`);
  console.log(`   GET    /api/snapshots/:id`);
  console.log(`   POST   /api/snapshots`);
  console.log(`   POST   /api/snapshots/:id/promote`);
  console.log(`   POST   /api/snapshots/:sourceId/clone`);
  console.log(`   PATCH  /api/snapshots/:id`);
  console.log(`   GET    /api/deployments`);
  console.log(`   GET    /api/deployments/active`);
  console.log(`   GET    /api/deployments/coverage`);
  console.log(`   GET    /api/deployments/events`);
  console.log(`   POST   /api/deployments`);
  console.log(`   GET    /api/validation-runs`);
  console.log(`   POST   /api/validation-runs/start`);
  console.log(`   POST   /api/validation-runs/finish`);
  console.log(`   POST   /api/memory/append`);
  console.log(`   POST   /api/memory/promote`);
  console.log(`   POST   /api/policy/evaluate`);
  const dbName = process.env.POSTGRES_DB || 'seedcore';
  console.log(`📊 Connected to PostgreSQL at ${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${dbName}`);
});
