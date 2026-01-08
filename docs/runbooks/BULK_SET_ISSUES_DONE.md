# Runbook: Bulk Set Issues to DONE Status

**Script**: `scripts\bulk-set-issues-done.ps1`  
**Purpose**: Safely bulk-update AFU9 issues to DONE status with audit trail  
**Author**: AFU-9 Control Center  
**Version**: 1.0.0

---

## Overview

This runbook documents how to use `bulk-set-issues-done.ps1` to safely set AFU9 issues to DONE status in the PostgreSQL database. The script includes:

- ✅ Safety checks (missing env vars → fail-closed)
- ✅ Dry-run mode
- ✅ Confirmation gates
- ✅ Pre/post verification
- ✅ Audit trail (request ID + evidence logging)
- ✅ SQL injection protection (whitelisted status literals + numeric params only)

---

## Prerequisites

### 1. Database Environment Variables

Set the following environment variables:

```powershell
$env:DATABASE_HOST = "your-rds-endpoint.rds.amazonaws.com"
$env:DATABASE_PORT = "5432"
$env:DATABASE_NAME = "afu9"
$env:DATABASE_USER = "afu9_admin"
$env:DATABASE_PASSWORD = "your-password"
```

**From AWS Secrets Manager**:

```powershell
# Load database credentials
$secret = aws secretsmanager get-secret-value `
  --secret-id afu9/database `
  --query SecretString --output text `
  --profile codefactory --region eu-central-1 | ConvertFrom-Json

$env:DATABASE_HOST = $secret.host
$env:DATABASE_PORT = $secret.port
$env:DATABASE_NAME = if ($secret.dbname) { $secret.dbname } else { $secret.database }
$env:DATABASE_USER = $secret.username
$env:DATABASE_PASSWORD = $secret.password
```

### 2. Database Access

Ensure network connectivity to the RDS instance:
- **VPN**: Connect to AWS VPN
- **ECS Exec**: Use `aws ecs execute-command` to run from within VPC

### 3. psql Client

Verify `psql` is installed and in PATH:

```powershell
psql --version
# Expected: psql (PostgreSQL) 14.x or higher
```

---

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `-AllNonDone` | Switch | `false` | If set, updates ALL non-DONE statuses (not just CREATED/SPEC_READY) |
| `-GithubIssueMin` | Int | N/A | Minimum `github_issue_number` (inclusive) |
| `-GithubIssueMax` | Int | N/A | Maximum `github_issue_number` (inclusive) |
| `-DryRun` | Switch | `false` | Show analysis only, do NOT execute UPDATE |
| `-Confirm` | Switch | `false` | Skip interactive confirmation prompt |

**Default Behavior** (no parameters):
- Updates only issues with `status IN ('CREATED', 'SPEC_READY')`
- Applies to ALL github_issue_numbers (no range filter)
- Shows preview and requires typing "CONFIRM"

---

## Usage Examples

### Example 1: Dry Run (Recommended First Step)

**Purpose**: See what would be updated without making changes

```powershell
.\scripts\bulk-set-issues-done.ps1 -DryRun
```

**Expected Output**:

```
=== Database Connection Validation ===
✅ All required database environment variables present
ℹ️  Detected environment: STAGING
ℹ️  Database host: afu9-postgres.cvu0c0we856q.eu-central-1.rds.amazonaws.com

=== Operation Configuration ===
ℹ️  Target statuses: CREATED, SPEC_READY
ℹ️  GitHub issue range filter: NONE (all issues)
ℹ️  Request ID: 12345678-90ab-cdef-1234-567890abcdef
⚠️  DRY RUN MODE - No changes will be made

=== Pre-Update Analysis ===
ℹ️  Querying overall status distribution...

Current Issue Status Distribution:
 status       | count 
--------------+-------
 CREATED      |    15
 SPEC_READY   |     8
 IMPLEMENTING |    42
 VERIFIED     |    12
 DONE         |   105

✅ Issues to be updated: 23

ℹ️  Preview of affected issues (first 20):

 id                                   | github_issue_number | title                          | status
--------------------------------------+---------------------+--------------------------------+------------
 a1b2c3d4-e5f6-7890-abcd-ef1234567890 |                  80 | E80.1 New Feature              | CREATED
 b2c3d4e5-f6a7-8901-bcde-f12345678901 |                  81 | E81.1 Bug Fix                  | SPEC_READY
 ...

=== Dry Run Complete ===
✅ Dry run completed - no changes made
ℹ️  Remove -DryRun flag to execute the update
```

---

### Example 2: Update with Confirmation Prompt

**Purpose**: Update CREATED + SPEC_READY issues with manual confirmation

```powershell
.\scripts\bulk-set-issues-done.ps1
```

**Interactive Flow**:

```
=== Confirmation Gate ===

About to update 23 issue(s) to DONE status
Environment: STAGING
Request ID: 12345678-90ab-cdef-1234-567890abcdef

