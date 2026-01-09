# INTENT Issue Authoring Smoke Test

**Issue**: E81.5 - Evidence Pack for Issue Authoring  
**Epic**: E81 (INTENT MVP - Issue Authoring UI)  
**Layer**: A (Application)

## Purpose

Verify that INTENT issue authoring operations generate proper evidence records with:
- Deterministic hashes
- Secret redaction
- lawbookVersion tracking
- Bounded payloads

## Prerequisites

- Control Center running locally or in staging
- Valid JWT token with INTENT access
- Active lawbook configured (optional - tests both scenarios)

## Test Scenarios

### 1. Draft Save Evidence

**Action**: Save issue draft

```bash
# Create or update draft
curl -X POST "http://localhost:3000/api/intent/sessions/{sessionId}/issue-draft" \
  -H "AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "issue_json": {
      "title": "Test Issue",
      "description": "Test description",
      "labels": ["bug"]
    }
  }'
```

**Expected Evidence**:
- `action`: `draft_save`
- `params_hash`: Computed from redacted params
- `result_hash`: Computed from redacted result
- `lawbook_version`: Active version or null
- `params_json`: No secrets (e.g., tokens, passwords)
- `result_json`: No secrets

**Verification**:
```sql
SELECT 
  request_id,
  session_id,
  action,
  params_hash,
  result_hash,
  lawbook_version,
  created_at
FROM intent_issue_authoring_events
WHERE session_id = 'YOUR_SESSION_ID'
  AND action = 'draft_save'
ORDER BY created_at DESC
LIMIT 1;
```

### 2. Draft Validate Evidence

**Action**: Validate issue draft

```bash
curl -X POST "http://localhost:3000/api/intent/sessions/{sessionId}/issue-draft/validate" \
  -H "AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "issue_json": {
      "title": "Test Issue",
      "description": "Test description"
    }
  }'
```

**Expected Evidence**:
- `action`: `draft_validate`
- Validation result in `result_json` (errors redacted if they contain secrets)
- Deterministic hash (same input → same hash)

### 3. Draft Commit Evidence

**Action**: Commit issue draft

```bash
curl -X POST "http://localhost:3000/api/intent/sessions/{sessionId}/issue-draft/commit" \
  -H "AUTH_HEADER"
```

**Expected Evidence**:
- `action`: `draft_commit`
- Committed draft version in result
- lawbookVersion tracked

### 4. Issue Set Generate Evidence (if implemented)

**Action**: Generate issue set from briefing

```bash
curl -X POST "http://localhost:3000/api/intent/sessions/{sessionId}/issue-set/generate" \
  -H "AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "briefing": "Create issues for...",
    "constraints": {}
  }'
```

**Expected Evidence**:
- `action`: `issue_set_generate`
- Briefing text in params (sanitized)
- Generated issues in result

### 5. Deterministic Hash Verification

**Test**: Same input produces same hash

```bash
# Save draft twice with same content
curl -X POST ".../issue-draft" -d '{"issue_json": {...}}'
# Wait 1 second
curl -X POST ".../issue-draft" -d '{"issue_json": {...}}'
```

**Verification**:
```sql
-- Should have different request_ids but same params_hash
SELECT 
  request_id,
  params_hash,
  created_at
FROM intent_issue_authoring_events
WHERE session_id = 'YOUR_SESSION_ID'
  AND action = 'draft_save'
ORDER BY created_at DESC
LIMIT 2;
```

Expected: `params_hash` should be identical for both records.

### 6. Secret Redaction Verification

**Test**: Secrets are not stored in evidence

```bash
# Attempt to save draft with secret-like fields (this should fail validation, but evidence should still be created)
curl -X POST ".../issue-draft" -d '{
  "issue_json": {
    "title": "Test",
    "metadata": {
      "github_token": "ghp_fake_token_12345",
      "api_key": "sk-fake-key"
    }
  }
}'
```

**Verification**:
```sql
SELECT 
  params_json,
  result_json
FROM intent_issue_authoring_events
WHERE session_id = 'YOUR_SESSION_ID'
ORDER BY created_at DESC
LIMIT 1;
```

Expected: `params_json` should show `"github_token": "[REDACTED]"` and `"api_key": "[REDACTED]"`.

### 7. Append-Only Policy Verification

**Test**: Cannot update or delete evidence records

```sql
-- Try to update (should fail)
UPDATE intent_issue_authoring_events 
SET action = 'modified' 
WHERE id = 'SOME_ID';

-- Try to delete (should fail)
DELETE FROM intent_issue_authoring_events 
WHERE id = 'SOME_ID';
```

Expected: Both should fail with error: "intent_issue_authoring_events is append-only: UPDATE and DELETE are not allowed"

### 8. Bounded Payload Verification

**Test**: Large payloads are rejected

```bash
# Create a very large draft (> 100KB)
LARGE_TEXT=$(python3 -c "print('x' * 110000)")
curl -X POST ".../issue-draft" -d "{
  \"issue_json\": {
    \"title\": \"Test\",
    \"description\": \"$LARGE_TEXT\"
  }
}"
```

Expected: Should fail with error about payload size limit.

### 9. lawbookVersion Tracking

**Test**: Evidence includes active lawbook version

**Scenario A**: With active lawbook
```sql
-- First, ensure lawbook is active
SELECT lawbook_version, is_active 
FROM lawbook_versions 
WHERE is_active = true;

-- Then check evidence
SELECT lawbook_version
FROM intent_issue_authoring_events
WHERE session_id = 'YOUR_SESSION_ID'
ORDER BY created_at DESC
LIMIT 1;
```

Expected: `lawbook_version` should match active version.

**Scenario B**: Without active lawbook
```sql
-- Deactivate lawbook temporarily
UPDATE lawbook_versions SET is_active = false;

-- Perform action, then check evidence
SELECT lawbook_version
FROM intent_issue_authoring_events
WHERE session_id = 'YOUR_SESSION_ID'
ORDER BY created_at DESC
LIMIT 1;
```

Expected: `lawbook_version` should be `null`.

## Acceptance Criteria

- ✅ All evidence records have deterministic hashes
- ✅ No secrets in `params_json` or `result_json`
- ✅ Append-only policy enforced (UPDATE/DELETE blocked)
- ✅ Payloads bounded to 100KB
- ✅ lawbookVersion tracked (null if not configured)
- ✅ All INTENT authoring actions create evidence

## Rollback

If evidence generation causes issues:

1. **Disable evidence recording** (if feature flag exists)
2. **Revert migration** (requires database rollback - NOT recommended in production)

## Notes

- Evidence records are fail-safe: if evidence insertion fails, the main operation still succeeds (with warning)
- Evidence table is append-only by design - no cleanup needed for normal operations
- For audit queries, use indexes on `session_id`, `request_id`, or `sub` for performance
