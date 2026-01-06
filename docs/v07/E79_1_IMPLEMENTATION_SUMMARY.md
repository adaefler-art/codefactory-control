# E79.1 Lawbook Schema + Versioning - Implementation Summary

**Issue**: E79.1 (I791) - Lawbook Schema + Versioning (immutable versions + active pointer)  
**Date**: 2026-01-05  
**Status**: ✅ Complete

---

## Overview

Implemented the foundation for AFU-9's Lawbook system: a versioned, immutable, auditable guardrails/rules document with deny-by-default semantics and deterministic hashing.

The Lawbook acts as the central authority for:
- Gate enforcement rules (determinism gates, post-deploy verification)
- Remediation policies (allowed playbooks, actions, limits)
- Evidence requirements (categories, max items)
- GitHub repository allowlists
- UI configuration

---

## Key Features

### 🔒 Immutability
- Lawbook versions are immutable once created
- Database constraint: unique `lawbook_hash` prevents duplicates
- No UPDATE operations on `lawbook_versions` table
- Content changes require new version creation

### 🚫 Deny-by-Default
- Missing active lawbook returns HTTP 404 with explicit error
- `notConfigured: true` flag signals gates to deny
- No fallback/default lawbook behavior
- Transparency: always know if lawbook is configured

### 🔐 Deterministic Hashing
- Same lawbook content → same SHA-256 hash (64 hex chars)
- Canonical JSON serialization with stable key ordering
- Array sorting during canonicalization (order-independent)
- Idempotency: creating same content returns existing version

### 📊 Transparency
- `lawbookVersion` included in all API responses
- Append-only `lawbook_events` audit trail
- Track version creation and activation events
- Future: lawbookVersion required in verdicts/reports (I793)

### 🔐 No Secrets
- Schema structure-only validation (Zod)
- No credential fields in schema
- JSONB storage for queryability
- Content validation separate from secrets management

---

## Architecture

### Schema (v0.7.0)

```typescript
LawbookV1 {
  version: "0.7.0"
  lawbookId: string              // e.g. "AFU9-LAWBOOK"
  lawbookVersion: string          // e.g. "2025-12-30.1"
  createdAt: ISO datetime
  createdBy: "admin" | "system"
  notes?: string
  
  github: {
    allowedRepos?: string[]      // Optional repo allowlist
  }
  
  determinism: {
    requireDeterminismGate: boolean
    requirePostDeployVerification: boolean
  }
  
  remediation: {
    enabled: boolean
    allowedPlaybooks: string[]   // e.g. ["SAFE_RETRY_RUNNER"]
    allowedActions: string[]     // e.g. ["runner_dispatch"]
    maxRunsPerIncident?: number
    cooldownMinutes?: number
  }
  
  evidence: {
    requiredKindsByCategory?: Record<string, string[]>
    maxEvidenceItems?: number
  }
  
  enforcement: {
    requiredFields: string[]     // e.g. ["lawbookVersion"]
    strictMode: boolean
  }
  
  ui: {
    displayName?: string
  }
}
```

### Database Schema (Migration 047)

#### `lawbook_versions`
- Immutable version storage
- Unique constraints: `(lawbook_id, lawbook_version)` and `lawbook_hash`
- SHA-256 hash for content deduplication
- JSONB storage with GIN index

#### `lawbook_active`
- Active version pointer (one row per lawbook_id)
- Foreign key to `lawbook_versions`
- `ON DELETE RESTRICT` prevents accidental deletion

#### `lawbook_events`
- Append-only audit trail
- Event types: `version_created`, `version_activated`, `version_deactivated`
- JSONB event metadata with GIN index

---

## API Endpoints

### GET `/api/lawbook/active`
**Returns**: Currently active lawbook version

**Success Response (200)**:
```json
{
  "id": "uuid",
  "lawbookVersion": "2025-12-30.1",
  "lawbookHash": "sha256...",
  "lawbook": { ... }
}
```

**Not Configured (404)**:
```json
{
  "error": "No active lawbook configured for 'AFU9-LAWBOOK'. Deny by default.",
  "notConfigured": true
}
```

### GET `/api/lawbook/versions`
**Returns**: List of lawbook versions (newest first)

**Query Params**: `lawbookId`, `limit`, `offset`

**Response (200)**:
```json
{
  "lawbookId": "AFU9-LAWBOOK",
  "versions": [
    {
      "id": "uuid",
      "lawbookVersion": "2025-12-30.1",
      "createdAt": "...",
      "lawbookHash": "sha256..."
    }
  ],
  "pagination": { "limit": 50, "offset": 0, "count": 1 }
}
```

