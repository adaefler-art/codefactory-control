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

### Prerequisites

1. Control Center must be running:
   ```bash
   cd control-center
   npm run dev
   ```

2. At least one issue must exist in the database

### Basic Usage

```powershell
# Test against local development server
./scripts/smoke-test-issue-detail-endpoint.ps1

# Test against custom base URL
./scripts/smoke-test-issue-detail-endpoint.ps1 -BaseUrl "https://control-center.example.com"

# Test with service token authentication
./scripts/smoke-test-issue-detail-endpoint.ps1 -ServiceToken "your-token-here"
```

### Expected Output

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

## Test Coverage

The smoke test validates:

1. ✅ **UUID lookup** - Full UUID v4 identifier
2. ✅ **publicId lookup** - 8-character hex prefix
3. ✅ **canonicalId lookup** - Human-readable format (if available)
4. ✅ **404 handling** - Non-existent issue returns 404
5. ✅ **400 handling** - Invalid identifier format returns 400
6. ✅ **Service token support** - Authentication header

## Manual API Testing

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
- ✅ Color-coded output displays correctly

## Notes

- The script automatically fetches a test issue from the database
- If no issues exist, the script exits gracefully with a warning
- canonicalId test is skipped if the test issue doesn't have one
- All tests are idempotent and safe to run repeatedly

## Related Documentation

- [AFU9 Issues API](../AFU9-ISSUES-API.md) - Complete API reference
- [API Routes](../API_ROUTES.md) - All available endpoints
