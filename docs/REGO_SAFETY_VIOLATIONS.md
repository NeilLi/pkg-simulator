# Rego Safety Violations: Boolean and Value Formatting

This document addresses **Rego safety violations** that occur when Python values are incorrectly formatted in generated Rego code, specifically focusing on boolean literal handling.

---

## Critical Issue: `var False is unsafe` and Cascading Errors

### Root Cause

When the SeedCore backend `RegoCompiler` generates Rego code, Python values (especially booleans) are being written directly into Rego files using f-strings without proper formatting. This causes OPA to interpret Python's capitalized `True`/`False` as **undefined variables** rather than boolean literals.

### Error Pattern

```
1 error occurred: policy.rego:10: rego_compile_error: var False is unsafe
1 error occurred: policy.rego:46: rego_compile_error: var subtasks is unsafe
1 error occurred: policy.rego:82: rego_compile_error: var mr is unsafe
```

**Why this happens:**

1. **Primary Error**: Python `False` → Rego sees `False` (capitalized) → OPA treats it as a variable → Variable is undefined → **"var False is unsafe"**

2. **Cascading Errors**: Once the provenance block fails, the entire rule scope becomes invalid, causing:
   - `var subtasks is unsafe` - because the rule body is invalid
   - `var mr is unsafe` - because `matched_rules` set is invalid

---

## Required Fix: Use `_format_value()` for All Values

### Problematic Code Pattern

**❌ INCORRECT (Current Implementation):**

```python
# In _compile_rule method, provenance section
rego_lines.append(f'        "weight": {rule_provenance["weight"]},')
rego_lines.append(f'        "priority": {rule_provenance["priority"]},')
```

**If `rule_provenance["weight"]` is Python `False`, this generates:**
```rego
"weight": False,  # ❌ OPA sees this as undefined variable "False"
```

### Correct Implementation

**✅ CORRECT (Fixed Implementation):**

```python
# In _compile_rule method, provenance section
weight_val = self._format_value(rule_provenance["weight"])
priority_val = self._format_value(rule_provenance["priority"])

rego_lines.append(f'        "weight": {weight_val},')
rego_lines.append(f'        "priority": {priority_val},')
```

**This generates:**
```rego
"weight": false,  # ✅ OPA recognizes this as boolean literal
```

---

## Complete Fix for `_compile_rule` Method

### Location: `src/seedcore/ops/pkg/rego_compiler.py`

Update the provenance section (typically around lines 246-255):

```python
def _compile_rule(self, rule: dict, rule_id: int) -> List[str]:
    """
    Compile a single PKG rule to Rego.
    """
    rego_lines = []
    
    # ... existing rule compilation logic ...
    
    # --- PROVENANCE SECTION (FIX THIS) ---
    rego_lines.append("    # Define provenance")
    rego_lines.append("    provenance := {")
    
    # ✅ FIX: Use _format_value for ALL fields to prevent Python stringification
    rule_id_val = self._format_value(rule_provenance.get("rule_id"))
    rule_name_val = self._format_value(rule_provenance.get("rule_name"))
    priority_val = self._format_value(rule_provenance.get("rule_priority", 0))
    weight_val = self._format_value(rule_provenance.get("weight", False))  # ⚠️ Critical: False -> false
    cond_count = self._format_value(rule_provenance.get("matched_conditions", 0))
    emissions_count = self._format_value(rule_provenance.get("emissions_count", 0))
    
    rego_lines.append(f'        "rule_id": {rule_id_val},')
    rego_lines.append(f'        "rule_name": {rule_name_val},')
    rego_lines.append(f'        "rule_priority": {priority_val},')
    rego_lines.append(f'        "weight": {weight_val},')
    rego_lines.append(f'        "matched_conditions": {cond_count},')
    rego_lines.append(f'        "emissions_count": {emissions_count}')
    rego_lines.append("    }")
    
    # ... rest of method ...
```

---

## Verify `_format_value()` Method Handles Booleans

Ensure your `_format_value()` method correctly converts Python booleans:

```python
def _format_value(self, value: Any) -> str:
    """
    Format a Python value for Rego code generation.
    Must handle: None, bool, int, float, str, list, dict
    """
    if value is None:
        return "null"
    
    # ✅ CRITICAL: Convert Python booleans to lowercase Rego literals
    if isinstance(value, bool):
        return "true" if value else "false"  # True -> true, False -> false
    
    if isinstance(value, (int, float)):
        return str(value)
    
    if isinstance(value, str):
        # Escape quotes and wrap in quotes
        escaped = value.replace('"', '\\"')
        return f'"{escaped}"'
    
    if isinstance(value, list):
        items = [self._format_value(item) for item in value]
        return f"[{', '.join(items)}]"
    
    if isinstance(value, dict):
        pairs = [f'"{k}": {self._format_value(v)}' for k, v in value.items()]
        return f"{{{', '.join(pairs)}}}"
    
    # Fallback: convert to string (may need escaping)
    return str(value)
```

