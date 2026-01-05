# E79.2 Verification Commands

## PowerShell Commands to Run Tests and Build

### 1. Verify Repository Structure

```powershell
# From repository root
npm run repo:verify
```

### 2. Build and Test Control Center

```powershell
# Navigate to control-center
cd control-center

# Install dependencies (if not already done)
npm install

# Run tests
npm test

# Run specific lawbook admin tests
npm test -- __tests__/api/lawbook-admin.test.ts

# Build Next.js application
npm run build
```

### 3. Start Development Server

```powershell
# From control-center directory
npm run dev
```

**Access Admin UI**: Navigate to `http://localhost:3000/admin/lawbook`

### 4. Full Repository Build

```powershell
# From repository root
npm install
npm run build
npm test
```

## Expected Test Results

All tests in `__tests__/api/lawbook-admin.test.ts` should pass:

- ✅ POST /api/lawbook/validate - validates lawbook successfully
- ✅ POST /api/lawbook/validate - returns validation errors with deterministic ordering
- ✅ POST /api/lawbook/validate - returns error for invalid JSON
- ✅ POST /api/lawbook/validate - requires authentication
- ✅ POST /api/lawbook/publish - publishes new lawbook version
- ✅ POST /api/lawbook/publish - returns existing version when hash matches (idempotent)
- ✅ POST /api/lawbook/publish - requires authentication
- ✅ GET /api/lawbook/versions/[id] - gets lawbook version by ID
- ✅ GET /api/lawbook/versions/[id] - returns 404 for non-existent version
- ✅ GET /api/lawbook/versions/[id] - requires authentication
- ✅ POST /api/lawbook/diff - computes diff between two versions
- ✅ POST /api/lawbook/diff - returns empty changes when versions are identical
- ✅ POST /api/lawbook/diff - returns 404 for non-existent version
- ✅ POST /api/lawbook/diff - requires both version IDs
- ✅ POST /api/lawbook/diff - requires authentication

**Total Tests**: 15 tests across 4 API endpoints

## Manual UI Testing

### Test Scenario 1: Load and Validate Example

```powershell
# 1. Start dev server
cd control-center
npm run dev

# 2. Open browser to http://localhost:3000/admin/lawbook
# 3. Click "Load Example" button
# 4. Click "Validate" button
# Expected: Green success message with hash
```

### Test Scenario 2: Publish New Version

```powershell
# 1. With example loaded (or custom JSON)
# 2. Click "Publish New Version"
# Expected: Success message, version appears in left sidebar
# Expected: New version is auto-selected
```

### Test Scenario 3: Test Idempotency

```powershell
# 1. Click "Publish New Version" again with same JSON
# Expected: Message indicates "already exists with this hash"
# Expected: Status 200 (not 201)
```

### Test Scenario 4: Activate Version

```powershell
# 1. Select a non-active version from sidebar
# 2. Click "Activate" button
# Expected: Confirmation dialog
# Expected: After confirm, "Active" badge appears on version
```

### Test Scenario 5: Compare Versions

```powershell
# 1. Select two different versions in diff dropdowns
# 2. Click "Show Diff"
# Expected: Modal opens showing changes
# Expected: Changes are sorted alphabetically by path
# Expected: Color coding (green=added, red=removed, yellow=modified)
```

### Test Scenario 6: Validation Errors

```powershell
# 1. Delete a required field from JSON (e.g., "lawbookId")
# 2. Click "Validate"
# Expected: Red error panel
# Expected: Errors sorted alphabetically by path
```

## Build Output

Expected successful build output:

```
> control-center@0.5.0 build
> next build --webpack

✓ Creating an optimized production build
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Collecting page data
✓ Generating static pages (X/X)
✓ Collecting build traces
✓ Finalizing page optimization

Route (app)                              Size     First Load JS
┌ ○ /                                    ...      ...
├ ○ /admin/lawbook                       ...      ...
...
○  (Static)  prerendered as static content
```

## Troubleshooting

### Dependencies Not Installed

```powershell
# Error: "Cannot find module 'next/server'"
# Solution: Install dependencies
cd control-center
npm install
```

### Tests Fail with Module Errors

```powershell
# Error: "Cannot find module '@/lawbook/schema'"
# Solution: Ensure TypeScript paths are configured
# Check tsconfig.json has proper path mappings
```

### Build Fails

```powershell
# Check for TypeScript errors
npx tsc --noEmit

# Check for linting errors
npm run lint
```

## Verification Checklist

- [ ] `npm run repo:verify` passes
- [ ] `npm install` completes without errors
- [ ] `npm test` shows all tests passing
- [ ] `npm run build` completes successfully
- [ ] Dev server starts without errors
- [ ] Admin UI loads at /admin/lawbook
- [ ] Can load example lawbook
- [ ] Can validate lawbook
- [ ] Can publish new version
- [ ] Can activate version
- [ ] Can compare two versions
- [ ] Navigation shows "Admin" link
- [ ] Diff view shows deterministic changes
