# E74.1: CR JSON Schema v1 - Implementation Complete

## Summary

Successfully implemented the ChangeRequest JSON Schema v1 as a deterministic, strict Zod schema with comprehensive tests, canonical JSON serialization, and documentation.

## Deliverables

### 1. Schema Module
**Location**: `control-center/src/lib/schemas/changeRequest.ts`

- ✅ Versioned schema (crVersion: "0.7.0")
- ✅ **NEW**: Strict mode enabled (`.strict()`)
- ✅ **NEW**: Version registry (`ACTIVE_CR_VERSIONS = ['0.7.0']`)
- ✅ All required fields with validation:
  - `canonicalId`, `title`, `motivation`
  - `scope` (summary, inScope, outOfScope)
  - `targets` (repo, branch, components)
  - `changes` (files with changeType enum, optional api/db)
  - `acceptanceCriteria` (min 1 required)
  - `tests` (required min 1, optional addedOrUpdated/manual)
  - `risks` (items with risk/impact/mitigation)
  - `rollout` (steps, rollbackPlan, optional featureFlags)
  - `evidence` (min 1, reuses UsedSourcesSchema)
  - `constraints` (determinismNotes, idempotencyNotes, lawbookVersion)
  - `metadata` (createdAt, createdBy, tags, kpiTargets)

### 2. Canonical Serialization
**Two functions for different use cases**:

1. `canonicalizeChangeRequest(cr: ChangeRequest): ChangeRequest`
   - ✅ Deterministic evidence sorting (by kind, then key fields)
   - ✅ Preserves user order for AC, tests, rollout steps
   - ✅ Non-mutating (returns new object)

2. **NEW**: `canonicalizeChangeRequestToJSON(cr: ChangeRequest): string`
   - ✅ Produces canonical JSON string with stable key ordering (recursive)
   - ✅ Alphabetically sorted object keys
   - ✅ Deterministic output for hashing/comparison
   - ✅ Same semantic input always produces identical JSON string

### 3. Tests
**Location**: `control-center/__tests__/lib/schemas/changeRequest.test.ts`

- ✅ **29 tests** (was 22, added 7 new tests), all passing
- ✅ Validates minimal and full CR examples
- ✅ Enforces required field validation
- ✅ Tests enum validations
- ✅ Verifies canonical serialization stability
- ✅ **NEW**: Tests canonical JSON string determinism
- ✅ **NEW**: Tests version validation (allowed vs disallowed)
- ✅ **NEW**: Tests strict mode (rejects unknown properties)

### 4. Documentation
**Location**: `docs/E74_1_IMPLEMENTATION_SUMMARY.md` and `docs/E74_1_OUTPUT.md`

- ✅ Complete schema documentation
- ✅ Example minimal valid CR JSON
- ✅ Usage examples for both canonicalization functions
- ✅ PowerShell commands
- ✅ **NEW**: Moved from root to `docs/` directory

## Example Minimal Valid CR

