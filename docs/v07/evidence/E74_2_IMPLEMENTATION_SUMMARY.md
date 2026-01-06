# E74.2: CR Validator Library + Standard Error Format

## Overview

Implemented a reusable CR validator library that validates CR JSON (I741) and returns standardized, deterministic error results for both UI and CI usage.

## Location

- **Validator Module**: `control-center/src/lib/validators/changeRequestValidator.ts`
- **Tests**: `control-center/__tests__/lib/validators/changeRequestValidator.test.ts`
- **CLI Script**: `scripts/validate-cr.ts`

## Validator API

### `validateChangeRequest(crJson, options?)`

Validates a Change Request JSON object and returns a standardized result.

#### Parameters

- `crJson: unknown` - The CR JSON object to validate
- `options?: object` - Optional validation options
  - `allowedRepos?: Array<{ owner: string; repo: string }>` - Allowlist of repositories
  - `allowedBranches?: string[]` - Allowlist of branches

#### Returns: `ValidationResult`

```typescript
interface ValidationResult {
  ok: boolean;              // True if no errors, false otherwise
  errors: ValidationError[];   // Array of validation errors (sorted)
  warnings: ValidationError[]; // Array of warnings (sorted)
  meta: ValidationMeta;        // Validation metadata
}

interface ValidationError {
  code: string;                    // Error code (e.g., "CR_SCHEMA_INVALID")
  message: string;                 // Human-readable message
  path: string;                    // JSON pointer (e.g., "/title")
  severity: "error" | "warn";      // Severity level
  details?: Record<string, unknown>; // Optional additional details
}

interface ValidationMeta {
  crVersion?: string;          // CR version from validated object
  validatedAt: string;         // ISO 8601 timestamp
  validatorVersion: string;    // Validator version (0.7.0)
  lawbookVersion?: string | null; // Lawbook version from CR
  hash?: string;               // SHA256 hash of canonical CR JSON
}
```

## Validation Layers

### Layer 1: Schema Validation (Zod)
- Validates against `ChangeRequestSchema` from E74.1
- Checks all required fields and types
- Enforces strict mode (no additional properties)

### Layer 2: Semantic Validation
- **Minimum counts** (redundant with schema, but explicit):
  - `acceptanceCriteria`: min 1 → `CR_AC_MISSING`
  - `tests.required`: min 1 → `CR_TESTS_MISSING`
  - `evidence`: min 1 → `CR_EVIDENCE_MISSING`
  
- **Size limits**:
  - `title`: max 120 chars → `CR_SIZE_LIMIT`
  - `motivation`: max 5000 chars → `CR_SIZE_LIMIT`
  - `changes.files`: max 100 entries → `CR_SIZE_LIMIT`
  - `evidence`: max 50 entries → `CR_SIZE_LIMIT`
  
- **Path validation** → `CR_PATH_INVALID`:
  - No `..` (directory traversal)
  - No backslashes (use forward slashes)
  - No absolute paths (starting with `/`)

### Layer 3: Policy Validation (Optional)
- **Repository allowlist**: If `options.allowedRepos` is provided, validates that `targets.repo` is in the allowlist → `CR_TARGET_NOT_ALLOWED` (error)
- **Branch allowlist**: If `options.allowedBranches` is provided, validates that `targets.branch` is in the allowlist → `CR_TARGET_NOT_ALLOWED` (warning)
- **Lawbook version check**: Warns if `constraints.lawbookVersion` is not present → `CR_LAWBOOK_VERSION_MISSING` (warning)

## Error Codes

| Code | Description |
|------|-------------|
| `CR_SCHEMA_INVALID` | Schema validation failed (Zod error) |
| `CR_SEMANTIC_INVALID` | Semantic validation failed (generic) |
| `CR_EVIDENCE_MISSING` | No evidence entries provided |
| `CR_TESTS_MISSING` | No required tests specified |
| `CR_AC_MISSING` | No acceptance criteria provided |
| `CR_SIZE_LIMIT` | Field exceeds size limit |
| `CR_PATH_INVALID` | File path contains forbidden pattern |
| `CR_TARGET_NOT_ALLOWED` | Target repo/branch not in allowlist |
| `CR_LAWBOOK_VERSION_MISSING` | lawbookVersion not specified (warning) |
| `CR_HASH_FAILED` | Failed to generate hash (warning) |

## Deterministic Output

- **Errors and warnings are sorted** by:
  1. Path (alphabetically)
  2. Code (alphabetically)
- **Hash generation**: SHA256 of canonical CR JSON (using `canonicalizeChangeRequestToJSON`)
- **Stable results**: Same CR always produces identical validation result

## Example Output

### Valid CR

```json
{
  "ok": true,
  "errors": [],
  "warnings": [
    {
      "code": "CR_LAWBOOK_VERSION_MISSING",
      "message": "lawbookVersion is not specified in constraints",
      "path": "/constraints/lawbookVersion",
      "severity": "warn"
    }
  ],
  "meta": {
    "crVersion": "0.7.0",
    "validatedAt": "2026-01-01T12:00:00.000Z",
    "validatorVersion": "0.7.0",
    "lawbookVersion": null,
    "hash": "abc123..."
  }
}
```

### Invalid CR

