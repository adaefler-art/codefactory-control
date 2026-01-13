# E86.5 - Staging DB Repair Mechanism - Security Summary

## Overview

This document describes the security properties and threat mitigations for the staging DB repair mechanism implemented in issue E86.5.

## Security Architecture

### 1. Multi-Layer Defense (Fail-Closed)

All API endpoints enforce strict guard ordering:

```
1. AUTH CHECK (401-first)    → Verify x-afu9-sub header
2. ENV GATING (409)           → Block prod/unknown environments  
3. ADMIN CHECK (403)          → Verify admin allowlist
4. DB OPERATIONS              → Execute only if all gates pass
```

**Key Principle**: Each layer fails closed. If ANY check fails, the request is rejected immediately without proceeding to subsequent layers.

### 2. Authentication & Authorization

#### Authentication (401-first)

- **Mechanism**: x-afu9-sub header set by proxy.ts after server-side JWT verification
- **Client Protection**: Middleware strips client-provided x-afu9-* headers to prevent spoofing
- **Failure Mode**: Missing or empty x-afu9-sub → 401 UNAUTHORIZED (immediate rejection)

#### Authorization - Admin-Only (403)

- **Mechanism**: AFU9_ADMIN_SUBS environment variable (comma-separated list)
- **Allowlist Check**: User sub must be in allowlist
- **Failure Modes**:
  - User not in allowlist → 403 FORBIDDEN
  - Empty/missing AFU9_ADMIN_SUBS → Deny all (fail-closed)

### 3. Environment Gating (Stage-Only)

- **Mechanism**: `getDeploymentEnv()` + `checkProdWriteGuard()`
- **Production Block**: Production environment → 409 ENV_DISABLED (immediate rejection)
- **Unknown Environments**: Unknown env → 409 ENV_DISABLED (fail-closed)
- **Rationale**: Repair operations are staging-only by design (no prod writes)

### 4. Hash Verification (Fail-Closed)

- **Mechanism**: Execute endpoint requires expectedHash parameter
- **Validation**: `validateRepairHash(repairId, expectedHash)`
- **Failure Mode**: Hash mismatch → 409 HASH_MISMATCH (reject execution)
- **Protection**: Prevents execution if playbook SQL has changed since preview

Example:
```typescript
if (!validateRepairHash(repairId, expectedHash)) {
  return errorResponse('HASH_MISMATCH', ...);
}
```

### 5. Append-Only Audit Trail

#### db_repair_runs Table

- **Schema**: Includes all execution metadata (repair_id, hash, executed_by, status, etc.)
- **Triggers**: Prevent UPDATE and DELETE operations
- **Enforcement**: Database-level (not just application-level)

```sql
CREATE TRIGGER prevent_update_db_repair_runs
  BEFORE UPDATE ON db_repair_runs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_db_repair_runs_modification();
```

#### Audit Fields

- `repair_id`: Which repair was executed
- `expected_hash`: Hash provided by caller
- `actual_hash`: Hash from registry (for verification)
- `executed_by`: User sub from x-afu9-sub
- `executed_at`: Timestamp
- `deployment_env`: Environment where executed
- `lawbook_hash`: Lawbook version at execution time
- `request_id`: Correlation ID
- `status`: SUCCESS | FAILED
- `error_code`, `error_message`: Bounded error details
- `pre_missing_tables`: Tables missing before repair (JSON)
- `post_missing_tables`: Tables missing after repair (JSON)

### 6. SQL Idempotency & Safety

#### Idempotent Patterns

All repair SQL uses safe, idempotent patterns:

✅ `CREATE TABLE IF NOT EXISTS`
✅ `CREATE INDEX IF NOT EXISTS`
✅ `CREATE OR REPLACE FUNCTION`
✅ `DO $$ ... IF NOT EXISTS ... END $$` for triggers

#### Prohibited Operations

Repair SQL explicitly avoids destructive operations:

❌ No `DROP TABLE`
❌ No `DROP INDEX`
❌ No `TRUNCATE`
❌ No `DELETE FROM`
❌ No `UPDATE` (except via idempotent functions)

#### Verification

Test coverage includes:
```typescript
repair?.sql.forEach((stmt) => {
  const normalized = stmt.toLowerCase();
  expect(normalized).not.toContain('drop table');
  expect(normalized).not.toContain('truncate');
  expect(normalized).not.toContain('delete from');
});
```

### 7. Input Validation & Sanitization

#### Request Validation

- **repairId**: Must be string, must exist in registry
- **expectedHash**: Must be string, must match registry hash
- **JSON Parsing**: Try-catch with error handling

```typescript
let body: any;
try {
  body = await request.json();
} catch (error) {
  return errorResponse('INVALID_JSON', ...);
}
```

#### Output Sanitization

- **Plan Truncation**: SQL statements truncated to 500 chars for preview
- **Error Message Bounding**: Error messages are bounded (not user-controlled)
- **Deterministic Output**: All arrays stable-sorted for consistent output

### 8. Minimal Privilege Principle

#### Database Permissions

Repair operations require:
- `CREATE TABLE` (for missing tables)
- `CREATE INDEX` (for missing indexes)
- `CREATE FUNCTION` (for trigger functions)
- `CREATE TRIGGER` (for append-only triggers)

Does NOT require:
- `DROP` privileges
- `TRUNCATE` privileges
- `DELETE` privileges on application tables

#### API Access

- **Authentication**: Required (401 if missing)
- **Admin Privileges**: Required (403 if not admin)
- **Stage Environment**: Required (409 if prod)

