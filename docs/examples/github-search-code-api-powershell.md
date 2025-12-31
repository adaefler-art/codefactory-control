# GitHub Search Code API - PowerShell Examples
# Reference: I714 (E71.4) - Tool searchCode

# Base URL (adjust for your environment)
$BaseUrl = "http://localhost:3000"
$ApiPath = "/api/integrations/github/search-code"

# ============================================
# Example 1: Basic Code Search
# ============================================
Write-Host "Example 1: Basic Code Search" -ForegroundColor Cyan

$params = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    query = "searchCode"
}

$response = Invoke-RestMethod `
    -Uri "$BaseUrl$ApiPath" `
    -Method GET `
    -Body $params

Write-Host "Found $($response.items.Count) results"
$response.items | ForEach-Object {
    Write-Host "- $($_.path) (score: $($_.score), hash: $($_.match.previewHash))"
}

# ============================================
# Example 2: Search with Path Prefix
# ============================================
Write-Host "`nExample 2: Search with Path Prefix" -ForegroundColor Cyan

$params = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    query = "function"
    pathPrefix = "control-center/src/lib/github"
}

$response = Invoke-RestMethod `
    -Uri "$BaseUrl$ApiPath" `
    -Method GET `
    -Body $params

Write-Host "Found $($response.items.Count) results in control-center/src/lib/github/"

# ============================================
# Example 3: Search with File Globs
# ============================================
Write-Host "`nExample 3: Search with File Globs" -ForegroundColor Cyan

$params = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    query = "interface"
    fileGlobs = "*.ts,*.tsx"
}

$response = Invoke-RestMethod `
    -Uri "$BaseUrl$ApiPath" `
    -Method GET `
    -Body $params

Write-Host "Found $($response.items.Count) TypeScript files containing 'interface'"

# ============================================
# Example 4: Pagination
# ============================================
Write-Host "`nExample 4: Pagination" -ForegroundColor Cyan

# First page
$params = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    query = "test"
    limit = 10
}

$page1 = Invoke-RestMethod `
    -Uri "$BaseUrl$ApiPath" `
    -Method GET `
    -Body $params

Write-Host "Page 1: $($page1.items.Count) results"
Write-Host "Has next page: $($null -ne $page1.pageInfo.nextCursor)"

# Second page (if available)
if ($page1.pageInfo.nextCursor) {
    $params.cursor = $page1.pageInfo.nextCursor
    
    $page2 = Invoke-RestMethod `
        -Uri "$BaseUrl$ApiPath" `
        -Method GET `
        -Body $params
    
    Write-Host "Page 2: $($page2.items.Count) results"
}

# ============================================
# Example 5: All Optional Parameters
# ============================================
Write-Host "`nExample 5: All Optional Parameters" -ForegroundColor Cyan

$params = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    query = "searchCode"
    branch = "main"
    pathPrefix = "control-center"
    fileGlobs = "*.ts"
    caseSensitive = $true
    limit = 5
}

$response = Invoke-RestMethod `
    -Uri "$BaseUrl$ApiPath" `
    -Method GET `
    -Body $params

Write-Host "Found $($response.items.Count) results with all filters"
Write-Host "Branch warning: $($response.meta.branchWarning)"

# ============================================
# Example 6: Inspect Result Metadata
# ============================================
Write-Host "`nExample 6: Inspect Result Metadata" -ForegroundColor Cyan

$params = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    query = "test"
    limit = 1
}

$response = Invoke-RestMethod `
    -Uri "$BaseUrl$ApiPath" `
    -Method GET `
    -Body $params

if ($response.items.Count -gt 0) {
    $item = $response.items[0]
    
    Write-Host "Result Details:"
    Write-Host "  Path: $($item.path)"
    Write-Host "  SHA: $($item.sha)"
    Write-Host "  Score: $($item.score)"
    Write-Host "  Preview length: $($item.match.preview.Length)"
    Write-Host "  Preview SHA-256: $($item.match.previewSha256)"
    Write-Host "  Preview short hash: $($item.match.previewHash)"
}

Write-Host "`nMetadata:"
Write-Host "  Generated at: $($response.meta.generatedAt)"
Write-Host "  Ordering: $($response.meta.ordering)"
Write-Host "  Branch effective: $($response.meta.branchEffective)"

# ============================================
# Example 7: Error Handling
# ============================================
Write-Host "`nExample 7: Error Handling" -ForegroundColor Cyan

# Query too short
try {
    $params = @{
        owner = "adaefler-art"
        repo = "codefactory-control"
        query = "a"  # Too short
    }
    
    Invoke-RestMethod `
        -Uri "$BaseUrl$ApiPath" `
        -Method GET `
        -Body $params
}
catch {
    $error = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "Error: $($error.code) - $($error.error)" -ForegroundColor Red
}

# Repository not allowed
try {
    $params = @{
        owner = "some-other-owner"
        repo = "not-allowed-repo"
        query = "test"
    }
    
    Invoke-RestMethod `
        -Uri "$BaseUrl$ApiPath" `
        -Method GET `
        -Body $params
}
catch {
    $error = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "Error: $($error.code) - $($error.error)" -ForegroundColor Red
}

# ============================================
# Example 8: Export Results to CSV
# ============================================
Write-Host "`nExample 8: Export Results to CSV" -ForegroundColor Cyan

$params = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    query = "function"
    limit = 50
}

$response = Invoke-RestMethod `
    -Uri "$BaseUrl$ApiPath" `
    -Method GET `
    -Body $params

$results = $response.items | Select-Object `
    path, `
    sha, `
    score, `
    @{Name='previewHash'; Expression={$_.match.previewHash}}, `
    @{Name='preview'; Expression={$_.match.preview}}

$results | Export-Csv -Path "search-results.csv" -NoTypeInformation
Write-Host "Exported $($results.Count) results to search-results.csv"

# ============================================
# Example 9: Collect All Pages
# ============================================
Write-Host "`nExample 9: Collect All Pages" -ForegroundColor Cyan

$allItems = @()
$cursor = $null

do {
    $params = @{
        owner = "adaefler-art"
        repo = "codefactory-control"
        query = "test"
        limit = 20
    }
    
    if ($cursor) {
        $params.cursor = $cursor
    }
    
    $response = Invoke-RestMethod `
        -Uri "$BaseUrl$ApiPath" `
        -Method GET `
        -Body $params
    
    $allItems += $response.items
    $cursor = $response.pageInfo.nextCursor
    
    Write-Host "Fetched page: $($response.items.Count) items, Total: $($allItems.Count)"
    
} while ($cursor)

Write-Host "Total items collected: $($allItems.Count)"
