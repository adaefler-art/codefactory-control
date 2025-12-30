# E71.1: Testing Repo Access Policy

This guide shows how to test the repository access policy (allowlist) enforcement in development and staging environments.

## Smoke Test Endpoint

The smoke test endpoint allows you to verify policy enforcement without making changes.

**Endpoint**: `GET /api/integrations/github/smoke`

**Parameters**:
- `owner` (required): Repository owner
- `repo` (required): Repository name
- `branch` (optional): Branch name

**Note**: This endpoint is only available in development/staging (not production).

## PowerShell Examples

### Test Allowed Repository

```powershell
# Test repository that's in the allowlist
$owner = "adaefler-art"
$repo = "codefactory-control"
$branch = "main"

# Option 1: Using Invoke-RestMethod (parsed JSON)
$response = Invoke-RestMethod -Uri "http://localhost:3000/api/integrations/github/smoke?owner=$owner&repo=$repo&branch=$branch" -Method Get
Write-Host "Status: $($response.ok)"
Write-Host "Message: $($response.message)"
Write-Host "GitHub Repo: $($response.github.full_name)"

# Option 2: Using Invoke-WebRequest (full response)
$result = Invoke-WebRequest -Uri "http://localhost:3000/api/integrations/github/smoke?owner=$owner&repo=$repo&branch=$branch" -Method Get
Write-Host "HTTP Status: $($result.StatusCode)"
Write-Host "Response: $($result.Content)"
```

### Test Denied Repository

```powershell
# Test repository that's NOT in the allowlist
$owner = "unauthorized-org"
$repo = "private-repo"

try {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/integrations/github/smoke?owner=$owner&repo=$repo" -Method Get
    Write-Host "Unexpected success: $response"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $errorBody = $_.ErrorDetails.Message | ConvertFrom-Json
    
    Write-Host "Expected denial - Status Code: $statusCode"
    Write-Host "Error Code: $($errorBody.code)"
    Write-Host "Error Message: $($errorBody.error)"
    Write-Host "Details: $($errorBody.details | ConvertTo-Json)"
}
```

### Test Branch Pattern Matching

```powershell
# Test different branch patterns
$testCases = @(
    @{ owner="adaefler-art"; repo="codefactory-control"; branch="main"; expected="ALLOW" },
    @{ owner="adaefler-art"; repo="codefactory-control"; branch="develop"; expected="ALLOW" },
    @{ owner="adaefler-art"; repo="codefactory-control"; branch="release/1.0"; expected="ALLOW" },
    @{ owner="adaefler-art"; repo="codefactory-control"; branch="hotfix/urgent"; expected="ALLOW" },
    @{ owner="adaefler-art"; repo="codefactory-control"; branch="unknown-branch"; expected="DENY" }
)

foreach ($test in $testCases) {
    Write-Host "`nTesting: $($test.owner)/$($test.repo) @ $($test.branch)"
    Write-Host "Expected: $($test.expected)"
    
    try {
        $uri = "http://localhost:3000/api/integrations/github/smoke?owner=$($test.owner)&repo=$($test.repo)&branch=$($test.branch)"
        $response = Invoke-RestMethod -Uri $uri -Method Get
        Write-Host "Result: ALLOWED ✓" -ForegroundColor Green
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 403) {
            Write-Host "Result: DENIED ✗" -ForegroundColor Red
        } else {
            Write-Host "Result: ERROR ($statusCode)" -ForegroundColor Yellow
        }
    }
}
```

## Bash/cURL Examples

### Test Allowed Repository

```bash
# Test repository in allowlist
curl -s "http://localhost:3000/api/integrations/github/smoke?owner=adaefler-art&repo=codefactory-control&branch=main" | jq .

# Expected output:
# {
#   "ok": true,
#   "message": "Repository access allowed",
#   "policy": { "owner": "adaefler-art", "repo": "codefactory-control", "branch": "main" },
#   "github": { "name": "codefactory-control", "full_name": "adaefler-art/codefactory-control", ... }
# }
```

### Test Denied Repository

```bash
# Test repository NOT in allowlist
curl -s -w "HTTP Status: %{http_code}\n" \
  "http://localhost:3000/api/integrations/github/smoke?owner=unauthorized&repo=repo" | jq .