### 9. Defense Against Common Attacks

#### SQL Injection

- **Protection**: No user input in SQL queries
- **Mechanism**: All SQL is pre-defined in registry (not constructed from user input)
- **Parameters**: repairId used only for registry lookup, not in SQL

#### Privilege Escalation

- **Protection**: Multi-layer guard ordering (401 → 409 → 403)
- **Admin Check**: Fail-closed if AFU9_ADMIN_SUBS missing/empty
- **Bypass Prevention**: Guards checked before ANY DB operations

#### Replay Attacks

- **Protection**: Hash verification ensures SQL hasn't changed
- **Audit Trail**: Every execution logged with unique ID
- **Idempotency**: Safe to replay (CREATE IF NOT EXISTS)

#### Header Spoofing

- **Protection**: Middleware strips client-provided x-afu9-* headers
- **Verification**: Only proxy.ts can set x-afu9-sub after JWT verification
- **Failure Mode**: Missing header → 401 (immediate rejection)

#### Production Writes

- **Protection**: Environment gating (409 for prod)
- **Enforcement**: Guard check BEFORE any DB connection
- **Failure Mode**: Prod environment → 409 ENV_DISABLED (no DB access)

## Threat Model

### Threat: Unauthorized User Executes Repair

**Mitigation**:
1. AUTH CHECK (401): No x-afu9-sub header → immediate rejection
2. ADMIN CHECK (403): User not in allowlist → immediate rejection

### Threat: Non-Admin User Executes Repair

**Mitigation**:
- ADMIN CHECK (403): Verifies user sub in AFU9_ADMIN_SUBS
- Fail-closed: Empty/missing allowlist → deny all

### Threat: Production Database Modified

**Mitigation**:
- ENV GATING (409): Production environment blocked
- Check occurs BEFORE any DB connection
- Unknown environments also blocked (fail-closed)

### Threat: Malicious SQL Injected

**Mitigation**:
- No user input in SQL queries
- All SQL pre-defined in registry
- repairId used only for registry lookup
- No dynamic SQL construction

### Threat: Replay Attack with Stale Repair

**Mitigation**:
- Hash verification: expectedHash must match current registry hash
- If playbook SQL changes, hash changes → execution rejected
- Audit trail logs expected vs actual hash

### Threat: Audit Trail Tampering

**Mitigation**:
- Append-only table with triggers
- Database-level enforcement (not just app-level)
- Triggers prevent UPDATE and DELETE
- Attempt to modify → PostgreSQL exception

### Threat: Destructive Operations

**Mitigation**:
- Repair SQL explicitly avoids DROP, TRUNCATE, DELETE
- Idempotent patterns (CREATE IF NOT EXISTS)
- Test coverage verifies no destructive ops
- Code review required for new repairs

### Threat: Header Spoofing

**Mitigation**:
- Middleware strips client-provided x-afu9-* headers
- Only proxy.ts can set x-afu9-sub after JWT verification
- Missing header → 401 (immediate rejection)

## Security Best Practices Followed

✅ **Fail-Closed**: All guards fail closed (deny by default)
✅ **Defense in Depth**: Multiple security layers (auth, env, admin, hash)
✅ **Least Privilege**: Admin-only, stage-only, minimal DB permissions
✅ **Audit Trail**: Append-only logging of all executions
✅ **Input Validation**: All inputs validated before use
✅ **Output Sanitization**: SQL truncated, errors bounded
✅ **Idempotency**: Safe to replay (CREATE IF NOT EXISTS)
✅ **No User SQL**: All SQL pre-defined (no injection risk)
✅ **Hash Verification**: Ensures SQL integrity
✅ **Environment Isolation**: Production writes blocked

## Compliance & Governance

### Audit Requirements

All executions logged with:
- Who executed (executed_by)
- What was executed (repair_id, actual_hash)
- When executed (executed_at)
- Where executed (deployment_env)
- Why executed (request_id for correlation)
- What changed (pre/post missing tables)
- Outcome (status, error_code, error_message)

### Approval Workflow

1. **Playbook Registration**: New repairs must be added to registry (code review required)
2. **Preview**: Admins preview repair before execution (no DB writes)
3. **Hash Verification**: Execution requires hash from preview (prevents stale repairs)
4. **Audit Trail**: All executions logged (append-only, no deletion)

### Evidence Collection

For each execution:
- `pre_missing_tables`: Evidence of problem before repair
- `post_missing_tables`: Evidence of fix after repair
- `lawbook_hash`: Lawbook version at execution time
- `request_id`: Correlation ID for tracing

## Security Testing

### Test Coverage

✅ Registry tests verify idempotent SQL
✅ Registry tests verify no destructive ops
✅ Registry tests verify hash validation
✅ Guard ordering tests (implicit in guard implementation)
✅ Append-only triggers tested in migration

### Manual Verification

PowerShell verification guide includes:
- Authentication tests (401 for missing auth)
- Environment tests (409 for prod)
- Admin tests (403 for non-admin)
- Hash tests (409 for hash mismatch)

## Conclusion

The DB repair mechanism implements defense-in-depth security with:
- Multi-layer guards (401 → 409 → 403)
- Fail-closed design (deny by default)
- Append-only audit trail (tamper-proof)
- Hash verification (integrity check)
- Idempotent SQL (safe to replay)
- No user input in SQL (injection-proof)
- Environment isolation (stage-only)

All security properties are enforced at multiple layers (application + database) and fail closed by default.
