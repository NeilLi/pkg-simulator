# PKG Tables Reference

This document provides a comprehensive reference of all Policy Knowledge Graph (PKG) tables and their columns, extracted from the migration files. This is intended for developers working with the PKG system.

## Overview

The PKG (Policy Knowledge Graph) system manages policy snapshots with Semantic Context Hydration. It includes:
- Policy snapshots and versioning
- Policy rules, conditions, and emissions
- Deployment management and device tracking
- Validation and promotion workflows
- Temporal facts management

## Enum Types

### pkg_env
- `'prod'`
- `'staging'`
- `'dev'`

### pkg_engine
- `'wasm'`
- `'native'`

### pkg_condition_type
- `'TAG'`
- `'SIGNAL'`
- `'VALUE'`
- `'FACT'`

### pkg_operator
- `'='`
- `'!='`
- `'>='`
- `'<='`
- `'>'`
- `'<'`
- `'EXISTS'`
- `'IN'`
- `'MATCHES'`

### pkg_relation
- `'EMITS'`
- `'ORDERS'`
- `'GATE'`

### pkg_artifact_type
- `'rego_bundle'`
- `'wasm_pack'`

---

## Core Tables (013_pkg_core.sql)

### pkg_snapshots
Versioned policy snapshots (governance root).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Unique snapshot identifier |
| `version` | TEXT | NOT NULL, UNIQUE | Snapshot version identifier |
| `env` | pkg_env | NOT NULL, DEFAULT 'prod' | Environment (prod/staging/dev) |
| `entrypoint` | TEXT | DEFAULT 'data.pkg' | OPA/Rego entrypoint |
| `schema_version` | TEXT | DEFAULT '1' | Schema version |
| `checksum` | TEXT | NOT NULL, CHECK (length=64) | Hex SHA256 checksum |
| `size_bytes` | BIGINT | | Snapshot size in bytes |
| `signature` | TEXT | | Optional Ed25519/PGP signature |
| `is_active` | BOOLEAN | NOT NULL, DEFAULT FALSE | Active flag (only one per env) |
| `notes` | TEXT | | Optional notes |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Creation timestamp |

**Indexes:**
- `ux_pkg_active_per_env` (UNIQUE): `(env)` WHERE `is_active = TRUE`

**Comments:**
- Table: Versioned policy snapshots (governance root)

---

### pkg_subtask_types
Subtask type definitions within a snapshot.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique subtask type identifier |
| `snapshot_id` | INT | NOT NULL, REFERENCES pkg_snapshots(id) ON DELETE CASCADE | Foreign key to snapshot |
| `name` | TEXT | NOT NULL | Subtask type name |
| `default_params` | JSONB | | Default parameters for this subtask type |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Creation timestamp |

**Indexes:**
- `ux_pkg_subtask_name_snapshot` (UNIQUE): `(snapshot_id, name)`

---

### pkg_policy_rules
Policy rules within a snapshot.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique rule identifier |
| `snapshot_id` | INT | NOT NULL, REFERENCES pkg_snapshots(id) ON DELETE CASCADE | Foreign key to snapshot |
| `rule_name` | TEXT | NOT NULL | Rule name |
| `priority` | INT | NOT NULL, DEFAULT 100 | Rule priority (lower = higher priority) |
| `rule_source` | TEXT | NOT NULL | YAML/Datalog/Rego source |
| `compiled_rule` | TEXT | | Optional compiled form |
| `engine` | pkg_engine | NOT NULL, DEFAULT 'wasm' | Execution engine (wasm/native) |
| `rule_hash` | TEXT | | Hash of rule_source (optional) |
| `metadata` | JSONB | | Additional metadata |
| `disabled` | BOOLEAN | NOT NULL, DEFAULT FALSE | Disabled flag |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Creation timestamp |

**Indexes:**
- `idx_pkg_rules_snapshot`: `(snapshot_id)`
- `idx_pkg_rules_name`: `(rule_name)`

---

