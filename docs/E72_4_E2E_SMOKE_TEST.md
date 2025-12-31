# E72.4 E2E Smoke Test (Timeline Chain)

This document describes a minimal smoke test for the Timeline Chain API.

## Endpoint

- `GET /api/timeline/chain?issueId=<id>&sourceSystem=<github|afu9>`

## Optional Smoke-Auth (Stage-only via ENV)

The Control Center middleware supports a **single-endpoint** smoke-auth bypass for:

- `GET /api/timeline/chain`

**Contract**

- Header: `X-AFU9-SMOKE-KEY`
- Env: `AFU9_SMOKE_KEY`
- If `AFU9_SMOKE_KEY` is not set, the bypass is disabled.

When used, the middleware sets response header:

- `x-afu9-smoke-auth-used: 1`

## PowerShell Example

```powershell
$BaseUrl = "https://stage.afu-9.com"
$IssueId = "123"
$SourceSystem = "afu9"

$Headers = @{
  "X-AFU9-SMOKE-KEY" = $env:AFU9_SMOKE_KEY
}

Invoke-RestMethod -Method GET `
  -Uri "$BaseUrl/api/timeline/chain?issueId=$IssueId&sourceSystem=$SourceSystem" `
  -Headers $Headers
```
