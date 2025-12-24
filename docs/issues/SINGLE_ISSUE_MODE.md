# AFU9 Single-Issue Mode

## Overview

AFU9 enforces a **Single-Issue Mode** constraint: only **ONE** issue can have `status = ACTIVE` at any given time. This is a fundamental design principle of the AFU9 autonomous code fabrication system.

## Why Single-Issue Mode?

Single-Issue Mode ensures AFU9 operates deterministically and efficiently:

1. **Focus Resources** - All compute and LLM resources concentrate on one task
2. **Prevent Conflicts** - Avoid merge conflicts from parallel work
3. **Clear State** - Always know what AFU9 is working on
4. **Simpler Debugging** - Easier to trace what went wrong
5. **Quality over Quantity** - Deep focus produces better results
6. **Deterministic Behavior** - Predictable system state at all times

## Enforcement Layers

The Single-Issue Mode constraint is enforced at multiple layers for maximum reliability:

### 1. Database Layer (Strongest)

A PostgreSQL trigger (`trg_enforce_single_active_issue`) prevents any INSERT or UPDATE that would create a second ACTIVE issue:

```sql
-- Automatically enforced by trigger
INSERT INTO afu9_issues (title, status) VALUES ('Issue 1', 'ACTIVE'); -- OK
INSERT INTO afu9_issues (title, status) VALUES ('Issue 2', 'ACTIVE'); -- ERROR!
```

**Error message example:**
```
Single-Active constraint violation: Only one issue can have status=ACTIVE. 
Found 1 other active issue(s). Current active issues: 
[abc-123:"Fix authentication bug"]
```

The trigger is defined in `database/migrations/014_afu9_issues.sql`.

### 2. Service Layer

The database helper functions in `control-center/src/lib/db/afu9Issues.ts` check the constraint before creating or updating:

```typescript
// Before creating with ACTIVE status
const canSetActive = await canSetIssueActive(pool, null);
if (!canSetActive.success) {
  return { success: false, error: canSetActive.error };
}

// Before updating to ACTIVE status
const canSetActive = await canSetIssueActive(pool, issueId);
if (!canSetActive.success) {
  return { success: false, error: canSetActive.error };
}
```

This provides early feedback to prevent constraint violations.

### 3. API Layer

The API endpoints handle constraint violations gracefully:

- **POST /api/issues** - Returns HTTP 409 (Conflict) if creating with ACTIVE status when another is active
- **PATCH /api/issues/[id]** - Returns HTTP 409 (Conflict) if updating to ACTIVE when another is active
- **POST /api/issues/[id]/activate** - Automatically deactivates other ACTIVE issues before activating the target

The `/activate` endpoint implements an atomic "swap" operation:
1. Deactivates the current ACTIVE issue (sets to CREATED)
2. Activates the target issue

### 4. UI Layer

The UI prevents accidental violations and provides clear feedback:

- **Activation Warning Dialog** - Shows when another issue is ACTIVE before proceeding
- **Confirmation Required** - User must confirm they want to deactivate the other issue
- **Clear Messaging** - Displays which issue will be deactivated

## Status Transitions

Valid status transitions:

```
CREATED → ACTIVE → DONE
    ↓       ↓
  BLOCKED → BLOCKED
    ↓       ↓
  ACTIVE  CREATED
```

- `CREATED` → `ACTIVE`, `BLOCKED`, `DONE`
- `ACTIVE` → `BLOCKED`, `DONE`, `CREATED` (via deactivation)
- `BLOCKED` → `CREATED`, `ACTIVE`, `DONE`
- `DONE` (terminal, no further transitions)

## Workflows

### Safely Activating an Issue

**Option 1: Use the Activate Endpoint (Recommended)**

```bash
POST /api/issues/{id}/activate
```

This endpoint automatically:
1. Checks if another issue is ACTIVE
2. Sets that issue to CREATED
3. Sets the target issue to ACTIVE
4. Returns details about what was deactivated

**Option 2: Manual Workflow**

```typescript
// 1. Get current active issue
const activeResult = await getActiveIssue(pool);

// 2. If active issue exists, deactivate it
if (activeResult.data) {
  await updateAfu9Issue(pool, activeResult.data.id, {
    status: Afu9IssueStatus.CREATED // or BLOCKED
  });
}

// 3. Activate new issue
await updateAfu9Issue(pool, newIssueId, {
  status: Afu9IssueStatus.ACTIVE
});
```

### Blocking the Active Issue

When AFU9 encounters a blocker, set the ACTIVE issue to BLOCKED:

```bash
PATCH /api/issues/{id}
{
  "status": "BLOCKED"
}
```

This frees up the ACTIVE slot without completing the issue.

### Completing the Active Issue

When AFU9 completes work, set the ACTIVE issue to DONE:

```bash
PATCH /api/issues/{id}
{
  "status": "DONE"
}
```

