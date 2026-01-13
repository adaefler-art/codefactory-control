# E84.2: Copilot Prompt Generator - Usage Examples

This document demonstrates how to use the Copilot Prompt Generator API to create deterministic, evidence-based prompts for fixing GitHub PR check failures.

## Overview

The Copilot Prompt Generator (E84.2) takes a checks triage report (from E84.1) and generates a structured prompt that can be used with GitHub Copilot to fix the failures.

## API Endpoint

```
GET /api/github/prs/{prNumber}/checks/prompt
```

### Query Parameters

- `owner` (required): Repository owner
- `repo` (required): Repository name
- `prNumber` (required): Pull request number (in path)
- `workflowRunId` (optional): Specific workflow run ID to analyze
- `maxLogBytes` (optional): Maximum log bytes to extract (default: 65536)
- `maxSteps` (optional): Maximum steps to analyze (default: 50)
- `maxFiles` (optional): Maximum files to suggest (default: 5)

### Response Schema

```typescript
{
  schemaVersion: "1.0",
  requestId: string,
  lawbookHash: string,
  failureClass: "lint" | "test" | "build" | "e2e" | "infra" | "deploy" | "unknown",
  promptText: string,           // Markdown-formatted prompt
  attachments: {
    evidenceUrls: string[],    // Links to failing checks (redacted)
    excerptHashes: string[]    // Hashes of log excerpts
  },
  verifySteps: string[],       // PowerShell commands to verify fixes
  doneDefinition: string[]     // Success criteria
}
```

## PowerShell Examples

### Basic Usage

```powershell
# Get prompt for PR #123
$base = "http://localhost:3000"
$owner = "adaefler-art"
$repo = "codefactory-control"
$pr = 123

$response = Invoke-RestMethod "$base/api/github/prs/$pr/checks/prompt?owner=$owner&repo=$repo"
$response | ConvertTo-Json -Depth 10
```

### Display Prompt Text

```powershell
# Get and display the prompt text
$base = "http://localhost:3000"
$owner = "adaefler-art"
$repo = "codefactory-control"
$pr = 123

$response = Invoke-RestMethod "$base/api/github/prs/$pr/checks/prompt?owner=$owner&repo=$repo"
Write-Host $response.promptText
```

### Limit File Suggestions

```powershell
# Limit file suggestions to 3 files
$base = "http://localhost:3000"
$owner = "adaefler-art"
$repo = "codefactory-control"
$pr = 123

$response = Invoke-RestMethod "$base/api/github/prs/$pr/checks/prompt?owner=$owner&repo=$repo&maxFiles=3"
Write-Host "Failure Class: $($response.failureClass)"
Write-Host "Suggested Verify Steps:"
$response.verifySteps | ForEach-Object { Write-Host "  - $_" }
```

### Extract and Run Verify Steps

```powershell
# Get prompt and extract verify steps
$base = "http://localhost:3000"
$owner = "adaefler-art"
$repo = "codefactory-control"
$pr = 123

$response = Invoke-RestMethod "$base/api/github/prs/$pr/checks/prompt?owner=$owner&repo=$repo"

Write-Host "Generated prompt for $($response.failureClass) failures"
Write-Host "`nVerification Steps:"
$response.verifySteps | ForEach-Object {
    Write-Host "  $_"
}

