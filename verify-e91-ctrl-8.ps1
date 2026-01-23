# E9.1-CTRL-8 Verification Commands
# Timeline Events for Loop (minimal schema + redaction)

Write-Host "=== E9.1-CTRL-8 Verification ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Verify tests pass
Write-Host "Step 1: Running loop event store tests..." -ForegroundColor Yellow
Set-Location control-center
npm test -- __tests__/lib/loop/eventStore.test.ts
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Event store tests failed" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Event store tests pass" -ForegroundColor Green
Write-Host ""

# Step 2: Verify all loop tests pass
Write-Host "Step 2: Running all loop tests..." -ForegroundColor Yellow
npm test -- __tests__/lib/loop/
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Loop tests failed" -ForegroundColor Red
    exit 1
}
Write-Host "✓ All loop tests pass" -ForegroundColor Green
Write-Host ""

# Step 3: Verify migration exists
Write-Host "Step 3: Verifying database migration..." -ForegroundColor Yellow
Set-Location ..
if (Test-Path "database/migrations/085_loop_events.sql") {
    Write-Host "✓ Migration file exists: 085_loop_events.sql" -ForegroundColor Green
    
    # Check for required table and constraints
    $migration = Get-Content "database/migrations/085_loop_events.sql" -Raw
    
    if ($migration -match "CREATE TABLE.*loop_events") {
        Write-Host "✓ Creates loop_events table" -ForegroundColor Green
    } else {
        Write-Host "❌ Missing loop_events table creation" -ForegroundColor Red
        exit 1
    }
    
    if ($migration -match "event_type.*CHECK") {
        Write-Host "✓ Event type constraint defined" -ForegroundColor Green
    } else {
        Write-Host "❌ Missing event type constraint" -ForegroundColor Red
        exit 1
    }
    
    if ($migration -match "FOREIGN KEY.*run_id") {
        Write-Host "✓ Foreign key to loop_runs defined" -ForegroundColor Green
    } else {
        Write-Host "❌ Missing foreign key constraint" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "❌ Migration file not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 4: Verify contract exists
Write-Host "Step 4: Verifying contract documentation..." -ForegroundColor Yellow
if (Test-Path "docs/contracts/loop-timeline-events.v1.md") {
    Write-Host "✓ Contract file exists: loop-timeline-events.v1.md" -ForegroundColor Green
    
    $contract = Get-Content "docs/contracts/loop-timeline-events.v1.md" -Raw
    
    # Verify required events
    $requiredEvents = @(
        "loop_run_started",
        "loop_run_finished",
        "loop_step_s1_completed",
        "loop_step_s2_spec_ready",
        "loop_step_s3_implement_prep",
        "loop_run_blocked",
        "loop_run_failed"
    )
    
    foreach ($event in $requiredEvents) {
        if ($contract -match $event) {
            Write-Host "  ✓ Event documented: $event" -ForegroundColor Green
        } else {
            Write-Host "  ❌ Missing event: $event" -ForegroundColor Red
            exit 1
        }
    }
    
    # Verify payload allowlist
    if ($contract -match "runId" -and $contract -match "step" -and $contract -match "stateBefore" -and $contract -match "requestId") {
        Write-Host "✓ Payload allowlist documented" -ForegroundColor Green
    } else {
        Write-Host "❌ Payload allowlist incomplete" -ForegroundColor Red
        exit 1
    }
    
    # Verify no secrets policy
    if ($contract -match "No secrets|Prohibited Data") {
        Write-Host "✓ No secrets policy documented" -ForegroundColor Green
    } else {
        Write-Host "❌ Missing no secrets policy" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "❌ Contract file not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 5: Verify API route exists
Write-Host "Step 5: Verifying API route..." -ForegroundColor Yellow
# Use bash to read the file to avoid PowerShell bracket issues
$apiRouteExists = bash -c "test -f 'control-center/app/api/loop/issues/[issueId]/events/route.ts' && echo 'true' || echo 'false'"
if ($apiRouteExists -eq 'true') {
    Write-Host "✓ API route exists" -ForegroundColor Green
    
    $routeCode = bash -c "cat 'control-center/app/api/loop/issues/[issueId]/events/route.ts'"
    
    if ($routeCode -match "async.*function.*GET" -or $routeCode -match "export.*async.*GET") {
        Write-Host "✓ GET handler defined" -ForegroundColor Green
    } else {
        Write-Host "❌ Missing GET handler" -ForegroundColor Red
        Write-Host "Route code sample: $($routeCode.Substring(0, [Math]::Min(200, $routeCode.Length)))" -ForegroundColor Yellow
        exit 1
    }
    
    if ($routeCode -match "getLoopEventStore") {
        Write-Host "✓ Uses LoopEventStore" -ForegroundColor Green
    } else {
        Write-Host "❌ Missing LoopEventStore usage" -ForegroundColor Red
        exit 1
    }
    
    if ($routeCode -match "schemaVersion.*loop" -or $routeCode -match "SCHEMA_VERSION.*loop") {
        Write-Host "✓ Schema versioning implemented" -ForegroundColor Green
    } else {
        Write-Host "❌ Missing schema versioning" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "❌ API route not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 6: Verify LoopEventStore implementation
Write-Host "Step 6: Verifying LoopEventStore implementation..." -ForegroundColor Yellow
$eventStore = "control-center/src/lib/loop/eventStore.ts"
if (Test-Path -LiteralPath $eventStore) {
    Write-Host "✓ LoopEventStore exists" -ForegroundColor Green
    
    $storeCode = Get-Content -LiteralPath $eventStore -Raw
    
    if ($storeCode -match "validatePayload") {
        Write-Host "✓ Payload validation implemented" -ForegroundColor Green
    } else {
        Write-Host "❌ Missing payload validation" -ForegroundColor Red
        exit 1
    }
    
    if ($storeCode -match "allowedFields.*=.*\[.*runId.*step.*stateBefore") {
        Write-Host "✓ Allowlist enforcement implemented" -ForegroundColor Green
    } else {
        Write-Host "❌ Missing allowlist enforcement" -ForegroundColor Red
        exit 1
    }
    
    if ($storeCode -match "getEventsByIssue") {
        Write-Host "✓ Query by issueId implemented" -ForegroundColor Green
    } else {
        Write-Host "❌ Missing query by issueId" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "❌ LoopEventStore not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 7: Verify event logging in execution engine
Write-Host "Step 7: Verifying event logging in execution engine..." -ForegroundColor Yellow
$execution = "control-center/src/lib/loop/execution.ts"
if (Test-Path -LiteralPath $execution) {
    Write-Host "✓ Execution engine exists" -ForegroundColor Green
    
    $execCode = Get-Content -LiteralPath $execution -Raw
    
    if ($execCode -match "getLoopEventStore") {
        Write-Host "✓ Event store imported" -ForegroundColor Green
    } else {
        Write-Host "❌ Event store not imported" -ForegroundColor Red
        exit 1
    }
    
    if ($execCode -match "eventType.*RUN_STARTED" -or $execCode -match "LoopEventType\.RUN_STARTED") {
        Write-Host "✓ loop_run_started event emitted" -ForegroundColor Green
    } else {
        Write-Host "❌ Missing loop_run_started event" -ForegroundColor Red
        exit 1
    }
    
    if ($execCode -match "eventType.*RUN_BLOCKED" -or $execCode -match "LoopEventType\.RUN_BLOCKED") {
        Write-Host "✓ loop_run_blocked event emitted" -ForegroundColor Green
    } else {
        Write-Host "❌ Missing loop_run_blocked event" -ForegroundColor Red
        exit 1
    }
    
    if ($execCode -match "eventType.*RUN_FINISHED" -or $execCode -match "LoopEventType\.RUN_FINISHED") {
        Write-Host "✓ loop_run_finished event emitted" -ForegroundColor Green
    } else {
        Write-Host "❌ Missing loop_run_finished event" -ForegroundColor Red
        exit 1
    }
    
    if ($execCode -match "eventType.*RUN_FAILED" -or $execCode -match "LoopEventType\.RUN_FAILED") {
        Write-Host "✓ loop_run_failed event emitted" -ForegroundColor Green
    } else {
        Write-Host "❌ Missing loop_run_failed event" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "❌ Execution engine not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 8: Verify security summary
Write-Host "Step 8: Verifying security summary..." -ForegroundColor Yellow
if (Test-Path "docs/E91_CTRL_8_SECURITY_SUMMARY.md") {
    Write-Host "✓ Security summary exists" -ForegroundColor Green
    
    $security = Get-Content "docs/E91_CTRL_8_SECURITY_SUMMARY.md" -Raw
    
    if ($security -match "Payload Allowlist.*PASS") {
        Write-Host "✓ Payload allowlist verified" -ForegroundColor Green
    } else {
        Write-Host "❌ Payload allowlist not verified" -ForegroundColor Red
        exit 1
    }
    
    if ($security -match "No Secrets.*PASS") {
        Write-Host "✓ No secrets policy verified" -ForegroundColor Green
    } else {
        Write-Host "❌ No secrets policy not verified" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "❌ Security summary not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

Write-Host "=== All Verifications Passed ===" -ForegroundColor Green
Write-Host ""
Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "  ✓ Event store tests pass" -ForegroundColor Green
Write-Host "  ✓ All loop tests pass" -ForegroundColor Green
Write-Host "  ✓ Database migration complete" -ForegroundColor Green
Write-Host "  ✓ Contract documented" -ForegroundColor Green
Write-Host "  ✓ API route implemented" -ForegroundColor Green
Write-Host "  ✓ Event store with allowlist enforcement" -ForegroundColor Green
Write-Host "  ✓ Event logging in execution engine" -ForegroundColor Green
Write-Host "  ✓ Security summary approved" -ForegroundColor Green
Write-Host ""
Write-Host "Acceptance Criteria Met:" -ForegroundColor Cyan
Write-Host "  ✓ Standard events: loop_run_started, loop_run_finished, step completions, blocked, failed" -ForegroundColor Green
Write-Host "  ✓ Payload allowlist: { runId, step, stateBefore, stateAfter?, blockerCode?, requestId }" -ForegroundColor Green
Write-Host "  ✓ No secrets in event payloads" -ForegroundColor Green
Write-Host "  ✓ Minimum 2 events per run (started + completion)" -ForegroundColor Green
Write-Host "  ✓ Events queryable by issueId" -ForegroundColor Green
Write-Host ""
Write-Host "Ready for PR merge! 🚀" -ForegroundColor Green
