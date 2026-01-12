# E84.2 Implementation Summary

## Overview

Successfully implemented the Deterministischer Copilot Prompt Generator as specified in issue E84.2. The implementation provides automatic generation of evidence-based, deterministic prompts for GitHub Copilot to fix check failures.

## Implementation Details

### 1. Type Definitions

**File**: `control-center/src/lib/types/checks-triage.ts`

Added the following type definitions:

- `PromptAttachmentsSchema`: Attachments with evidence URLs and excerpt hashes
- `CopilotPromptV1Schema`: Complete prompt schema (v1.0)
- `CopilotPromptInputSchema`: Input schema for prompt generation

All schemas use Zod for runtime validation and type safety.

### 2. Core Service

**File**: `control-center/src/lib/github/copilot-prompt-generator.ts`

Implemented the following components:

#### Secret Redaction Layer

- Redacts GitHub tokens (ghp_, gho_, ghs_, ghu_, ghr_)
- Redacts AWS credentials (AKIA*, AWS_SECRET_ACCESS_KEY)
- Redacts API keys in URLs
- Redacts Bearer tokens (JWT format)
- Redacts NPM tokens
- Function: `redactSecrets(text: string): string`

#### Template System

Provides specialized templates for each failure class:

1. **Lint Template**: Focus on code style, minimal changes
2. **Test Template**: Fix code not tests, no test removal
3. **Build Template**: Fix compilation errors, proper type usage
4. **E2E Template**: Fix user-facing functionality
5. **Infra Template**: CDK/Terraform fixes or manual steps
6. **Deploy Template**: Deployment script fixes or documentation
7. **Unknown Template**: Investigation and root cause analysis

Each template includes:
- Contextual description
- Specific instructions
- PowerShell verify steps
- Done definition criteria

#### File Hint Extraction

- Extracts file paths from error messages and stack traces
- Filters out `node_modules` and HTTP URLs
- Returns sorted, unique file list
- Respects `maxFiles` constraint

#### Prompt Generation

- **Function**: `generateCopilotPrompt(input: CopilotPromptInput): Promise<CopilotPromptV1>`
- Deterministic template selection based on `failureClass`
- Stable ordering of evidence (sorted URLs and hashes)
- Automatic secret redaction
- Markdown-formatted output

#### Hash Function

- **Function**: `hashPrompt(prompt: CopilotPromptV1): string`
- SHA256-based deterministic hashing
- Excludes non-deterministic fields (requestId)
- Normalizes arrays by sorting
- Returns 16-character hash

### 3. API Route

**File**: `control-center/app/api/github/prs/[prNumber]/checks/prompt/route.ts`

Implements: `GET /api/github/prs/{prNumber}/checks/prompt`

**Query Parameters**:
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `workflowRunId` (optional): Specific workflow run
- `maxLogBytes` (optional): Max log excerpt size (default: 65536)
- `maxSteps` (optional): Max steps to analyze (default: 50)
- `maxFiles` (optional): Max files to suggest (default: 5)

**Response Codes**:
- `200`: Success - returns CopilotPromptV1
- `400`: Invalid input parameters
- `401`: Authentication required
- `403`: Repository access denied
- `404`: PR not found
- `409`: No failures found (conflict - nothing to fix)
- `500`: Internal server error

**Flow**:
1. Validate input parameters
2. Generate checks triage report (E84.1)
3. Check for failures (return 409 if none)
4. Generate copilot prompt
5. Return prompt with proper headers

### 4. Tests

#### Unit Tests for Generator

**File**: `control-center/__tests__/lib/copilot-prompt-generator.test.ts`

**Coverage**: 26 tests

- **Secret Redaction Tests** (9 tests):
  - GitHub tokens (ghp_, gho_, ghs_)
  - AWS access keys and secret keys
  - URL parameters (token, api_key, etc.)
  - Bearer tokens
  - NPM tokens
  - Multiple secrets in one text
  - Text without secrets

- **Prompt Generation Tests** (11 tests):
  - Template for each failure class (7 classes)
  - File hint extraction
  - File limit enforcement
  - Secret redaction in prompts
  - Required fields validation
  - Evidence sorting for determinism

- **Hash Function Tests** (4 tests):
  - Consistent hashing for same input
  - Different hashes for different inputs
  - RequestId exclusion from hash
  - Array sorting normalization

- **Determinism Tests** (2 tests):
  - Identical output for identical input
  - Hash stability verification

#### API Route Tests

**File**: `control-center/__tests__/api/github-prs-checks-prompt.test.ts`

**Coverage**: 8 tests

- Invalid PR number handling (400)
- Missing owner parameter (400)
- Missing repo parameter (400)
- No failures found (409)
- Successful prompt generation (200)
- Custom maxFiles parameter
- Request ID in headers
- Error handling (500)

### 5. Documentation

**File**: `docs/E84_2_COPILOT_PROMPT_USAGE.md`

Comprehensive usage documentation including:
- API endpoint reference
- PowerShell examples
- Failure class template descriptions
- Security features (redaction)
- Determinism guarantees
- Example prompt structure
- Error handling reference
- Integration with E84.1
- Testing instructions

## Acceptance Criteria Verification

### ✅ Per Failure Class Templates

