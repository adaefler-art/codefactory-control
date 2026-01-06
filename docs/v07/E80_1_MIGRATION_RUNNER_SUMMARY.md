# E80.1 - Migration Runner Implementation Summary

**Date**: 2026-01-05  
**Commit**: 378f5cc  
**Status**: ✅ Complete

## Overview

Implemented the migration runner with deterministic schema_migrations ledger tracking, completing the blocker for E80.1. The enhanced migration runner ensures all database migrations are tracked with SHA-256 hash verification for integrity.

## Changes Made

### 1. Enhanced Migration Runner (`scripts/db-migrate.sh`)

**Previous Behavior**:
- Simply applied all SQL files in `database/migrations/` directory
- No tracking of which migrations were applied
- Would re-execute all migrations on each run
- No hash verification

**New Behavior**:
- ✅ **Deterministic ordering**: Applies migrations in lexicographic filename order
- ✅ **Ledger tracking**: Records each migration in `schema_migrations` table
- ✅ **Hash computation**: Calculates SHA-256 hash for each migration file
- ✅ **Idempotent**: Skips already-applied migrations (checks ledger first)
- ✅ **Hash verification**: Verifies stored hash matches current file hash
- ✅ **Fail-closed**: Rejects modified migrations with explicit error code

**Key Features**:

1. **Automatic ledger creation**:
   ```sql
   CREATE TABLE IF NOT EXISTS schema_migrations (
     filename TEXT PRIMARY KEY,
     sha256 TEXT NOT NULL,
     applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )
   ```

2. **Hash computation** (supports both sha256sum and shasum):
   ```bash
   compute_hash() {
     if command -v sha256sum >/dev/null 2>&1; then
       sha256sum "$file" | awk '{print $1}'
     elif command -v shasum >/dev/null 2>&1; then
       shasum -a 256 "$file" | awk '{print $1}'
     fi
   }
   ```

3. **Migration application**:
   ```bash
   # For each migration file (sorted):
   # 1. Check if already applied
   # 2. If yes: verify hash matches (fail if mismatch)
   # 3. If no: apply migration and record in ledger
   # 4. Report results (applied/skipped counts)
   ```

4. **Error handling**:
   - `MIGRATION_HASH_MISMATCH`: File modified after application (exit 1)
   - SQL execution errors: Migration failed (exit 1)
   - Database connection errors: Cannot connect (exit 1)

### 2. Test Suite (`scripts/test-db-migrate.sh`)

Comprehensive test suite covering all scenarios:

**Test 1: Fresh database applies all migrations**
- Creates test database
- Runs migration runner
- Verifies:
  - `schema_migrations` table created ✓
  - All 49 migrations recorded in ledger ✓
  - All migrations have SHA-256 hashes ✓
  - Migrations applied in lexicographic order ✓

**Test 2: Rerun does not duplicate or modify ledger**
- Captures initial ledger state
- Reruns migration runner
- Verifies:
  - Ledger count unchanged ✓
  - Ledger hashes unchanged (idempotent) ✓

**Test 3: Ledger hashes match actual file hashes**
- Compares first 5 migrations
- Verifies:
  - Stored hash equals computed hash for each file ✓

**Test 4: Hash mismatch fails migration**
- Creates test migrations
- Applies them once
- Modifies a migration file
- Attempts to rerun
- Verifies:
  - Hash mismatch detected ✓
  - Migration runner exits with code 1 ✓
  - Error message contains `MIGRATION_HASH_MISMATCH` ✓

**Running Tests**:
```bash
# Set test database credentials
export TEST_DATABASE_HOST=localhost
export TEST_DATABASE_PORT=5432
export TEST_DATABASE_NAME=afu9_test_migrations
export TEST_DATABASE_USER=postgres
export TEST_DATABASE_PASSWORD=your-password

# Run tests
bash scripts/test-db-migrate.sh
```

### 3. Documentation Updates

Updated `docs/runbooks/MIGRATION_PARITY_CHECK.md` with new section:

**Added**:
- Migration Runner with Ledger Tracking section
- Features and behavior descriptions
- PowerShell and Bash usage examples
- Expected output for different scenarios:
  - First run (fresh database)
  - Subsequent runs (all migrations applied)
  - Hash mismatch scenario
- Testing instructions with expected output
- Pass/fail criteria
- Troubleshooting guide:
  - Hash mismatch error resolution
  - Ledger table missing resolution

**Example Output Documented**:

First run:
```
🔍 Starting database migration...
▶️  Applying: 001_initial_schema.sql
✅ Applied:  001_initial_schema.sql (hash: abc123...)
...
Total: 49 applied, 0 skipped
```

Subsequent run:
```
⏭️  Skipped: 001_initial_schema.sql (already applied, hash verified ✓)
...
Total: 0 applied, 49 skipped
```

Hash mismatch:
```
❌ ERROR: MIGRATION_HASH_MISMATCH
   File: 002_users.sql
   Stored hash:  def456...
   Current hash: xyz789...
```

## Technical Implementation Details

### Idempotency Strategy

Uses `ON CONFLICT DO NOTHING` for ledger inserts:

