[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$BaseUrl = "https://stage.afu-9.com",

  [Parameter(Mandatory = $false)]
  [string]$UserA = "smoke-user-a",

  [Parameter(Mandatory = $false)]
  [string]$UserB = "smoke-user-b",

  [Parameter(Mandatory = $false)]
  [string]$SmokeKey = $null,

  [Parameter(Mandatory = $false)]
  [switch]$StrictGapFree
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Failed = $false

function Write-Pass([string]$Message) {
  Write-Host "PASS: $Message" -ForegroundColor Green
}

function Write-Fail([string]$Message) {
  Write-Host "FAIL: $Message" -ForegroundColor Red
  $script:Failed = $true
}

function Write-Warn([string]$Message) {
  Write-Host "WARN: $Message" -ForegroundColor Yellow
}

function Write-Info([string]$Message) {
  Write-Host "INFO: $Message" -ForegroundColor DarkGray
}

function Normalize-BaseUrl([string]$Url) {
  return $Url.TrimEnd('/')
}

function Get-Json([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
  try { return ($Text | ConvertFrom-Json) } catch { return $null }
}

function Invoke-Afu9Api {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('GET','POST')][string]$Method,
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$UserId,
    [Parameter(Mandatory = $false)][object]$Body = $null
  )

  $headers = @{ 'x-afu9-sub' = $UserId; 'accept' = 'application/json' }
  if (-not [string]::IsNullOrWhiteSpace($SmokeKey)) { $headers['x-afu9-smoke-key'] = $SmokeKey }

  $params = @{ Method = $Method; Uri = $Url; Headers = $headers }

  if ($null -ne $Body) {
    $params['ContentType'] = 'application/json'
    $params['Body'] = ($Body | ConvertTo-Json -Depth 20)
  }

  $iwr = Get-Command Invoke-WebRequest
  if ($iwr.Parameters.ContainsKey('SkipHttpErrorCheck')) {
    $params['SkipHttpErrorCheck'] = $true
  }

  try {
    $resp = Invoke-WebRequest @params
    $text = $resp.Content
    return [pscustomobject]@{
      Status  = [int]$resp.StatusCode
      Text    = $text
      Json    = (Get-Json -Text $text)
      Headers = $resp.Headers
    }
  } catch {
    $ex = $_.Exception

    if ($null -ne $ex -and ($ex.PSObject.Properties.Name -contains 'Response') -and $null -ne $ex.Response) {
      try {
        $status = [int]$ex.Response.StatusCode
        $reader = New-Object System.IO.StreamReader($ex.Response.GetResponseStream())
        $text = $reader.ReadToEnd()
        return [pscustomobject]@{
          Status  = $status
          Text    = $text
          Json    = (Get-Json -Text $text)
          Headers = $null
        }
      } catch {
        # fallthrough
      }
    }

    throw
  }
}

function Get-SessionIdFromCreateResponse($Json) {
  if ($null -eq $Json) { return $null }

  foreach ($candidate in @('sessionId','session_id','id')) {
    if ($null -ne $Json.$candidate -and -not [string]::IsNullOrWhiteSpace([string]$Json.$candidate)) {
      return [string]$Json.$candidate
    }
  }

  return $null
}

$BaseUrl = Normalize-BaseUrl -Url $BaseUrl

Write-Host "=== AFU-9 E2E Smoke: Intent Sessions (Commit 1340724) ===" -ForegroundColor Cyan
Write-Info "BaseUrl: $BaseUrl"
Write-Info "UserA:  $UserA"
Write-Info "UserB:  $UserB"

if ([string]::IsNullOrWhiteSpace($SmokeKey)) { $SmokeKey = $env:AFU9_SMOKE_KEY }
if ([string]::IsNullOrWhiteSpace($SmokeKey)) {
  Write-Info "SmokeAuth: disabled (no key)"
} else {
  Write-Info "SmokeAuth: enabled"
}

