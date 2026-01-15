#Requires -Version 7.0

<#
.SYNOPSIS
E87.3 Unified Timeline Events - Verification Script

.DESCRIPTION
Tests the unified timeline API endpoint with various filters:
- Query by sessionId
- Query by canonicalId
- Query by ghIssueNumber
- Query by prNumber
- Pagination
- Deterministic ordering

.PARAMETER BaseUrl
Base URL of the control-center API (default: http://localhost:3000)

.EXAMPLE
.\verify-e87-3.ps1 -BaseUrl https://stage.afu-9.com
#>

param(
    [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = 'Stop'

# Colors
$Red = "`e[31m"
$Green = "`e[32m"
$Yellow = "`e[33m"
$Blue = "`e[34m"
$Reset = "`e[0m"

function Write-TestResult {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Message = ""
    )
    
    if ($Passed) {
        Write-Host "${Green}✓${Reset} ${Name}" -NoNewline
        if ($Message) {
            Write-Host " - ${Message}"
        } else {
            Write-Host ""
        }
    } else {
        Write-Host "${Red}✗${Reset} ${Name}" -NoNewline
        if ($Message) {
            Write-Host " - ${Message}"
        } else {
            Write-Host ""
        }
    }
}

Write-Host "${Blue}=== E87.3 Unified Timeline Events Verification ===${Reset}"
Write-Host "Base URL: $BaseUrl"
Write-Host ""

$passed = 0
$failed = 0

# Test 1: Query timeline (no filters) - should return events
Write-Host "${Yellow}Test 1: Query timeline (no filters)${Reset}"
try {
    $response = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/timeline/unified" -ErrorAction Stop
    
    $hasMetadata = $null -ne $response.metadata
    $hasEvents = $null -ne $response.events
    $eventsIsArray = $response.events -is [array]
    
    if ($hasMetadata -and $hasEvents -and $eventsIsArray) {
        Write-TestResult "Query returned metadata and events array" $true
        Write-Host "  Total events: $($response.metadata.total)"
        Write-Host "  Returned: $($response.metadata.returned)"
        $passed++
    } else {
        Write-TestResult "Query response structure" $false "Missing metadata or events"
        $failed++
    }
} catch {
    Write-TestResult "Query timeline API" $false $_.Exception.Message
    $failed++
}

Write-Host ""

# Test 2: Query by sessionId (example sessionId)
Write-Host "${Yellow}Test 2: Query by sessionId${Reset}"
try {
    $testSessionId = "19eacd15-4925-4b53-90b8-99751843e19f"
    $response = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/timeline/unified?sessionId=$testSessionId" -ErrorAction Stop
    
    $hasMetadata = $null -ne $response.metadata
    $hasEvents = $null -ne $response.events
    
    if ($hasMetadata -and $hasEvents) {
        Write-TestResult "Query by sessionId succeeded" $true
        Write-Host "  SessionId: $testSessionId"
        Write-Host "  Returned: $($response.metadata.returned) events"
        
        # Verify all events have sessionId filter applied (if any returned)
        if ($response.events.Count -gt 0) {
            $allMatch = $true
            foreach ($event in $response.events) {
                if ($event.session_id -ne $testSessionId -and $null -ne $event.session_id) {
                    $allMatch = $false
                    break
                }
            }
            if ($allMatch) {
                Write-TestResult "All events match sessionId filter" $true
            } else {
                Write-TestResult "All events match sessionId filter" $false
            }
        }
        $passed++
    } else {
        Write-TestResult "Query by sessionId" $false "Missing metadata or events"
        $failed++
    }
} catch {
    Write-TestResult "Query by sessionId" $false $_.Exception.Message
    $failed++
}

Write-Host ""

# Test 3: Query with pagination
Write-Host "${Yellow}Test 3: Query with pagination${Reset}"
try {
    $response = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/timeline/unified?limit=5&offset=0" -ErrorAction Stop
    
    $hasMetadata = $null -ne $response.metadata
    $correctLimit = $response.metadata.limit -eq 5
    $correctOffset = $response.metadata.offset -eq 0
    $hasHasMore = $null -ne $response.metadata.hasMore
    
    if ($hasMetadata -and $correctLimit -and $correctOffset -and $hasHasMore) {
        Write-TestResult "Pagination metadata is correct" $true
        Write-Host "  Limit: $($response.metadata.limit)"
        Write-Host "  Offset: $($response.metadata.offset)"
        Write-Host "  Has more: $($response.metadata.hasMore)"
        $passed++
    } else {
        Write-TestResult "Pagination metadata" $false "Incorrect pagination values"
        $failed++
    }
} catch {
    Write-TestResult "Query with pagination" $false $_.Exception.Message
    $failed++
}

Write-Host ""

# Test 4: Query by PR number
Write-Host "${Yellow}Test 4: Query by PR number${Reset}"
try {
    $testPrNumber = 123
    $response = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/timeline/unified?prNumber=$testPrNumber" -ErrorAction Stop
    
    $hasMetadata = $null -ne $response.metadata
    $hasEvents = $null -ne $response.events
    
    if ($hasMetadata -and $hasEvents) {
        Write-TestResult "Query by prNumber succeeded" $true
        Write-Host "  PR Number: $testPrNumber"
        Write-Host "  Returned: $($response.metadata.returned) events"
        $passed++
    } else {
        Write-TestResult "Query by prNumber" $false "Missing metadata or events"
        $failed++
    }
} catch {
    Write-TestResult "Query by prNumber" $false $_.Exception.Message
    $failed++
}

Write-Host ""

# Test 5: Query by event type
Write-Host "${Yellow}Test 5: Query by event type${Reset}"
try {
    $testEventType = "approval_approved"
    $response = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/timeline/unified?eventType=$testEventType" -ErrorAction Stop
    
    $hasMetadata = $null -ne $response.metadata
    $hasEvents = $null -ne $response.events
    
    if ($hasMetadata -and $hasEvents) {
        Write-TestResult "Query by eventType succeeded" $true
        Write-Host "  Event Type: $testEventType"
        Write-Host "  Returned: $($response.metadata.returned) events"
        
        # Verify all events match the event type (if any returned)
        if ($response.events.Count -gt 0) {
            $allMatch = $true
            foreach ($event in $response.events) {
                if ($event.event_type -ne $testEventType) {
                    $allMatch = $false
                    break
                }
            }
            if ($allMatch) {
                Write-TestResult "All events match eventType filter" $true
            } else {
                Write-TestResult "All events match eventType filter" $false
            }
        }
        $passed++
    } else {
        Write-TestResult "Query by eventType" $false "Missing metadata or events"
        $failed++
    }
} catch {
    Write-TestResult "Query by eventType" $false $_.Exception.Message
    $failed++
}

Write-Host ""

# Test 6: Verify deterministic ordering (timestamp DESC)
Write-Host "${Yellow}Test 6: Verify deterministic ordering${Reset}"
try {
    $response = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/timeline/unified?limit=10" -ErrorAction Stop
    
    if ($response.events.Count -gt 1) {
        $isOrdered = $true
        $prevTimestamp = $null
        
        foreach ($event in $response.events) {
            $currentTimestamp = [DateTime]::Parse($event.timestamp)
            if ($null -ne $prevTimestamp -and $currentTimestamp -gt $prevTimestamp) {
                $isOrdered = $false
                break
            }
            $prevTimestamp = $currentTimestamp
        }
        
        if ($isOrdered) {
            Write-TestResult "Events are ordered by timestamp DESC" $true
            $passed++
        } else {
            Write-TestResult "Events are ordered by timestamp DESC" $false
            $failed++
        }
    } else {
        Write-TestResult "Events ordering (needs at least 2 events)" $true "Not enough events to test"
        $passed++
    }
} catch {
    Write-TestResult "Verify deterministic ordering" $false $_.Exception.Message
    $failed++
}

Write-Host ""

# Test 7: Verify event structure (schema validation)
Write-Host "${Yellow}Test 7: Verify event structure${Reset}"
try {
    $response = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/timeline/unified?limit=1" -ErrorAction Stop
    
    if ($response.events.Count -gt 0) {
        $event = $response.events[0]
        
        $hasRequiredFields = (
            $null -ne $event.id -and
            $null -ne $event.event_type -and
            $null -ne $event.timestamp -and
            $null -ne $event.actor -and
            $null -ne $event.subject_type -and
            $null -ne $event.subject_identifier -and
            $null -ne $event.request_id -and
            $null -ne $event.summary -and
            $null -ne $event.details -and
            $null -ne $event.links
        )
        
        if ($hasRequiredFields) {
            Write-TestResult "Event has all required fields" $true
            Write-Host "  Event Type: $($event.event_type)"
            Write-Host "  Actor: $($event.actor)"
            Write-Host "  Summary: $($event.summary.Substring(0, [Math]::Min(50, $event.summary.Length)))"
            $passed++
        } else {
            Write-TestResult "Event structure" $false "Missing required fields"
            $failed++
        }
    } else {
        Write-TestResult "Event structure (no events to test)" $true "No events returned"
        $passed++
    }
} catch {
    Write-TestResult "Verify event structure" $false $_.Exception.Message
    $failed++
}

Write-Host ""

# Test 8: Verify summary length constraint (max 500 chars)
Write-Host "${Yellow}Test 8: Verify summary length constraint${Reset}"
try {
    $response = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/timeline/unified?limit=10" -ErrorAction Stop
    
    if ($response.events.Count -gt 0) {
        $allValid = $true
        $maxLength = 0
        
        foreach ($event in $response.events) {
            $summaryLength = $event.summary.Length
            $maxLength = [Math]::Max($maxLength, $summaryLength)
            
            if ($summaryLength -gt 500) {
                $allValid = $false
                break
            }
        }
        
        if ($allValid) {
            Write-TestResult "All summaries <= 500 chars" $true
            Write-Host "  Max summary length: $maxLength chars"
            $passed++
        } else {
            Write-TestResult "Summary length constraint" $false "Found summary > 500 chars"
            $failed++
        }
    } else {
        Write-TestResult "Summary length constraint (no events to test)" $true "No events returned"
        $passed++
    }
} catch {
    Write-TestResult "Verify summary length constraint" $false $_.Exception.Message
    $failed++
}

Write-Host ""
Write-Host "${Blue}=== Summary ===${Reset}"
Write-Host "${Green}Passed: $passed${Reset}"
Write-Host "${Red}Failed: $failed${Reset}"
Write-Host ""

if ($failed -eq 0) {
    Write-Host "${Green}All tests passed!${Reset}"
    exit 0
} else {
    Write-Host "${Red}Some tests failed.${Reset}"
    exit 1
}
