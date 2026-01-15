# E89.5 Implementation Verification Guide

## Overview
This document provides verification steps for E89.5: INTENT "Sources" Integration.

## Automated Verification

### 1. Build Control Center
```bash
npm --prefix control-center run build
```
Expected: Build succeeds without errors.

### 2. Run Unit Tests
```bash
npm --prefix control-center test -- tool-sources-tracker
npm --prefix control-center test -- intent-sources
```
Expected: All tests pass.

### 3. Run Repository Verification
```bash
npm run repo:verify
```
Expected: All checks pass.

## Manual Verification

### Prerequisites
- Control Center running locally or in development environment
- INTENT enabled (AFU9_INTENT_ENABLED=true)
- Valid GitHub token for evidence tools

### Test Scenario 1: readFile Tool Creates Sources

1. Open INTENT Console at http://localhost:3000/intent
2. Create a new session
3. Send message: "Lies die Datei control-center/src/lib/db/intentSessions.ts, Zeilen 1-50"
4. Wait for INTENT agent response
5. **Verify**: Sources Panel appears on right side
6. **Verify**: Panel shows 1 source of type "File Snippet"
7. **Verify**: Source shows correct repo/path/lines
8. **Verify**: Source has a snippetHash value

### Test Scenario 2: Multiple Tool Calls Aggregate Sources

1. In same session, send: "Suche nach 'IntentSession' im Repository adaefler-art/codefactory-control"
2. Wait for response
3. **Verify**: Sources Panel updates with new sources
4. **Verify**: Both readFile and searchCode sources are shown
5. **Verify**: Sources are deduplicated (no exact duplicates)

### Test Scenario 3: Sources API Endpoint

1. Get session ID from browser URL or network tab
2. Call API endpoint:
   ```bash
   curl -H "Cookie: auth-token=YOUR_TOKEN" \
     http://localhost:3000/api/intent/sessions/SESSION_ID/sources
   ```
3. **Verify**: Returns JSON with sources array
4. **Verify**: count field matches number of unique sources
5. **Verify**: Sources match what's shown in UI

### Test Scenario 4: Type Filtering

1. Call API with type filter:
   ```bash
   curl -H "Cookie: auth-token=YOUR_TOKEN" \
     "http://localhost:3000/api/intent/sessions/SESSION_ID/sources?type=file_snippet"
   ```
2. **Verify**: Only file_snippet sources returned
3. **Verify**: typeFilter field in response is "file_snippet"

### Test Scenario 5: Auth Guards

1. Try accessing sources endpoint without auth:
   ```bash
   curl http://localhost:3000/api/intent/sessions/SESSION_ID/sources
   ```
2. **Verify**: Returns 401 Unauthorized

3. Try accessing another user's session sources:
   - Create session with User A
   - Try to access with User B's token
4. **Verify**: Returns 403 Forbidden

## Database Verification

### Check Sources in Database

```sql
-- View all sources for a session
SELECT 
  id,
  role,
  used_sources_json,
  used_sources_hash,
  created_at
FROM intent_messages
WHERE session_id = 'SESSION_ID'
  AND role = 'assistant'
  AND used_sources_json IS NOT NULL
ORDER BY created_at ASC;
```

Expected:
- Assistant messages with tool calls have used_sources_json populated
- used_sources_hash is non-null and matches SHA-256 of canonical JSON
- Sources are stored in canonical form (sorted, deduplicated)

### Verify Append-Only

```sql
-- Try to update sources (should fail)
UPDATE intent_messages 
SET used_sources_json = '[]'::jsonb 
WHERE id = 'MESSAGE_ID';
```

Expected: Success (PostgreSQL doesn't enforce append-only at DB level, but application layer should prevent this)

## Acceptance Criteria Checklist

- [ ] Every readFile tool invocation creates used_sources entry
- [ ] Every searchCode tool invocation creates used_sources entries (one per result)
- [ ] UI Sources Panel shows sources live/refresh
- [ ] Sources Panel displays file refs with path, lines, hash
- [ ] Hashes match with tool responses (snippetHash from readFile.meta)
- [ ] Sources API endpoint works (GET /api/intent/sessions/:id/sources)
- [ ] API returns sources with deterministic ordering (created_at ASC)
- [ ] API supports type filtering (?type=file_snippet)
- [ ] Auth guards work: 401 → 403 session ownership
- [ ] No production block needed (read-only endpoint)

## Known Limitations

1. **Other Evidence Tools**: Only readFile and searchCode implemented. listTree would need similar integration.
2. **UI Refresh**: Sources Panel shows sources from latest assistant message, not real-time during generation
3. **Source Navigation**: Clicking sources doesn't navigate to GitHub (future enhancement)
4. **Export**: No CSV/JSON export of sources (future enhancement)

## Rollback Plan

If issues are found:

1. Revert changes to `intent-agent.ts` (remove tracker integration)
2. Revert changes to messages route (pass null for sources)
3. Sources API endpoint can be left in place (harmless if not called)
4. Tool sources tracker module can remain (unused)

Database schema and UI components from E73.2 remain unchanged.
