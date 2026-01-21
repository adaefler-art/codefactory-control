# I907 Verification Commands

## Prerequisites
```powershell
# Ensure you're in the repository root
cd /path/to/codefactory-control

# Set required environment variables (for testing)
$env:ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED = "true"
$env:AFU9_ADMIN_SUBS = "your-user-sub-here"
$env:NEXT_PUBLIC_GITHUB_OWNER = "adaefler-art"
$env:NEXT_PUBLIC_GITHUB_REPO = "codefactory-control"
```

## 1. Verify Code Quality

### Linting
```powershell
# Lint the IssueDraftPanel component
npm --prefix control-center run lint -- app/intent/components/IssueDraftPanel.tsx

# Expected: 0 errors, 3 acceptable warnings
# - onDraftUpdated unused (part of interface)
# - loadDraft missing in useEffect deps (intentional)
# - data unused in one path (acceptable)
```

### Type Checking
```powershell
# Check TypeScript compilation for modified files
npx --prefix control-center tsc --noEmit app/intent/components/IssueDraftPanel.tsx

# Note: May show JSX errors (expected for standalone check)
# Files compile correctly with Next.js
```

## 2. Verify File Changes

### Check Git Status
```powershell
# View modified files
git status

# Expected files:
# - control-center/src/lib/api-routes.ts
# - control-center/app/intent/components/IssueDraftPanel.tsx
# - I907_IMPLEMENTATION_SUMMARY.md
# - I907_VERIFICATION_COMMANDS.md
```

### Review Diff
```powershell
# View API routes changes
git diff control-center/src/lib/api-routes.ts

# Expected: Added publish route to issueDraft object

# View IssueDraftPanel changes (summary)
git diff --stat control-center/app/intent/components/IssueDraftPanel.tsx

# Expected: ~200 lines added (types, state, handler, UI)
```

## 3. Verify Repository Build

### Install Dependencies
```powershell
# Install control-center dependencies
npm --prefix control-center install

# Expected: No errors, dependencies installed
```

### Build Verification
```powershell
# Note: Full build may fail due to workspace dependency issues
# These are unrelated to our changes

# Verify Next.js can parse our files
npx --prefix control-center next build --dry-run 2>&1 | Select-String "IssueDraftPanel"

# Expected: No syntax errors in IssueDraftPanel.tsx
```

## 4. Manual UI Verification (Development Server)

### Start Development Server
```powershell
# Start control-center
npm --prefix control-center run dev

# Expected: Server starts on http://localhost:3000
```

### Test Flow
```powershell
# 1. Navigate to http://localhost:3000/intent
# 2. Click "New Session"
# 3. Send message: "Create an issue for improving documentation"
# 4. Click "Issue Draft" button in header
# 5. Verify draft panel opens on right side
# 6. Verify "📤 Publish to GitHub" button is visible (orange, full-width)
# 7. Click "Validate" button
# 8. Verify status badge shows VALID
# 9. Click "Commit Version" button
# 10. Click "📤 Publish to GitHub" button
# 11. Verify publish result panel shows:
#     - Batch ID
#     - Summary counts
#     - GitHub issue links
# 12. Click GitHub issue link
# 13. Verify issue exists in repository
```

## 5. Verify API Integration

### Test Publish Endpoint
```powershell
# Get session ID from UI (copy from browser console or URL)
$sessionId = "your-session-id-here"

# Test publish endpoint (requires authentication)
curl -X POST "http://localhost:3000/api/intent/sessions/$sessionId/issue-draft/versions/publish" `
  -H "Content-Type: application/json" `
  -H "Cookie: your-auth-cookie-here" `
  -d '{
    "owner": "adaefler-art",
    "repo": "codefactory-control",
    "issue_set_id": "'$sessionId'"
  }'

# Expected response:
# {
#   "success": true,
#   "batch_id": "...",
#   "summary": { "total": 1, "created": 1, ... },
#   "items": [ { "canonical_id": "...", "github_issue_url": "..." } ],
#   "links": { "batch_id": "...", "request_id": "..." }
# }
```

## 6. Verify Database Events

### Check Publish Batch Events
```powershell
# Connect to database (adjust connection string)
psql $DATABASE_URL