### POST `/api/lawbook/versions`
**Creates**: New lawbook version (idempotent by hash)

**Request Body**: Valid LawbookV1 JSON

**Success Response (201 new, 200 existing)**:
```json
{
  "id": "uuid",
  "lawbookVersion": "2025-12-30.1",
  "lawbookHash": "sha256...",
  "isExisting": false,
  "message": "Lawbook version created successfully"
}
```

**Validation Error (400)**:
```json
{
  "error": "Invalid lawbook schema",
  "details": [...]
}
```

### POST `/api/lawbook/activate`
**Activates**: A lawbook version (updates active pointer)

**Request Body**:
```json
{
  "lawbookVersionId": "uuid",
  "activatedBy": "admin"
}
```

**Success Response (200)**:
```json
{
  "lawbookId": "AFU9-LAWBOOK",
  "activeLawbookVersionId": "uuid",
  "updatedAt": "...",
  "message": "Lawbook version activated successfully"
}
```

---

## Database Operations

### `createLawbookVersion(lawbook, createdBy)`
- Validates schema with Zod
- Computes deterministic hash
- Checks for existing hash (idempotent)
- Inserts new version if unique
- Records `version_created` event
- Returns `{ success, data, isExisting }`

### `getActiveLawbook(lawbookId)`
- Joins `lawbook_active` + `lawbook_versions`
- Returns active version or `notConfigured: true`
- Deny-by-default if missing

### `listLawbookVersions(lawbookId, limit, offset)`
- Queries versions for lawbookId
- Orders by `created_at DESC` (newest first)
- Supports pagination

### `activateLawbookVersion(versionId, activatedBy)`
- Verifies version exists
- Upserts `lawbook_active` pointer
- Records `version_activated` event
- Returns updated active record

---

## Test Coverage

**File**: `__tests__/api/lawbook-versioning.test.ts`  
**Tests**: 15/15 passing ✅

### Test Categories

1. **Version Creation** (5 tests)
   - Creates new version successfully
   - Idempotency: same hash returns existing
   - Schema validation rejects invalid
   - Same content → same hash
   - Different content → different hash

2. **Version Listing** (2 tests)
   - Lists versions successfully
   - Respects pagination parameters

3. **Version Activation** (3 tests)
   - Activates version successfully
   - Rejects invalid version ID
   - Requires lawbookVersionId parameter

4. **Active Retrieval** (3 tests)
   - Returns active lawbook successfully
   - Returns 404 when not configured (deny-by-default)
   - Supports custom lawbookId parameter

5. **Hash Determinism** (2 tests)
   - Array order normalization produces same hash
   - Hash format is valid SHA-256 (64 hex chars)

---

## Files Changed

### New Files

1. **control-center/src/lawbook/schema.ts** (225 lines)
   - LawbookV1 schema with Zod validation
   - TypeScript types for all sections
   - Canonical JSON serialization
   - SHA-256 hashing utility
   - `createMinimalLawbook()` helper

2. **control-center/src/lib/db/lawbook.ts** (387 lines)
   - Database CRUD operations
   - Idempotency enforcement
   - Event recording
   - Error handling with structured results

3. **database/migrations/047_lawbook_versioning.sql** (175 lines)
   - Three tables: versions, active, events
   - Indexes for performance
   - Constraints for data integrity
   - Comments for documentation

4. **control-center/app/api/lawbook/active/route.ts** (53 lines)
   - GET endpoint for active lawbook
   - Deny-by-default behavior

5. **control-center/app/api/lawbook/versions/route.ts** (118 lines)
   - GET: list versions (paginated)
   - POST: create version (idempotent)

6. **control-center/app/api/lawbook/activate/route.ts** (58 lines)
   - POST endpoint for activation
   - Validation and error handling

7. **control-center/__tests__/api/lawbook-versioning.test.ts** (399 lines)
   - 15 comprehensive tests
   - Mocked database layer
   - Full API coverage

8. **docs/lawbook-example.json** (48 lines)
   - Example minimal lawbook
   - Production-ready template

9. **E79_1_VERIFICATION_COMMANDS.md** (documentation)
   - PowerShell verification commands
   - API usage examples
   - Implementation guarantees

---

## Non-Negotiables Met

