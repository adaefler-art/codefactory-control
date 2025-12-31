# E71.3: GitHub Read File API - PowerShell Examples

## Overview

This document provides PowerShell examples for using the GitHub Read File API endpoint.

**Endpoint**: `GET /api/integrations/github/read-file`

**Base URL**: `http://localhost:3000` (development) or your deployed URL

## Prerequisites

```powershell
# Set your base URL
$BaseUrl = "http://localhost:3000"
# Or for production:
# $BaseUrl = "https://your-control-center.example.com"
```

## Example 1: Basic File Reading

Read a complete file with default settings:

```powershell
# Read README.md from main branch
$response = Invoke-RestMethod `
  -Uri "$BaseUrl/api/integrations/github/read-file" `
  -Method Get `
  -Body @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    branch = "main"
    path = "README.md"
  }

# Display results
Write-Host "File: $($response.meta.path)"
Write-Host "Snippet Hash: $($response.meta.snippetHash)"
Write-Host "Total Lines: $($response.meta.totalLines)"
Write-Host "Truncated: $($response.meta.truncated)"
Write-Host "`nContent (first 200 chars):"
Write-Host $response.content.text.Substring(0, [Math]::Min(200, $response.content.text.Length))
```

## Example 2: Read Specific Line Range

Read lines 10-20 from a file:

```powershell
$response = Invoke-RestMethod `
  -Uri "$BaseUrl/api/integrations/github/read-file" `
  -Method Get `
  -Body @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    branch = "main"
    path = "control-center/src/lib/github/read-file.ts"
    startLine = 10
    endLine = 20
  }

# Display line-by-line with numbers
Write-Host "Lines $($response.meta.range.startLine)-$($response.meta.range.endLine):"
foreach ($line in $response.content.lines) {
  Write-Host "$($line.n): $($line.text)"
}

# Evidence metadata
Write-Host "`nEvidence:"
Write-Host "  Blob SHA: $($response.meta.blobSha)"
Write-Host "  Content SHA-256: $($response.meta.contentSha256)"
Write-Host "  Snippet Hash: $($response.meta.snippetHash)"
```

## Example 3: Read with Size Limit

Read up to 50KB with truncation:

```powershell
$response = Invoke-RestMethod `
  -Uri "$BaseUrl/api/integrations/github/read-file" `
  -Method Get `
  -Body @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    branch = "main"
    path = "control-center/package-lock.json"
    maxBytes = 50000
  }

Write-Host "Was truncated: $($response.meta.truncated)"
Write-Host "Content size: $($response.content.text.Length) chars"
```

## Example 4: Read Without Line Numbers

Read file without the lines array (smaller response):

```powershell
$response = Invoke-RestMethod `
  -Uri "$BaseUrl/api/integrations/github/read-file" `
  -Method Get `
  -Body @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    branch = "main"
    path = "package.json"
    includeLineNumbers = "false"
  }

# Response only contains text, not lines array
Write-Host $response.content.text
```

## Example 5: Read Without SHA Metadata

Read file without blob/commit SHA (minimal metadata):

```powershell
$response = Invoke-RestMethod `
  -Uri "$BaseUrl/api/integrations/github/read-file" `
  -Method Get `
  -Body @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    branch = "main"
    path = "README.md"
    includeSha = "false"
  }

Write-Host "Blob SHA: $($response.meta.blobSha)"  # Will be null
Write-Host "Content SHA-256: $($response.meta.contentSha256)"  # Still included
```

## Example 6: Error Handling

Handle different error cases:

```powershell
# Function to call API with error handling
function Read-GitHubFile {
  param(
    [string]$Owner,
    [string]$Repo,
    [string]$Path,
    [string]$Branch = "main",
    [int]$StartLine = 0,
    [int]$EndLine = 0
  )

  try {
    $body = @{
      owner = $Owner
      repo = $Repo
      branch = $Branch
      path = $Path
    }

    if ($StartLine -gt 0 -and $EndLine -gt 0) {
      $body.startLine = $StartLine
      $body.endLine = $EndLine
    }

    $response = Invoke-RestMethod `
      -Uri "$BaseUrl/api/integrations/github/read-file" `
      -Method Get `
      -Body $body `
      -ErrorAction Stop

    return $response
  }
  catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $errorBody = $_.ErrorDetails.Message | ConvertFrom-Json

    switch ($statusCode) {
      400 {
        Write-Error "Bad Request: $($errorBody.error) (Code: $($errorBody.code))"
      }
      403 {
        Write-Error "Access Denied: $($errorBody.error)"
      }
      413 {
        Write-Error "File Too Large: $($errorBody.error)"
      }
      415 {
        Write-Error "Binary/Unsupported Encoding: $($errorBody.error)"
      }
      default {
        Write-Error "API Error ($statusCode): $($errorBody.error)"
      }
    }
    return $null
  }
}

# Example usage
$result = Read-GitHubFile -Owner "adaefler-art" -Repo "codefactory-control" -Path "README.md"
if ($result) {
  Write-Host "Successfully read file: $($result.meta.path)"
}

# Try reading with invalid path (will error)
$result = Read-GitHubFile -Owner "adaefler-art" -Repo "codefactory-control" -Path "../etc/passwd"
# Output: Bad Request: Invalid path '../etc/passwd': Parent directory traversal (..) not allowed (Code: INVALID_PATH)
```

## Example 7: Evidence Verification

Verify file content hasn't changed by comparing snippet hashes:

```powershell
# Read file and store evidence
$baseline = Invoke-RestMethod `
  -Uri "$BaseUrl/api/integrations/github/read-file" `
  -Method Get `
  -Body @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    branch = "main"
    path = "README.md"
  }

Write-Host "Baseline Evidence:"
Write-Host "  Snippet Hash: $($baseline.meta.snippetHash)"
Write-Host "  Generated At: $($baseline.meta.generatedAt)"
Write-Host "  Blob SHA: $($baseline.meta.blobSha)"

# Later, verify content hasn't changed
Start-Sleep -Seconds 5

$verification = Invoke-RestMethod `
  -Uri "$BaseUrl/api/integrations/github/read-file" `
  -Method Get `
  -Body @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    branch = "main"
    path = "README.md"
  }

if ($baseline.meta.snippetHash -eq $verification.meta.snippetHash) {
  Write-Host "`n✅ Content verified - hashes match"
} else {
  Write-Host "`n⚠️  Content changed - hashes differ"
  Write-Host "  Baseline: $($baseline.meta.snippetHash)"
  Write-Host "  Current:  $($verification.meta.snippetHash)"
}
```

## Example 8: Batch File Reading

Read multiple files in parallel:

```powershell
$files = @(
  "README.md",
  "package.json",
  "tsconfig.json"
)

