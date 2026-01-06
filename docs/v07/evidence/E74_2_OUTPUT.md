# E74.2: CR Validator Library - API Output Specification

## Validator API Signature

```typescript
/**
 * Validate a Change Request JSON object
 * 
 * @param crJson - The CR JSON object to validate (unknown type for flexibility)
 * @param options - Optional validation options
 * @returns ValidationResult with ok status, errors, warnings, and metadata
 */
function validateChangeRequest(
  crJson: unknown,
  options?: {
    allowedRepos?: Array<{ owner: string; repo: string }>;
    allowedBranches?: string[];
  }
): ValidationResult;

// Return type definition
interface ValidationResult {
  ok: boolean;                 // True if no errors, false otherwise
  errors: ValidationError[];   // Array of validation errors (sorted)
  warnings: ValidationError[]; // Array of warnings (sorted)
  meta: ValidationMeta;        // Validation metadata
}

interface ValidationError {
  code: string;                    // Error code (e.g., "CR_SCHEMA_INVALID")
  message: string;                 // Human-readable message
  path: string;                    // JSON pointer (e.g., "/title" or "/changes/files/0/path")
  severity: "error" | "warn";      // Severity level
  details?: Record<string, unknown>; // Optional additional details
}

interface ValidationMeta {
  crVersion?: string;          // CR version from validated object (e.g., "0.7.0")
  validatedAt: string;         // ISO 8601 timestamp (e.g., "2026-01-01T12:00:00.000Z")
  validatorVersion: string;    // Validator version (e.g., "0.7.0")
  lawbookVersion?: string | null; // Lawbook version from CR (if present)
  hash?: string;               // SHA256 hash of canonical CR JSON (if valid)
}
```

## Example Output: Valid CR

### Input
A minimal valid CR following the schema from E74.1.

