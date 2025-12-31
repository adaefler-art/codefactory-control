# E73.2 Validation Commands

This document provides PowerShell commands to validate the E73.2 implementation.

## Prerequisites

Ensure you're in the repository root and have Node.js installed.

## 1. Database Migration

Run the migration to add used_sources columns:

```powershell
# Navigate to repo root
cd /home/runner/work/codefactory-control/codefactory-control

# Run migration (requires PostgreSQL running)
npm --prefix control-center run db:migrate
```

Expected output:
```
✓ Migration 031_used_sources.sql applied successfully
```

## 2. Install Dependencies (if needed)

```powershell
# Install control-center dependencies
cd control-center
npm install
cd ..
```

## 3. Run Tests

### All Tests
```powershell
npm --prefix control-center test
```

### Specific Test Suites
```powershell
# Canonicalizer tests
npm --prefix control-center test sourceCanonicalizer

# API tests
npm --prefix control-center test intent-used-sources

# All INTENT tests
npm --prefix control-center test intent
```

Expected output:
```
PASS  __tests__/lib/utils/sourceCanonicalizer.test.ts
  ✓ canonicalizeUsedSources returns empty array for null/undefined/empty
  ✓ sorts sources by kind alphabetically
  ✓ removes exact duplicates
  ✓ produces same hash for same sources in different order
  ... (all tests passing)

Test Suites: 3 passed, 3 total
Tests:       XX passed, XX total
```

## 4. Build Validation

```powershell
npm --prefix control-center run build
```

Expected output:
```
✓ Pre-build checks passed
   Creating an optimized production build ...
✓ Compiled successfully
```

## 5. Linting

```powershell
npm --prefix control-center run lint
```

Expected output:
```
✓ No linting errors found
```

## 6. Type Checking

```powershell
cd control-center
npx tsc --noEmit
cd ..
```

Expected output:
```
(No output = success)
```

## 7. Repository Verification

Run the full repo verification:

```powershell
npm run repo:verify
```

Expected checks:
- ✓ Database migrations valid
- ✓ TypeScript compilation successful
- ✓ Tests passing
- ✓ No circular dependencies

## 8. Development Server (Manual Testing)

Start the dev server for manual UI testing:

```powershell
npm --prefix control-center run dev
```

Then open browser to: `http://localhost:3000/intent`

### Manual Test Checklist

1. **Session Creation**
   - [ ] Click "New Session" -> session created
   - [ ] Session appears in sidebar

2. **Message Sending**
   - [ ] Send a message -> user message appears
   - [ ] Assistant stub response appears

3. **Sources Panel** (requires DB with sources)
   - [ ] Assistant messages show source badge
   - [ ] Click message -> sources panel shows
   - [ ] Panel is collapsible
   - [ ] Sources render with correct icons

4. **API Testing** (with curl/Postman)
   ```bash
   # Send message with sources
   curl -X POST http://localhost:3000/api/intent/sessions/{sessionId}/messages \
     -H "Content-Type: application/json" \
     -H "x-afu9-sub: test-user" \
     -d '{
       "content": "Test message",
       "used_sources": [{
         "kind": "github_issue",
         "repo": {"owner": "test", "repo": "repo"},
         "number": 1
       }]
     }'
   ```

## 9. Screenshot Capture

Take screenshots for documentation:

```powershell
# 1. INTENT page with sources panel
# 2. Assistant message with sources badge
# 3. Expanded sources panel showing different source types
# 4. Collapsed sources panel
```

## 10. Code Review

Request automated code review:

```powershell
# (This would be done via GitHub PR interface)
# The code_review tool would analyze:
# - TypeScript types correctness
# - Zod schema validation
# - Database migration safety
# - UI component accessibility
# - Test coverage
```

## Expected Results

✅ **All tests passing**  
✅ **Build successful**  
✅ **No TypeScript errors**  
✅ **No linting errors**  
✅ **UI renders correctly**  
✅ **API accepts and validates used_sources**  
✅ **Sources canonicalized and hashed correctly**  

## Troubleshooting

### Tests Fail: Module not found
```powershell
cd control-center
npm install
```

### Build Fails: TypeScript errors
```powershell
# Check imports in:
# - src/lib/schemas/usedSources.ts
# - src/lib/utils/sourceCanonicalizer.ts
# - app/intent/components/SourcesPanel.tsx
```

### Database Migration Fails
```powershell
# Check PostgreSQL is running
# Verify connection string in .env
# Ensure previous migrations (001-030) are applied
```

### UI Not Rendering Sources
```powershell
# Check browser console for errors
# Verify API response includes used_sources field
# Check SourcesPanel import in page.tsx
```

## Success Criteria

All validation commands complete without errors:
- ✅ Tests: 100% passing
- ✅ Build: Success
- ✅ Lint: Clean
- ✅ TypeScript: No errors
- ✅ Manual UI: Sources panel functional
- ✅ API: Validation working

## Files to Review

1. Schema: `control-center/src/lib/schemas/usedSources.ts`
2. Canonicalizer: `control-center/src/lib/utils/sourceCanonicalizer.ts`
3. Migration: `database/migrations/031_used_sources.sql`
4. DB Layer: `control-center/src/lib/db/intentSessions.ts`
5. API: `control-center/app/api/intent/sessions/[id]/messages/route.ts`
6. UI: `control-center/app/intent/components/SourcesPanel.tsx`
7. Tests: `control-center/__tests__/lib/utils/sourceCanonicalizer.test.ts`
8. Tests: `control-center/__tests__/api/intent-used-sources.test.ts`

---

**Last Updated**: 2025-12-31  
**Issue**: E73.2 - Sources Panel + used_sources Contract  
**Status**: Implementation Complete, Ready for Validation
