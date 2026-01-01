# E74.1: CR JSON Schema v1 Implementation

## Overview

Implemented the ChangeRequest JSON Schema v1 as a deterministic, strict contract for turning INTENT conversations into implementable work.

## Location

- **Schema Module**: `control-center/src/lib/schemas/changeRequest.ts`
- **Tests**: `control-center/__tests__/lib/schemas/changeRequest.test.ts`

## Exported Types and Functions

- `ChangeRequestSchema` - Main Zod schema for CR validation (strict mode enabled)
- `ChangeRequest` - TypeScript type inferred from schema
- `canonicalizeChangeRequest(cr)` - Function to canonicalize CR object with sorted evidence
- `canonicalizeChangeRequestToJSON(cr)` - Function to serialize CR to canonical JSON string with stable key ordering
- `EXAMPLE_MINIMAL_CR` - Example minimal valid CR JSON
- `ACTIVE_CR_VERSIONS` - Registry of allowed schema versions
- All sub-schemas (scope, targets, changes, tests, risks, rollout, etc.)

## Schema Version

- Current version: **0.7.0**
- Active versions registry: `ACTIVE_CR_VERSIONS = ['0.7.0']`
- Version validation enforced via `z.enum(ACTIVE_CR_VERSIONS)`

## Key Features

### Strict Mode
- ✅ Schema uses `.strict()` - no additional properties allowed
- ✅ Rejects any CR with unknown fields

### Required Fields (enforced by schema)
- ✅ `acceptanceCriteria` - minimum 1 entry
- ✅ `tests.required` - minimum 1 entry
- ✅ `evidence` - minimum 1 entry (reuses `UsedSourcesSchema`)
- ✅ Valid `changeType` enum: `create`, `modify`, `delete`
- ✅ Valid `crVersion` - must be in `ACTIVE_CR_VERSIONS`

### Canonical Serialization
- **Evidence array** is sorted deterministically for hashing (by kind, then key fields)
- **Object keys** are sorted alphabetically (recursively) for deterministic JSON strings
- **User-provided order** preserved for:
  - `acceptanceCriteria`
  - `tests.required`, `tests.addedOrUpdated`, `tests.manual`
  - `rollout.steps`

### Two Canonicalization Functions
1. `canonicalizeChangeRequest(cr)` - Returns CR object with sorted evidence
2. `canonicalizeChangeRequestToJSON(cr)` - Returns canonical JSON string with stable key ordering for hashing/comparison

### Evidence Integration
- Reuses `UsedSourcesSchema` from existing `usedSources.ts`
- Supports: `file_snippet`, `github_issue`, `github_pr`, `afu9_artifact`

## Example Minimal Valid CR JSON

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
    "repo": {
      "owner": "adaefler-art",
      "repo": "codefactory-control"
    },
    "branch": "main",
    "components": ["control-center"]
  },
  "changes": {
    "files": [
      {
        "path": "control-center/src/app/api/example/route.ts",
        "changeType": "create",
        "rationale": "New API endpoint for example feature"
      }
    ]
  },
  "acceptanceCriteria": [
    "API endpoint responds with 200 status",
    "Response includes required fields"
  ],
  "tests": {
    "required": ["npm test"]
  },
  "risks": {
    "items": [
      {
        "risk": "API performance degradation",
        "impact": "low",
        "mitigation": "Implement caching and rate limiting"
      }
    ]
  },
  "rollout": {
    "steps": [
      "Deploy to staging",
      "Run integration tests",
      "Deploy to production"
    ],
    "rollbackPlan": "Revert to previous deployment via GitHub Actions"
  },
  "evidence": [
    {
      "kind": "github_issue",
      "repo": {
        "owner": "adaefler-art",
        "repo": "codefactory-control"
      },
      "number": 741,
      "title": "E74.1: CR JSON Schema v1"
    }
  ],
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

## PowerShell Validation Commands

### Run Tests
\`\`\`powershell
# Run CR schema tests only
npm --prefix control-center test -- changeRequest.test.ts

# Run all tests
npm --prefix control-center test
\`\`\`

### Build
\`\`\`powershell
# Build the control-center
npm --prefix control-center run build
\`\`\`

### Verify Repository
\`\`\`powershell
# Run repository verification (if available)
npm run repo:verify
\`\`\`

## Test Coverage

29 tests covering:
- ✅ Minimal valid CR validation
- ✅ Full CR with all optional fields
- ✅ Rejection of missing `acceptanceCriteria`
- ✅ Rejection of missing `tests.required`
- ✅ Rejection of missing `evidence`
- ✅ Rejection of invalid `changeType`
- ✅ All enum validations (file change types, risk impact, KPI targets, createdBy)
- ✅ Canonical serialization stability
- ✅ Evidence ordering (deterministic sort)
- ✅ Preservation of user order for AC/tests/rollout
- ✅ **NEW**: Canonical JSON string generation with stable key ordering
- ✅ **NEW**: Version validation (allowed vs disallowed versions)
- ✅ **NEW**: Strict mode enforcement (rejects unknown properties)

## Usage Example

\`\`\`typescript
import { 
  ChangeRequestSchema, 
  canonicalizeChangeRequest, 
  canonicalizeChangeRequestToJSON,
  EXAMPLE_MINIMAL_CR,
  ACTIVE_CR_VERSIONS
} from '@/lib/schemas/changeRequest';

// Validate a CR (strict mode enforced)
const cr = ChangeRequestSchema.parse(crData);

// Canonicalize for hashing (object with sorted evidence)
const canonical = canonicalizeChangeRequest(cr);

// Get canonical JSON string (sorted keys + evidence)
const canonicalJSON = canonicalizeChangeRequestToJSON(cr);

// Hash the canonical JSON
const hash = sha256(canonicalJSON);

// Check active versions
console.log(ACTIVE_CR_VERSIONS); // ['0.7.0']
\`\`\`

## Acceptance Criteria - COMPLETE ✅

- ✅ CR schema exists, versioned (0.7.0), strict, with required fields
- ✅ Tests green: **29/29 tests passing** (was 22, added 7 new tests)
- ✅ Schema includes all required fields:
  - ✅ Canonical ID
  - ✅ Acceptance Criteria (min 1)
  - ✅ Tests (min 1 required)
  - ✅ Risks
  - ✅ Rollout
  - ✅ Evidence (min 1)
- ✅ Canonical serialization with stable evidence ordering
- ✅ **NEW**: Canonical JSON string generation with recursive key sorting
- ✅ **NEW**: Strict mode enabled (`.strict()`)
- ✅ **NEW**: Version registry (`ACTIVE_CR_VERSIONS`) with validation
- ✅ Reuses existing `UsedSourcesSchema` for evidence
- ✅ Example minimal valid CR provided
- ✅ PowerShell commands documented
- ✅ **NEW**: Output file moved to `docs/` directory

## Build Status

- ✅ **Tests**: 29/29 passing for CR schema
- ⚠️ **Full test suite**: 5 test suites failing (pre-existing, unrelated to CR schema - missing `@codefactory/verdict-engine`)
- ⚠️ **Build**: Fails due to pre-existing issue (missing `@codefactory/verdict-engine`), not related to CR schema changes