$createUrl = "$BaseUrl/api/intent/sessions"
$getUrlTemplate = "$BaseUrl/api/intent/sessions/{0}"
$appendUrlTemplate = "$BaseUrl/api/intent/sessions/{0}/messages"

# A) Create session as UserA
$createBody = @{ title = "smoke-intent-session $(Get-Date -Format s)"; status = 'active' }
$createRes = Invoke-Afu9Api -Method POST -Url $createUrl -UserId $UserA -Body $createBody

if ($createRes.Status -eq 500) {
  Write-Fail "Create session returned 500. Hint: DB schema/migration missing (user_id?)"
  if ($createRes.Text) { Write-Host $createRes.Text }
  exit 1
}

if (@(200, 201) -notcontains $createRes.Status) {
  Write-Fail "Create session expected 200/201 but got $($createRes.Status)"
  if ($createRes.Text) { Write-Host $createRes.Text }
  exit 1
}

$sessionId = Get-SessionIdFromCreateResponse -Json $createRes.Json
if ([string]::IsNullOrWhiteSpace($sessionId)) {
  Write-Fail "Create session response missing session id (expected field: id/sessionId/session_id)"
  if ($createRes.Text) { Write-Host $createRes.Text }
  exit 1
}

Write-Pass "Create session as UserA (sessionId=$sessionId)"

# B) GET session as UserA -> 200
$getUrl = [string]::Format($getUrlTemplate, $sessionId)
$getARes = Invoke-Afu9Api -Method GET -Url $getUrl -UserId $UserA
if ($getARes.Status -ne 200) {
  Write-Fail "GET session as UserA expected 200 but got $($getARes.Status)"
  if ($getARes.Text) { Write-Host $getARes.Text }
} else {
  Write-Pass "GET session as UserA"
}

# C) GET same session as UserB -> 404 (anti-enumeration)
$getBRes = Invoke-Afu9Api -Method GET -Url $getUrl -UserId $UserB
if ($getBRes.Status -ne 404) {
  Write-Fail "GET session as UserB expected 404 (anti-enumeration) but got $($getBRes.Status)"
  if ($getBRes.Text) { Write-Host $getBRes.Text }
} else {
  Write-Pass "GET session as UserB returns 404"
}

# D) Run 10 parallel "next" (append message) requests as UserA
$appendUrl = [string]::Format($appendUrlTemplate, $sessionId)

Write-Info "Running 10 parallel POSTs to /messages (each creates user+assistant message)"

$runOne = {
  param($i, $url, $user, $smokeKey)

  $headers = @{ 'x-afu9-sub' = $user; 'accept' = 'application/json' }
  if (-not [string]::IsNullOrWhiteSpace($smokeKey)) { $headers['x-afu9-smoke-key'] = $smokeKey }
  $body = @{ content = "smoke-next-$i-$(New-Guid)" } | ConvertTo-Json -Depth 10

  $params = @{ Method = 'POST'; Uri = $url; Headers = $headers; ContentType = 'application/json'; Body = $body }
  $iwr = Get-Command Invoke-WebRequest
  if ($iwr.Parameters.ContainsKey('SkipHttpErrorCheck')) {
    $params['SkipHttpErrorCheck'] = $true
  }

  try {
    $resp = Invoke-WebRequest @params
    $json = $null
    try { $json = $resp.Content | ConvertFrom-Json } catch { }

    $userSeq = $null
    $assistantSeq = $null

    if ($null -ne $json -and $null -ne $json.userMessage -and $null -ne $json.userMessage.seq) {
      $userSeq = [int]$json.userMessage.seq
    }

    if ($null -ne $json -and $null -ne $json.assistantMessage -and $null -ne $json.assistantMessage.seq) {
      $assistantSeq = [int]$json.assistantMessage.seq
    }

    return [pscustomobject]@{
      i            = [int]$i
      status       = [int]$resp.StatusCode
      userSeq      = $userSeq
      assistantSeq = $assistantSeq
      raw          = $resp.Content
    }
  } catch {
    $status = $null
    $raw = $null

    try {
      $ex = $_.Exception
      if ($null -ne $ex -and ($ex.PSObject.Properties.Name -contains 'Response') -and $null -ne $ex.Response) {
        try { $status = [int]$ex.Response.StatusCode } catch { }
        try {
          $reader = New-Object System.IO.StreamReader($ex.Response.GetResponseStream())
          $raw = $reader.ReadToEnd()
        } catch { }
      }
    } catch { }

    return [pscustomobject]@{
      i            = [int]$i
      status       = $status
      userSeq      = $null
      assistantSeq = $null
      raw          = $raw
    }
  }
}