Write-Host "`nDone Definition:"
$response.doneDefinition | ForEach-Object {
    Write-Host "  - $_"
}
```

## Failure Class Templates

The generator provides specialized templates for each failure class:

### Lint Failures

- **Context**: Linting/code style issues
- **Instructions**: Fix only linting errors, minimal changes
- **Verify**: Runs linter, tests, build
- **Done**: All linting errors resolved

### Test Failures

- **Context**: Unit/integration test failures
- **Instructions**: Identify root cause, don't modify tests unless incorrect
- **Verify**: Runs tests, build
- **Done**: All tests pass, no tests removed

### Build Failures

- **Context**: Compilation/build errors
- **Instructions**: Fix TypeScript/compilation errors
- **Verify**: Runs build, then tests
- **Done**: Build succeeds, no type errors

### E2E Failures

- **Context**: End-to-end test failures
- **Instructions**: Fix user-facing functionality issues
- **Verify**: Runs tests, build
- **Done**: E2E tests pass, workflows function correctly

### Infrastructure Failures

- **Context**: Infrastructure/deployment setup issues
- **Instructions**: Fix CDK/Terraform issues or document manual steps
- **Verify**: Runs tests, build
- **Done**: Infra checks pass OR manual steps documented

### Deploy Failures

- **Context**: Deployment process failures
- **Instructions**: Fix deployment scripts or document issues
- **Verify**: Runs tests, build
- **Done**: Deployment checks pass OR issue documented

### Unknown Failures

- **Context**: Unclassified failures
- **Instructions**: Investigate and identify root cause
- **Verify**: Runs tests, build
- **Done**: Issue resolved and root cause documented

## Security Features

The generator automatically redacts sensitive information:

- GitHub tokens (`ghp_*`, `gho_*`, `ghs_*`, etc.)
- AWS credentials (`AKIA*`, `AWS_SECRET_ACCESS_KEY`)
- API keys in URLs (`?api_key=...`, `?token=...`)
- Bearer tokens (JWT format)
- NPM tokens (`npm_*`)

## Determinism

The generator ensures deterministic output:

1. **Stable Template Selection**: Based purely on `failureClass`
2. **Sorted Evidence**: URLs and hashes are always sorted
3. **Consistent Hashing**: Same input → same prompt text hash
4. **No Secrets**: Redaction ensures no variable tokens in output

## Example Prompt Structure

```markdown
# Fix GitHub Check Failures

## Context

You are fixing **linting failures** in a TypeScript/JavaScript codebase.
These failures indicate code style or formatting issues that need to be corrected.

**Repository:** adaefler-art/codefactory-control
**PR:** #123
**Head SHA:** abc123def456
**Lawbook Hash:** v1.0.0-test

## Failures

Found 1 failure(s) requiring attention:

### ESLint (lint)

**Status:** failure
**Evidence URL:** https://github.com/adaefler-art/codefactory-control/runs/123
**Primary Signal:** Error: Expected 2 spaces but found 4

**Log Excerpt:**
\`\`\`
Error: Expected 2 spaces but found 4
  at src/example.ts:10:5
\`\`\`

**Excerpt Hash:** hash123

## Instructions

1. Fix ONLY the linting errors listed below
2. Make MINIMAL changes - only what's necessary to pass the linter
3. Follow existing code style and formatting conventions
4. Do NOT refactor or make unnecessary changes
5. Preserve existing functionality exactly

## File Touch Hints

The following files may need changes (limit 5):
- src/example.ts

## Verification

After making changes, run these PowerShell commands to verify:

\`\`\`powershell
npm --prefix control-center run lint
\`\`\`
\`\`\`powershell
npm run repo:verify
\`\`\`
\`\`\`powershell
npm --prefix control-center test
\`\`\`
\`\`\`powershell
npm --prefix control-center run build
\`\`\`

## Done Definition

1. All linting errors are resolved
2. All failing checks now pass
3. No new test failures introduced
4. Changes are minimal and focused
5. No secrets or sensitive data in code
```

## Error Handling

### No Failures Found (409)

```json
{
  "error": "No failures found in checks",
  "code": "NO_FAILURES",
  "details": {
    "overall": "GREEN",
    "message": "All checks are passing, no prompt needed"
  }
}
```

### Repository Access Denied (403)

```json
{
  "error": "Repository access denied",
  "code": "REPO_ACCESS_DENIED",
  "details": {
    "repository": "owner/repo"
  }
}
```

### PR Not Found (404)

```json
{
  "error": "PR not found",
  "code": "PR_NOT_FOUND"
}
```

## Integration with E84.1

The prompt generator builds on the checks triage analyzer (E84.1):

```
E84.1: Checks Triage Analyzer
  ↓
  Generates: ChecksTriageReportV1
  ↓
E84.2: Copilot Prompt Generator
  ↓
  Generates: CopilotPromptV1
  ↓
GitHub Copilot (manual or automated)
```

## Testing

Run the tests:

```bash
cd control-center
npm test -- --testPathPattern=copilot-prompt
```

Tests cover:

- Secret redaction (GitHub, AWS, NPM tokens)
- Template generation for all failure classes
- Deterministic hashing
- File hint extraction
- API endpoint responses
- Error handling
