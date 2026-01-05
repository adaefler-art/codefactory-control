# INTENT Smoke Test - Stage Environment

**Purpose:** Deterministic smoke-test procedure for INTENT Console in staging environment.

**Prerequisites:**
- Access to Stage environment (`https://stage.afu-9.com` or equivalent)
- Valid authentication credentials
- PowerShell 7+ (for API testing)

---

## Scenario 1: INTENT Disabled (Flag = false)

### Expected Behavior
When `AFU9_INTENT_ENABLED=false`:
- UI shows clear **"INTENT is disabled"** warning banner (yellow/orange styling)
- Banner explains fail-closed behavior
- Message creation endpoints return 404
- All other endpoints (sessions list, status check) remain accessible

### Test Steps

#### 1. Check Status Endpoint
```powershell
$Base = "https://stage.afu-9.com"
$Headers = @{
  "Cookie" = "your-session-cookie-here"
}

# Get INTENT status
$status = Invoke-RestMethod -Method Get -Uri "$Base/api/intent/status" -Headers $Headers
Write-Output "INTENT Status: $($status | ConvertTo-Json -Depth 3)"

# Expected output:
# {
#   "enabled": false,
#   "mode": "disabled"
# }
```

#### 2. Verify UI Banner
1. Navigate to `https://stage.afu-9.com/intent`
2. **Verify:** Yellow/orange warning banner displays
3. **Verify:** Banner text includes "AFU9_INTENT_ENABLED=false"
4. **Verify:** Banner suggests contacting administrator

#### 3. Verify Fail-Closed Behavior
```powershell
# Attempt to create a session (should succeed)
$createSession = Invoke-RestMethod -Method Post -Uri "$Base/api/intent/sessions" `
  -Headers $Headers -ContentType "application/json" -Body "{}"
Write-Output "Session Created: $($createSession.id)"