### Output JSON
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
    "validatedAt": "2026-01-01T12:57:00.000Z",
    "validatorVersion": "0.7.0",
    "lawbookVersion": null,
    "hash": "84fd81c355cf1ff3e92462d6bfb28b4b5d904307951566ae4eddb80e37e3fa78"
  }
}
```

### Key Points
- `ok: true` indicates validation passed
- Empty `errors` array means no blocking issues
- One warning about missing lawbookVersion (non-blocking)
- `hash` is a deterministic SHA256 of the canonical CR JSON
- All timestamps are ISO 8601 format

## Example Output: Invalid CR (Multiple Errors)

### Input
A CR with multiple validation errors:
- Title exceeds 120 characters
- File path contains forbidden pattern `..`
- Missing required fields

### Output JSON
```json
{
  "ok": false,
  "errors": [
    {
      "code": "CR_PATH_INVALID",
      "message": "File path contains forbidden pattern (no \"..\", backslashes, or absolute paths): ../../../etc/passwd",
      "path": "/changes/files/0/path",
      "severity": "error",
      "details": {
        "invalidPath": "../../../etc/passwd"
      }
    },
    {
      "code": "CR_SIZE_LIMIT",
      "message": "Title exceeds maximum length of 120 characters",
      "path": "/title",
      "severity": "error",
      "details": {
        "limit": 120,
        "actual": 145
      }
    }
  ],
  "warnings": [],
  "meta": {
    "crVersion": "0.7.0",
    "validatedAt": "2026-01-01T12:57:00.000Z",
    "validatorVersion": "0.7.0",
    "lawbookVersion": null,
    "hash": "f8e9a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0"
  }
}
```

### Key Points
- `ok: false` indicates validation failed
- Errors are **sorted deterministically** by path, then by code
- Each error includes:
  - `code`: Standardized error code
  - `message`: Human-readable description
  - `path`: JSON pointer to the problematic field
  - `severity`: Always "error" for blocking issues
  - `details`: Additional context (limit values, invalid data, etc.)

## Example Output: Schema Validation Failure

### Input
Invalid CR JSON missing many required fields.

### Output JSON
```json
{
  "ok": false,
  "errors": [
    {
      "code": "CR_SCHEMA_INVALID",
      "message": "Invalid input: expected array, received undefined",
      "path": "/acceptanceCriteria",
      "severity": "error",
      "details": {
        "zodCode": "invalid_type"
      }
    },
    {
      "code": "CR_SCHEMA_INVALID",
      "message": "Invalid input: expected string, received undefined",
      "path": "/canonicalId",
      "severity": "error",
      "details": {
        "zodCode": "invalid_type"
      }
    },
    {
      "code": "CR_SCHEMA_INVALID",
      "message": "Invalid input: expected object, received undefined",
      "path": "/changes",
      "severity": "error",
      "details": {
        "zodCode": "invalid_type"
      }
    },
    {
      "code": "CR_SCHEMA_INVALID",
      "message": "Invalid input: expected object, received undefined",
      "path": "/constraints",
      "severity": "error",
      "details": {
        "zodCode": "invalid_type"
      }
    }
  ],
  "warnings": [],
  "meta": {
    "validatedAt": "2026-01-01T12:57:00.000Z",
    "validatorVersion": "0.7.0"
  }
}
```

### Key Points
- Schema errors all use `CR_SCHEMA_INVALID` code
- `details.zodCode` provides the underlying Zod error type
- `meta.crVersion` and `meta.hash` are absent because schema validation failed
- Multiple errors are sorted alphabetically by path

## Example Output: Policy Violation

### Input
A valid CR targeting a repository not in the allowlist.

### Output JSON
```json
{
  "ok": false,
  "errors": [
    {
      "code": "CR_TARGET_NOT_ALLOWED",
      "message": "Target repository test-org/test-repo is not in the allowed list",
      "path": "/targets/repo",
      "severity": "error",
      "details": {
        "targetRepo": {
          "owner": "test-org",
          "repo": "test-repo"
        }
      }
    }
  ],
  "warnings": [],
  "meta": {
    "crVersion": "0.7.0",
    "validatedAt": "2026-01-01T12:57:00.000Z",
    "validatorVersion": "0.7.0",
    "lawbookVersion": "1.0.0",
    "hash": "c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5"
  }
}
```

### Key Points
- Policy violations use `CR_TARGET_NOT_ALLOWED` code
- `details` includes the actual target that caused the violation
- Hash is still generated even though policy check failed
- Useful for CI/CD pipelines with repository restrictions

## PowerShell Commands

### Run CLI Validator
```powershell
# Validate a CR JSON file
npx ts-node --transpile-only scripts/validate-cr.ts path/to/cr.json

# With explicit path
npx ts-node --transpile-only scripts/validate-cr.ts C:\projects\cr-files\my-cr.json

# Capture and check exit code
npx ts-node --transpile-only scripts/validate-cr.ts my-cr.json
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ CR is valid" -ForegroundColor Green
} else {
    Write-Host "❌ CR validation failed" -ForegroundColor Red
}

# Save output to file
npx ts-node --transpile-only scripts/validate-cr.ts my-cr.json > validation-result.json
```

### Run Tests
```powershell
# Run only the CR validator tests
npm --prefix control-center test -- changeRequestValidator.test.ts

# Run all control-center tests
npm --prefix control-center test

# Run tests in watch mode
npm --prefix control-center test -- --watch changeRequestValidator.test.ts
```

### Build and Verify
```powershell
# Run repository verification (includes linting, route checks, etc.)
npm run repo:verify

# Build control-center
npm --prefix control-center run build

# Full CI/CD verification sequence
npm run repo:verify
npm --prefix control-center test
npm --prefix control-center run build
```

### Integration Example (PowerShell CI Script)
```powershell
# Example CI script using the validator
$crFile = "output/generated-cr.json"

Write-Host "Validating Change Request..." -ForegroundColor Cyan

# Run validator and capture output
$validationOutput = npx ts-node --transpile-only scripts/validate-cr.ts $crFile 2>&1 | Out-String
$exitCode = $LASTEXITCODE

