#!/usr/bin/env bash
# Seed schema_migrations ledger for existing database
# Use this ONLY when the database schema exists but the ledger is empty
#
# WARNING: This should only be run ONCE to bootstrap the ledger
# After this, all migrations must go through db-migrate.sh

set -euo pipefail

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

psql_exec() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 "$@"
  else
    psql -v ON_ERROR_STOP=1 "$@"
  fi
}

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

echo "🔧 Seeding schema_migrations ledger..."
echo ""

# Ensure schema_migrations table exists
psql_exec -c "CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  sha256 TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)" >/dev/null

# Check current count
current_count=$(psql_exec -t -c "SELECT COUNT(*) FROM schema_migrations" | tr -d ' ')

if [[ "$current_count" != "0" ]]; then
  echo "⚠️  WARNING: schema_migrations already has $current_count entries"
  echo "This script should only be run when the ledger is empty."
  echo ""
  echo "Current migrations:"
  psql_exec -c "SELECT filename, LEFT(sha256, 12) as hash, applied_at FROM schema_migrations ORDER BY applied_at"
  echo ""
  read -p "Continue anyway? (yes/no): " confirm
  if [[ "$confirm" != "yes" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "Processing migration files..."
echo ""

# Process all migration files and add them to the ledger
for f in $(ls database/migrations/*.sql | sort); do
  filename=$(basename "$f")
  hash=$(compute_hash "$f")
  
  # Insert if not exists
  psql_exec -c "INSERT INTO schema_migrations (filename, sha256, applied_at) 
                VALUES ('$filename', '$hash', NOW()) 
                ON CONFLICT (filename) DO NOTHING" >/dev/null
  
  # Check if it was inserted
  was_new=$(psql_exec -t -c "SELECT 1 FROM schema_migrations WHERE filename = '$filename'" | tr -d ' ')
  
  if [[ "$was_new" == "1" ]]; then
    echo "✅ Recorded: $filename (hash: ${hash:0:12}...)"
  else
    echo "⏭️  Skipped:  $filename (already in ledger)"
  fi
done

echo ""
echo "════════════════════════════════════════"
echo "✅ Ledger seeding completed"
echo "════════════════════════════════════════"

final_count=$(psql_exec -t -c "SELECT COUNT(*) FROM schema_migrations" | tr -d ' ')
echo "Total migrations in ledger: $final_count"
echo ""
echo "Migrations:"
psql_exec -c "SELECT filename, LEFT(sha256, 12) as hash, applied_at FROM schema_migrations ORDER BY filename"