# Attempt to send a message (should fail with 404)
try {
  $sendMessage = Invoke-RestMethod -Method Post `
    -Uri "$Base/api/intent/sessions/$($createSession.id)/messages" `
    -Headers $Headers -ContentType "application/json" `
    -Body '{"content":"Test message"}'
  Write-Error "ERROR: Message should have been blocked but succeeded!"
} catch {
  $statusCode = $_.Exception.Response.StatusCode.value__
  if ($statusCode -eq 404) {
    Write-Output "✅ PASS: Message correctly blocked (404) when disabled"
  } else {
    Write-Error "❌ FAIL: Expected 404, got $statusCode"
  }
}
```

---

## Scenario 2: INTENT Enabled (Flag = true)

### Expected Behavior
When `AFU9_INTENT_ENABLED=true`:
- UI shows subtle green **"INTENT Enabled"** badge
- Full workflow functions: create session → send message → receive response
- Context pack generation works

### Test Steps

#### 1. Check Status Endpoint
```powershell
$Base = "https://stage.afu-9.com"
$Headers = @{
  "Cookie" = "your-session-cookie-here"
}

# Get INTENT status
$status = Invoke-RestMethod -Method Get -Uri "$Base/api/intent/status" -Headers $Headers
Write-Output "INTENT Status: $($status | ConvertTo-Json -Depth 3)"

# Expected output:
# {
#   "enabled": true,
#   "mode": "enabled"
# }
```

#### 2. Verify UI Badge
1. Navigate to `https://stage.afu-9.com/intent`
2. **Verify:** Green "INTENT Enabled" badge displays (subtle, non-intrusive)
3. **Verify:** No warning banner

#### 3. Full Workflow Test
```powershell
# Create new session
$session = Invoke-RestMethod -Method Post -Uri "$Base/api/intent/sessions" `
  -Headers $Headers -ContentType "application/json" -Body "{}"
Write-Output "✅ Session created: $($session.id)"

# Send message
$messageBody = @{
  content = "What is AFU-9?"
} | ConvertTo-Json

$response = Invoke-RestMethod -Method Post `
  -Uri "$Base/api/intent/sessions/$($session.id)/messages" `
  -Headers $Headers -ContentType "application/json" -Body $messageBody

Write-Output "✅ User message: $($response.userMessage.id)"
Write-Output "✅ Assistant response: $($response.assistantMessage.id)"
Write-Output "Assistant says: $($response.assistantMessage.content.Substring(0, 100))..."

# Verify response structure
if ($response.userMessage -and $response.assistantMessage) {
  Write-Output "✅ PASS: Message exchange successful"
} else {
  Write-Error "❌ FAIL: Invalid response structure"
}
```

#### 4. Context Pack Generation (Optional)
```powershell
# Generate context pack
$pack = Invoke-RestMethod -Method Post `
  -Uri "$Base/api/intent/sessions/$($session.id)/context-pack" `
  -Headers $Headers

Write-Output "✅ Context pack created: $($pack.id)"
Write-Output "   Hash: $($pack.pack_hash)"
Write-Output "   Version: $($pack.version)"

# List context packs for session
$packs = Invoke-RestMethod -Method Get `
  -Uri "$Base/api/intent/sessions/$($session.id)/context-packs" `
  -Headers $Headers

Write-Output "✅ Total packs for session: $($packs.packs.Count)"
```

#### 5. Session UX Verification (Manual)
1. Navigate to `https://stage.afu-9.com/intent`
2. Do NOT create a session manually
3. Type a message and click "Send"
4. **Verify:** Session auto-creates
5. **Verify:** Message sends successfully
6. **Verify:** Response appears
7. **Verify:** No "Session ID required" error

---

## Security Checklist

### Status Endpoint (`/api/intent/status`)
- [ ] Returns 401 if not authenticated
- [ ] Response contains ONLY `{ enabled: boolean, mode: string }`
- [ ] No secrets (OPENAI_API_KEY, etc.) in response
- [ ] No environment variable dump

### Example Security Test
```powershell
# Unauthenticated request should fail
try {
  $unauth = Invoke-RestMethod -Method Get -Uri "$Base/api/intent/status"
  Write-Error "❌ FAIL: Unauthenticated request should have returned 401"
} catch {
  $statusCode = $_.Exception.Response.StatusCode.value__
  if ($statusCode -eq 401) {
    Write-Output "✅ PASS: Correctly requires authentication"
  } else {
    Write-Error "❌ FAIL: Expected 401, got $statusCode"
  }
}

# Authenticated response should not leak secrets
$status = Invoke-RestMethod -Method Get -Uri "$Base/api/intent/status" -Headers $Headers
$statusJson = $status | ConvertTo-Json -Depth 5

if ($statusJson -match "sk-" -or $statusJson -match "OPENAI" -or $statusJson -match "API_KEY") {
  Write-Error "❌ FAIL: Response contains potential secrets!"
} else {
  Write-Output "✅ PASS: Response contains no secrets"
}
```

---

## Troubleshooting

### Issue: "INTENT is disabled" banner shows but flag is true
**Solution:** 
1. Check if client is calling old endpoint (`/api/system/flags-env` instead of `/api/intent/status`)
2. Clear browser cache
3. Verify `AFU9_INTENT_ENABLED` in server environment (not just client)

### Issue: "Session ID required" error in UI
**Root Cause:** Old UI code path - should be fixed by this implementation

**Verification:**
1. Check browser console for errors
2. Ensure "Send" button is NOT disabled when message is typed
3. Verify auto-create logic triggers

### Issue: 404 on message send when enabled
**Solution:**
1. Verify `AFU9_INTENT_ENABLED=true` in server environment
2. Check `OPENAI_API_KEY` is configured
3. Review server logs for intent-agent errors

---

## Success Criteria

### Scenario 1 (Disabled)
- ✅ Status endpoint returns `enabled: false`
- ✅ UI shows clear warning banner
- ✅ Message creation returns 404
- ✅ No secrets in any response

### Scenario 2 (Enabled)
- ✅ Status endpoint returns `enabled: true`
- ✅ UI shows green "Enabled" badge
- ✅ Full message workflow succeeds
- ✅ Auto-create session works
- ✅ No "Session ID required" error reachable via UI
- ✅ Context pack generation works (optional)

---

## Notes

- This runbook is version-controlled in `docs/runbooks/INTENT_SMOKE_STAGE.md`
- Update if API contracts change
- Can be adapted for production environment with appropriate credentials