\`\`\`json
{
  "crVersion": "0.7.0",
  "canonicalId": "CR-2026-01-01-001",
  "title": "Example Change Request",
  "motivation": "Demonstrate minimal valid CR structure",
  "scope": {
    "summary": "Add new API endpoint",
    "inScope": ["API endpoint implementation", "Unit tests"],
    "outOfScope": ["UI changes", "Database migrations"]
  },
  "targets": {
    "repo": { "owner": "adaefler-art", "repo": "codefactory-control" },
    "branch": "main",
    "components": ["control-center"]
  },
  "changes": {
    "files": [{
      "path": "control-center/src/app/api/example/route.ts",
      "changeType": "create",
      "rationale": "New API endpoint for example feature"
    }]
  },
  "acceptanceCriteria": [
    "API endpoint responds with 200 status",
    "Response includes required fields"
  ],
  "tests": {
    "required": ["npm test"]
  },
  "risks": {
    "items": [{
      "risk": "API performance degradation",
      "impact": "low",
      "mitigation": "Implement caching and rate limiting"
    }]
  },
  "rollout": {
    "steps": ["Deploy to staging", "Run integration tests", "Deploy to production"],
    "rollbackPlan": "Revert to previous deployment via GitHub Actions"
  },
  "evidence": [{
    "kind": "github_issue",
    "repo": { "owner": "adaefler-art", "repo": "codefactory-control" },
    "number": 741,
    "title": "E74.1: CR JSON Schema v1"
  }],
  "constraints": {
    "determinismNotes": ["Schema is deterministic and versioned"]
  },
  "metadata": {
    "createdAt": "2026-01-01T12:00:00.000Z",
    "createdBy": "intent",
    "tags": ["api", "example"],
    "kpiTargets": ["D2D", "AutoFixRate"]
  }
}
\`\`\`

## PowerShell Commands for Validation

### Run Tests
\`\`\`powershell
# Run CR schema tests specifically
npm --prefix control-center test -- changeRequest.test.ts

# Expected output:
# Test Suites: 1 passed, 1 total
# Tests:       22 passed, 22 total
\`\`\`

### Run All Tests
\`\`\`powershell
npm --prefix control-center test

# Note: Some pre-existing test failures exist (unrelated to CR schema)
# CR schema tests: 29/29 passing ✅
\`\`\`

### Build
\`\`\`powershell
npm --prefix control-center run build

# Note: Build has pre-existing failures due to missing @codefactory/verdict-engine
# These are unrelated to the CR schema implementation
\`\`\`

### Verify Repository (if available)
\`\`\`powershell
npm run repo:verify
\`\`\`

## Test Results

\`\`\`
 PASS  __tests__/lib/schemas/changeRequest.test.ts
  ChangeRequest Schema
    ✓ should validate the minimal example CR
    ✓ should validate a full CR with all optional fields
    ✓ should reject CR with missing acceptanceCriteria
    ✓ should reject CR with missing tests.required
    ✓ should reject CR with missing evidence
    ✓ should reject CR with invalid changeType
    ✓ should reject CR with missing required fields
    ✓ should reject CR with empty strings in required fields
    ✓ should validate all valid file change types
    ✓ should validate all valid risk impact levels
    ✓ should validate all valid KPI targets
    ✓ should validate both createdBy values
    ✓ should accept ISO datetime strings in metadata
    ✓ should reject invalid datetime strings
  canonicalizeChangeRequest
    ✓ should produce stable output for evidence reordering
    ✓ should sort file_snippet evidence by repo, branch, path, startLine
    ✓ should sort github_issue and github_pr by repo and number
    ✓ should sort afu9_artifact by artifactType and artifactId
    ✓ should preserve user order for acceptanceCriteria
    ✓ should preserve user order for tests
    ✓ should preserve user order for rollout steps
    ✓ should not mutate original CR
  canonicalizeChangeRequestToJSON
    ✓ should produce identical JSON for semantically identical CRs with different key orders
    ✓ should produce deterministic JSON with sorted object keys
  Version Validation
    ✓ should accept allowed CR version
    ✓ should reject disallowed CR version
    ✓ should have active versions registry
  Strict Mode
    ✓ should reject CR with additional unknown properties
    ✓ should accept CR with exactly the defined properties

Test Suites: 1 passed, 1 total
Tests:       29 passed, 29 total
\`\`\`

## Acceptance Criteria - ALL MET ✅

1. ✅ CR schema exists, versioned (0.7.0), strict, with required fields
2. ✅ Tests green: **29/29 tests passing** (added 7 new tests)
3. ✅ Schema includes all required components:
   - ✅ Canonical ID
   - ✅ Acceptance Criteria (enforced min 1)
   - ✅ Tests (enforced min 1 in required array)
   - ✅ Risks with impact levels
   - ✅ Rollout with steps and rollback plan
   - ✅ Evidence (enforced min 1, reuses UsedSourcesSchema)
4. ✅ Canonical serialization implemented with stable evidence ordering
5. ✅ **NEW**: Canonical JSON string generation with recursive key sorting
6. ✅ **NEW**: Strict mode enabled (`.strict()`)
7. ✅ **NEW**: Version registry validation
8. ✅ Example minimal valid CR provided
9. ✅ PowerShell commands documented and verified
10. ✅ **NEW**: Documentation moved to `docs/` directory

## Files Changed

1. `control-center/src/lib/schemas/changeRequest.ts` - Main schema (new)
2. `control-center/__tests__/lib/schemas/changeRequest.test.ts` - Comprehensive tests (new)
3. `docs/E74_1_IMPLEMENTATION_SUMMARY.md` - Implementation documentation (new)

## Next Steps (E75.* - Out of Scope)

This implementation deliberately does NOT include:
- GitHub issue creation
- Integration with INTENT workflow
- CR persistence/storage
- CR validation API endpoints

These are planned for future issues as specified in the requirements.
