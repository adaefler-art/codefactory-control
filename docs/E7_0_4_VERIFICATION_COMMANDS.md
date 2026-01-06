# E7.0.4 Verification Commands

This document provides PowerShell commands to verify the E7.0.4 implementation.

## 1. Repository Verification

```powershell
npm run repo:verify
```

**Expected Output:**
```
✅ All repository canon checks passed!
Repository structure is consistent.
```

## 2. Route Verification

```powershell
npm run routes:verify
```

**Expected Output:**
```
✅ ALL CHECKS PASSED
All API routes are properly canonicalized
```

## 3. Control Center Tests

```powershell
npm --prefix control-center test
```

**Expected Output:**
```
Test Suites: 108 passed, 108 total
Tests:       1568 passed, 1568 total
```

## 4. Control Center Build

```powershell
npm --prefix control-center run build
```

**Expected Output:**
```
✓ Compiled successfully

Routes:
├ ○ /settings/flags-env   # ← New route
├ ƒ /api/system/flags-env  # ← New API endpoint
...
```

## 5. Test Specific Features

### Test Flags/Env Catalog

```powershell
npm --prefix control-center test -- __tests__/lib/flags-env-catalog.test.ts
```

**Expected:** 23 tests pass

### Test Effective Config Resolution

```powershell
npm --prefix control-center test -- __tests__/lib/effective-config.test.ts
```

**Expected:** 21 tests pass

### Test API Endpoint

```powershell
npm --prefix control-center test -- __tests__/api/flags-env.test.ts
```

**Expected:** 13 tests pass

## 6. Generate JSON Export Sample

```powershell
$env:NODE_ENV="development"
$env:GITHUB_OWNER="adaefler-art"
$env:AWS_REGION="eu-central-1"
$env:AFU9_DEBUG_MODE="true"

npx tsx -e @"
import { getEffectiveConfigReportSanitized } from './control-center/src/lib/effective-config';
import { FLAGS_CATALOG } from './control-center/src/lib/flags-env-catalog';

const report = getEffectiveConfigReportSanitized();
const output = {
  ok: true,
  catalog: {
    version: FLAGS_CATALOG.version,
    lastUpdated: FLAGS_CATALOG.lastUpdated,
    totalFlags: FLAGS_CATALOG.flags.length,
  },
  effective: report,
};

console.log(JSON.stringify(output, null, 2));
"@
```

## 7. Start Dev Server and View UI

```powershell
# Terminal 1: Start server
cd control-center
npm run dev

# Terminal 2: Open browser (after authentication)
# Navigate to: http://localhost:3000/settings/flags-env
```

**UI Features to Verify:**
- ✅ Summary cards (Total, Set, Missing, Missing Required)
- ✅ Missing required flags warning (red alert box)
- ✅ Filterable table (Risk, Source, Tag, Show)
- ✅ Export JSON button
- ✅ Secrets are masked in display
- ✅ Source attribution (build/environment/default/missing)

## 8. Test API Endpoint Directly

```powershell
# Start server first (see step 7)
# Then in another terminal:
Invoke-RestMethod -Uri "http://localhost:3000/api/system/flags-env" | ConvertTo-Json -Depth 10
```

**Expected Response Structure:**
```json
{
  "ok": true,
  "catalog": {
    "version": "1.0.0",
    "lastUpdated": "2026-01-02",
    "totalFlags": 25
  },
  "effective": {
    "timestamp": "...",
    "environment": "development",
    "values": [...],
    "missing": [...],
    "missingRequired": [...],
    "summary": {
      "total": 25,
      "set": ...,
      "missing": ...,
      "missingRequired": ...,
      ...
    }
  }
}
```

## 9. Check Catalog Contents

```powershell
# View the catalog
cat control-center/src/lib/flags-env-catalog.ts | Select-String "key:"
```

**Expected:** Should show 25+ flags including:
- GIT_SHA, BUILD_TIME
- GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_PEM, etc.
- OPENAI_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY
- DATABASE_* variables
- MCP_* endpoints

## Summary

All commands should pass, confirming:
- ✅ 57 new tests pass (100% pass rate)
- ✅ Build succeeds
- ✅ Routes properly canonicalized
- ✅ UI functional with all features
- ✅ API returns correct data structure
- ✅ Secrets properly sanitized
- ✅ Missing flags detected
