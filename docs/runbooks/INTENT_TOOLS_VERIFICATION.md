# INTENT Tools Verification (Staging)

## Prerequisites
- Staging deployment with AFU9_INTENT_ENABLED=true
- Valid smoke key or authenticated session

## Verification Steps

### 1. Test Change Request Workflow

```powershell
$Base = "https://stage.afu-9.com"
$Headers = @{
  "Cookie" = "your-session-cookie-here"
}

# Create new session
$session = Invoke-RestMethod -Method Post -Uri "$Base/api/intent/sessions" -Headers $Headers
$sessionId = $session.id

# Ask INTENT about CR
$message1 = @{
  content = "Siehst du einen Change Request in dieser Session?"
} | ConvertTo-Json

$response1 = Invoke-RestMethod -Method Post `
  -Uri "$Base/api/intent/sessions/$sessionId/messages" `
  -Headers $Headers -ContentType "application/json" -Body $message1

# Should return: "Nein, es existiert noch kein Change Request"
Write-Output $response1.assistantMessage.content

# Create CR via INTENT
$message2 = @{
  content = "Erstelle einen Change Request für ein neues Feature: Dark Mode Support"
} | ConvertTo-Json

$response2 = Invoke-RestMethod -Method Post `
  -Uri "$Base/api/intent/sessions/$sessionId/messages" `
  -Headers $Headers -ContentType "application/json" -Body $message2

# Should call save_change_request tool
Write-Output $response2.assistantMessage.content

# Verify CR exists
$message3 = @{
  content = "Zeige mir den aktuellen Change Request"
} | ConvertTo-Json

$response3 = Invoke-RestMethod -Method Post `
  -Uri "$Base/api/intent/sessions/$sessionId/messages" `
  -Headers $Headers -ContentType "application/json" -Body $message3

# Should call get_change_request and return CR JSON
Write-Output $response3.assistantMessage.content
```

### 2. Test GitHub Publishing

```powershell
# Validate CR first
$message4 = @{
  content = "Validiere den Change Request"
} | ConvertTo-Json

$response4 = Invoke-RestMethod -Method Post `
  -Uri "$Base/api/intent/sessions/$sessionId/messages" `
  -Headers $Headers -ContentType "application/json" -Body $message4

# Publish to GitHub
$message5 = @{
  content = "Publiziere den Change Request als GitHub Issue"
} | ConvertTo-Json

$response5 = Invoke-RestMethod -Method Post `
  -Uri "$Base/api/intent/sessions/$sessionId/messages" `
  -Headers $Headers -ContentType "application/json" -Body $message5

# Should return GitHub issue URL
Write-Output $response5.assistantMessage.content
```

## Expected Results

✅ INTENT calls tools when asked about CR
✅ CR can be created, validated, and published via chat
✅ Tool errors are returned verbatim (no hallucination)
✅ GitHub issue is created/updated idempotently
