# PKG Simulator Alignment with SeedCore PKG Manager

This document tracks alignment between the PKG Simulator and the SeedCore PKG Manager implementation.

## Database Query Alignment

### ✅ Snapshots (`pkg_snapshots`)
- **Simulator**: Fetches all snapshots with: `id, version, env, is_active, checksum, size_bytes, created_at, notes`
- **PKG Manager**: Queries: `id, version, checksum, notes` filtered by `is_active = TRUE`
- **Status**: ✅ Aligned - Simulator shows all snapshots (useful for UI), Manager only needs active

### ✅ Rules (`pkg_policy_rules`)
- **Simulator**: 
  - Fetches: `id, snapshot_id, rule_name, priority, engine, disabled, rule_source, compiled_rule, rule_hash, metadata`
  - Filters: `disabled = FALSE` by default (can include disabled via `?include_disabled=true`)
  - Orders by: `priority DESC` (matching PKG DAO)
- **PKG Manager**: 
  - Fetches same fields via LEFT JOIN query
  - Filters: `disabled = FALSE`
  - Orders by: `priority DESC`
- **Status**: ✅ Aligned - Now matches PKG DAO pattern

### ✅ Conditions (`pkg_rule_conditions`)
- **Simulator**: Fetches all fields: `rule_id, condition_type, condition_key, operator, value, position`
- **PKG Manager**: Same fields via LEFT JOIN
- **Status**: ✅ Aligned

### ✅ Emissions (`pkg_rule_emissions`)
- **Simulator**: Fetches with JOIN to `pkg_subtask_types` for `subtask_name`
- **PKG Manager**: Same pattern via LEFT JOIN
- **Status**: ✅ Aligned

### ✅ Deployments (`pkg_deployments`)
- **Simulator**: 
  - JOINs with `pkg_snapshots` to get `snapshot_version`
  - Includes `activated_by` field
  - Filters `is_active = TRUE` by default
- **PKG Manager**: Same JOIN pattern, includes `snapshot_version`
- **Status**: ✅ Aligned

### ✅ Validation Runs (`pkg_validation_runs`)
- **Simulator**: Fetches: `id, snapshot_id, started_at, finished_at, success, report`
- **PKG Manager**: Same fields
- **Status**: ✅ Aligned

### ✅ Facts (`facts` table)
- **Simulator**: 
  - Queries `facts` table (not `pkg_facts`)
  - Uses PKG integration columns: `namespace, subject, predicate, object_data, valid_from, valid_to`
  - Computes `status` field: 'active' | 'expired'
- **PKG Manager**: Uses `facts` table via FactManager service
- **Status**: ✅ Aligned - Using correct table per PKG_TABLES_REFERENCE.md

### ✅ Unified Memory (`v_unified_cortex_memory`)
- **Simulator**: Simple query with limit, orders by memory tier
- **PKG Manager**: Uses `PKGCortexDAO` with vector similarity search
- **Status**: ✅ Aligned for simulator use case (simulator doesn't need similarity search)

## Type Definitions

### ✅ Enums
All enums match the database enum types:
- `PkgEnv`: 'prod' | 'staging' | 'dev' ✅
- `PkgEngine`: 'wasm' | 'native' ✅
- `PkgConditionType`: 'TAG' | 'SIGNAL' | 'VALUE' | 'FACT' ✅
- `PkgOperator`: '=' | '!=' | '>=' | '<=' | '>' | '<' | 'EXISTS' | 'IN' | 'MATCHES' ✅
- `PkgRelation`: 'EMITS' | 'ORDERS' | 'GATE' ✅

### ✅ Interfaces
- `Rule`: Now includes optional `ruleSource`, `compiledRule`, `ruleHash`, `metadata` ✅
- `Deployment`: Now includes `activatedBy`, `snapshotVersion` ✅
- All other interfaces match PKG manager data structures ✅

## Differences (By Design)

1. **Snapshot Filtering**: Simulator shows all snapshots, Manager only active
   - Reason: UI needs to show all snapshots for selection

2. **Disabled Rules**: Simulator can optionally include disabled rules
   - Reason: UI may want to show disabled rules for editing

3. **Unified Memory**: Simulator uses simple query, Manager uses vector similarity
   - Reason: Simulator doesn't need semantic search, just displays data

4. **Facts Table**: Simulator queries `facts` table (correct per reference)
   - Note: There's also `pkg_facts` table, but `facts` is the main table with PKG integration

## Verification Checklist

- [x] Snapshots query matches PKG DAO pattern
- [x] Rules query matches PKG DAO pattern (priority DESC, disabled filter)
- [x] Conditions and emissions JOIN pattern matches
- [x] Deployments JOIN with snapshots matches
- [x] Facts table selection matches PKG integration schema
- [x] Unified memory view query matches reference
- [x] Type definitions include all PKG manager fields
- [x] Enum mappings match database enum types

## References

- PKG Tables Reference: `deploy/migrations/PKG_TABLES_REFERENCE.md`
- PKG Manager: `src/seedcore/ops/pkg/manager.py`
- PKG DAO: `src/seedcore/ops/pkg/dao.py`