### pkg_rule_conditions
Conditions for policy rules.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `rule_id` | UUID | NOT NULL, REFERENCES pkg_policy_rules(id) ON DELETE CASCADE | Foreign key to rule |
| `condition_type` | pkg_condition_type | NOT NULL | Condition type (TAG/SIGNAL/VALUE/FACT) |
| `condition_key` | TEXT | NOT NULL | Condition key (e.g., vip, x6, subject) |
| `operator` | pkg_operator | NOT NULL, DEFAULT 'EXISTS' | Comparison operator |
| `value` | TEXT | | Value to compare against |
| `position` | INT | NOT NULL, DEFAULT 0 | Position/order of condition |

**Indexes:**
- `idx_pkg_conditions_rule`: `(rule_id)`
- `idx_pkg_conditions_key`: `(condition_key, operator)`

---

### pkg_rule_emissions
Rule emissions (subtask relationships).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `rule_id` | UUID | NOT NULL, REFERENCES pkg_policy_rules(id) ON DELETE CASCADE | Foreign key to rule |
| `subtask_type_id` | UUID | NOT NULL, REFERENCES pkg_subtask_types(id) ON DELETE CASCADE | Foreign key to subtask type |
| `relationship_type` | pkg_relation | NOT NULL, DEFAULT 'EMITS' | Relationship type (EMITS/ORDERS/GATE) |
| `params` | JSONB | | Parameters for the emission |
| `position` | INT | NOT NULL, DEFAULT 0 | Position/order of emission |

**Indexes:**
- `idx_pkg_emissions_rule`: `(rule_id)`
- `idx_pkg_emissions_subtask`: `(subtask_type_id)`

---

### pkg_snapshot_artifacts
WASM/Rego artifacts for snapshots.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `snapshot_id` | INT | PRIMARY KEY, REFERENCES pkg_snapshots(id) ON DELETE CASCADE | Foreign key to snapshot |
| `artifact_type` | pkg_artifact_type | NOT NULL | Artifact type (rego_bundle/wasm_pack) |
| `artifact_bytes` | BYTEA | NOT NULL | Binary artifact data |
| `size_bytes` | BIGINT | GENERATED ALWAYS AS (octet_length(artifact_bytes)) STORED | Computed size in bytes |
| `sha256` | TEXT | NOT NULL, CHECK (length=64) | SHA256 hash of artifact |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Creation timestamp |
| `created_by` | TEXT | NOT NULL, DEFAULT 'system' | Creator identifier |

**Indexes:**
- `idx_pkg_artifacts_type`: `(artifact_type)`

---

## Operations Tables (014_pkg_ops.sql)