Type 'CONFIRM' to proceed (or Ctrl+C to abort): CONFIRM

✅ Confirmation received

=== Executing UPDATE ===
ℹ️  Executing UPDATE query...

 id                                   | github_issue_number | title                          | status
--------------------------------------+---------------------+--------------------------------+--------
 a1b2c3d4-e5f6-7890-abcd-ef1234567890 |                  80 | E80.1 New Feature              | DONE
 b2c3d4e5-f6a7-8901-bcde-f12345678901 |                  81 | E81.1 Bug Fix                  | DONE
(23 rows)

✅ UPDATE completed successfully

=== Post-Update Verification ===
✅ Verification PASSED: All targeted issues updated to DONE

=== Evidence Logging ===
✅ Evidence logged to: docs/merge-evidence/V07_BULK_DONE_EVIDENCE.md

=== Final Summary ===
✅ Operation completed successfully
ℹ️  Request ID: 12345678-90ab-cdef-1234-567890abcdef
ℹ️  Issues updated: 23
ℹ️  Environment: STAGING
```

---

### Example 3: Update Specific Range (Auto-Confirm)

**Purpose**: Update issues #100-200 without confirmation prompt

```powershell
.\scripts\bulk-set-issues-done.ps1 `
  -GithubIssueMin 100 `
  -GithubIssueMax 200 `
  -Confirm
```

**Expected Behavior**:
- Only updates issues with `github_issue_number BETWEEN 100 AND 200`
- Still only targets CREATED/SPEC_READY (default)
- Skips interactive confirmation (useful for automation)

---

### Example 4: Update ALL Non-DONE Issues

**Purpose**: Set ALL issues (except already DONE) to DONE status

```powershell
.\scripts\bulk-set-issues-done.ps1 -AllNonDone
```

**Warning**: This updates issues in ALL statuses:
- CREATED → DONE
- SPEC_READY → DONE
- IMPLEMENTING → DONE
- VERIFIED → DONE
- MERGE_READY → DONE
- HOLD → DONE
- KILLED → DONE

**Use Case**: End-of-release cleanup, archiving old sprints

---

### Example 5: Combination - Range + AllNonDone + Auto-Confirm

**Purpose**: Close out a specific release range completely

```powershell
.\scripts\bulk-set-issues-done.ps1 `
  -AllNonDone `
  -GithubIssueMin 70 `
  -GithubIssueMax 79 `
  -Confirm
```

