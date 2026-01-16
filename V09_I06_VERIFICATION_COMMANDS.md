# V09-I06 Verification Commands

This document provides step-by-step commands to verify the Upload + Sources Management implementation.

## Prerequisites

```powershell
# Ensure database is running
docker-compose up -d postgres

# Run migrations
npm --prefix control-center run db:migrate

# Start control center (in separate terminal)
npm --prefix control-center run dev
```

## Verification Script

```powershell
# V09-I06: Upload + Sources Management Verification
# Issue: Upload + Sources Management (Product Memory Basis)

Write-Host "`n=== V09-I06 Upload + Sources Management Verification ===" -ForegroundColor Cyan
Write-Host "Testing upload functionality, sources integration, and RLS..." -ForegroundColor Yellow

$baseUrl = "http://localhost:3000"
$userId = "test-user-v09i06"

# Step 1: Create test session
Write-Host "`n[Step 1] Creating test session..." -ForegroundColor Green
try {
    $session = Invoke-RestMethod -Method Post `
        -Uri "$baseUrl/api/intent/sessions" `
        -Headers @{ "x-afu9-sub" = $userId } `
        -ContentType "application/json" `
        -Body '{"title": "V09-I06 Upload Test Session"}'
    
    $sessionId = $session.id
    Write-Host "✓ Session created: $sessionId" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to create session: $_" -ForegroundColor Red
    exit 1
}

# Step 2: Create test files
Write-Host "`n[Step 2] Creating test files..." -ForegroundColor Green
$testFiles = @(
    @{ Name = "test-document.txt"; Content = "Test document content for V09-I06 verification" },
    @{ Name = "test-data.json"; Content = '{"test": "data", "version": "v09-i06"}' },
    @{ Name = "test-notes.md"; Content = "# Test Notes`n`nThis is a test markdown file." }
)

foreach ($file in $testFiles) {
    $filePath = Join-Path $env:TEMP $file.Name
    $file.Content | Out-File -FilePath $filePath -Encoding utf8 -NoNewline
    Write-Host "  Created: $($file.Name)" -ForegroundColor Gray
}

# Step 3: Upload files
Write-Host "`n[Step 3] Uploading files to session..." -ForegroundColor Green
$uploadIds = @()