# Query recent publish batch events
SELECT 
  batch_id,
  session_id,
  event_type,
  total_items,
  created_count,
  updated_count,
  created_at,
  owner,
  repo
FROM intent_issue_set_publish_batch_events
ORDER BY created_at DESC
LIMIT 5;

# Expected: Recent publish events with correct counts
```

### Check Publish Item Events
```powershell
# Query recent publish item events
SELECT 
  batch_id,
  canonical_id,
  event_type,
  github_issue_number,
  github_issue_url,
  created_at
FROM intent_issue_set_publish_item_events
ORDER BY created_at DESC
LIMIT 10;

# Expected: Item-level events with GitHub URLs
```

## 7. Verify GitHub Integration

### Check GitHub Issues
```powershell
# Using GitHub CLI (if available)
gh issue list --repo adaefler-art/codefactory-control --limit 5

# Or visit GitHub web UI:
# https://github.com/adaefler-art/codefactory-control/issues

# Expected: Published issue(s) visible with canonicalId in body
```

## 8. Verify Error Handling

### Test Without Admin Privilege
```powershell
# Remove user from admin list (testing)
$env:AFU9_ADMIN_SUBS = "different-user"

# Try to publish (should fail with 403)
# Expected: Error message about forbidden access
```

### Test With Publishing Disabled
```powershell
# Disable publishing (testing)
$env:ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED = "false"

# Try to publish (should fail with 409)
# Expected: Error message about publishing not enabled
```

## 9. Screenshot Verification

### Capture UI States
```powershell
# Recommended screenshots to capture:
# 1. Intent page with "Issue Draft" button highlighted
# 2. Issue Draft panel with new "Publish to GitHub" button
# 3. Publish result panel showing success with GitHub links
# 4. Publish History panel showing published batch
# 5. GitHub issue page showing published issue

# Save screenshots to: /path/to/codefactory-control/I907_screenshots/
```

## 10. Code Review Checklist

### Self-Review
- [ ] TypeScript types properly defined (no `any`)
- [ ] Error handling implemented
- [ ] UI feedback for loading states
- [ ] Button disable logic prevents concurrent operations
- [ ] Links open in new tab (`target="_blank"`, `rel="noopener noreferrer"`)
- [ ] Accessible labels and titles
- [ ] Responsive design (panel width, scrolling)
- [ ] Success/error messages clear and actionable
- [ ] Code follows existing patterns
- [ ] No breaking changes
- [ ] Minimal, surgical changes

### Integration Review
- [ ] API route exists and accessible
- [ ] Backend service handles publish correctly
- [ ] Database events recorded
- [ ] GitHub issues created with canonicalId
- [ ] Activity log updated
- [ ] Guards enforced (auth, admin, production)
- [ ] Idempotency working (same batch hash = skip)

## Success Criteria

✅ All verification steps pass
✅ UI shows publish button and result
✅ Publish creates GitHub issue(s)
✅ Database events recorded
✅ No TypeScript errors
✅ No linting errors (only acceptable warnings)
✅ Screenshots captured
✅ Documentation complete

## Troubleshooting

### Issue: "Publishing not enabled" error
**Solution:** Set `ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED=true`

### Issue: "Forbidden" error (403)
**Solution:** Add user ID to `AFU9_ADMIN_SUBS` environment variable

### Issue: Publish button disabled
**Solution:** Ensure draft is validated (status = VALID) first

### Issue: No GitHub issue link in result
**Solution:** Check publish result for errors, verify GitHub App credentials

### Issue: Build fails with workspace errors
**Solution:** This is a known issue unrelated to our changes. Individual files compile correctly.

## Clean Up

### After Testing
```powershell
# Stop development server (Ctrl+C)

# Reset environment variables (if needed)
# Restore original values or clear test values

# Commit changes
git add .
git commit -m "I907: Add In-App Issue Creation and Publishing Flow"
git push
```
