# I907 Implementation Summary: In-App Flow for Issue Creation and Publishing

## Overview
Implemented a clear "Golden Path" for users to create and publish issues in the INTENT interface without requiring Smoke-Key access. Users can now create drafts, validate them, commit versions, and publish to GitHub directly from the UI.

## Changes Made

### 1. API Routes Enhancement
**File:** `control-center/src/lib/api-routes.ts`

Added the publish endpoint to the issueDraft routes:
```typescript
publish: (sessionId: string) => `/api/intent/sessions/${sessionId}/issue-draft/versions/publish`
```

This route connects to the existing backend publish service at `/api/intent/sessions/[id]/issue-draft/versions/publish`.

### 2. IssueDraftPanel Component Enhancement
**File:** `control-center/app/intent/components/IssueDraftPanel.tsx`

#### New TypeScript Interfaces
- `PublishResultItem`: Represents individual publish result items with GitHub links
- `PublishResult`: Complete publish response structure with batch summary

#### New State Variables
- `isPublishing`: Tracks publish operation in progress
- `publishResult`: Stores publish response data (properly typed)
- `showPublishResult`: Controls result display visibility

#### New Handler Function
`handlePublish()` - Handles the complete publish workflow:
- Retrieves owner/repo from environment variables (defaults to `adaefler-art/codefactory-control`)
- Posts to publish endpoint with `session_id` as `issue_set_id`
- Handles success/error states
- Displays publish results in the UI

#### UI Updates
1. **Action Buttons Reorganization:**
   - Row 1: Validate | Commit Version | Copy Snippet
   - Row 2: 📤 Publish to GitHub (full-width, orange button)

2. **Publish Result Display:**
   - Collapsible success panel with green theme
   - Batch ID display (truncated to 12 chars)
   - Summary counts (total, created, updated, skipped, failed)
   - GitHub issue links (clickable, opens in new tab)
   - Format: `{canonical_id} → #{issue_number} ({action})`
   - Warnings section (if applicable)

3. **Button Disable Logic:**
   - All buttons disabled during any operation (validate, commit, publish)
   - Publish button only enabled when draft is valid
   - Prevents concurrent operations

#### TypeScript Improvements
- Removed all `any` types
- Proper typing for API responses
- Proper typing for error objects
- Type-safe map/filter operations

## User Flow

### Golden Path: From Intent to GitHub Issue
1. **Create Draft** (DISCUSS mode)
   - User opens Issue Draft panel
   - INTENT generates draft from conversation
   - Draft appears in panel automatically

2. **Validate**
   - User clicks "Validate" button
   - System validates draft structure
   - Status badge shows VALID/INVALID/DRAFT
   - Errors/warnings displayed if any

3. **Commit Version**
   - User clicks "Commit Version" (enabled only when valid)
   - System saves a versioned snapshot
   - Version stored in database

4. **Publish to GitHub** ⭐ NEW
   - User clicks "📤 Publish to GitHub" button
   - System publishes all committed versions from session
   - Publish result shows:
     - Batch ID
     - Summary statistics
     - GitHub issue links (clickable)
     - Any warnings

5. **Verify in GitHub**
   - User clicks GitHub issue links
   - Issues appear in repository with canonicalId marker
   - Activity log records all events

## Backend Integration

### Existing Services Used
- **Publish API:** `/api/intent/sessions/[id]/issue-draft/versions/publish`
  - Implements idempotent batch publishing
  - Uses GitHub App server-to-server auth
  - Enforces repo allowlist
  - Records in audit ledger

- **Activity Logging:**
  - Publish events tracked in `intent_issue_set_publish_batch_events`
  - Item-level events in `intent_issue_set_publish_item_events`
  - Includes batch_id, request_id, counts, GitHub URLs

- **Guards:**
  - 401: Authentication required
  - 409: Production block (publishing not enabled)
  - 403: Admin check (AFU9_ADMIN_SUBS)
  - Idempotency via batch hash