foreach ($file in $testFiles) {
    $filePath = Join-Path $env:TEMP $file.Name
    
    try {
        $form = @{ file = Get-Item $filePath }
        $upload = Invoke-RestMethod -Method Post `
            -Uri "$baseUrl/api/intent/sessions/$sessionId/uploads" `
            -Headers @{ "x-afu9-sub" = $userId } `
            -Form $form
        
        $uploadIds += $upload.uploads[0].id
        Write-Host "  ✓ Uploaded: $($file.Name) (ID: $($upload.uploads[0].id))" -ForegroundColor Green
        Write-Host "    SHA256: $($upload.uploads[0].contentSha256)" -ForegroundColor Gray
        Write-Host "    Size: $($upload.uploads[0].sizeBytes) bytes" -ForegroundColor Gray
    } catch {
        Write-Host "  ✗ Failed to upload $($file.Name): $_" -ForegroundColor Red
        exit 1
    }
}

# Step 4: List uploads
Write-Host "`n[Step 4] Listing uploads for session..." -ForegroundColor Green
try {
    $uploads = Invoke-RestMethod `
        -Uri "$baseUrl/api/intent/sessions/$sessionId/uploads" `
        -Headers @{ "x-afu9-sub" = $userId }
    
    Write-Host "✓ Found $($uploads.count) upload(s)" -ForegroundColor Green
    
    if ($uploads.count -ne $testFiles.Count) {
        Write-Host "✗ Expected $($testFiles.Count) uploads, got $($uploads.count)" -ForegroundColor Red
        exit 1
    }
    
    foreach ($upload in $uploads.uploads) {
        Write-Host "  - $($upload.filename) ($($upload.contentType), $($upload.sizeBytes) bytes)" -ForegroundColor Gray
    }
} catch {
    Write-Host "✗ Failed to list uploads: $_" -ForegroundColor Red
    exit 1
}

# Step 5: Verify uploads appear in sources
Write-Host "`n[Step 5] Verifying uploads appear in sources..." -ForegroundColor Green
try {
    $sources = Invoke-RestMethod `
        -Uri "$baseUrl/api/intent/sessions/$sessionId/sources" `
        -Headers @{ "x-afu9-sub" = $userId }
    
    $uploadSources = $sources.sources | Where-Object { $_.kind -eq 'upload' }
    Write-Host "✓ Found $($uploadSources.Count) upload source(s) in sources API" -ForegroundColor Green
    
    if ($uploadSources.Count -ne $testFiles.Count) {
        Write-Host "✗ Expected $($testFiles.Count) upload sources, got $($uploadSources.Count)" -ForegroundColor Red
        exit 1
    }
    
    foreach ($uploadSource in $uploadSources) {
        Write-Host "  - $($uploadSource.filename) (ID: $($uploadSource.uploadId))" -ForegroundColor Gray
    }
} catch {
    Write-Host "✗ Failed to fetch sources: $_" -ForegroundColor Red
    exit 1
}

# Step 6: Test type filtering
Write-Host "`n[Step 6] Testing source type filtering..." -ForegroundColor Green
try {
    $uploadOnlySources = Invoke-RestMethod `
        -Uri "$baseUrl/api/intent/sessions/$sessionId/sources?type=upload" `
        -Headers @{ "x-afu9-sub" = $userId }
    
    Write-Host "✓ Type filter 'upload' returned $($uploadOnlySources.count) source(s)" -ForegroundColor Green
    
    if ($uploadOnlySources.count -ne $testFiles.Count) {
        Write-Host "✗ Expected $($testFiles.Count) filtered sources, got $($uploadOnlySources.count)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Failed to filter sources: $_" -ForegroundColor Red
    exit 1
}

# Step 7: Test duplicate upload (same file content)
Write-Host "`n[Step 7] Testing duplicate upload rejection..." -ForegroundColor Green
try {
    $filePath = Join-Path $env:TEMP $testFiles[0].Name
    $form = @{ file = Get-Item $filePath }
    
    $duplicateUpload = Invoke-RestMethod -Method Post `
        -Uri "$baseUrl/api/intent/sessions/$sessionId/uploads" `
        -Headers @{ "x-afu9-sub" = $userId } `
        -Form $form
    
    # Should return existing upload, not create new one
    Write-Host "✓ Duplicate upload handled correctly (returned existing upload)" -ForegroundColor Green
    
    # Verify count didn't increase
    $uploadsAfter = Invoke-RestMethod `
        -Uri "$baseUrl/api/intent/sessions/$sessionId/uploads" `
        -Headers @{ "x-afu9-sub" = $userId }
    
    if ($uploadsAfter.count -ne $testFiles.Count) {
        Write-Host "✗ Duplicate upload created new record (count: $($uploadsAfter.count))" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Duplicate upload test failed: $_" -ForegroundColor Red
    exit 1
}

# Step 8: Test invalid file type
Write-Host "`n[Step 8] Testing invalid file type rejection..." -ForegroundColor Green
try {
    $invalidFile = Join-Path $env:TEMP "test.exe"
    "Invalid content" | Out-File -FilePath $invalidFile -Encoding utf8
    
    $form = @{ file = Get-Item $invalidFile }
    
    try {
        Invoke-RestMethod -Method Post `
            -Uri "$baseUrl/api/intent/sessions/$sessionId/uploads" `
            -Headers @{ "x-afu9-sub" = $userId } `
            -Form $form
        
        Write-Host "✗ Invalid file type should have been rejected" -ForegroundColor Red
        exit 1
    } catch {
        if ($_.Exception.Message -match "400") {
            Write-Host "✓ Invalid file type correctly rejected (400 Bad Request)" -ForegroundColor Green
        } else {
            throw
        }
    }
} catch {
    Write-Host "✗ Invalid file type test failed: $_" -ForegroundColor Red
    exit 1
}

# Step 9: Test RLS (wrong user cannot access uploads)
Write-Host "`n[Step 9] Testing RLS/tenant isolation..." -ForegroundColor Green
try {
    $wrongUser = "wrong-user-v09i06"
    
    try {
        Invoke-RestMethod `
            -Uri "$baseUrl/api/intent/sessions/$sessionId/uploads" `
            -Headers @{ "x-afu9-sub" = $wrongUser }
        
        Write-Host "✗ Wrong user should not be able to access uploads" -ForegroundColor Red
        exit 1
    } catch {
        if ($_.Exception.Message -match "403|404") {
            Write-Host "✓ RLS enforced correctly (wrong user denied access)" -ForegroundColor Green
        } else {
            throw
        }
    }
} catch {
    Write-Host "✗ RLS test failed: $_" -ForegroundColor Red
    exit 1
}

# Step 10: Delete uploads
Write-Host "`n[Step 10] Testing upload deletion..." -ForegroundColor Green
$deletedCount = 0

foreach ($uploadId in $uploadIds) {
    try {
        $delete = Invoke-RestMethod -Method Delete `
            -Uri "$baseUrl/api/intent/sessions/$sessionId/uploads/$uploadId" `
            -Headers @{ "x-afu9-sub" = $userId }
        
        if ($delete.deleted) {
            $deletedCount++
            Write-Host "  ✓ Deleted upload: $uploadId" -ForegroundColor Green
        } else {
            Write-Host "  ✗ Failed to delete upload: $uploadId" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "  ✗ Error deleting upload $uploadId : $_" -ForegroundColor Red
        exit 1
    }
}

Write-Host "✓ Deleted $deletedCount/$($uploadIds.Count) upload(s)" -ForegroundColor Green

# Step 11: Verify uploads are deleted
Write-Host "`n[Step 11] Verifying uploads are deleted..." -ForegroundColor Green
try {
    $uploadsAfterDelete = Invoke-RestMethod `
        -Uri "$baseUrl/api/intent/sessions/$sessionId/uploads" `
        -Headers @{ "x-afu9-sub" = $userId }
    
    if ($uploadsAfterDelete.count -eq 0) {
        Write-Host "✓ All uploads successfully deleted" -ForegroundColor Green
    } else {
        Write-Host "✗ Expected 0 uploads after deletion, got $($uploadsAfterDelete.count)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Failed to verify deletion: $_" -ForegroundColor Red
    exit 1
}

# Cleanup
Write-Host "`n[Cleanup] Removing test files..." -ForegroundColor Yellow
foreach ($file in $testFiles) {
    $filePath = Join-Path $env:TEMP $file.Name
    Remove-Item $filePath -ErrorAction SilentlyContinue
}
Remove-Item (Join-Path $env:TEMP "test.exe") -ErrorAction SilentlyContinue

Write-Host "`n=== V09-I06 Verification Complete ===" -ForegroundColor Cyan
Write-Host "✓ All tests passed successfully!" -ForegroundColor Green
Write-Host "`nSummary:" -ForegroundColor Yellow
Write-Host "  - Upload validation: ✓" -ForegroundColor Gray
Write-Host "  - Deduplication: ✓" -ForegroundColor Gray
Write-Host "  - Sources integration: ✓" -ForegroundColor Gray
Write-Host "  - Type filtering: ✓" -ForegroundColor Gray
Write-Host "  - RLS enforcement: ✓" -ForegroundColor Gray
Write-Host "  - Deletion: ✓" -ForegroundColor Gray
```

## Quick Manual Tests

### Test 1: Upload a File
```powershell
# Create test session
$session = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/api/intent/sessions" `
  -Headers @{ "x-afu9-sub" = "test-user" } `
  -ContentType "application/json" `
  -Body '{"title": "Upload Test"}'

# Create test file
"Test content" | Out-File -FilePath "$env:TEMP\test.txt" -Encoding utf8

# Upload
$form = @{ file = Get-Item "$env:TEMP\test.txt" }
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/api/intent/sessions/$($session.id)/uploads" `
  -Headers @{ "x-afu9-sub" = "test-user" } `
  -Form $form
```

### Test 2: List Uploads
```powershell
Invoke-RestMethod `
  -Uri "http://localhost:3000/api/intent/sessions/$($session.id)/uploads" `
  -Headers @{ "x-afu9-sub" = "test-user" }
```

### Test 3: Check Sources
```powershell
Invoke-RestMethod `
  -Uri "http://localhost:3000/api/intent/sessions/$($session.id)/sources" `
  -Headers @{ "x-afu9-sub" = "test-user" }
```

## Expected Results

1. **Upload** returns 201 with upload metadata
2. **List** returns all uploads for session
3. **Sources** includes uploads with `kind: 'upload'`
4. **Duplicate upload** returns existing upload (no new record)
5. **Invalid file type** returns 400 error
6. **Wrong user** cannot access uploads (403/404)
7. **Delete** removes upload and file

## Database Verification

```sql
-- Check uploads table
SELECT id, session_id, filename, content_type, size_bytes, content_sha256, created_at
FROM intent_session_uploads
WHERE session_id = '<session-id>';

-- Check cascade delete works
-- (Delete session and verify uploads are deleted)
DELETE FROM intent_sessions WHERE id = '<session-id>';

SELECT COUNT(*) FROM intent_session_uploads WHERE session_id = '<session-id>';
-- Should return 0
```