```json
{
  "ok": false,
  "errors": [
    {
      "code": "CR_SIZE_LIMIT",
      "message": "Title exceeds maximum length of 120 characters",
      "path": "/title",
      "severity": "error",
      "details": {
        "limit": 120,
        "actual": 145
      }
    },
    {
      "code": "CR_PATH_INVALID",
      "message": "File path contains forbidden pattern (no \"..\", backslashes, or absolute paths): ../../../etc/passwd",
      "path": "/changes/files/0/path",
      "severity": "error",
      "details": {
        "invalidPath": "../../../etc/passwd"
      }
    }
  ],
  "warnings": [],
  "meta": {
    "crVersion": "0.7.0",
    "validatedAt": "2026-01-01T12:00:00.000Z",
    "validatorVersion": "0.7.0",
    "lawbookVersion": null,
    "hash": "def456..."
  }
}
```

## CLI Usage

The CLI validator accepts a CR JSON file path and outputs the validation result.

### PowerShell Commands

```powershell
# Validate a CR JSON file
npx ts-node --transpile-only scripts/validate-cr.ts path/to/cr.json

# Example with valid CR (exit code 0)
npx ts-node --transpile-only scripts/validate-cr.ts examples/valid-cr.json

# Example with invalid CR (exit code 1)
npx ts-node --transpile-only scripts/validate-cr.ts examples/invalid-cr.json

# Capture exit code
npx ts-node --transpile-only scripts/validate-cr.ts my-cr.json
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ CR is valid"
} else {
    Write-Host "❌ CR has errors"
}
```

### Exit Codes

- `0` - Validation passed (`ok: true`)
- `1` - Validation failed (`ok: false`)
- `2` - CLI error (invalid usage, file not found, etc.)

## Usage Examples

### TypeScript/JavaScript

```typescript
import { validateChangeRequest } from '@/lib/validators/changeRequestValidator';

// Basic validation
const result = validateChangeRequest(crJson);
if (!result.ok) {
  console.error('Validation errors:', result.errors);
}

// With policy checks
const result = validateChangeRequest(crJson, {
  allowedRepos: [
    { owner: 'adaefler-art', repo: 'codefactory-control' }
  ],
  allowedBranches: ['main', 'develop']
});

// Access metadata
console.log('Validated at:', result.meta.validatedAt);
console.log('CR hash:', result.meta.hash);
```

### API Endpoint

```typescript
// Example API route using the validator
import { NextRequest, NextResponse } from 'next/server';
import { validateChangeRequest } from '@/lib/validators/changeRequestValidator';

export async function POST(request: NextRequest) {
  const crJson = await request.json();
  
  const result = validateChangeRequest(crJson);
  
  return NextResponse.json(result, { 
    status: result.ok ? 200 : 400 
  });
}
```

## Test Coverage

**34 tests passing**, covering:

- ✅ Valid CR validation (ok: true)
- ✅ Schema validation errors (Layer 1)
- ✅ Semantic validation:
  - ✅ Size limit violations (title, motivation, files, evidence)
  - ✅ Path validation (forbidden patterns: `..`, `\`, `/`)
  - ✅ Minimum counts (AC, tests, evidence)
- ✅ Policy validation:
  - ✅ Repository allowlist (error if not allowed)
  - ✅ Branch allowlist (warning if not allowed)
- ✅ Deterministic error ordering (stable sorted output)
- ✅ Metadata validation (version, timestamp, hash)
- ✅ Error format validation (code, message, path, severity, details)

### Run Tests

```powershell
# Run validator tests only
npm --prefix control-center test -- changeRequestValidator.test.ts

# Run all control-center tests
npm --prefix control-center test

# Run tests in watch mode
npm --prefix control-center test -- --watch changeRequestValidator.test.ts
```

## Build and Verification

```powershell
# Run repository verification (includes linting, route checks, etc.)
npm run repo:verify

# Build control-center
npm --prefix control-center run build

# Run all tests
npm --prefix control-center test
```

## Integration Points

### UI Usage
```typescript
// In a React component or API route
import { validateChangeRequest } from '@/lib/validators/changeRequestValidator';

function validateAndSubmitCR(crData: unknown) {
  const result = validateChangeRequest(crData);
  
  if (!result.ok) {
    // Display errors to user
    return { success: false, errors: result.errors };
  }
  
  // Proceed with submission
  return { success: true, hash: result.meta.hash };
}
```

### CI/CD Usage
```yaml
# Example GitHub Actions workflow
- name: Validate CR JSON
  run: |
    npx ts-node --transpile-only scripts/validate-cr.ts cr-output.json
  # Fails workflow if CR is invalid (exit code 1)
```

## Acceptance Criteria - COMPLETE ✅

- ✅ Library easily usable by UI/API
- ✅ Deterministic error output with stable sorting
- ✅ SHA256 hash generation for canonical CR JSON
- ✅ Standard error format with codes, messages, paths, severity
- ✅ Multi-layer validation (schema, semantic, policy)
- ✅ CLI entrypoint with exit codes
- ✅ No network calls (pure validation)
- ✅ Tests green: **34/34 tests passing**
- ✅ Build and verification passing
- ✅ PowerShell commands documented

## Non-Negotiables - VERIFIED ✅

- ✅ **Deterministic validation output**: Stable error ordering by path then code
- ✅ **Standard error format**: Used across all validation layers
- ✅ **No network calls**: Pure validation logic only
- ✅ **Policy checks beyond schema**: Size limits, path validation, allowlists
- ✅ **PowerShell snippets**: Provided for CLI validation

## Version

- **Validator Version**: `0.7.0`
- **Compatible CR Version**: `0.7.0`
- **Node.js**: Requires ts-node for CLI usage
