# Epic-1 v0.9: Issue Detail Endpoint - Verification Guide

This document provides verification and testing instructions for the new `/api/afu9/issues/[ref]` endpoint implemented in Epic-1 v0.9.

## Overview

The new endpoint allows fetching issue details using three types of identifiers:
- **UUID v4** (canonical ID) - Full UUID format
- **publicId** - 8-character hexadecimal prefix
- **canonicalId** - Human-readable format (e.g., `I811`, `E81.1`)

## Smoke Test Script

### Location

```
scripts/smoke-test-issue-detail-endpoint.ps1
```

## Local Development Testing

### Prerequisites

1. Control Center must be running:
   ```bash
   cd control-center
   npm run dev
   ```

2. At least one issue must exist in the database

### Usage (Local)

```powershell
# Basic test (no colors, plain output for CI/logs)
./scripts/smoke-test-issue-detail-endpoint.ps1

# With color output (interactive terminal only)
./scripts/smoke-test-issue-detail-endpoint.ps1 -Color

# Custom local URL
./scripts/smoke-test-issue-detail-endpoint.ps1 -BaseUrl "http://localhost:3001"
```

### Expected Output (Local, No Colors)

```
═══════════════════════════════════════════════════════════
  Epic-1 v0.9: /api/afu9/issues/[ref] Smoke Test
═══════════════════════════════════════════════════════════

Base URL: http://localhost:3000

Step 1: Fetching issues list...
✓ Found test issue:
  UUID:        123e4567-e89b-12d3-a456-426614174000
  PublicId:    123e4567
  CanonicalId: I811

Step 2: Testing UUID lookup...
✓ UUID lookup (Status: 200)

Step 3: Testing publicId (8-hex) lookup...
✓ PublicId lookup (Status: 200)

Step 4: Testing canonicalId lookup...
✓ CanonicalId lookup (Status: 200)

Step 5: Testing 404 (non-existent UUID)...
✓ 404 Not Found (Status: 404)

Step 6: Testing 400 (invalid identifier)...
✓ 400 Bad Request (Status: 400)

═══════════════════════════════════════════════════════════
✓ Smoke Test Complete
═══════════════════════════════════════════════════════════
```

## Staging/Production Testing

### Prerequisites

1. Service token configured (never commit tokens to source)
2. Staging/production endpoint accessible

### Usage (Stage/Prod)

```powershell
# Set token securely (from environment or secure storage)
$token = $env:AFU9_SERVICE_TOKEN  # or Get-Secret, etc.

# Test staging
./scripts/smoke-test-issue-detail-endpoint.ps1 `
  -BaseUrl "https://stage.afu-9.com" `
  -ServiceToken $token

# Test production (use with caution)
./scripts/smoke-test-issue-detail-endpoint.ps1 `
  -BaseUrl "https://afu-9.com" `
  -ServiceToken $token
```

### Security Notes (Stage/Prod)

- **Never log service tokens** - Script automatically redacts tokens from error messages
- **Use environment variables** - Don't hardcode tokens in scripts or command history
- **Prefer secret management** - Use Azure KeyVault, AWS Secrets Manager, or similar
- **CI/CD integration** - Tokens should be injected via pipeline secrets

### CI/CD Integration

```yaml
# Example GitHub Actions workflow
- name: Smoke Test (Staging)
  env:
    AFU9_SERVICE_TOKEN: ${{ secrets.AFU9_SERVICE_TOKEN_STAGING }}
  run: |
    pwsh scripts/smoke-test-issue-detail-endpoint.ps1 `
      -BaseUrl "https://stage.afu-9.com" `
      -ServiceToken $env:AFU9_SERVICE_TOKEN
```

## Test Coverage

The smoke test validates:

1. ✅ **UUID lookup** - Full UUID v4 identifier
2. ✅ **publicId lookup** - 8-character hex prefix
3. ✅ **canonicalId lookup** - Human-readable format (if available)
4. ✅ **404 handling** - Non-existent issue returns 404
5. ✅ **400 handling** - Invalid identifier format returns 400
6. ✅ **Service token support** - Authentication header (redacted from logs)

## Manual API Testing (Local)

### Test UUID Lookup

```bash
curl -X GET http://localhost:3000/api/afu9/issues/123e4567-e89b-12d3-a456-426614174000
```

**Expected:** 200 OK with issue details

### Test publicId Lookup

```bash
curl -X GET http://localhost:3000/api/afu9/issues/123e4567
```

**Expected:** 200 OK with issue details matching the UUID lookup

### Test canonicalId Lookup

```bash
curl -X GET http://localhost:3000/api/afu9/issues/I811
```

**Expected:** 200 OK with issue details

### Test 404 (Not Found)

```bash
curl -X GET http://localhost:3000/api/afu9/issues/00000000-0000-0000-0000-000000000000
```

**Expected:** 404 Not Found

### Test 400 (Invalid Format)

```bash
curl -X GET http://localhost:3000/api/afu9/issues/not-a-valid-id
```

**Expected:** 400 Bad Request

## Manual API Testing (Stage/Prod)

### With Service Token

```bash
# Set token from environment
TOKEN="${AFU9_SERVICE_TOKEN}"

# Test UUID lookup
curl -X GET https://stage.afu-9.com/api/afu9/issues/123e4567-e89b-12d3-a456-426614174000 \
  -H "x-afu9-service-token: ${TOKEN}"
```

**Security:** Never log or commit the service token value.

## Script Features

### Color Output

- **Default:** No colors (plain text for CI/CD and log files)
- **Optional:** Use `-Color` flag for interactive terminals
- **Reason:** ANSI escape codes break log parsers and CI output

### Token Security

- **Automatic redaction:** Service tokens are removed from error messages
- **No logging:** Token values never appear in script output
- **Header-only:** Token used only in HTTP header, not in URLs or query params

## Integration with Existing Endpoints

The new endpoint complements the existing `/api/afu9/issues` endpoints:

- **List issues:** `GET /api/afu9/issues`
- **Get by ref:** `GET /api/afu9/issues/[ref]` ← **New**
- **Create issue:** `POST /api/afu9/issues`
- **Update issue:** `PATCH /api/afu9/issues/:id`
- **Activate issue:** `POST /api/afu9/issues/:id/activate`
- **Handoff to GitHub:** `POST /api/afu9/issues/:id/handoff`

## Success Criteria

- ✅ Script executes without errors
- ✅ All identifier types (UUID, publicId, canonicalId) resolve correctly
- ✅ 404 returned for non-existent issues
- ✅ 400 returned for invalid identifiers
- ✅ Service token authentication works (if configured)
- ✅ No ANSI colors by default (CI/log compatible)
- ✅ Service token never appears in output

## Notes

- The script uses `/api/afu9/issues?limit=1` to fetch test data (no direct DB access)
- If no issues exist, the script exits gracefully with a warning
- canonicalId test is skipped if the test issue doesn't have one
- All tests are idempotent and safe to run repeatedly
- Color output is disabled by default to prevent breaking CI/CD pipelines

## Related Documentation

- [AFU9 Issues API](../AFU9-ISSUES-API.md) - Complete API reference
- [API Routes](../API_ROUTES.md) - All available endpoints
