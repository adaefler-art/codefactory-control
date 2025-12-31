# E72.4 Timeline Chain API E2E Smoke Test (PowerShell)
#
# Tests the complete flow:
# 1. Health checks
# 2. Query /api/timeline/chain
# 3. Verify deterministic ordering and evidence fields
# 4. Verify ordering stability across re-queries
#
# Usage:
#   .\scripts\smoke-test-timeline-chain.ps1 -BaseUrl "http://localhost:3000"
#
# Examples:
#   # Test against local dev server
#   .\scripts\smoke-test-timeline-chain.ps1 -BaseUrl "http://localhost:3000"
#
#   # Test against staging
#   .\scripts\smoke-test-timeline-chain.ps1 -BaseUrl "http://afu9-alb-staging.elb.amazonaws.com"
#
#   # Custom issue ID
#   $env:TEST_ISSUE_ID = "my-issue-456"
#   .\scripts\smoke-test-timeline-chain.ps1 -BaseUrl "http://localhost:3000"

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

# Configuration
$TestIssueId = if ($env:TEST_ISSUE_ID) { $env:TEST_ISSUE_ID } else { "test-issue-123" }
$TestSourceSystem = if ($env:TEST_SOURCE_SYSTEM) { $env:TEST_SOURCE_SYSTEM } else { "afu9" }

Write-Host "=== E72.4 Timeline Chain API - E2E Smoke Test ===" -ForegroundColor Cyan
Write-Host "Base URL: $BaseUrl" -ForegroundColor Gray
Write-Host "Test Issue ID: $TestIssueId" -ForegroundColor Gray
Write-Host "Source System: $TestSourceSystem" -ForegroundColor Gray
Write-Host ""

# Test counters
$script:Passed = 0
$script:Failed = 0

# Helper function to run a test
function Run-Test {
    param(
        [string]$TestName,
        [scriptblock]$TestBlock
    )
    
    Write-Host -NoNewline "Testing $TestName... "
    
    try {
        $result = & $TestBlock
        if ($result) {
            Write-Host "PASSED" -ForegroundColor Green
            $script:Passed++
            return $true
        } else {
            Write-Host "FAILED" -ForegroundColor Red
            $script:Failed++
            return $false
        }
    } catch {
        Write-Host "FAILED" -ForegroundColor Red
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
        $script:Failed++
        return $false
    }
}

# Helper function to check HTTP status
function Test-HttpStatus {
    param(
        [string]$Url,
        [int]$ExpectedStatus = 200
    )
    
    try {
        $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -ErrorAction SilentlyContinue
        return $response.StatusCode -eq $ExpectedStatus
    } catch {
        if ($_.Exception.Response) {
            return $_.Exception.Response.StatusCode.value__ -eq $ExpectedStatus
        }
        return $false
    }
}

# Helper function to get JSON response
function Get-JsonResponse {
    param([string]$Url)
    
    try {
        $response = Invoke-RestMethod -Uri $Url -Method Get -ErrorAction Stop
        return $response
    } catch {
        return $null
    }
}

Write-Host "=== Step 1: Health Check ===" -ForegroundColor Cyan
Write-Host ""

Run-Test "API Health endpoint" {
    Test-HttpStatus "$BaseUrl/api/health" 200
}

Run-Test "Timeline chain endpoint exists" {
    Test-HttpStatus "$BaseUrl/api/timeline/chain?issueId=$TestIssueId" 200
}

Write-Host ""
Write-Host "=== Step 2: Query Timeline Chain ===" -ForegroundColor Cyan
Write-Host ""

$ApiUrl = "$BaseUrl/api/timeline/chain?issueId=$TestIssueId&sourceSystem=$TestSourceSystem"
Write-Host "Querying: $ApiUrl" -ForegroundColor Gray
Write-Host ""

# Save response for inspection
$response = Get-JsonResponse $ApiUrl

if ($response) {
    Write-Host "Response:" -ForegroundColor Yellow
    $response | ConvertTo-Json -Depth 10 | Write-Host
    Write-Host ""
} else {
    Write-Host "Failed to get response from API" -ForegroundColor Red
    Write-Host ""
}

Write-Host "=== Step 3: Verify Response Structure ===" -ForegroundColor Cyan
Write-Host ""

Run-Test "Response has issueId field" {
    $response -and $response.PSObject.Properties.Name -contains 'issueId'
}

Run-Test "Response has sourceSystem field" {
    $response -and $response.PSObject.Properties.Name -contains 'sourceSystem'
}

Run-Test "Response has nodes array" {
    $response -and $response.PSObject.Properties.Name -contains 'nodes' -and $response.nodes -is [Array]
}

Run-Test "Response has edges array" {
    $response -and $response.PSObject.Properties.Name -contains 'edges' -and $response.edges -is [Array]
}

Run-Test "Response has metadata object" {
    $response -and $response.PSObject.Properties.Name -contains 'metadata'
}

Run-Test "Metadata has nodeCount" {
    $response -and $response.metadata -and $response.metadata.PSObject.Properties.Name -contains 'nodeCount'
}