**Use Case**: Closing all v0.7 issues (#70-79) regardless of current status

---

## Output Artifacts

### 1. Console Output

The script outputs structured sections:

1. **Database Connection Validation**: Checks ENV vars
2. **Operation Configuration**: Shows parameters + request ID
3. **Pre-Update Analysis**: Status distribution + affected count + preview
4. **Confirmation Gate**: User prompt (if not auto-confirm)
5. **Executing UPDATE**: RETURNING clause shows updated rows
6. **Post-Update Verification**: Final status distribution + verification check
7. **Evidence Logging**: Confirms evidence file updated
8. **Final Summary**: Request ID + counts + environment

### 2. Evidence File

**Location**: `docs/merge-evidence/V07_BULK_DONE_EVIDENCE.md`

**Format** (append-only):

```markdown
## Operation: 2026-01-08 14:35:22 UTC

**Request ID**: 12345678-90ab-cdef-1234-567890abcdef  
**Environment**: STAGING  
**Database Host**: afu9-postgres.cvu0c0we856q.eu-central-1.rds.amazonaws.com  
**Executed By**: john.doe  

**Parameters**:
- AllNonDone: False
- GithubIssueMin: N/A
- GithubIssueMax: N/A
- Target Statuses: CREATED, SPEC_READY

**Results**:
- Issues Updated: 23
- Verification: PASSED (0 remaining)

**Status**: ✅ COMPLETE

---
```

**Purpose**: Audit trail for compliance, rollback reference, troubleshooting

---

## Safety Features

### 1. Fail-Closed Design

Missing environment variables cause immediate exit:

```powershell
❌ Missing required environment variables:
  - DATABASE_HOST
  - DATABASE_PASSWORD
```

### 2. SQL Injection Protection

- **Status literals**: Whitelisted enum (no user input interpolation)
- **Numeric params**: Only integers for `github_issue_number` range
- **No dynamic SQL**: All queries use fixed structure

### 3. Dry-Run Mode

Always test first:

```powershell
# Safe - see impact before committing
.\scripts\bulk-set-issues-done.ps1 -DryRun

# Then execute
.\scripts\bulk-set-issues-done.ps1
```

### 4. Confirmation Gate

Requires typing "CONFIRM" (exact match) unless `-Confirm` flag set.

### 5. Post-Update Verification

Fails if remaining count != 0:

```powershell
❌ Verification FAILED: 5 issues still match criteria (expected 0)
```

---

## Troubleshooting

### Issue: "Failed to connect to database"

**Cause**: Network access to RDS blocked

**Solution**:
1. Check VPN connection
2. Verify security group rules
3. Test with `psql` directly:

```powershell
$env:PGPASSWORD = $env:DATABASE_PASSWORD
psql -h $env:DATABASE_HOST -p $env:DATABASE_PORT -U $env:DATABASE_USER -d $env:DATABASE_NAME -c "SELECT 1;"
```

---

### Issue: "GithubIssueMin cannot be greater than GithubIssueMax"

**Cause**: Invalid range parameters

**Solution**: Swap values or fix typo:

```powershell
# ❌ Wrong
-GithubIssueMin 200 -GithubIssueMax 100

# ✅ Correct
-GithubIssueMin 100 -GithubIssueMax 200
```

---

### Issue: "No issues match the criteria"

**Cause**: All issues already DONE or range doesn't match any issues

**Solution**: Check current status distribution:

```powershell
$env:PGPASSWORD = $env:DATABASE_PASSWORD
psql -h $env:DATABASE_HOST -p $env:DATABASE_PORT -U $env:DATABASE_USER -d $env:DATABASE_NAME -c "SELECT status, COUNT(*) FROM afu9_issues GROUP BY status;"
```

---

## Rollback

If issues were incorrectly set to DONE, use manual SQL:

```sql
-- Rollback specific issues (use request ID from evidence log to find timestamp)
UPDATE afu9_issues
SET 
    status = 'CREATED',  -- or original status
    updated_at = NOW()
WHERE 
    id IN ('uuid1', 'uuid2', 'uuid3');
```

**Best Practice**: Keep database backups before bulk operations.

---

## Compliance

### Audit Trail

Every execution creates:
1. **Request ID** (GUID) - unique identifier
2. **Evidence log entry** - timestamp, parameters, results
3. **Console output** - full operation details

### No Secrets in Logs

Script never logs:
- ❌ DATABASE_PASSWORD
- ❌ Full connection strings
- ✅ Database host (non-sensitive)
- ✅ Environment name
- ✅ Request ID

### Deterministic Output

Same inputs always produce:
- Same SQL query
- Same affected count (if database unchanged)
- Same verification result

---

## Advanced Usage

### Running via ECS Exec

If VPN unavailable, execute from within VPC:

```powershell
# Get task ARN
$taskArn = aws ecs list-tasks `
  --cluster afu9-cluster `
  --service-name afu9-control-center-staging `
  --desired-status RUNNING `
  --profile codefactory --region eu-central-1 `
  --query 'taskArns[0]' --output text

# Exec into container
aws ecs execute-command `
  --cluster afu9-cluster `
  --task $taskArn `
  --container control-center `
  --command "sh" `
  --interactive `
  --profile codefactory --region eu-central-1

# Inside container, export script and run
# (DATABASE_* vars already set in container environment)
cd /tmp
# Copy script content or wget from GitHub
powershell ./bulk-set-issues-done.ps1 -DryRun
```

---

## Verification Commands

### Before Execution

```powershell
# 1. Check current status distribution
$env:PGPASSWORD = $env:DATABASE_PASSWORD
psql -h $env:DATABASE_HOST -p $env:DATABASE_PORT -U $env:DATABASE_USER -d $env:DATABASE_NAME -c "SELECT status, COUNT(*) FROM afu9_issues GROUP BY status;"

# 2. Count issues in target statuses
psql -h $env:DATABASE_HOST -p $env:DATABASE_PORT -U $env:DATABASE_USER -d $env:DATABASE_NAME -c "SELECT COUNT(*) FROM afu9_issues WHERE status IN ('CREATED', 'SPEC_READY');"
```

### After Execution

```powershell
# 1. Verify no issues remain in target statuses
psql -h $env:DATABASE_HOST -p $env:DATABASE_PORT -U $env:DATABASE_USER -d $env:DATABASE_NAME -c "SELECT COUNT(*) FROM afu9_issues WHERE status IN ('CREATED', 'SPEC_READY');"
# Expected: 0

# 2. Check DONE count increased
psql -h $env:DATABASE_HOST -p $env:DATABASE_PORT -U $env:DATABASE_USER -d $env:DATABASE_NAME -c "SELECT COUNT(*) FROM afu9_issues WHERE status = 'DONE';"

# 3. Review evidence log
Get-Content docs/merge-evidence/V07_BULK_DONE_EVIDENCE.md | Select-Object -Last 30
```

---

## Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | Operation completed or no issues matched (dry-run) |
| 1 | Error | Check error message (missing vars, DB connection, verification failed) |

---

## References

- **Script**: `scripts\bulk-set-issues-done.ps1`
- **Evidence Log**: `docs/merge-evidence/V07_BULK_DONE_EVIDENCE.md`
- **Database Schema**: `database/migrations/022_issue_lifecycle_state_machine.sql`
- **State Model**: `control-center/src/lib/schemas/issueStateModel.ts`

---

**Last Updated**: 2026-01-08  
**Maintainer**: AFU-9 Control Center Team
