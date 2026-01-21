# I906 Quick Reference: Smoke-Key Allowlist Management

## Quick Commands

### View Current Allowlist
```powershell
$base = "https://stage.afu-9.com"
$headers = @{ "x-afu9-smoke-key" = $env:AFU9_SMOKE_KEY }

Invoke-RestMethod "$base/api/admin/smoke-key/allowlist" -Method Get -Headers $headers
```

### Add Route (Exact Match)
```powershell
$payload = @{
    op = "add"
    route = "/api/my/endpoint"
    method = "GET"
    description = "My test endpoint"
} | ConvertTo-Json

Invoke-RestMethod "$base/api/admin/smoke-key/allowlist" -Method Post -Headers $headers -Body $payload
```

### Add Route (Regex Pattern)
```powershell
$payload = @{
    op = "add"
    route = "^/api/issues/\d+/state$"
    method = "POST"
    isRegex = $true
    description = "Issue state endpoints"
} | ConvertTo-Json

Invoke-RestMethod "$base/api/admin/smoke-key/allowlist" -Method Post -Headers $headers -Body $payload
```

### Remove Route
```powershell
$payload = @{
    op = "remove"
    route = "/api/my/endpoint"
    method = "GET"
} | ConvertTo-Json

Invoke-RestMethod "$base/api/admin/smoke-key/allowlist" -Method Post -Headers $headers -Body $payload
```

### View Audit History
```powershell
Invoke-RestMethod "$base/api/admin/smoke-key/allowlist?history=true" -Method Get -Headers $headers
```

## API Reference

### GET /api/admin/smoke-key/allowlist
Returns current allowlist and statistics.

**Query Parameters:**
- `history=true`: Include removed routes (full audit trail)

**Response:**
```json
{
  "ok": true,
  "allowlist": [
    {
      "id": 1,
      "route_pattern": "/api/test",
      "method": "GET",
      "is_regex": false,
      "description": "Test endpoint",
      "added_by": "user-123",
      "added_at": "2025-01-01T00:00:00Z",
      "removed_by": null,
      "removed_at": null
    }
  ],
  "stats": {
    "activeCount": 20,
    "totalCount": 25,
    "limitRemaining": 80,
    "maxLimit": 100
  }
}
```

### POST /api/admin/smoke-key/allowlist
Add or remove routes from allowlist.

**Request Body (Add):**
```json
{
  "op": "add",
  "route": "/api/path",
  "method": "GET",           // Optional, default: "*"
  "isRegex": false,          // Optional, default: false
  "description": "..."       // Optional
}
```

**Request Body (Remove):**
```json
{
  "op": "remove",
  "route": "/api/path",
  "method": "GET"            // Optional, default: "*"
}
```

**Response Codes:**
- `201`: Route added successfully
- `200`: Route removed successfully
- `400`: Invalid input (bad regex, empty route, invalid method)
- `401`: Unauthorized (not admin)
- `404`: Route not found (remove operation)
- `409`: Route already exists (add operation)
- `429`: Limit exceeded (100 routes max)

## Common Patterns

### Exact Route Match
```json
{
  "route": "/api/exact/path",
  "method": "GET",
  "isRegex": false
}
```
Matches only: `GET /api/exact/path`

### Wildcard Method
```json
{
  "route": "/api/test",
  "method": "*",
  "isRegex": false
}
```
Matches: `GET /api/test`, `POST /api/test`, etc.

### Regex Pattern - Numeric ID
```json
{
  "route": "^/api/issues/\\d+$",
  "method": "GET",
  "isRegex": true
}
```
Matches: `GET /api/issues/123`, `GET /api/issues/456`  
Does NOT match: `GET /api/issues/abc`, `GET /api/issues/`

### Regex Pattern - Any Segment
```json
{
  "route": "^/api/issues/[^/]+/state$",
  "method": "GET",
  "isRegex": true
}
```
Matches: `GET /api/issues/ABC-123/state`, `GET /api/issues/456/state`

## Troubleshooting

### Routes Not Taking Effect
**Problem:** Added route but still getting 401  
**Solution:** Wait 35 seconds for cache refresh (30s TTL + 5s buffer)

### Admin Endpoint Returns 401
**Problem:** Cannot access allowlist management API  
**Solution:** 
1. Check AFU9_ADMIN_SUBS contains your user sub
2. Verify you have valid JWT in cookies
3. Note: Smoke-key does NOT work for admin endpoints (by design)

### Regex Pattern Not Matching
**Problem:** Regex pattern not matching expected routes  
**Solution:**
1. Test regex separately: `"pattern" -match "^/api/test/\d+$"`
2. Verify `isRegex: true` flag is set
3. Check pattern escaping (backslashes need doubling in JSON)