All 7 failure classes have dedicated templates:
- `lint`: Linting-specific instructions and verify steps
- `test`: Test failure guidance
- `build`: Build/compilation error fixes
- `e2e`: End-to-end test fixes
- `infra`: Infrastructure issue handling
- `deploy`: Deployment failure resolution
- `unknown`: Investigation guidance

### ✅ Determinism

- Template selection based purely on `failure.type`
- Stable evidence ordering (sorted arrays)
- Deterministic hash function
- Identical input → identical output hash

### ✅ Required Content

Each prompt includes:
- ✅ Context (repo, PR, headSha)
- ✅ Observed failures (names + excerpts)
- ✅ Strict instructions (minimal diff, tests, deterministic)
- ✅ File touch hints (from failing paths)
- ✅ Verify commands (PowerShell)
- ✅ No secrets (redaction layer)

### ✅ Guardrails

- Status codes: 401 → 409 → 403 (no external writes)
- Redaction for tokens, keys, secrets
- Input validation via Zod schemas

### ✅ Testing

- ✅ Snapshot tests per failure class (7 classes tested)
- ✅ Redaction tests for common patterns (9 tests)
- ✅ Deterministic hash stability (4 tests)
- ✅ API endpoint tests (8 tests)
- **Total: 34 tests, all passing**

### ✅ PowerShell Verification

Example command provided:
```powershell
Invoke-RestMethod "$base/api/github/prs/$pr/checks/prompt?owner=$owner&repo=$repo" | ConvertTo-Json -Depth 10
```

## Files Created/Modified

### Created Files (5):

1. `control-center/src/lib/github/copilot-prompt-generator.ts` (445 lines)
2. `control-center/app/api/github/prs/[prNumber]/checks/prompt/route.ts` (196 lines)
3. `control-center/__tests__/lib/copilot-prompt-generator.test.ts` (572 lines)
4. `control-center/__tests__/api/github-prs-checks-prompt.test.ts` (276 lines)
5. `docs/E84_2_COPILOT_PROMPT_USAGE.md` (323 lines)

### Modified Files (1):

1. `control-center/src/lib/types/checks-triage.ts` (+47 lines)

## Test Results

```
PASS __tests__/lib/copilot-prompt-generator.test.ts
  Copilot Prompt Generator
    redactSecrets
      ✓ should redact GitHub personal access tokens
      ✓ should redact multiple GitHub token types
      ✓ should redact AWS access keys
      ✓ should redact AWS secret access keys
      ✓ should redact secrets in URLs
      ✓ should redact Bearer tokens
      ✓ should redact NPM tokens
      ✓ should handle text with no secrets
      ✓ should redact multiple types of secrets in one text
    generateCopilotPrompt
      ✓ should generate prompt for lint failure
      ✓ should generate prompt for test failure
      ✓ should generate prompt for build failure
      ✓ should generate prompt for e2e failure
      ✓ should generate prompt for infra failure
      ✓ should generate prompt for deploy failure
      ✓ should generate prompt for unknown failure
      ✓ should extract file hints from error messages
      ✓ should limit file hints to maxFiles
      ✓ should redact secrets in prompts
      ✓ should include all required fields
      ✓ should sort evidence URLs and hashes for determinism
    hashPrompt
      ✓ should generate consistent hash for same prompt
      ✓ should generate different hash for different prompts
      ✓ should ignore requestId in hash (not part of stable data)
      ✓ should handle unsorted arrays by sorting them
    Determinism
      ✓ should generate identical prompts for identical triage reports

PASS __tests__/api/github-prs-checks-prompt.test.ts
  Copilot Prompt API
    GET /api/github/prs/[prNumber]/checks/prompt
      ✓ should return 400 for invalid PR number
      ✓ should return 400 for missing owner parameter
      ✓ should return 400 for missing repo parameter
      ✓ should return 409 when no failures are found
      ✓ should generate and return prompt for failures
      ✓ should respect custom maxFiles parameter
      ✓ should include x-request-id in response headers
      ✓ should handle errors gracefully

Test Suites: 2 passed, 2 total
Tests:       34 passed, 34 total
```

## Code Quality

- ✅ No linting errors in new files
- ✅ All tests passing
- ✅ TypeScript type safety with Zod validation
- ✅ Comprehensive error handling
- ✅ Proper logging with structured context
- ✅ Security-first design (redaction layer)

## Integration

The implementation integrates seamlessly with E84.1:

```
Checks Triage API (E84.1)
  ↓
  ChecksTriageReportV1
  ↓
Copilot Prompt Generator (E84.2)
  ↓
  CopilotPromptV1
  ↓
GitHub Copilot (manual workflow)
```

## Next Steps

This implementation provides the foundation for:
1. Automated prompt generation in CI/CD workflows
2. Integration with GitHub Copilot chat
3. Self-healing PR workflows
4. Metrics collection on fix success rates

## Conclusion

E84.2 has been successfully implemented with all acceptance criteria met:
- ✅ Deterministic prompt generation
- ✅ Per-failure-class templates
- ✅ Secret redaction
- ✅ Evidence-first approach
- ✅ Comprehensive testing
- ✅ API endpoint with proper error handling
- ✅ Documentation and examples

The implementation is production-ready and follows the codefactory-control architecture patterns for minimal diff, type safety, and testability.
