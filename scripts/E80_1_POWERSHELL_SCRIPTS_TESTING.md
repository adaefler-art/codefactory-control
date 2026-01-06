# E80.1 PowerShell Scripts - Testing Guide

This document provides testing instructions for the three PowerShell automation scripts created for E80.1 Migration Parity Check.

## Prerequisites

- PowerShell 5.1+ or PowerShell Core 7+
- PostgreSQL client (`psql`) for check-migration-parity.ps1
- AWS CLI for setup-aws-admin-subs.ps1
- Node.js and npm for running migrations

## Script 1: check-migration-parity.ps1

### Display Help

```powershell
Get-Help ./scripts/check-migration-parity.ps1
Get-Help ./scripts/check-migration-parity.ps1 -Detailed
Get-Help ./scripts/check-migration-parity.ps1 -Examples
```

### Test Syntax

```powershell
# PowerShell syntax validation
$script = Get-Content ./scripts/check-migration-parity.ps1 -Raw
$null = [ScriptBlock]::Create($script)
Write-Host "Syntax check passed"
```

### Basic Usage (requires local dev environment)

```powershell
# Run with admin fix (for local testing without real auth)
./scripts/check-migration-parity.ps1 -Environment local -FixAdmin

# Run without admin fix (requires proper auth)
./scripts/check-migration-parity.ps1 -Environment local
```

### Environment Variables for Database Connection

```powershell
# Set these before running the script
$env:DATABASE_HOST = "localhost"
$env:DATABASE_PORT = "5432"
$env:DATABASE_NAME = "afu9"
$env:DATABASE_USER = "postgres"
$env:DATABASE_PASSWORD = "your-password"
```

### Expected Behavior

The script should:
1. ✅ Check for psql availability
2. ✅ Verify database connection
3. ✅ Check schema_migrations ledger table
4. ✅ Count repository migrations
5. ✅ Run migrations (if local environment)
6. ✅ Call the parity API endpoint
7. ✅ Display formatted results with color coding
8. ✅ Exit with code 0 (PASS) or 1 (FAIL)

## Script 2: setup-aws-admin-subs.ps1

### Display Help

```powershell
Get-Help ./scripts/setup-aws-admin-subs.ps1
Get-Help ./scripts/setup-aws-admin-subs.ps1 -Detailed
Get-Help ./scripts/setup-aws-admin-subs.ps1 -Examples
```

### Test Syntax

```powershell
# PowerShell syntax validation
$script = Get-Content ./scripts/setup-aws-admin-subs.ps1 -Raw
$null = [ScriptBlock]::Create($script)
Write-Host "Syntax check passed"
```

### Dry-Run Mode (Safe Testing)

```powershell
# Test without making AWS changes
./scripts/setup-aws-admin-subs.ps1 -Environment stage -AdminSubs "test-sub-123" -DryRun
```

### Real Usage (requires AWS credentials)

```powershell
# For staging environment
./scripts/setup-aws-admin-subs.ps1 -Environment stage -AdminSubs "S3b43b2-a051-7015-a2b7-98f77551d415"

# For production environment
./scripts/setup-aws-admin-subs.ps1 -Environment prod -AdminSubs "user1,user2,user3"
```

### Expected Behavior

The script should:
1. ✅ Check AWS CLI availability
2. ✅ Verify AWS authentication (via STS)
3. ✅ Check if secret exists
4. ✅ Display planned operation
5. ✅ Prompt for confirmation (unless dry-run)
6. ✅ Create or update secret in AWS Secrets Manager
7. ✅ Verify the secret value
8. ✅ Display next steps for ECS integration
9. ✅ Exit with code 0 (success) or 1 (error)

## Script 3: update-task-definition-admin-subs.ps1

### Display Help

```powershell
Get-Help ./scripts/update-task-definition-admin-subs.ps1
Get-Help ./scripts/update-task-definition-admin-subs.ps1 -Detailed
```

### Test Syntax

```powershell
# PowerShell syntax validation
$script = Get-Content ./scripts/update-task-definition-admin-subs.ps1 -Raw
$null = [ScriptBlock]::Create($script)
Write-Host "Syntax check passed"
```