# Expected output:
# {
#   "ok": false,
#   "error": "Access denied to repository unauthorized/repo",
#   "code": "REPO_NOT_ALLOWED",
#   "details": { "owner": "unauthorized", "repo": "repo" }
# }
# HTTP Status: 403
```

## Configuration for Testing

### Development Default Allowlist

If `GITHUB_REPO_ALLOWLIST` is not set, the system uses this default:

```json
{
  "allowlist": [
    {
      "owner": "adaefler-art",
      "repo": "codefactory-control",
      "branches": ["main", "develop", "release/*", "hotfix/*", "feature/*", "copilot/*"]
    }
  ]
}
```

### Custom Test Allowlist

Set a custom allowlist for testing:

```powershell
# PowerShell
$env:GITHUB_REPO_ALLOWLIST = @"
{
  "allowlist": [
    {
      "owner": "adaefler-art",
      "repo": "codefactory-control",
      "branches": ["main", "release/*"]
    },
    {
      "owner": "test-org",
      "repo": "test-repo",
      "branches": ["main"]
    }
  ]
}
"@

# Restart the dev server
npm --prefix control-center run dev
```

```bash
# Bash
export GITHUB_REPO_ALLOWLIST='{
  "allowlist": [
    {
      "owner": "adaefler-art",
      "repo": "codefactory-control",
      "branches": ["main", "release/*"]
    }
  ]
}'

# Restart the dev server
npm --prefix control-center run dev
```

## Expected Responses

### Success (200)

```json
{
  "ok": true,
  "message": "Repository access allowed",
  "policy": {
    "owner": "adaefler-art",
    "repo": "codefactory-control",
    "branch": "main"
  },
  "github": {
    "name": "codefactory-control",
    "full_name": "adaefler-art/codefactory-control",
    "default_branch": "main",
    "visibility": "public",
    "private": false
  }
}
```

### Access Denied (403)

```json
{
  "ok": false,
  "error": "Access denied to repository test/repo on branch 'develop'",
  "code": "REPO_NOT_ALLOWED",
  "details": {
    "owner": "test",
    "repo": "repo",
    "branch": "develop"
  }
}
```

### Configuration Error

```json
{
  "ok": false,
  "error": "Invalid GITHUB_REPO_ALLOWLIST JSON: ...",
  "code": "POLICY_CONFIG_ERROR"
}
```

## Verifying Policy Enforcement

### Check All GitHub Entry Points

All GitHub API calls should now go through the auth wrapper. You can verify by:

```powershell
# Search for direct token usage (should find none except in github-app-auth.ts and tests)
cd control-center
Select-String -Path "src\**\*.ts" -Pattern "getGitHubInstallationToken" -Exclude "*test*","github-app-auth.ts" | Select-Object Path, LineNumber
```

Expected: No results (all calls use auth-wrapper)

### Monitor Logs

When running the dev server, you'll see policy enforcement in action:

```powershell
# Start dev server with verbose logging
$env:AFU9_DEBUG_MODE = "true"
npm --prefix control-center run dev
```

Look for log entries like:
- `[RepoAccessPolicy] No GITHUB_REPO_ALLOWLIST configured, using development default`
- Access denied errors when policy blocks requests

## Integration with Existing Endpoints

The smoke test endpoint complements existing status checks:

| Endpoint | Purpose | Auth Check |
|----------|---------|------------|
| `/api/integrations/github/status` | GitHub App configuration status | JWT only (no policy) |
| `/api/integrations/github/smoke` | Policy enforcement test | Full policy check |

## Troubleshooting

### "Endpoint not available in production"

The smoke test is intentionally disabled in production. Use it only in dev/staging.

### "REPO_NOT_ALLOWED" for expected repository

1. Check `GITHUB_REPO_ALLOWLIST` environment variable
2. Verify owner/repo match exactly (case-sensitive)
3. Check branch patterns (e.g., `release/*` vs `release/1.0`)

### GitHub API errors

1. Verify GitHub App is installed on the repository
2. Check GitHub App permissions (needs repo read access)
3. Verify `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY_PEM` are configured

## Production Deployment

⚠️ **Important**: The smoke test endpoint is automatically disabled in production for security.

To test policy in production:
1. Use application logs to verify policy enforcement
2. Monitor denied access attempts
3. Use infrastructure health checks (`/api/integrations/github/status`)
