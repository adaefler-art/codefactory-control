# E9.2-CONTROL-02 Verification Commands
# AFU-9 → GitHub Handoff / Mirror Create

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "E9.2-CONTROL-02 Verification" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Run mirror metadata tests
Write-Host "Step 1: Running mirror metadata tests..." -ForegroundColor Yellow
Set-Location control-center
npm test -- handoff-mirror-metadata.test.ts
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Mirror metadata tests failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Mirror metadata tests passed" -ForegroundColor Green
Write-Host ""

# Step 2: Run handoff idempotence tests
Write-Host "Step 2: Running handoff idempotence tests..." -ForegroundColor Yellow
npm test -- handoff-idempotence.test.ts
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Handoff idempotence tests failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Handoff idempotence tests passed" -ForegroundColor Green
Write-Host ""

# Step 3: Build control-center
Write-Host "Step 3: Building control-center..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Build successful" -ForegroundColor Green
Write-Host ""

# Step 4: Run repository verification
Write-Host "Step 4: Running repository verification..." -ForegroundColor Yellow
Set-Location ..
npm run repo:verify
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Repository verification failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Repository verification passed" -ForegroundColor Green
Write-Host ""

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "All Verifications Passed! ✅" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Changes Summary:" -ForegroundColor Cyan
Write-Host "- Added handoffAt, handoffError, githubRepo to API responses" -ForegroundColor White
Write-Host "- Both camelCase and snake_case for backward compatibility" -ForegroundColor White
Write-Host "- 5 new tests + 11 existing tests all passing" -ForegroundColor White
Write-Host "- UI now receives complete mirror metadata" -ForegroundColor White
Write-Host ""
Write-Host "Files Modified:" -ForegroundColor Cyan
Write-Host "- control-center/app/api/issues/_shared.ts" -ForegroundColor White
Write-Host "- control-center/app/issues/[id]/page.tsx" -ForegroundColor White
Write-Host ""
Write-Host "Files Added:" -ForegroundColor Cyan
Write-Host "- control-center/__tests__/api/handoff-mirror-metadata.test.ts" -ForegroundColor White
