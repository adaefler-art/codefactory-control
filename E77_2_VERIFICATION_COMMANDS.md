# E77.2 Verification Commands

## PowerShell Commands for Testing and Building

### Run Playbook Tests Only
```powershell
# Run just the playbook-related tests
npm --prefix control-center test -- --testPathPattern="playbooks" --no-coverage
```

**Expected Output**: 71 tests passing across 7 test suites

### Run Full Test Suite
```powershell
# Run all control-center tests
npm --prefix control-center test
```

**Note**: Some unrelated tests may fail due to workspace dependency issues (verdict-engine module). The playbook tests should all pass.

### Run Build
```powershell
# Build the control-center application
npm --prefix control-center run build
```

**Note**: Build may fail due to pre-existing workspace dependency issues (deploy-memory and verdict-engine). These are unrelated to the E77.2 implementation.

### Run Repository Verification
```powershell
# Run security and structure verification
npm run repo:verify
```

This checks:
- No secrets in code
- File structure compliance
- Import restrictions
- Security patterns

## Quick Verification Workflow

Run these commands in sequence to verify the E77.2 implementation:

```powershell
# 1. Navigate to project root
cd /path/to/codefactory-control

# 2. Run playbook tests (should all pass)
npm --prefix control-center test -- --testPathPattern="playbooks" --no-coverage

# 3. Run full test suite (playbook tests should pass)
npm --prefix control-center test

# 4. Run repo verification
npm run repo:verify
```

## Test Output Example

When running playbook tests, you should see:

```
Test Suites: 7 passed, 7 total
Tests:       71 passed, 71 total
Snapshots:   0 total
Time:        ~7s
```

The 7 test suites are:
1. `safe-retry-runner.test.ts` - 30 tests
2. `rerun-post-deploy-verification.test.ts` - 26 tests  
3. `registry.test.ts` - 15 tests
4. `remediation-playbooks.test.ts` - Existing framework tests
5. `playbook-api.test.ts` - Existing playbook API tests
6. `playbook-contract.test.ts` - Existing contract tests
7. `playbook-executor.test.ts` - Existing executor tests

## Troubleshooting

### If tests fail:
1. Ensure dependencies are installed:
   ```powershell
   npm --prefix control-center install
   ```

2. Clear Jest cache:
   ```powershell
   npm --prefix control-center test -- --clearCache
   ```

3. Check for TypeScript errors:
   ```powershell
   npx tsc --noEmit --project control-center/tsconfig.json
   ```

### If build fails:
The build may fail due to workspace dependency issues with `@codefactory/deploy-memory` and `@codefactory/verdict-engine`. These are pre-existing issues unrelated to E77.2.

To verify E77.2 code compiles correctly:
```powershell
npx tsc --noEmit control-center/src/lib/playbooks/*.ts control-center/src/lib/remediation-executor.ts
```

## Individual Test Files

Run specific test files:

```powershell
# Test safe-retry-runner playbook
npm --prefix control-center test -- safe-retry-runner.test.ts

# Test rerun-post-deploy-verification playbook  
npm --prefix control-center test -- rerun-post-deploy-verification.test.ts

# Test playbook registry
npm --prefix control-center test -- registry.test.ts
```

## Watch Mode for Development

```powershell
# Run tests in watch mode for continuous feedback
npm --prefix control-center test -- --watch --testPathPattern="playbooks"
```

## Coverage Report

```powershell
# Generate coverage report for playbook code
npm --prefix control-center test -- --testPathPattern="playbooks" --coverage
```
