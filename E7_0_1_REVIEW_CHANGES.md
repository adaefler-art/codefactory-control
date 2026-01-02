# E7.0.1 Review Feedback - Changes Summary

## Changes Made (Commit 4cb5672)

### Files Modified (7 files)

1. **scripts/deploy-context-resolver.ts**
   - Added `normalizeEnvironment()` function
   - Accepts aliases: prod/production, stage/staging (case-insensitive)
   - Normalizes to canonical: "production" | "staging"

2. **scripts/deploy-context-guardrail.ts**
   - Refactored validation to use regex patterns (avoid false positives)
   - Added security filter for secret values in summary output
   - Filters env vars containing: SECRET, TOKEN, PASSWORD, KEY

3. **scripts/__tests__/deploy-context-guardrail.test.ts**
   - Added 6 tests for alias normalization
   - Added test for false-positive prevention (product, production strings)
   - Total: 22 tests (was 16)

4. **.github/workflows/deploy-ecs.yml**
   - Changed `ts-node` to `npx ts-node` for deterministic execution

5. **.github/workflows/deploy-database-stack.yml**
   - Changed `ts-node` to `npx ts-node` for deterministic execution

6. **scripts/test-deploy-context-guardrail-negative.ps1** (NEW)
   - PowerShell negative test suite (9 tests)

7. **scripts/test-deploy-context-guardrail-positive.ps1** (NEW)
   - PowerShell positive test suite (6 tests)

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| Unit Tests | 22/22 | ✅ PASS |
| PowerShell Negative | 9/9 | ✅ PASS |
| PowerShell Positive | 6/6 | ✅ PASS |
| Build | - | ✅ PASS |

## How to Run Tests Locally

### PowerShell (Recommended)
```powershell
# Negative tests (violations blocked)
pwsh -File scripts/test-deploy-context-guardrail-negative.ps1

# Positive tests (valid deploys allowed)
pwsh -File scripts/test-deploy-context-guardrail-positive.ps1
```

### Bash (Alternative)
```bash
# Negative tests
./scripts/test-deploy-context-guardrail-negative.sh

# Positive tests
./scripts/test-deploy-context-guardrail-positive.sh
```

### Unit Tests
```bash
npm test -- scripts/__tests__/deploy-context-guardrail.test.ts
```

## Acceptance Criteria Met

- [x] Guardrail still fail-closed
- [x] DEPLOY_ENV values compatible (prod/stage aliases normalized)
- [x] PowerShell-first test scripts exist and documented
- [x] Artifact detection structured (no false positives)
- [x] Workflows use deterministic execution (npx ts-node)
- [x] No secrets printed in logs/summary
- [x] All tests pass (22 unit + 9 negative + 6 positive)

## Key Improvements

1. **Compatibility**: Accepts common aliases used in repo (prod, stage)
2. **Security**: Filters secret values from logs
3. **Reliability**: Structured regex patterns prevent false positives
4. **Testing**: PowerShell-first approach for Windows compatibility
5. **Determinism**: Uses npx with package-lock for consistent execution