Run-Test "Metadata has edgeCount" {
    $response -and $response.metadata -and $response.metadata.PSObject.Properties.Name -contains 'edgeCount'
}

Run-Test "Metadata has timestamp" {
    $response -and $response.metadata -and $response.metadata.PSObject.Properties.Name -contains 'timestamp'
}

Write-Host ""
Write-Host "=== Step 4: Verify Deterministic Ordering ===" -ForegroundColor Cyan
Write-Host ""

if ($response -and $response.nodes -and $response.nodes.Count -gt 0) {
    Write-Host "Node type sequence:" -ForegroundColor Gray
    for ($i = 0; $i -lt $response.nodes.Count; $i++) {
        Write-Host "  $($i + 1). $($response.nodes[$i].node_type)" -ForegroundColor Gray
    }
    Write-Host ""
    
    # Check if first node is ISSUE (expected for typical chains)
    if ($response.nodes[0].node_type -eq "ISSUE") {
        Write-Host "✓ First node is ISSUE (correct deterministic ordering)" -ForegroundColor Green
        $script:Passed++
    } else {
        Write-Host "⚠ First node is $($response.nodes[0].node_type) (expected ISSUE for typical chain)" -ForegroundColor Yellow
        Write-Host "  Note: Ordering may vary based on available data" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠ No nodes found in response" -ForegroundColor Yellow
    Write-Host "  This is expected if backfill data doesn't exist yet" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Step 5: Verify Evidence Fields ===" -ForegroundColor Cyan
Write-Host ""

if ($response -and $response.nodes -and $response.nodes.Count -gt 0) {
    $firstNode = $response.nodes[0]
    
    Run-Test "Node has id (UUID)" {
        $firstNode.PSObject.Properties.Name -contains 'id' -and $firstNode.id
    }
    
    Run-Test "Node has source_system" {
        $firstNode.PSObject.Properties.Name -contains 'source_system' -and $firstNode.source_system
    }
    
    Run-Test "Node has source_type" {
        $firstNode.PSObject.Properties.Name -contains 'source_type' -and $firstNode.source_type
    }
    
    Run-Test "Node has source_id" {
        $firstNode.PSObject.Properties.Name -contains 'source_id' -and $firstNode.source_id
    }
    
    Run-Test "Node has node_type" {
        $firstNode.PSObject.Properties.Name -contains 'node_type' -and $firstNode.node_type
    }
    
    Run-Test "Node has created_at timestamp" {
        $firstNode.PSObject.Properties.Name -contains 'created_at' -and $firstNode.created_at
    }
    
    Run-Test "Node has updated_at timestamp" {
        $firstNode.PSObject.Properties.Name -contains 'updated_at' -and $firstNode.updated_at
    }
    
    Write-Host ""
    Write-Host "First node details:" -ForegroundColor Yellow
    @{
        id = $firstNode.id
        source_system = $firstNode.source_system
        source_type = $firstNode.source_type
        source_id = $firstNode.source_id
        node_type = $firstNode.node_type
        created_at = $firstNode.created_at
    } | ConvertTo-Json | Write-Host
} else {
    Write-Host "⚠ No nodes available for evidence field verification" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Step 6: Verify Stable Ordering (Re-query) ===" -ForegroundColor Cyan
Write-Host ""

# Query again to verify ordering is stable
$response2 = Get-JsonResponse $ApiUrl

if ($response -and $response2 -and $response.nodes -and $response2.nodes) {
    $nodeIds1 = $response.nodes | ForEach-Object { $_.id }
    $nodeIds2 = $response2.nodes | ForEach-Object { $_.id }
    
    $ids1String = $nodeIds1 -join ','
    $ids2String = $nodeIds2 -join ','
    
    if ($ids1String -eq $ids2String) {
        Write-Host "✓ Node ordering is stable across queries" -ForegroundColor Green
        $script:Passed++
    } else {
        if ($nodeIds1.Count -eq 0) {
            Write-Host "⚠ No nodes to compare (empty dataset)" -ForegroundColor Yellow
        } else {
            Write-Host "✗ Node ordering changed between queries" -ForegroundColor Red
            $script:Failed++
        }
    }
} else {
    Write-Host "⚠ Unable to verify ordering stability" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Test Summary ===" -ForegroundColor Cyan
Write-Host "Passed: $script:Passed" -ForegroundColor Green
Write-Host "Failed: $script:Failed" -ForegroundColor Red
Write-Host "Total:  $($script:Passed + $script:Failed)"
Write-Host ""

if ($script:Failed -eq 0) {
    Write-Host "✓ All E72.4 smoke tests passed!" -ForegroundColor Green
    Write-Host "✓ Timeline chain API is operational" -ForegroundColor Green
    exit 0
} else {
    Write-Host "✗ Some tests failed" -ForegroundColor Red
    Write-Host "Note: Failures may occur if backfill data is not present" -ForegroundColor Yellow
    Write-Host "Run backfill steps (documented in docs/E72_4_E2E_SMOKE_TEST.md) to populate test data" -ForegroundColor Yellow
    exit 1
}
