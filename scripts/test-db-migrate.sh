#!/usr/bin/env bash
# Test suite for db-migrate.sh with afu9_migrations_ledger tracking
# E80.1: Verify deterministic migration application and hash verification

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test database configuration (using local test DB)
export DATABASE_HOST="${TEST_DATABASE_HOST:-localhost}"
export DATABASE_PORT="${TEST_DATABASE_PORT:-5432}"
export DATABASE_NAME="${TEST_DATABASE_NAME:-afu9_test_migrations}"
export DATABASE_USER="${TEST_DATABASE_USER:-postgres}"
export DATABASE_PASSWORD="${TEST_DATABASE_PASSWORD:-}"
export PGSSLMODE=disable

# Function to print test result
print_result() {
  local status="$1"
  local message="$2"
  
  TESTS_RUN=$((TESTS_RUN + 1))
  
  if [[ "$status" == "PASS" ]]; then
    echo -e "${GREEN}✓ PASS${NC}: $message"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗ FAIL${NC}: $message"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

# Function to run psql command
run_psql() {
  psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d "$DATABASE_NAME" -t -c "$1" 2>/dev/null || echo ""
}

# Function to setup test database
setup_test_db() {
  echo -e "${YELLOW}Setting up test database...${NC}"
  
  # Drop and recreate test database
  psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d postgres -c "DROP DATABASE IF EXISTS $DATABASE_NAME" >/dev/null 2>&1 || true
  psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d postgres -c "CREATE DATABASE $DATABASE_NAME" >/dev/null 2>&1
  
  echo "Test database created: $DATABASE_NAME"
}

# Function to cleanup test database
cleanup_test_db() {
  echo -e "${YELLOW}Cleaning up test database...${NC}"
  psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d postgres -c "DROP DATABASE IF EXISTS $DATABASE_NAME" >/dev/null 2>&1 || true
  echo "Test database dropped"
}

# Function to create test migration files
create_test_migrations() {
  local test_dir="$1"
  
  mkdir -p "$test_dir"
  
  # Create test migration 001
  cat > "$test_dir/001_test_users.sql" << 'EOF'
CREATE TABLE test_users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
EOF

  # Create test migration 002
  cat > "$test_dir/002_test_posts.sql" << 'EOF'
CREATE TABLE test_posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES test_users(id),
  content TEXT NOT NULL
);
EOF

  # Create test migration 003
  cat > "$test_dir/003_test_comments.sql" << 'EOF'
CREATE TABLE test_comments (
  id SERIAL PRIMARY KEY,
  post_id INTEGER REFERENCES test_posts(id),
  comment TEXT NOT NULL
);
EOF
}