### pkg_deployments
Targeted deployments (router/edge classes) for canary deployments.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | PRIMARY KEY | Unique deployment identifier |
| `snapshot_id` | INT | NOT NULL, REFERENCES pkg_snapshots(id) ON DELETE CASCADE | Foreign key to snapshot |
| `target` | TEXT | NOT NULL | Target (e.g., 'router', 'edge:door', 'edge:robot') |
| `region` | TEXT | NOT NULL, DEFAULT 'global' | Deployment region |
| `percent` | INT | NOT NULL, DEFAULT 100, CHECK (0-100) | Deployment percentage (0-100) |
| `is_active` | BOOLEAN | NOT NULL, DEFAULT TRUE | Active flag |
| `activated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Activation timestamp |
| `activated_by` | TEXT | NOT NULL, DEFAULT 'system' | Activator identifier |

**Indexes:**
- `idx_pkg_deploy_snapshot`: `(snapshot_id)`
- `idx_pkg_deploy_target`: `(target, region)`

---

### pkg_facts
Temporal policy facts (e.g., temporary access).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | PRIMARY KEY | Unique fact identifier |
| `snapshot_id` | INT | REFERENCES pkg_snapshots(id) ON DELETE CASCADE | Foreign key to snapshot (optional) |
| `namespace` | TEXT | NOT NULL, DEFAULT 'default' | Fact namespace |
| `subject` | TEXT | NOT NULL | Subject (e.g., 'guest:Ben') |
| `predicate` | TEXT | NOT NULL | Predicate (e.g., 'hasTemporaryAccess') |
| `object` | JSONB | NOT NULL | Object data (e.g., {"service":"lounge"}) |
| `valid_from` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Validity start time |
| `valid_to` | TIMESTAMPTZ | | Validity end time (NULL = indefinite) |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Creation timestamp |
| `created_by` | TEXT | NOT NULL, DEFAULT 'system' | Creator identifier |

**Indexes:**
- `idx_pkg_facts_subject`: `(subject)`
- `idx_pkg_facts_predicate`: `(predicate)`
- `idx_pkg_facts_window`: `(valid_from, valid_to)`
- `idx_pkg_facts_snapshot`: `(snapshot_id)`

**Note:** This table can be partitioned by `valid_from` for better performance with temporal data.

---

### pkg_validation_fixtures
Validation fixtures for snapshot testing.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | PRIMARY KEY | Unique fixture identifier |
| `snapshot_id` | INT | NOT NULL, REFERENCES pkg_snapshots(id) ON DELETE CASCADE | Foreign key to snapshot |
| `name` | TEXT | NOT NULL | Fixture name |
| `input` | JSONB | NOT NULL | Evaluator input |
| `expect` | JSONB | NOT NULL | Expected outputs/properties |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Creation timestamp |

**Constraints:**
- UNIQUE: `(snapshot_id, name)`

---

### pkg_validation_runs
Validation run records.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | PRIMARY KEY | Unique run identifier |
| `snapshot_id` | INT | NOT NULL, REFERENCES pkg_snapshots(id) ON DELETE CASCADE | Foreign key to snapshot |
| `started_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Start timestamp |
| `finished_at` | TIMESTAMPTZ | | End timestamp (NULL if still running) |
| `success` | BOOLEAN | | Success flag (NULL if not finished) |
| `report` | JSONB | | Validation report data |

**Indexes:**
- `idx_pkg_valruns_snapshot`: `(snapshot_id)`

---

### pkg_promotions
Promotion/rollback audit trail.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | PRIMARY KEY | Unique promotion identifier |
| `snapshot_id` | INT | NOT NULL, REFERENCES pkg_snapshots(id) ON DELETE CASCADE | Foreign key to snapshot |
| `from_version` | TEXT | | Previous version |
| `to_version` | TEXT | | New version |
| `actor` | TEXT | NOT NULL | Actor who performed the action |
| `action` | TEXT | NOT NULL | Action type ('promote' | 'rollback') |
| `reason` | TEXT | | Reason for promotion/rollback |
| `metrics` | JSONB | | Metrics (eval p95, validation summary) |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Creation timestamp |
| `success` | BOOLEAN | NOT NULL, DEFAULT TRUE | Success flag |

**Indexes:**
- `idx_pkg_promotions_snapshot`: `(snapshot_id)`

---

### pkg_device_versions
Device version heartbeat (edge telemetry).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `device_id` | TEXT | PRIMARY KEY | Device identifier (e.g., 'door:D-1510') |
| `device_type` | TEXT | NOT NULL | Device type ('door'|'robot'|'shuttle'|...) |
| `region` | TEXT | NOT NULL, DEFAULT 'global' | Device region |
| `snapshot_id` | INT | REFERENCES pkg_snapshots(id) ON DELETE SET NULL | Currently running snapshot |
| `version` | TEXT | | Version string |
| `last_seen` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Last heartbeat timestamp |

**Indexes:**
- `idx_pkg_device_type_region`: `(device_type, region)`

---

## Facts Table PKG Integration (016_fact_pkg_integration.sql)

The `facts` table (created in `009_create_facts_table.sql`) has been extended with PKG integration columns:

### Base Facts Table Columns
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique fact identifier |
| `text` | TEXT | NOT NULL | The fact text content |
| `tags` | TEXT[] | DEFAULT '{}' | Array of tags for categorizing |
| `meta_data` | JSONB | DEFAULT '{}'::jsonb | Additional metadata as JSON |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Last update timestamp |