---

## Common Places Where Booleans Leak Into Rego

### 1. Provenance Block (Most Common)

**Location**: `_compile_rule()` method, provenance section

**Fields that might be booleans:**
- `weight` - often boolean (True/False)
- `enabled` - boolean flag
- `is_active` - boolean flag
- `has_conditions` - boolean flag

**Fix**: Wrap ALL provenance values in `_format_value()`

---

### 2. Condition Values

**Location**: `_compile_condition()` method

**Example:**
```python
# If condition value is boolean
if condition_type == "SIGNAL":
    signal_value = condition.get("value")  # Might be True/False
    # ✅ Should already be using _format_value, but verify:
    formatted_value = self._format_value(signal_value)
```

**Fix**: Ensure `_format_value()` is used for all condition values

---

### 3. Rule Metadata

**Location**: Rule header/metadata sections

**Example:**
```python
# Rule metadata
disabled = rule.get("disabled", False)  # ⚠️ Python boolean
enabled = rule.get("enabled", True)     # ⚠️ Python boolean

# ❌ WRONG:
rego_lines.append(f'    disabled := {disabled}')

# ✅ CORRECT:
rego_lines.append(f'    disabled := {self._format_value(disabled)}')
```

---

### 4. Emission Parameters

**Location**: `_compile_emission()` method

**Example:**
```python
# Emission params might contain booleans
params = emission.get("params", {})
for key, value in params.items():
    # ✅ Use _format_value for each param value
    formatted_val = self._format_value(value)
    rego_lines.append(f'        "{key}": {formatted_val},')
```

---

## Testing the Fix

### 1. Create Test Rule with Boolean Values

```python
test_rule = {
    "id": 1,
    "name": "test_rule",
    "priority": 100,
    "weight": False,  # ⚠️ Python boolean
    "enabled": True,  # ⚠️ Python boolean
    "conditions": [...],
    "emissions": [...]
}
```

### 2. Generate Rego and Check Output

```python
compiler = RegoCompiler()
rego_code = compiler.compile_snapshot_to_rego(snapshot_id=1, rules=[test_rule])

# Check that booleans are lowercase
assert '"weight": false' in rego_code  # ✅ lowercase
assert '"enabled": true' in rego_code   # ✅ lowercase
assert '"weight": False' not in rego_code  # ❌ no capitalized
```

### 3. Validate with OPA

```bash
# Save generated Rego
echo "$rego_code" > test_policy.rego

# Parse (should succeed)
opa parse test_policy.rego

# Build WASM (should succeed)
opa build -t wasm -e data.pkg.result -o bundle.tar.gz test_policy.rego
```

---

## Error Messages Reference

| Error Message | Cause | Fix |
|--------------|-------|-----|
| `var False is unsafe` | Python `False` written as `False` | Use `_format_value()` → `false` |
| `var True is unsafe` | Python `True` written as `True` | Use `_format_value()` → `true` |
| `var subtasks is unsafe` | Cascading from boolean error | Fix boolean formatting |
| `var mr is unsafe` | Cascading from boolean error | Fix boolean formatting |
| `var None is unsafe` | Python `None` written as `None` | Use `_format_value()` → `null` |

---

## Checklist for Backend Implementation

When updating `rego_compiler.py`, ensure:

- [ ] **All provenance values use `_format_value()`**
  - `rule_id`, `rule_name`, `rule_priority`
  - `weight` (especially - often boolean)
  - `matched_conditions`, `emissions_count`
  - Any other provenance fields

- [ ] **`_format_value()` correctly handles booleans**
  - `True` → `"true"`
  - `False` → `"false"`
  - `None` → `"null"`

- [ ] **All condition values use `_format_value()`**
  - Signal values
  - Tag values
  - Fact values
  - Semantic values

- [ ] **All emission parameters use `_format_value()`**
  - Parameter values (may be booleans, numbers, strings)

- [ ] **All rule metadata uses `_format_value()`**
  - `disabled`, `enabled`, `is_active` flags

- [ ] **Test with boolean values**
  - Create test rules with `weight: False`, `enabled: True`
  - Verify generated Rego has lowercase `false`/`true`
  - Verify OPA compilation succeeds

---

## Summary

**The Problem:**
- Python booleans (`True`, `False`) are written directly into Rego code
- OPA interprets capitalized `False` as an undefined variable
- This causes "var False is unsafe" errors and cascading failures

**The Solution:**
- **Always use `_format_value()`** when writing Python values to Rego code
- Ensure `_format_value()` converts `True` → `"true"`, `False` → `"false"`
- Apply this fix to **all** value insertions: provenance, conditions, emissions, metadata

**Critical Locations:**
1. ✅ Provenance block in `_compile_rule()` - **MOST IMPORTANT**
2. ✅ Condition values in `_compile_condition()`
3. ✅ Emission parameters in `_compile_emission()`
4. ✅ Rule metadata throughout

Following these guidelines will eliminate Rego safety violations and ensure successful WASM compilation.
