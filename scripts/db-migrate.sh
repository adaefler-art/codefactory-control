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
    psql "$DATABASE_URL" "$@"
  else
    psql "$@"
  fi
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
  local result=$(psql_exec -t -c "SELECT COUNT(*) FROM schema_migrations WHERE filename = '$filename'" 2>/dev/null || echo "0")
  echo "$result" | tr -d ' '
}

# Function to get stored hash for a migration
get_stored_hash() {
  local filename="$1"
  local result=$(psql_exec -t -c "SELECT sha256 FROM schema_migrations WHERE filename = '$filename'" 2>/dev/null || echo "")
  echo "$result" | tr -d ' '
}

# Function to record migration in ledger
record_migration() {
  local filename="$1"
  local hash="$2"
  psql_exec -c "INSERT INTO schema_migrations (filename, sha256, applied_at) VALUES ('$filename', '$hash', NOW()) ON CONFLICT (filename) DO NOTHING" >/dev/null
}

echo "🔍 Starting database migration..."
echo ""

# Ensure schema_migrations table exists
echo "📋 Checking schema_migrations ledger..."
psql_exec -c "CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)" >/dev/null 2>&1 || {
  echo "⚠️  schema_migrations table check skipped (will be created by 048_schema_migrations_ledger.sql)"
}

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
    
    if psql_exec -f "$f" >/dev/null 2>&1; then
      # Record in ledger
      record_migration "$filename" "$current_hash"
      echo "✅ Applied:  $filename (hash: ${current_hash:0:12}...)"
      applied_count=$((applied_count + 1))
    else
      echo "❌ ERROR: Failed to apply $filename"
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