### PKG Integration Columns (Added in 016)
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `snapshot_id` | INTEGER | REFERENCES pkg_snapshots(id) ON DELETE SET NULL | Reference to PKG snapshot for policy governance |
| `namespace` | TEXT | NOT NULL, DEFAULT 'default', CHECK (length > 0) | Fact namespace for organization and access control |
| `subject` | TEXT | | Fact subject (e.g., guest:john_doe) |
| `predicate` | TEXT | | Fact predicate (e.g., hasTemporaryAccess) |
| `object_data` | JSONB | | Fact object data as JSON |
| `valid_from` | TIMESTAMPTZ | | Fact validity start time (NULL = immediate) |
| `valid_to` | TIMESTAMPTZ | CHECK (valid_from <= valid_to) | Fact validity end time (NULL = indefinite) |
| `created_by` | TEXT | NOT NULL, DEFAULT 'system', CHECK (length > 0) | Creator identifier for audit trail |
| `pkg_rule_id` | TEXT | | PKG rule that created this fact |
| `pkg_provenance` | JSONB | | PKG rule provenance data for governance |
| `validation_status` | TEXT | | PKG validation status (pkg_validated, pkg_validation_failed, etc.) |

**PKG-Related Indexes:**
- `idx_facts_subject`: `(subject)`
- `idx_facts_predicate`: `(predicate)`
- `idx_facts_namespace`: `(namespace)`
- `idx_facts_temporal`: `(valid_from, valid_to)`
- `idx_facts_snapshot`: `(snapshot_id)`
- `idx_facts_created_by`: `(created_by)`
- `idx_facts_pkg_rule`: `(pkg_rule_id)`
- `idx_facts_validation_status`: `(validation_status)`
- `idx_facts_subject_namespace`: `(subject, namespace)`
- `idx_facts_temporal_namespace`: `(valid_from, valid_to, namespace)`
- `idx_facts_created_at_namespace`: `(created_at, namespace)`

**Constraints:**
- `chk_facts_temporal`: `valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to`
- `chk_facts_namespace_not_empty`: `namespace IS NOT NULL AND length(trim(namespace)) > 0`
- `chk_facts_created_by_not_empty`: `created_by IS NOT NULL AND length(trim(created_by)) > 0`

---

## Views and Functions

### Views (015_pkg_views_functions.sql)

#### pkg_active_artifact
Active artifact per environment.
- Columns: `env`, `snapshot_id`, `version`, `artifact_type`, `size_bytes`, `sha256`

#### pkg_rules_expanded
Rules + emissions flattened (audit-friendly).
- Columns: `rule_id`, `rule_name`, `priority`, `engine`, `disabled`, `snapshot_id`, `snapshot_version`, `env`, `relationship_type`, `subtask_name`, `params`, `metadata`

#### pkg_deployment_coverage
Deployment coverage: how many devices are running the intended snapshot.
- Columns: `target`, `region`, `snapshot_id`, `version`, `devices_on_snapshot`, `devices_total`

#### active_temporal_facts (016_fact_pkg_integration.sql)
View of non-expired temporal facts with status indicator.
- Includes all facts columns plus computed `status` field ('indefinite', 'active', 'expired')

### Views (017_task_embedding_support.sql)

#### v_unified_cortex_memory
**Unified Memory View** - Merges three memory tiers for PKG/Coordinator queries.

This view integrates:
- **TIER 1 (event_working)**: Multimodal task events (working memory) - perception events like voice, vision, sensor readings
- **TIER 2 (knowledge_base)**: Knowledge graph tasks (structural memory) - tasks linked through graph_node_map
- **TIER 3 (knowledge_base)**: General graph entities (world memory) - agents, organs, artifacts, capabilities, etc.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT | Polymorphic ID (UUID for tasks, BIGINT::TEXT for graph nodes) |
| `category` | TEXT | Category/type (task type, label, etc.) |
| `content` | TEXT | Content description |
| `memory_tier` | TEXT | Memory tier: 'event_working' or 'knowledge_base' |
| `vector` | VECTOR(1024) | 1024-dimensional embedding vector |
| `metadata` | JSONB | Contextual metadata (varies by tier) |

**Usage Notes:**
- PKG can query the entire view for deep reasoning across all memory tiers
- Coordinator can filter by `memory_tier` for fast-path queries
- Uses TEXT casting for polymorphic IDs to resolve UUID/BIGINT impedance mismatch
- Excludes duplicate 'task.primary' labels from TIER 3 to avoid duplication with TIER 2