# Parse JSON output
$result = $validationOutput | ConvertFrom-Json

if ($exitCode -eq 0) {
    Write-Host "✅ CR validation passed" -ForegroundColor Green
    Write-Host "   Hash: $($result.meta.hash)" -ForegroundColor Gray
    Write-Host "   Warnings: $($result.warnings.Count)" -ForegroundColor Yellow
    
    # Proceed with CR submission
    # Submit-CR -Hash $result.meta.hash -CrFile $crFile
} else {
    Write-Host "❌ CR validation failed with $($result.errors.Count) error(s)" -ForegroundColor Red
    
    # Print errors
    foreach ($error in $result.errors) {
        Write-Host "   [$($error.code)] $($error.path): $($error.message)" -ForegroundColor Red
    }
    
    # Fail the pipeline
    exit 1
}
```

## Error Code Reference

| Code | Severity | Meaning | Remediation |
|------|----------|---------|-------------|
| `CR_SCHEMA_INVALID` | error | Failed Zod schema validation | Fix the field indicated in `path` to match the schema |
| `CR_SIZE_LIMIT` | error | Field exceeds maximum size | Reduce size; see `details.limit` and `details.actual` |
| `CR_PATH_INVALID` | error | File path contains forbidden pattern | Remove `..`, `\`, or leading `/` from paths |
| `CR_EVIDENCE_MISSING` | error | No evidence entries | Add at least one evidence entry |
| `CR_TESTS_MISSING` | error | No required tests | Add at least one required test |
| `CR_AC_MISSING` | error | No acceptance criteria | Add at least one acceptance criterion |
| `CR_TARGET_NOT_ALLOWED` | error/warn | Target repo/branch not allowed | Use an allowed repository or branch |
| `CR_LAWBOOK_VERSION_MISSING` | warn | lawbookVersion not specified | Add `constraints.lawbookVersion` |
| `CR_HASH_FAILED` | warn | Hash generation failed | Review CR structure; non-blocking |

## Determinism Guarantees

1. **Error Ordering**: Errors and warnings are always sorted by:
   - Primary: `path` (alphabetically)
   - Secondary: `code` (alphabetically)

2. **Hash Stability**: The same CR input always produces the same hash (using canonical JSON serialization from E74.1)

3. **Timestamp Format**: `validatedAt` is always ISO 8601 format with milliseconds

4. **Version Tracking**: `validatorVersion` increments on breaking changes to validation logic

## Usage in Different Contexts

### UI/Frontend
```typescript
import { validateChangeRequest } from '@/lib/validators/changeRequestValidator';

function handleCRSubmission(crData: unknown) {
  const result = validateChangeRequest(crData);
  
  if (!result.ok) {
    // Display errors to user in a friendly format
    showErrors(result.errors);
    return;
  }
  
  // Proceed with submission, including hash for verification
  submitCR(crData, result.meta.hash);
}
```

### API Endpoint
```typescript
export async function POST(request: Request) {
  const crJson = await request.json();
  const result = validateChangeRequest(crJson, {
    allowedRepos: await getAllowedRepos(),
    allowedBranches: ['main', 'develop']
  });
  
  return Response.json(result, { 
    status: result.ok ? 200 : 400 
  });
}
```

### CI/CD Pipeline
```bash
# Bash example
npx ts-node --transpile-only scripts/validate-cr.ts output/cr.json
if [ $? -eq 0 ]; then
  echo "✅ Validation passed"
  # Continue pipeline
else
  echo "❌ Validation failed"
  exit 1
fi
```

## Version Compatibility

- **Validator Version**: `0.7.0`
- **Compatible CR Versions**: `0.7.0` (from `ACTIVE_CR_VERSIONS`)
- **Node.js**: Requires Node.js 18+ and ts-node for TypeScript execution
- **Dependencies**: Zod 4.x, Node.js crypto module

---

**Implementation**: E74.2  
**Dependencies**: E74.1 (CR JSON Schema v1)  
**Status**: Complete ✅