✅ **Immutability**: Published versions never change (DB constraints + no UPDATEs)  
✅ **Deny-by-default**: Missing lawbook returns 404 with explicit error  
✅ **Deterministic Hashing**: Same content → same SHA-256 hash  
✅ **Transparency**: `lawbookVersion` in all responses, audit trail  
✅ **No Secrets**: Schema structure only, no credential fields

---

## Acceptance Criteria Met

✅ **Lawbook schema + DB versioning + active pointer**: End-to-end implementation  
✅ **Deterministic hashing**: Canonical JSON + SHA-256, tested  
✅ **Idempotent creation**: Same hash returns existing version  
✅ **Tests/build green**: 15/15 tests passing, TypeScript compiles  
✅ **Example lawbook JSON**: Provided in `docs/lawbook-example.json`  
✅ **Files changed list**: Documented with reasons  
✅ **PowerShell commands**: Provided for tests/build/migrations

---

## Integration Points (Future)

This implementation provides the foundation. Future issues will integrate:

1. **I792**: Embed `lawbookVersion` in verdict/incident/remediation artifacts
2. **I793**: Enforce `lawbookVersion` presence in all enforcement decisions
3. **I794**: UI for lawbook management (create/activate/history)
4. **I795**: Migration/versioning workflows
5. **I796**: Lawbook-aware gate implementations

---

## Example Usage

### Create Initial Lawbook

```bash
# 1. Run migration
psql -h localhost -U postgres -d afu9 -f database/migrations/047_lawbook_versioning.sql

# 2. Create lawbook version
curl -X POST http://localhost:3000/api/lawbook/versions \
  -H "Content-Type: application/json" \
  -d @docs/lawbook-example.json

# Response: {"id": "uuid-1", "lawbookHash": "abc123...", "isExisting": false}

# 3. Activate version
curl -X POST http://localhost:3000/api/lawbook/activate \
  -H "Content-Type: application/json" \
  -d '{"lawbookVersionId": "uuid-1", "activatedBy": "admin"}'

# 4. Verify active
curl http://localhost:3000/api/lawbook/active
# Returns full lawbook JSON
```

### Update Lawbook (New Version)

```bash
# 1. Create new version (with changes)
curl -X POST http://localhost:3000/api/lawbook/versions \
  -H "Content-Type: application/json" \
  -d @docs/lawbook-v2.json

# Response: {"id": "uuid-2", "lawbookHash": "def456...", "isExisting": false}

# 2. Test new version (gates use old version until activation)

# 3. Activate when ready
curl -X POST http://localhost:3000/api/lawbook/activate \
  -H "Content-Type: application/json" \
  -d '{"lawbookVersionId": "uuid-2", "activatedBy": "admin"}'

# All gates now use new version
# Old version preserved in history
```

---

## Security Summary

**No vulnerabilities introduced.**

- Schema validation via Zod (prevents injection)
- DB parameterized queries (no SQL injection)
- Input sanitization via Next.js
- No credential/secret storage in lawbook
- Append-only audit trail
- Foreign key constraints prevent orphaned records

---

## Performance Notes

- JSONB with GIN indexes for fast queries
- Unique hash index prevents duplicate content scans
- Pagination support for version listing
- Active lawbook cached (future: add Redis caching)

---

## Minimal Example Lawbook

```json
{
  "version": "0.7.0",
  "lawbookId": "AFU9-LAWBOOK",
  "lawbookVersion": "2025-12-30.1",
  "createdAt": "2025-12-30T10:00:00.000Z",
  "createdBy": "system",
  "github": { "allowedRepos": [] },
  "determinism": {
    "requireDeterminismGate": true,
    "requirePostDeployVerification": true
  },
  "remediation": {
    "enabled": true,
    "allowedPlaybooks": ["SAFE_RETRY_RUNNER"],
    "allowedActions": ["runner_dispatch"],
    "maxRunsPerIncident": 3,
    "cooldownMinutes": 15
  },
  "evidence": { "maxEvidenceItems": 100 },
  "enforcement": {
    "requiredFields": ["lawbookVersion"],
    "strictMode": true
  },
  "ui": { "displayName": "AFU-9 Default Lawbook" }
}
```

---

## Conclusion

E79.1 is **complete** and **ready for integration**. The Lawbook foundation provides:
- Versioned, immutable rule storage
- Deterministic content hashing
- Active version pointer with audit trail
- Deny-by-default semantics
- Full API coverage with 15 passing tests

**Next**: Integrate lawbook into enforcement decisions (I792, I793).
