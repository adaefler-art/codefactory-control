# Fix for Missing @codefactory/verdict-engine Dependency

## Problem
Pre-existing build and test failures due to missing `@codefactory/verdict-engine` package:
- 5 test suites failing
- Build failing with "Cannot find module '@codefactory/verdict-engine'"

## Root Cause
The `@codefactory/verdict-engine` and `@codefactory/deploy-memory` workspace packages exist in the repository under `packages/` but were not built. These packages need to be compiled (TypeScript → JavaScript) before they can be used by `control-center`.

## Solution
Enhanced the `control-center/prebuild.js` script to automatically build workspace dependencies before the Next.js build process.

### Changes Made
1. **Modified**: `control-center/prebuild.js`
   - Added `buildWorkspaceDependencies()` function
   - Automatically builds `@codefactory/deploy-memory` and `@codefactory/verdict-engine` if their `dist/` folders don't exist
   - Runs before build metadata generation

### How It Works
1. When `npm run build` is executed in control-center, the prebuild script runs first
2. The script checks if workspace packages (`deploy-memory`, `verdict-engine`) have been built
3. If not built (no `dist/` folder), it runs `npm run build` for each package
4. If already built, it skips the build and continues
5. Then generates build metadata and proceeds with Next.js build

## Results
- ✅ **Build**: Now passes successfully
- ✅ **Tests**: 97/98 test suites passing (down from 5 failing)
  - Only 1 remaining failure in `intent-used-sources.test.ts` (unrelated to verdict-engine)
- ✅ **CR Schema Tests**: All 29 tests still passing

## Verification Commands

```powershell
# Build control-center (will auto-build workspace packages)
npm --prefix control-center run build

# Run tests
npm --prefix control-center test

# Run CR schema tests specifically
npm --prefix control-center test -- changeRequest.test.ts
```

## Build Output Example
```
Building workspace dependencies...
  Building @codefactory/deploy-memory...
  ✓ Built @codefactory/deploy-memory
  Building @codefactory/verdict-engine...
  ✓ Built @codefactory/verdict-engine
✓ Build metadata generated
✓ Pre-build checks passed
```

## Notes
- The `node_modules/` and `dist/` directories are already in `.gitignore`, so they won't be committed
- This solution is minimal and doesn't change any functionality—it just ensures dependencies are built
- The build process is idempotent: if packages are already built, they're skipped