### Basic Usage

```powershell
# Run the helper script
./scripts/update-task-definition-admin-subs.ps1
```

### Expected Behavior

The script should:
1. ✅ Check for infrastructure code location
2. ✅ Display TypeScript code snippet for ECS secrets
3. ✅ Show alternative patterns for Fargate
4. ✅ Provide deployment instructions
5. ✅ Show verification commands
6. ✅ Display troubleshooting tips
7. ✅ Exit with code 0

## Automated Testing

### All Scripts Syntax Check

```powershell
# Test all three scripts
$scripts = @(
    "./scripts/check-migration-parity.ps1",
    "./scripts/setup-aws-admin-subs.ps1",
    "./scripts/update-task-definition-admin-subs.ps1"
)

foreach ($scriptPath in $scripts) {
    Write-Host "Testing: $scriptPath" -ForegroundColor Cyan
    $script = Get-Content $scriptPath -Raw
    $null = [ScriptBlock]::Create($script)
    Write-Host "  ✅ Syntax check passed" -ForegroundColor Green
}
```

### Help Documentation Check

```powershell
# Verify help is available for all scripts
$scripts = @(
    "./scripts/check-migration-parity.ps1",
    "./scripts/setup-aws-admin-subs.ps1",
    "./scripts/update-task-definition-admin-subs.ps1"
)

foreach ($scriptPath in $scripts) {
    Write-Host "Checking help for: $scriptPath" -ForegroundColor Cyan
    $help = Get-Help $scriptPath -ErrorAction SilentlyContinue
    if ($help) {
        Write-Host "  ✅ Help available" -ForegroundColor Green
    } else {
        Write-Host "  ❌ No help found" -ForegroundColor Red
    }
}
```

## Integration Testing

### Full E80.1 Workflow Test

This requires a complete local environment setup:

```powershell
# 1. Start local database
docker-compose up -d postgres

# 2. Set environment variables
$env:DATABASE_HOST = "localhost"
$env:DATABASE_PORT = "5432"
$env:DATABASE_NAME = "afu9"
$env:DATABASE_USER = "postgres"
$env:DATABASE_PASSWORD = "postgres"

# 3. Start control-center
cd control-center
npm run dev

# 4. In another terminal, run parity check
cd ..
./scripts/check-migration-parity.ps1 -Environment local -FixAdmin

# Expected: PASS status with matching migration counts
```

## Verification Checklist

- [x] All scripts have valid PowerShell syntax
- [x] Help documentation is accessible via Get-Help
- [x] Scripts are executable (chmod +x)
- [x] Error handling works (tested with missing dependencies)
- [x] Colored output displays correctly
- [x] Exit codes are correct (0 for success, 1 for errors)
- [x] Parameter validation works
- [x] Dry-run mode works (script 2)
- [x] Code snippets display correctly (script 3)

## CI/CD Integration

These scripts can be integrated into CI/CD pipelines:

```yaml
# GitHub Actions example
- name: Check Migration Parity
  shell: pwsh
  run: |
    ./scripts/check-migration-parity.ps1 -Environment local -FixAdmin
```

## Troubleshooting

### PowerShell Version Issues

```powershell
# Check PowerShell version
$PSVersionTable.PSVersion

# Minimum required: 5.1 or Core 7.0+
```

### Script Execution Policy

```powershell
# If scripts won't run due to execution policy
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Or run with bypass
pwsh -ExecutionPolicy Bypass -File ./scripts/check-migration-parity.ps1
```

### Missing Dependencies

Each script checks for its dependencies and provides helpful error messages:
- Script 1: Checks for `psql` and database connectivity
- Script 2: Checks for `aws` CLI and valid credentials
- Script 3: No external dependencies (informational only)

## Related Documentation

- [E80.1 Implementation Summary](../E80_1_IMPLEMENTATION_SUMMARY.md)
- [Migration Parity Check Runbook](../docs/runbooks/MIGRATION_PARITY_CHECK.md)
- [Database Migration Guide](../database/README.md)
