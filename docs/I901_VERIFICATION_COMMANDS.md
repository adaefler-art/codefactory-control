# I901 Verification Commands

## Purpose
Verification script for Issue I901 - INTENT Console UI Hotfix

## Prerequisites
```powershell
# Ensure you're in the repo root
cd /path/to/codefactory-control
```

## 1. Repository Verification
```powershell
# Run repository canon checks
npm run repo:verify
```

Expected: ✅ All repository canon checks passed

## 2. Control Center Tests
```powershell
# Run all UI tests
cd control-center
npm test -- __tests__/ui/

# Run specific INTENT layout tests
npm test -- __tests__/ui/intent-page-layout-regression.test.tsx
npm test -- __tests__/ui/intent-page-scroll.test.tsx
```

Expected:
- Test Suites: 4 passed (1 skipped - unrelated)
- Tests: 24+ passed (1 skipped - unrelated)

## 3. Build Verification
```powershell
# Note: Build may have workspace dependency issues unrelated to this fix
# The UI changes are isolated to control-center/app/intent/page.tsx
cd control-center
npm run build
```

## 4. Manual UI Smoke Test (Optional)
If you have a running dev environment:

```powershell
# Start dev server
cd control-center
npm run dev
```

Then in browser:
1. Navigate to http://localhost:3000/intent
2. Create a new session or select existing session
3. Send 30+ messages (or simulate with browser console)
4. Verify:
   - ✅ Chat scrollbar is visible and functional
   - ✅ Last message is reachable by scrolling
   - ✅ Composer (input area) never overlaps chat messages
   - ✅ Header can scroll if needed (when Context Packs drawer is open)
5. Resize browser window (mobile-ish: 375x667)
6. Repeat verification
7. Open Issue Draft Panel button
8. Verify drawer doesn't conflict with layout

## 5. Git Status
```powershell
# Verify only expected files were changed
git --no-pager diff origin/main...HEAD --stat
```

Expected files changed:
- control-center/app/intent/page.tsx
- control-center/__tests__/ui/intent-page-layout-regression.test.tsx

## Summary Checklist
- [ ] repo:verify passes
- [ ] All UI tests pass
- [ ] No unexpected files changed
- [ ] Manual smoke test (if applicable)

## Notes
- The fix is minimal: 5 lines changed in page.tsx (3 for layout, 2 for data-testid)
- New regression test file added with 3 comprehensive tests
- All existing tests continue to pass
- No breaking changes to other components