This permanently marks the issue as complete.

## UI Behavior

### Issue List View (`/issues`)

- ACTIVE issues are highlighted with green badges
- Only one issue should show ACTIVE status at a time
- Filter by status to see all ACTIVE issues (should return max 1)

### Issue Detail View (`/issues/[id]`)

**Activate Button:**
- Disabled if issue is already ACTIVE
- Shows "Already Active" text when disabled
- When clicked and another issue is ACTIVE:
  1. Shows warning dialog
  2. Displays the current ACTIVE issue details
  3. Requires user confirmation
  4. On confirm: deactivates other issue and activates this one

**Activity Log:**
- Shows all status changes including activations/deactivations
- Tracks when issues were set to ACTIVE
- Records which user/agent made the change

## Activity Log Integration

Every status change is logged to `afu9_issue_events` table:

- `event_type: STATUS_CHANGED`
- `old_status` and `new_status` fields
- Timestamp of change
- Who/what made the change (if available)

This provides a complete audit trail of Single-Issue Mode enforcement.

## API Examples

### Check Current Active Issue

```bash
GET /api/issues?status=ACTIVE&limit=1
```

Response:
```json
{
  "issues": [
    {
      "id": "abc-123",
      "title": "Fix authentication bug",
      "status": "ACTIVE",
      ...
    }
  ],
  "total": 1
}
```

### Activate an Issue

```bash
POST /api/issues/abc-123/activate
```

Success response:
```json
{
  "message": "Issue activated successfully",
  "issue": { "id": "abc-123", "status": "ACTIVE", ... },
  "deactivated": {
    "id": "def-456",
    "title": "Previous active issue"
  }
}
```

### Handle Constraint Violation

```bash
PATCH /api/issues/abc-123
{
  "status": "ACTIVE"
}
```

Error response (HTTP 409):
```json
{
  "error": "Single-Active constraint: Issue def-456 (\"Previous issue\") is already ACTIVE. Only one issue can have status=ACTIVE at a time."
}
```

## Database Schema

The constraint is enforced by this trigger function:

```sql
CREATE OR REPLACE FUNCTION enforce_single_active_issue()
RETURNS TRIGGER AS $$
DECLARE
  active_count INTEGER;
BEGIN
  IF NEW.status = 'ACTIVE' THEN
    SELECT COUNT(*) INTO active_count
    FROM afu9_issues
    WHERE status = 'ACTIVE' 
      AND id != NEW.id;
    
    IF active_count > 0 THEN
      RAISE EXCEPTION 'Single-Active constraint violation: ...';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Applied to both INSERT and UPDATE operations:

```sql
CREATE TRIGGER trg_enforce_single_active_issue
  BEFORE INSERT OR UPDATE OF status ON afu9_issues
  FOR EACH ROW
  EXECUTE FUNCTION enforce_single_active_issue();
```

## Best Practices

1. **Always use the `/activate` endpoint** when activating issues - it handles deactivation automatically
2. **Check activity log** to understand when and why status changes occurred
3. **Block rather than deactivate** when pausing work on an issue
4. **Set to DONE** only when truly complete
5. **Monitor for ACTIVE issues** - there should always be 0 or 1, never more

## Troubleshooting

### "Single-Active constraint violation" Error

**Cause:** Attempting to create or update an issue to ACTIVE when another is already ACTIVE.

**Solution:**
1. Check which issue is currently ACTIVE: `GET /api/issues?status=ACTIVE`
2. Either:
   - Use `/activate` endpoint (handles deactivation automatically)
   - Manually deactivate the current ACTIVE issue first
   - Set current ACTIVE issue to BLOCKED or DONE

### Multiple ACTIVE Issues in Database

**Should never happen** due to database trigger, but if it does:

```sql
-- Find all ACTIVE issues
SELECT id, title, status FROM afu9_issues WHERE status = 'ACTIVE';

-- Manually fix by updating all but one
UPDATE afu9_issues 
SET status = 'CREATED' 
WHERE id = 'issue-id-to-deactivate';
```

Then investigate how the constraint was bypassed (trigger disabled?).

## Related Documentation

- [AFU9 Issue Model](./AFU9_ISSUE_MODEL.md) - Complete issue data model
- [Activity Log](./ACTIVITY_LOG.md) - Event logging and tracking
- [Database Contract Pattern](../../DB_CONTRACT_PATTERN.md) - Contract architecture
- [Migration 014](../../../database/migrations/014_afu9_issues.sql) - Schema definition

## Summary

Single-Issue Mode is a core AFU9 design principle enforced at every layer:
- ✅ Database trigger prevents violations
- ✅ Service layer checks constraints
- ✅ API returns clear errors
- ✅ UI prevents conflicts with warnings
- ✅ Activity log tracks all changes

This ensures AFU9 maintains focus, prevents conflicts, and operates deterministically.
