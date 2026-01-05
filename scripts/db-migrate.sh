#!/usr/bin/env bash
set -euo pipefail

# Enhanced migration runner with schema_migrations ledger tracking
# E80.1: Deterministic migration tracking with SHA-256 hash verification

if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -z "${DATABASE_HOST:-}" || -z "${DATABASE_PORT:-}" || -z "${DATABASE_NAME:-}" || -z "${DATABASE_USER:-}" || -z "${DATABASE_PASSWORD:-}" ]]; then
    echo "❌ DATABASE_URL or DATABASE_(HOST,PORT,NAME,USER,PASSWORD) are required" >&2
    exit 1
  fi
fi

export PGSSLMODE=${PGSSLMODE:-require}

if [[ -z "${DATABASE_URL:-}" ]]; then
  export PGHOST="$DATABASE_HOST"
  export PGPORT="$DATABASE_PORT"
  export PGDATABASE="$DATABASE_NAME"
  export PGUSER="$DATABASE_USER"
  export PGPASSWORD="$DATABASE_PASSWORD"
fi

# Function to execute psql command
psql_exec() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 "$@"
  else
    psql -v ON_ERROR_STOP=1 "$@"
  fi
}

sql_escape() {
  local value="$1"
  # Escape single quotes for safe embedding in SQL strings.
  echo "${value//\'/\'\'}"
}

# Function to compute SHA-256 hash of a file
compute_hash() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    echo "❌ ERROR: Neither sha256sum nor shasum found" >&2
    exit 1
  fi
}

# Function to check if migration is already applied
is_migration_applied() {
  local filename="$1"
  local escaped
  escaped=$(sql_escape "$filename")
  local result
  result=$(psql_exec -t -c "SELECT 1 FROM schema_migrations WHERE filename = '$escaped' LIMIT 1" 2>/dev/null || true)
  if echo "$result" | tr -d ' ' | grep -q '^1$'; then
    echo "1"
  else
    echo "0"
  fi
}

# Function to get stored hash for a migration
get_stored_hash() {
  local filename="$1"
  local escaped
  escaped=$(sql_escape "$filename")
  local result
  result=$(psql_exec -t -c "SELECT sha256 FROM schema_migrations WHERE filename = '$escaped' LIMIT 1" 2>/dev/null || echo "")
  echo "$result" | tr -d ' '
}

# Function to record migration in ledger
record_migration() {
  local filename="$1"
  local hash="$2"
  local escaped
  escaped=$(sql_escape "$filename")
  psql_exec -c "INSERT INTO schema_migrations (filename, sha256, applied_at) VALUES ('$escaped', '$hash', NOW()) ON CONFLICT (filename) DO NOTHING" >/dev/null
}

ensure_schema_migrations_ledger() {
  echo "📋 Ensuring schema_migrations ledger..."

  # Create table if missing (sha256 nullable for legacy compatibility; hashes are enforced by this script).
  psql_exec -c "CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    sha256 TEXT,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )" >/dev/null

  # Backward-compat: older deployments may have a schema_migrations table without sha256.
  psql_exec -c "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS sha256 TEXT" >/dev/null

  # Ensure applied_at exists (legacy safety)
  psql_exec -c "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ" >/dev/null
  psql_exec -c "UPDATE schema_migrations SET applied_at = COALESCE(applied_at, NOW())" >/dev/null

  # Optional index for debugging/history
  psql_exec -c "CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations(applied_at DESC)" >/dev/null
}

echo "🔍 Starting database migration..."
echo ""

ensure_schema_migrations_ledger

applied_count=0
skipped_count=0
total_count=0

# Process migrations in lexicographic order (deterministic)
for f in $(ls database/migrations/*.sql | sort); do
  filename=$(basename "$f")
  total_count=$((total_count + 1))
  
  # Compute current file hash
  current_hash=$(compute_hash "$f")
  
  # Check if migration already applied
  is_applied=$(is_migration_applied "$filename")
  
  if [[ "$is_applied" == "1" ]]; then
    # Migration already applied - verify hash
    stored_hash=$(get_stored_hash "$filename")

    # Backward-compat: legacy schema_migrations rows may have empty sha256.
    # In that case, backfill with the current hash and continue.
    if [[ -z "${stored_hash:-}" ]]; then
      escaped=$(sql_escape "$filename")
      psql_exec -c "UPDATE schema_migrations SET sha256 = '$current_hash' WHERE filename = '$escaped' AND (sha256 IS NULL OR sha256 = '')" >/dev/null
      echo "⚠️  Skipped: $filename (already applied; legacy ledger hash backfilled)"
      skipped_count=$((skipped_count + 1))
      continue
    fi
    
    if [[ "$stored_hash" != "$current_hash" ]]; then
      echo "❌ ERROR: MIGRATION_HASH_MISMATCH"
      echo "   File: $filename"
      echo "   Stored hash:  $stored_hash"
      echo "   Current hash: $current_hash"
      echo ""
      echo "Migration file has been modified after being applied!"
      echo "This is a critical error. Migrations must be immutable once applied."
      echo ""
      echo "Actions:"
      echo "  1. Revert changes to $filename"
      echo "  2. Create a new migration file for schema changes"
      echo "  3. Never modify applied migrations"
      exit 1
    fi
    
    echo "⏭️  Skipped: $filename (already applied, hash verified ✓)"
    skipped_count=$((skipped_count + 1))
  else
    # Apply new migration
    echo "▶️  Applying: $filename"

    tmp_log=$(mktemp)
    if psql_exec -f "$f" >"$tmp_log" 2>&1; then
      # Record in ledger
      record_migration "$filename" "$current_hash"
      echo "✅ Applied:  $filename (hash: ${current_hash:0:12}...)"
      applied_count=$((applied_count + 1))
      rm -f "$tmp_log" || true
    else
      echo "❌ ERROR: Failed to apply $filename"
      echo "--- psql output (tail) ---" >&2
      tail -n 200 "$tmp_log" >&2 || true
      rm -f "$tmp_log" || true
      exit 1
    fi
  fi
done

echo ""
echo "════════════════════════════════════════"
echo "✅ Migration run completed successfully"
echo "════════════════════════════════════════"
echo "Total migrations:   $total_count"
echo "Applied:            $applied_count"
echo "Skipped (verified): $skipped_count"
echo "════════════════════════════════════════"
