# E83.2 Quick Reference: PowerShell Verification Commands

## Basic Verification (Staging)

Test the endpoint on staging environment:

```powershell
pwsh scripts/verify-assign-copilot.ps1 `
  -BaseUrl "https://control-center.stage.afu9.cloud" `
  -IssueNumber 123 `
  -Owner "adaefler-art" `
  -Repo "codefactory-control"
```

## Local Development

Test on local development server:

```powershell
pwsh scripts/verify-assign-copilot.ps1 `
  -BaseUrl "http://localhost:3000" `
  -IssueNumber 123
```

## Manual API Testing

### First Call (Should Assign)

```powershell
$body = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    requestId = "test-$(Get-Random)"
} | ConvertTo-Json

$response1 = Invoke-RestMethod `
    -Uri "http://localhost:3000/api/github/issues/123/assign-copilot" `
    -Method POST `
    -Headers @{ "Content-Type" = "application/json" } `
    -Body $body

Write-Host "First call response:"
$response1 | ConvertTo-Json -Depth 10
Write-Host "Status: $($response1.status)"  # Should be: ASSIGNED
```

### Second Call (Should be NOOP)

```powershell
$body = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    requestId = "test-$(Get-Random)"
} | ConvertTo-Json

$response2 = Invoke-RestMethod `
    -Uri "http://localhost:3000/api/github/issues/123/assign-copilot" `
    -Method POST `
    -Headers @{ "Content-Type" = "application/json" } `
    -Body $body

Write-Host "Second call response:"
$response2 | ConvertTo-Json -Depth 10
Write-Host "Status: $($response2.status)"  # Should be: NOOP
```

### Verify Idempotency

```powershell
if ($response1.assignees -join "," -eq $response2.assignees -join ",") {
    Write-Host "✓ PASSED: Assignees unchanged (idempotent)" -ForegroundColor Green
} else {
    Write-Host "✗ FAILED: Assignees changed!" -ForegroundColor Red
}
```

## Testing Negative Cases

### Invalid Issue Number (404)

```powershell
$body = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
} | ConvertTo-Json

try {
    Invoke-RestMethod `
        -Uri "http://localhost:3000/api/github/issues/999999999/assign-copilot" `
        -Method POST `
        -Headers @{ "Content-Type" = "application/json" } `
        -Body $body
} catch {
    Write-Host "Status: $($_.Exception.Response.StatusCode.Value__)"  # Should be: 404
}
```

### Missing Required Fields (400)

```powershell
$body = @{
    owner = "adaefler-art"
    # Missing: repo
} | ConvertTo-Json

try {
    Invoke-RestMethod `
        -Uri "http://localhost:3000/api/github/issues/123/assign-copilot" `
        -Method POST `
        -Headers @{ "Content-Type" = "application/json" } `
        -Body $body
} catch {
    $error = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "Error: $($error.error)"  # Should be: Missing required fields
}
```

### Repository Not in Registry (404)

```powershell
$body = @{
    owner = "unknown"
    repo = "unknown"
} | ConvertTo-Json

try {
    Invoke-RestMethod `
        -Uri "http://localhost:3000/api/github/issues/123/assign-copilot" `
        -Method POST `
        -Headers @{ "Content-Type" = "application/json" } `
        -Body $body
} catch {
    $error = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "Error: $($error.error)"  # Should be: Repository not found in registry
}
```

## Build & Test Commands

### Run Unit Tests

```powershell
cd control-center
npm test -- __tests__/api/github-assign-copilot.test.ts
```

### Build Project

```powershell
cd control-center
npm run build
```

### Verify Repository

```powershell
npm run repo:verify
```

## Environment Setup

### Required Environment Variables

Create or update `.env.local` file:

```bash
# .env.local
GITHUB_COPILOT_USERNAME=copilot
ENABLE_PROD=false
NODE_ENV=development
```

**Note:** Always use `.env` files or secure configuration management instead of setting environment variables directly in shell scripts to avoid potential exposure of sensitive configuration.

## Database Verification

### Check Registry Audit Logs

```sql
SELECT 
  id,
  action_type,
  action_status,
  repository,
  resource_number,
  executed_by,
  created_at,
  validation_result->>'allowed' as allowed
FROM registry_action_audit
WHERE action_type = 'assign_issue'
ORDER BY created_at DESC
LIMIT 10;
```

### Check Active Registry

```sql
SELECT 
  registry_id,
  repository,
  version,
  content->'allowedActions' as allowed_actions,
  active,
  created_at
FROM repo_actions_registry
WHERE repository = 'adaefler-art/codefactory-control'
  AND active = true;
```

## Expected Output Examples

### Successful Assignment

```json
{
  "status": "ASSIGNED",
  "assignees": ["copilot"],
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "lawbookHash": "sha256:abc123def456..."
}
```

### Idempotent NOOP

```json
{
  "status": "NOOP",
  "assignees": ["copilot"],
  "requestId": "660e8400-e29b-41d4-a716-446655440001",
  "lawbookHash": "sha256:abc123def456..."
}
```

## Troubleshooting

### Issue: "Repository not found in registry"

**Solution:** Create a registry for the repository:

```typescript
import { getRepoActionsRegistryService } from '@/lib/repo-actions-registry-service';

const service = getRepoActionsRegistryService();
await service.createRegistry({
  version: '1.0.0',
  registryId: 'my-repo-v1',
  repository: 'owner/repo',
  allowedActions: [
    {
      actionType: 'assign_issue',
      enabled: true,
      preconditions: [],
      requireEvidence: true,
    },
  ],
  createdAt: new Date().toISOString(),
  createdBy: 'admin',
  failClosed: true,
});
```

### Issue: "Production environment blocked"

**Solution:** Either:
1. Use staging URL instead of production
2. Set `ENABLE_PROD=true` (not recommended for normal operation)

### Issue: "No active lawbook found"

**Solution:** Ensure an active lawbook version exists in the database.

## References

- Full Documentation: `docs/v08/E83_2_ASSIGN_COPILOT_IMPLEMENTATION.md`
- Verification Script: `scripts/verify-assign-copilot.ps1`
- API Route: `control-center/app/api/github/issues/[issueNumber]/assign-copilot/route.ts`
- Tests: `control-center/__tests__/api/github-assign-copilot.test.ts`