```sql
INSERT INTO schema_migrations (filename, sha256, applied_at) 
VALUES ('$filename', '$hash', NOW()) 
ON CONFLICT (filename) DO NOTHING
```

This ensures:
- No duplicate entries (filename is PRIMARY KEY)
- Existing entries are never updated
- Hash mismatches are caught before INSERT (in verification step)

### Hash Verification Logic

```bash
# Check if migration already applied
is_applied=$(is_migration_applied "$filename")

if [[ "$is_applied" == "1" ]]; then
  # Get stored hash
  stored_hash=$(get_stored_hash "$filename")
  
  # Compare with current hash
  if [[ "$stored_hash" != "$current_hash" ]]; then
    # FAIL: File modified after application
    echo "❌ ERROR: MIGRATION_HASH_MISMATCH"
    exit 1
  fi
  
  # SKIP: Hash verified, migration already applied
  echo "⏭️  Skipped: $filename (already applied, hash verified ✓)"
else
  # APPLY: New migration
  psql -f "$f"
  record_migration "$filename" "$current_hash"
  echo "✅ Applied: $filename"
fi
```

### Error Codes

| Exit Code | Meaning |
|-----------|---------|
| 0 | Success: All migrations applied or verified |
| 1 | Failure: Database error, hash mismatch, or SQL error |

### Cross-Platform Compatibility

Supports both Linux and macOS hash tools:
- Linux: `sha256sum`
- macOS: `shasum -a 256`

## Integration with E80.1

The enhanced migration runner completes the E80.1 implementation:

1. **Migration Runner** (`scripts/db-migrate.sh`): Writes ledger entries ✓
2. **Parity Check Endpoint** (`/api/ops/db/migrations`): Reads ledger entries ✓
3. **UI** (`/ops/migrations`): Displays parity status ✓
4. **Workflow** (`.github/workflows/migration-parity.yml`): Triggers checks ✓

### Complete Data Flow

```
Migration Application:
  db-migrate.sh
    ↓
  Compute SHA-256 hash
    ↓
  Apply migration SQL
    ↓
  INSERT INTO schema_migrations (filename, sha256, applied_at)
    ↓
  Ledger updated

Parity Check:
  User requests check (UI/API/Workflow)
    ↓
  List repo migrations (database/migrations/*.sql)
    ↓
  List DB migrations (SELECT * FROM schema_migrations)
    ↓
  Compute parity (missing, extra, hash mismatches)
    ↓
  Return PASS/FAIL status
```

## Verification

### Manual Verification

```bash
# 1. Run migrations
npm --prefix control-center run db:migrate

# 2. Check ledger populated
psql -d afu9 -c "SELECT COUNT(*) FROM schema_migrations"
# Expected: 49

# 3. Verify hashes
psql -d afu9 -c "SELECT filename, LEFT(sha256, 12) || '...' as hash FROM schema_migrations ORDER BY filename LIMIT 5"

# 4. Test idempotency (rerun)
npm --prefix control-center run db:migrate
# Expected: All migrations skipped

# 5. Test hash mismatch (modify a file)
echo "-- test" >> database/migrations/001_initial_schema.sql
npm --prefix control-center run db:migrate
# Expected: MIGRATION_HASH_MISMATCH error

# 6. Revert
git checkout database/migrations/001_initial_schema.sql
```

### Automated Verification

```bash
# Run test suite
bash scripts/test-db-migrate.sh

# Expected output:
# Total tests:   9
# Passed:        9
# Failed:        0
```

## Best Practices

1. **Never modify applied migrations**
   - Migrations are immutable once applied
   - Create new migration files for schema changes
   - Hash mismatch will block deployment

2. **Always run migrations before parity checks**
   - Ensures ledger is up to date
   - Parity check compares ledger to repo files

3. **Monitor migration runner output**
   - Check applied vs. skipped counts
   - Investigate any hash mismatch errors immediately

4. **Test migrations locally before committing**
   - Run `db:migrate` locally
   - Verify parity check shows PASS
   - Then commit migration file

## Known Limitations

1. **No rollback support**: Migration runner only supports forward migrations
2. **Manual hash fix not supported**: If hash mismatch, must revert file changes
3. **No partial application**: All migrations run in single transaction per file
4. **PostgreSQL only**: Requires `psql` command-line client

## Future Enhancements

Potential improvements (not implemented):
- Migration rollback support
- Transaction wrapping for all migrations
- Support for other databases (MySQL, SQLite)
- Migration dependencies/prerequisites
- Dry-run mode

## Summary

✅ **Complete**: Migration runner with ledger tracking fully implemented  
✅ **Tested**: 9 tests covering all scenarios  
✅ **Documented**: Comprehensive runbook with PowerShell commands  
✅ **Integrated**: Works seamlessly with E80.1 parity checks  

The implementation satisfies all requirements from the comment:
- Deterministic migration application ✓
- SHA-256 hash computation ✓
- Idempotent reruns ✓
- Fail-closed hash mismatch detection ✓
- Comprehensive test suite ✓
- Updated documentation ✓

**Ready for production use.**