**Related Views:**
- `task_embeddings_primary_1024`: Enhanced with `memory_tier` and `memory_label` columns for Unified Memory integration
- `tasks_missing_any_embedding_1024`: Identifies tasks missing 1024d embeddings (multimodal OR graph)

### Functions (015_pkg_views_functions.sql)

#### pkg_check_integrity()
Returns integrity check results.
- Returns: `(ok BOOLEAN, msg TEXT)`
- Checks for cross-snapshot emission mismatches

#### pkg_active_snapshot_id(p_env pkg_env DEFAULT 'prod')
Returns the active snapshot ID for an environment.
- Returns: `INT`

#### pkg_promote_snapshot(p_snapshot_id INT, p_env pkg_env, p_actor TEXT, p_reason TEXT DEFAULT NULL)
Promotes a snapshot to active for an environment.
- Returns: `VOID`
- Creates promotion audit record

### Functions (016_fact_pkg_integration.sql)

#### get_facts_by_subject(p_subject TEXT, p_namespace TEXT DEFAULT 'default', p_include_expired BOOLEAN DEFAULT FALSE)
Get facts for a subject with optional temporal filtering.
- Returns table with fact columns plus `is_temporal`, `is_expired` flags

#### cleanup_expired_facts(p_namespace TEXT DEFAULT NULL, p_dry_run BOOLEAN DEFAULT FALSE)
Cleanup expired temporal facts with optional dry run mode.
- Returns: `INTEGER` (count of expired facts)

#### get_fact_statistics(p_namespace TEXT DEFAULT NULL)
Get comprehensive statistics about facts.
- Returns: `(total_facts BIGINT, temporal_facts BIGINT, pkg_governed_facts BIGINT, expired_facts BIGINT, active_temporal_facts BIGINT, namespaces TEXT[])`

---

## Table Relationships

```
pkg_snapshots (root)
├── pkg_subtask_types (snapshot_id)
├── pkg_policy_rules (snapshot_id)
│   ├── pkg_rule_conditions (rule_id)
│   └── pkg_rule_emissions (rule_id)
│       └── pkg_subtask_types (subtask_type_id)
├── pkg_snapshot_artifacts (snapshot_id)
├── pkg_deployments (snapshot_id)
├── pkg_facts (snapshot_id, optional)
├── pkg_validation_fixtures (snapshot_id)
├── pkg_validation_runs (snapshot_id)
├── pkg_promotions (snapshot_id)
└── pkg_device_versions (snapshot_id, optional)
    └── facts (snapshot_id, optional via 016_fact_pkg_integration)
```

---

## Migration Files Reference

- `013_pkg_core.sql`: Core PKG catalog tables (snapshots, rules, conditions, emissions, artifacts)
- `014_pkg_ops.sql`: Operations tables (deployments, facts, validation, promotions, device tracking)
- `015_pkg_views_functions.sql`: Helper views and functions
- `016_fact_pkg_integration.sql`: PKG integration with facts table
- `017_task_embedding_support.sql`: Unified Memory views for PKG queries (`v_unified_cortex_memory`)
- `009_create_facts_table.sql`: Base facts table (referenced by 016)

---

## Notes for Developers

1. **Active Snapshots**: Only one active snapshot per environment (enforced by unique index)
2. **Cascade Deletes**: Most child tables cascade delete when snapshot is deleted
3. **Temporal Facts**: Both `pkg_facts` and `facts` tables support temporal validity windows
4. **Integrity**: Use `pkg_check_integrity()` to verify cross-snapshot references
5. **Promotion**: Use `pkg_promote_snapshot()` function for safe snapshot promotion with audit trail
6. **Device Tracking**: `pkg_device_versions` tracks which devices are running which snapshots
7. **Validation**: Use `pkg_validation_fixtures` and `pkg_validation_runs` for testing snapshots before promotion
8. **Unified Memory**: Use `v_unified_cortex_memory` view for PKG queries that need access to all memory tiers (working memory, structural memory, world memory)