$jobs = @()
foreach ($file in $files) {
  $jobs += Start-Job -ScriptBlock {
    param($BaseUrl, $Owner, $Repo, $Path)
    Invoke-RestMethod `
      -Uri "$BaseUrl/api/integrations/github/read-file" `
      -Method Get `
      -Body @{
        owner = $Owner
        repo = $Repo
        branch = "main"
        path = $Path
      }
  } -ArgumentList $BaseUrl, "adaefler-art", "codefactory-control", $file
}

# Wait for all jobs and collect results
$results = $jobs | Wait-Job | Receive-Job

# Display manifest
Write-Host "Evidence Manifest:"
foreach ($result in $results) {
  Write-Host "  $($result.meta.path):"
  Write-Host "    Snippet Hash: $($result.meta.snippetHash)"
  Write-Host "    Total Lines:  $($result.meta.totalLines)"
  Write-Host "    Blob SHA:     $($result.meta.blobSha)"
}

# Cleanup jobs
$jobs | Remove-Job
```

## Example 9: Export to File

Save file content to local filesystem:

```powershell
$response = Invoke-RestMethod `
  -Uri "$BaseUrl/api/integrations/github/read-file" `
  -Method Get `
  -Body @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    branch = "main"
    path = "control-center/src/lib/github/read-file.ts"
  }

# Create local copy
$localPath = ".\downloaded-read-file.ts"
$response.content.text | Out-File -FilePath $localPath -Encoding UTF8

Write-Host "File saved to: $localPath"
Write-Host "Snippet hash for verification: $($response.meta.snippetHash)"

# Save metadata separately
$metadata = @{
  path = $response.meta.path
  snippetHash = $response.meta.snippetHash
  contentSha256 = $response.meta.contentSha256
  blobSha = $response.meta.blobSha
  generatedAt = $response.meta.generatedAt
  totalLines = $response.meta.totalLines
} | ConvertTo-Json

$metadata | Out-File -FilePath ".\downloaded-read-file.meta.json" -Encoding UTF8
Write-Host "Metadata saved to: .\downloaded-read-file.meta.json"
```

## Query Parameter Reference

| Parameter | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `owner` | Yes | string | - | Repository owner |
| `repo` | Yes | string | - | Repository name |
| `path` | Yes | string | - | File path (POSIX) |
| `branch` | No | string | `"main"` | Branch name |
| `startLine` | No | number | - | Start line (1-based, requires `endLine`) |
| `endLine` | No | number | - | End line (1-based, requires `startLine`) |
| `maxBytes` | No | number | `200000` | Max bytes (1-1000000) |
| `includeSha` | No | boolean | `true` | Include blob/commit SHA |
| `includeLineNumbers` | No | boolean | `true` | Include lines array |

## Response Structure

```json
{
  "meta": {
    "owner": "string",
    "repo": "string",
    "branch": "string",
    "path": "string",
    "blobSha": "string | null",
    "commitSha": "string | null",
    "contentSha256": "string",
    "snippetHash": "string",
    "encoding": "utf-8",
    "generatedAt": "ISO-8601 timestamp",
    "truncated": boolean,
    "range": { "startLine": number, "endLine": number } | null,
    "totalLines": number | null
  },
  "content": {
    "text": "string",
    "lines": [
      { "n": number, "text": "string" }
    ] // Optional, if includeLineNumbers=true
  }
}
```

## Error Response Structure

```json
{
  "error": "string",
  "code": "ERROR_CODE",
  "details": {
    "owner": "string",
    "repo": "string",
    "path": "string",
    // ... additional context
  }
}
```

## Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `INVALID_PARAMS` | Missing or invalid query parameters |
| 400 | `INVALID_PATH` | Path validation failed (traversal, backslashes, etc.) |
| 400 | `RANGE_INVALID` | Invalid line range (endLine < startLine, etc.) |
| 400 | `NOT_A_FILE` | Path points to directory or non-file |
| 403 | `REPO_NOT_ALLOWED` | Repository not in policy allowlist |
| 413 | `FILE_TOO_LARGE` | File exceeds size limits |
| 415 | `BINARY_OR_UNSUPPORTED_ENCODING` | File is binary or not UTF-8 |
| 500 | `GITHUB_API_ERROR` | GitHub API failure |
| 500 | `AUTH_MISCONFIGURED` | GitHub App authentication issue |

## Testing

```powershell
# Test the API is running
try {
  $response = Invoke-RestMethod `
    -Uri "$BaseUrl/api/integrations/github/read-file" `
    -Method Get `
    -Body @{
      owner = "adaefler-art"
      repo = "codefactory-control"
      branch = "main"
      path = "README.md"
    } `
    -ErrorAction Stop
  
  Write-Host "✅ API is working"
  Write-Host "   Snippet Hash: $($response.meta.snippetHash)"
}
catch {
  Write-Host "❌ API test failed: $($_.Exception.Message)"
}
```