### Limit Reached (429)
**Problem:** Cannot add more routes  
**Solution:**
1. Check stats: `GET /api/admin/smoke-key/allowlist`
2. Remove obsolete routes: `POST { op: "remove", ... }`
3. Max limit: 100 active routes

## Security Notes

### Access Control
- ✅ Allowlist modifications: Admin-only (AFU9_ADMIN_SUBS)
- ✅ Smoke-key bypass: Staging-only
- ✅ Route access: Smoke-key + allowlist match required

### Audit Trail
- All modifications logged with actor and timestamp
- Soft deletes preserve full history
- View history: `GET ?history=true`

### Hard Limits
- Max 100 active routes
- No wildcard patterns by default
- Regex validation before storage

## Cache Behavior

### TTL: 30 seconds
- Changes take effect within 30 seconds (no redeploy)
- Cache refreshes automatically
- Fail-closed: Cache error → deny access

### Testing Cache
1. Add route: `POST { op: "add", ... }`
2. Wait 35 seconds
3. Test route access with smoke-key

## Regex Tips

### Valid Patterns
```
^/api/test$               # Exact match
^/api/issues/\d+$         # Numeric ID
^/api/issues/[^/]+/state$ # Any segment + /state
^/api/(test|prod)$        # Alternation
```

### Invalid Patterns
```
[invalid(regex             # Syntax error
^/api/test                 # Missing $, too broad
.*                         # Too broad (use carefully)
```

### Escaping in JSON
```json
{
  "route": "^/api/test/\\d+$"  // Note: double backslash
}
```

## Monitoring

### Check Statistics
```powershell
$stats = (Invoke-RestMethod "$base/api/admin/smoke-key/allowlist" -Method Get -Headers $headers).stats
Write-Host "Active: $($stats.activeCount) / $($stats.maxLimit)"
Write-Host "Remaining: $($stats.limitRemaining)"
```

### View Recent Changes
```powershell
$history = (Invoke-RestMethod "$base/api/admin/smoke-key/allowlist?history=true" -Method Get -Headers $headers).allowlist
$history | Select-Object -First 10 | Format-Table route_pattern, method, added_by, added_at, removed_at
```

### Check Logs for Modifications
```bash
# Search application logs for allowlist changes
grep "smoke_key_allowlist_change" /var/log/app.log
```

## Best Practices

### DO
- ✅ Use exact match when possible (faster, more secure)
- ✅ Add descriptive comments to routes
- ✅ Test regex patterns before adding
- ✅ Remove obsolete routes promptly
- ✅ Review audit trail periodically

### DON'T
- ❌ Use overly broad patterns (e.g., `.*`)
- ❌ Add production routes (staging-only)
- ❌ Share admin credentials
- ❌ Expect instant effect (30s cache)
- ❌ Exceed 80% of max limit (leaves no buffer)

## Example Workflow

```powershell
# 1. Check current state
$current = Invoke-RestMethod "$base/api/admin/smoke-key/allowlist" -Method Get -Headers $headers
Write-Host "Current routes: $($current.stats.activeCount)"

# 2. Add new route
$add = @{
    op = "add"
    route = "/api/my/test/endpoint"
    method = "POST"
    description = "Testing new feature X"
} | ConvertTo-Json

Invoke-RestMethod "$base/api/admin/smoke-key/allowlist" -Method Post -Headers $headers -Body $add

# 3. Wait for cache refresh
Start-Sleep -Seconds 35

# 4. Test route access
$testHeaders = @{ "x-afu9-smoke-key" = $env:AFU9_SMOKE_KEY }
Invoke-RestMethod "$base/api/my/test/endpoint" -Method Post -Headers $testHeaders

# 5. Remove when done testing
$remove = @{
    op = "remove"
    route = "/api/my/test/endpoint"
    method = "POST"
} | ConvertTo-Json

Invoke-RestMethod "$base/api/admin/smoke-key/allowlist" -Method Post -Headers $headers -Body $remove
```

## Support

### Documentation
- Security Summary: `I906_SECURITY_SUMMARY.md`
- Implementation Details: `I906_IMPLEMENTATION_SUMMARY.md`
- Full Verification: `I906_VERIFICATION_COMMANDS.ps1`

### Database Schema
```sql
SELECT * FROM smoke_key_allowlist 
WHERE removed_at IS NULL 
ORDER BY added_at DESC;
```

### Migration
```bash
# Apply migration
psql -f database/migrations/078_smoke_key_allowlist.sql

# Verify
psql -c "SELECT COUNT(*) FROM smoke_key_allowlist WHERE removed_at IS NULL;"
# Expected: 20 (migrated from hardcoded routes)
```