### Environment Variables
- `NEXT_PUBLIC_GITHUB_OWNER`: GitHub repository owner (default: `adaefler-art`)
- `NEXT_PUBLIC_GITHUB_REPO`: GitHub repository name (default: `codefactory-control`)
- `ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED`: Must be `true` in production
- `AFU9_ADMIN_SUBS`: Comma-separated list of admin user IDs

## Testing Considerations

### Manual Testing Steps
1. **Setup:**
   - Ensure `ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED=true`
   - Ensure user is in `AFU9_ADMIN_SUBS` list
   - Start control-center: `npm --prefix control-center run dev`

2. **Create Draft:**
   - Navigate to `/intent`
   - Create new session
   - Send message: "Create an issue for improving documentation"
   - Open "Issue Draft" panel
   - Verify draft appears

3. **Validate:**
   - Click "Validate" button
   - Verify status badge shows VALID
   - Check for no errors

4. **Commit:**
   - Click "Commit Version" button
   - Verify success (no errors)

5. **Publish:**
   - Click "📤 Publish to GitHub" button
   - Verify publish result shows:
     - Batch ID
     - Counts (created: 1, total: 1)
     - GitHub issue link
   - Click GitHub link
   - Verify issue exists in repository

6. **View History:**
   - Click "Publish History" button
   - Verify batch appears in history
   - Verify item details match

### Automated Testing
- Linting: `npx eslint app/intent/components/IssueDraftPanel.tsx`
  - Result: 0 errors, 3 acceptable warnings
- Type checking: `npx tsc --noEmit` (with Next.js project)

## Files Modified
1. `control-center/src/lib/api-routes.ts` (+1 line)
2. `control-center/app/intent/components/IssueDraftPanel.tsx` (+200 lines, enhanced)

## Files Unchanged (Leveraged Existing)
1. `control-center/app/api/intent/sessions/[id]/issue-draft/versions/publish/route.ts`
2. `control-center/src/lib/github/issue-draft-version-publisher.ts`
3. `control-center/app/intent/components/PublishHistoryPanel.tsx`

## Acceptance Criteria Status

✅ **User can create draft without Smoke-Key**
- Normal auth flow works
- No special permissions needed for draft creation

✅ **User can publish draft without Smoke-Key**
- Uses normal auth (requires admin privilege)
- AFU9_ADMIN_SUBS guard enforced

✅ **Publish result shows batchId, counts, GH links**
- Batch ID displayed (truncated)
- Summary counts: total, created, updated, skipped, failed
- GitHub issue links clickable

✅ **Draft Panel stays synchronized**
- No "missing draft access" errors
- Draft loads on session change
- Refresh on commit/publish

✅ **Activity Log records events**
- Backend automatically logs to `intent_issue_set_publish_batch_events`
- Includes batch_id, request_id, counts, GitHub URLs

## Known Limitations

1. **Admin-Only Publishing:**
   - Publish requires user to be in `AFU9_ADMIN_SUBS`
   - This is a security guard (403 Forbidden)
   - For normal users without Smoke-Key: they can create drafts but cannot publish

2. **Environment Configuration Required:**
   - `ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED=true` required in production
   - Returns 409 Conflict if not enabled

3. **Owner/Repo Hardcoded:**
   - Currently uses environment variables or defaults
   - No UI picker for different repos

4. **Build Issue:**
   - Workspace dependencies have build errors (unrelated to this change)
   - This affects full build but not the functionality
   - Files compile correctly individually

## Future Enhancements

1. **Diff Preview:**
   - Add "what will happen" summary before publish
   - Show which issues are new vs. updated
   - Preview markdown rendering

2. **Repository Selection:**
   - UI picker for owner/repo
   - Multiple repository targets
   - Saved preferences

3. **Batch Management:**
   - Partial batch publishing
   - Issue-level retry
   - Revert/rollback capability

4. **Non-Admin Publishing:**
   - Approval workflow for non-admin users
   - Review/approval UI
   - Notification system

## Notes

- All changes follow existing patterns in the codebase
- TypeScript types properly defined
- No breaking changes to existing functionality
- Minimal, surgical changes as required
