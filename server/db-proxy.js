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

const app = express();
const PORT = process.env.DB_PROXY_PORT || 3001;

// CORS for Vite dev server
app.use(cors({
  origin: 'http://localhost:3000',
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

// Test connection
pool.on('connect', () => {
  console.log('✅ Database connection established');
});

pool.on('error', (err) => {
  console.error('❌ Database pool error:', err);
});

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
    
    const result = await pool.query(`
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
    })));
  } catch (error) {
    console.error('Error fetching deployments:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get validation runs
app.get('/api/validation-runs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, snapshot_id, started_at, finished_at, success, report
      FROM pkg_validation_runs
      ORDER BY started_at DESC
    `);
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
    const result = await pool.query(`
      INSERT INTO facts (snapshot_id, namespace, subject, predicate, object_data, valid_from, valid_to, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id::text as id, snapshot_id, namespace, subject, predicate, object_data as object, valid_from, valid_to, created_by
    `, [
      snapshotId || null,
      namespace || 'default',
      subject,
      predicate,
      JSON.stringify(object || {}),
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

app.listen(PORT, () => {
  console.log(`🚀 Database proxy server running on http://localhost:${PORT}`);
  const dbName = process.env.POSTGRES_DB || 'seedcore';
  console.log(`📊 Connected to PostgreSQL at ${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${dbName}`);
});