$results = @()
if ($PSVersionTable.PSVersion.Major -ge 7) {
  $results = 1..10 | ForEach-Object -Parallel $runOne -ThrottleLimit 10 -ArgumentList $appendUrl, $UserA, $SmokeKey
} else {
  $jobs = @()
  foreach ($i in 1..10) {
    $jobs += Start-Job -ScriptBlock $runOne -ArgumentList $i, $appendUrl, $UserA, $SmokeKey
  }
  Wait-Job -Job $jobs | Out-Null
  $results = $jobs | Receive-Job
  $jobs | Remove-Job | Out-Null
}

$badStatus = $results | Where-Object { @($null, 200, 201) -notcontains $_.status }
if ($badStatus.Count -gt 0) {
  Write-Fail "Parallel POST /messages: expected all 200/201, got failures: $($badStatus | Select-Object -First 3 | ConvertTo-Json -Depth 5)"
}

$missingSeq = $results | Where-Object { $null -eq $_.userSeq -or $null -eq $_.assistantSeq }
if ($missingSeq.Count -gt 0) {
  Write-Fail "Parallel POST /messages: missing seq fields in response"
}

# Seq checks
$userSeqs = @($results | ForEach-Object { $_.userSeq })
$assistantSeqs = @($results | ForEach-Object { $_.assistantSeq })
$allSeqs = @($userSeqs + $assistantSeqs)

if ($userSeqs.Count -ne 10 -or ($userSeqs | Select-Object -Unique).Count -ne 10) {
  Write-Fail "userMessage.seq must be unique for 10 parallel requests"
} else {
  Write-Pass "userMessage.seq unique across 10 parallel requests"
}

# Each request should reserve a consecutive pair (race-safe seq ownership)
$pairViolations = $results | Where-Object { $null -ne $_.userSeq -and $null -ne $_.assistantSeq -and ($_.assistantSeq -ne ($_.userSeq + 1)) }
if ($pairViolations.Count -gt 0) {
  Write-Fail "assistantMessage.seq must equal userMessage.seq + 1 (pair reservation)"
} else {
  Write-Pass "Each request has consecutive (user,assistant) seq pair"
}

# Combined uniqueness + no gaps for the 20 inserts we just made
$uniqueAll = ($allSeqs | Select-Object -Unique)
if ($uniqueAll.Count -ne 20) {
  Write-Fail "Combined seq values must be unique across all 20 messages"
} else {
  $sorted = $uniqueAll | Sort-Object
  $min = [int]$sorted[0]
  $max = [int]$sorted[-1]
  if (($max - $min + 1) -ne 20) {
    $msg = "Combined seq values are not gap-free (expected 20 consecutive values, got min=$min max=$max)"
    if ($StrictGapFree) {
      Write-Fail $msg
    } else {
      Write-Warn $msg
    }
  } else {
    Write-Pass "Combined seq values are unique and gap-free (20 consecutive values)"
  }
}

if (-not $script:Failed) {
  Write-Host "=== RESULT: PASS ===" -ForegroundColor Green
  exit 0
}

Write-Host "=== RESULT: FAIL ===" -ForegroundColor Red
exit 1