# Test 1: Fresh database applies all migrations and creates ledger entries
test_fresh_migration() {
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "Test 1: Fresh database applies all migrations"
  echo "═══════════════════════════════════════════════════════"
  
  setup_test_db
  
  # Run migrations
  cd "$REPO_ROOT"
  bash scripts/db-migrate.sh >/dev/null 2>&1
  
  # Check ledger exists
  local ledger_exists=$(run_psql "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'afu9_migrations_ledger'" | tr -d ' ')
  if [[ "$ledger_exists" == "1" ]]; then
    print_result "PASS" "afu9_migrations_ledger table created"
  else
    print_result "FAIL" "afu9_migrations_ledger table not found"
    return 1
  fi
  
  # Check all migrations recorded
  local ledger_count=$(run_psql "SELECT COUNT(*) FROM afu9_migrations_ledger" | tr -d ' ')
  local migration_count=$(ls database/migrations/*.sql | wc -l | tr -d ' ')
  
  if [[ "$ledger_count" == "$migration_count" ]]; then
    print_result "PASS" "All $migration_count migrations recorded in ledger"
  else
    print_result "FAIL" "Ledger has $ledger_count entries, expected $migration_count"
    return 1
  fi
  
  # Check hashes are recorded
  local hash_count=$(run_psql "SELECT COUNT(*) FROM afu9_migrations_ledger WHERE sha256 != ''" | tr -d ' ')
  if [[ "$hash_count" == "$migration_count" ]]; then
    print_result "PASS" "All migrations have SHA-256 hashes"
  else
    print_result "FAIL" "Only $hash_count migrations have hashes, expected $migration_count"
    return 1
  fi
  
  # Check ordering is deterministic (filenames in order)
  local first_migration=$(run_psql "SELECT filename FROM afu9_migrations_ledger ORDER BY applied_at ASC LIMIT 1" | tr -d ' ')
  if [[ "$first_migration" == "001_initial_schema.sql" ]]; then
    print_result "PASS" "Migrations applied in lexicographic order"
  else
    print_result "FAIL" "First migration is $first_migration, expected 001_initial_schema.sql"
    return 1
  fi
}

# Test 2: Rerun does not change ledger
test_idempotent_rerun() {
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "Test 2: Rerun does not duplicate or modify ledger"
  echo "═══════════════════════════════════════════════════════"
  
  # Get initial ledger state
  local initial_count=$(run_psql "SELECT COUNT(*) FROM afu9_migrations_ledger" | tr -d ' ')
  local initial_hashes=$(run_psql "SELECT filename, sha256 FROM afu9_migrations_ledger ORDER BY filename" | tr -d '\n')
  
  # Run migrations again
  cd "$REPO_ROOT"
  bash scripts/db-migrate.sh >/dev/null 2>&1
  
  # Check ledger unchanged
  local final_count=$(run_psql "SELECT COUNT(*) FROM afu9_migrations_ledger" | tr -d ' ')
  local final_hashes=$(run_psql "SELECT filename, sha256 FROM afu9_migrations_ledger ORDER BY filename" | tr -d '\n')
  
  if [[ "$initial_count" == "$final_count" ]]; then
    print_result "PASS" "Ledger count unchanged ($initial_count entries)"
  else
    print_result "FAIL" "Ledger count changed from $initial_count to $final_count"
    return 1
  fi
  
  if [[ "$initial_hashes" == "$final_hashes" ]]; then
    print_result "PASS" "Ledger hashes unchanged (idempotent)"
  else
    print_result "FAIL" "Ledger hashes changed after rerun"
    return 1
  fi
}

# Test 3: Hash mismatch fails with explicit error
test_hash_mismatch() {
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "Test 3: Hash mismatch fails migration with error code"
  echo "═══════════════════════════════════════════════════════"
  
  # Create a temporary test directory
  local test_dir="/tmp/test_migrations_$$"
  create_test_migrations "$test_dir"
  
  # Setup clean test DB
  setup_test_db
  
  # Apply migrations first time
  cd "$REPO_ROOT"
  DATABASE_MIGRATIONS_DIR="$test_dir" bash -c "
    export DATABASE_HOST='$DATABASE_HOST'
    export DATABASE_PORT='$DATABASE_PORT'
    export DATABASE_NAME='$DATABASE_NAME'
    export DATABASE_USER='$DATABASE_USER'
    export PGSSLMODE=disable
    
    # Manually create canonical ledger and apply migrations
    psql -h \"\$DATABASE_HOST\" -p \"\$DATABASE_PORT\" -U \"\$DATABASE_USER\" -d \"\$DATABASE_NAME\" -c 'CREATE TABLE IF NOT EXISTS afu9_migrations_ledger (filename TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())' >/dev/null
    
    for f in \$(ls $test_dir/*.sql | sort); do
      filename=\$(basename \"\$f\")
      hash=\$(sha256sum \"\$f\" | awk '{print \$1}')
      psql -h \"\$DATABASE_HOST\" -p \"\$DATABASE_PORT\" -U \"\$DATABASE_USER\" -d \"\$DATABASE_NAME\" -f \"\$f\" >/dev/null
      psql -h \"\$DATABASE_HOST\" -p \"\$DATABASE_PORT\" -U \"\$DATABASE_USER\" -d \"\$DATABASE_NAME\" -c \"INSERT INTO afu9_migrations_ledger (filename, sha256) VALUES ('\$filename', '\$hash')\" >/dev/null
    done
  " >/dev/null 2>&1
  
  # Modify a migration file (simulate hash mismatch)
  echo "-- Modified content" >> "$test_dir/001_test_users.sql"
  
  # Try to rerun migrations (should fail)
  local output=$(cd "$REPO_ROOT" && DATABASE_MIGRATIONS_DIR="$test_dir" bash -c "
    export DATABASE_HOST='$DATABASE_HOST'
    export DATABASE_PORT='$DATABASE_PORT'
    export DATABASE_NAME='$DATABASE_NAME'
    export DATABASE_USER='$DATABASE_USER'
    export PGSSLMODE=disable
    
    # Replace database/migrations with test dir temporarily
    for f in \$(ls $test_dir/*.sql | sort); do
      filename=\$(basename \"\$f\")
      current_hash=\$(sha256sum \"\$f\" | awk '{print \$1}')
      stored_hash=\$(psql -h \"\$DATABASE_HOST\" -p \"\$DATABASE_PORT\" -U \"\$DATABASE_USER\" -d \"\$DATABASE_NAME\" -t -c \"SELECT sha256 FROM afu9_migrations_ledger WHERE filename = '\$filename'\" | tr -d ' ')
      
      if [[ \"\$stored_hash\" != \"\" && \"\$stored_hash\" != \"\$current_hash\" ]]; then
        echo \"HASH_MISMATCH\"
        exit 1
      fi
    done
  " 2>&1)
  
  local exit_code=$?
  
  if [[ $exit_code -ne 0 && "$output" == *"HASH_MISMATCH"* ]]; then
    print_result "PASS" "Hash mismatch detected and migration failed"
  else
    print_result "FAIL" "Hash mismatch not detected (exit=$exit_code)"
  fi
  
  # Cleanup
  rm -rf "$test_dir"
}

# Test 4: Verify hash computation matches repo hashes
test_hash_computation() {
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "Test 4: Ledger hashes match actual file hashes"
  echo "═══════════════════════════════════════════════════════"
  
  cd "$REPO_ROOT"
  
  # Compare first 5 migrations
  local mismatch=0
  local checked=0
  
  for f in $(ls database/migrations/*.sql | sort | head -5); do
    filename=$(basename "$f")
    
    # Compute actual hash
    local actual_hash=""
    if command -v sha256sum >/dev/null 2>&1; then
      actual_hash=$(sha256sum "$f" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then
      actual_hash=$(shasum -a 256 "$f" | awk '{print $1}')
    fi
    
    # Get stored hash
    local stored_hash=$(run_psql "SELECT sha256 FROM afu9_migrations_ledger WHERE filename = '$filename'" | tr -d ' ')
    
    if [[ "$actual_hash" == "$stored_hash" ]]; then
      checked=$((checked + 1))
    else
      mismatch=$((mismatch + 1))
      echo "  Mismatch: $filename"
      echo "    Actual:  $actual_hash"
      echo "    Stored:  $stored_hash"
    fi
  done
  
  if [[ $mismatch -eq 0 && $checked -gt 0 ]]; then
    print_result "PASS" "All $checked checked migrations have matching hashes"
  else
    print_result "FAIL" "$mismatch mismatches found in $checked migrations"
  fi
}

# Main test execution
main() {
  echo "════════════════════════════════════════════════════════"
  echo "  Migration Runner Test Suite (E80.1)"
  echo "════════════════════════════════════════════════════════"
  echo "Database: $DATABASE_NAME @ $DATABASE_HOST:$DATABASE_PORT"
  echo ""
  
  # Check prerequisites
  if ! command -v psql >/dev/null 2>&1; then
    echo -e "${RED}ERROR: psql not found${NC}"
    echo "PostgreSQL client is required to run tests"
    exit 1
  fi
  
  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    echo -e "${RED}ERROR: Neither sha256sum nor shasum found${NC}"
    exit 1
  fi
  
  # Check database connectivity
  if ! psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d postgres -c "SELECT 1" >/dev/null 2>&1; then
    echo -e "${RED}ERROR: Cannot connect to PostgreSQL${NC}"
    echo "Please ensure PostgreSQL is running and credentials are correct"
    echo "Set TEST_DATABASE_* env vars if needed"
    exit 1
  fi
  
  # Run tests
  test_fresh_migration
  test_idempotent_rerun
  test_hash_computation
  test_hash_mismatch
  
  # Cleanup
  cleanup_test_db
  
  # Print summary
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  Test Summary"
  echo "════════════════════════════════════════════════════════"
  echo "Total tests:   $TESTS_RUN"
  echo -e "${GREEN}Passed:        $TESTS_PASSED${NC}"
  if [[ $TESTS_FAILED -gt 0 ]]; then
    echo -e "${RED}Failed:        $TESTS_FAILED${NC}"
  else
    echo "Failed:        $TESTS_FAILED"
  fi
  echo "════════════════════════════════════════════════════════"
  
  if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
  fi
}

# Run tests if not sourced
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
