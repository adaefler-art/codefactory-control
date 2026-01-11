#!/usr/bin/env bash
set -e
set -u

# Best-effort: enable pipefail when supported.
set -o pipefail 2>/dev/null || true

# Enhanced migration runner with afu9_migrations_ledger tracking
# E80.1: Deterministic migration tracking with SHA-256 hash verification

AFU9_LEDGER_TABLE="afu9_migrations_ledger"

# Optional: run only a single migration file (e.g., 052_intent_issue_drafts.sql)
# Deterministic: prefer env var, fall back to first arg.
MIGRATION_FILE="${AFU9_MIGRATION_FILE:-${1:-}}"

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
get_stored_hash() {
  local filename="$1"
  local escaped
  escaped=$(sql_escape "$filename")
  local result
  result=$(psql_exec -t -c "SELECT sha256 FROM ${AFU9_LEDGER_TABLE} WHERE filename = '$escaped' LIMIT 1" 2>/dev/null || echo "")
  echo "$result" | tr -d ' '
}

# Function to get stored hash for a migration
record_migration() {
  local filename="$1"
  local hash="$2"
  local applied_by="${AFU9_MIGRATION_APPLIED_BY:-${GITHUB_ACTOR:-}}"
  local runner_version="${AFU9_MIGRATION_RUNNER_VERSION:-${GITHUB_SHA:-}}"

  local escaped
  escaped=$(sql_escape "$filename")
  local escaped_by
  escaped_by=$(sql_escape "$applied_by")
  local escaped_runner
  escaped_runner=$(sql_escape "$runner_version")

  psql_exec -c "
    INSERT INTO ${AFU9_LEDGER_TABLE} (filename, sha256, applied_at, applied_by, runner_version)
    VALUES ('$escaped', '$hash', NOW(), NULLIF('$escaped_by',''), NULLIF('$escaped_runner',''))
    ON CONFLICT (filename) DO NOTHING
  " >/dev/null
}

table_exists() {
  local table_name="$1"
  local escaped
  escaped=$(sql_escape "$table_name")
  local result
  result=$(psql_exec -t -c "SELECT to_regclass('public.$escaped') IS NOT NULL" 2>/dev/null || echo "")
  echo "$result" | tr -d ' '
}

is_initial_schema_present() {
  # Detect legacy deployments where the initial schema exists but schema_migrations
  # doesn't contain 001_initial_schema.sql.
  local required_tables=(
    workflows
    workflow_executions
    workflow_steps
    mcp_servers
    repositories
    agent_runs
    mcp_tool_calls
  )

  local missing=()
  local t
  for t in "${required_tables[@]}"; do
    if [[ "$(table_exists "$t")" != "t" ]]; then
      missing+=("$t")
    fi
  done

  if (( ${#missing[@]} == 0 )); then
    echo "1"
    return 0
  fi

  echo "0"
  echo "${missing[*]}"
}

# Function to record migration in ledger
ensure_afu9_migrations_ledger() {
  echo "📋 Ensuring ${AFU9_LEDGER_TABLE} ledger..."

  psql_exec -c "
    CREATE TABLE IF NOT EXISTS ${AFU9_LEDGER_TABLE} (
      filename TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      applied_by TEXT NULL,
      runner_version TEXT NULL
    );
  " >/dev/null

  # Append-only enforcement: deny UPDATE/DELETE.
  psql_exec -c "
    CREATE OR REPLACE FUNCTION afu9_migrations_ledger_deny_mutations()
    RETURNS trigger
    LANGUAGE plpgsql
    AS \$\$
    BEGIN
      RAISE EXCEPTION 'afu9_migrations_ledger is append-only';
    END;
    \$\$;
  " >/dev/null

  psql_exec -c "
    DO \$\$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_afu9_migrations_ledger_no_update'
      ) THEN
        CREATE TRIGGER trg_afu9_migrations_ledger_no_update
        BEFORE UPDATE ON ${AFU9_LEDGER_TABLE}
        FOR EACH ROW
        EXECUTE FUNCTION afu9_migrations_ledger_deny_mutations();
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_afu9_migrations_ledger_no_delete'
      ) THEN
        CREATE TRIGGER trg_afu9_migrations_ledger_no_delete
        BEFORE DELETE ON ${AFU9_LEDGER_TABLE}
        FOR EACH ROW
        EXECUTE FUNCTION afu9_migrations_ledger_deny_mutations();
      END IF;
    END;
    \$\$;
  " >/dev/null
}

echo "🔍 Starting database migration..."
echo ""

if [[ -n "${MIGRATION_FILE:-}" ]]; then
  if [[ ! -f "database/migrations/${MIGRATION_FILE}" ]]; then
    echo "❌ Migration file not found: database/migrations/${MIGRATION_FILE}" >&2
    exit 1
  fi
  echo "🎯 Targeted migration mode: ${MIGRATION_FILE}"
  echo ""
fi

ensure_afu9_migrations_ledger

# Legacy bootstrap: if the ledger is empty but the schema already exists, record all repo migrations
# (no SQL will be executed). This avoids breakage caused by legacy schema_migrations formats.
ledger_count=$(psql_exec -t -c "SELECT COUNT(*)::int AS count FROM ${AFU9_LEDGER_TABLE};" 2>/dev/null | tr -d ' ' || echo "0")
user_table_count=$(psql_exec -t -c "
  SELECT COUNT(*)::int AS count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    AND table_name NOT IN ('schema_migrations', '${AFU9_LEDGER_TABLE}');
" 2>/dev/null | tr -d ' ' || echo "0")

if [[ -z "${MIGRATION_FILE:-}" && "${ledger_count:-0}" == "0" && "${user_table_count:-0}" != "0" ]]; then
  echo ""
  echo "⚠️  Detected existing schema without ${AFU9_LEDGER_TABLE}."
  echo "⚠️  Bootstrapping ${AFU9_LEDGER_TABLE} from repository files (no SQL will be executed)."
  echo ""

  for f in $(ls database/migrations/*.sql | sort); do
    filename=$(basename "$f")
    current_hash=$(compute_hash "$f")
    record_migration "$filename" "$current_hash"
  done

  total_count=$(ls database/migrations/*.sql | wc -l | tr -d ' ')
  echo "✅ Ledger bootstrap complete. Total recorded: $total_count"
  exit 0
fi

applied_count=0
skipped_count=0
total_count=0

if [[ -n "${MIGRATION_FILE:-}" ]]; then
  files=("database/migrations/${MIGRATION_FILE}")
else
  # Process migrations in lexicographic order (deterministic)
  mapfile -t files < <(ls database/migrations/*.sql | sort)
fi

for f in "${files[@]}"; do
  filename=$(basename "$f")
  total_count=$((total_count + 1))
  
  # Compute current file hash
  current_hash=$(compute_hash "$f")
  
  stored_hash=$(get_stored_hash "$filename")

  if [[ -n "${stored_hash:-}" ]]; then
    if [[ "$stored_hash" != "$current_hash" ]]; then
      echo "❌ ERROR: HASH_MISMATCH"
      echo "   File: $filename"
      echo "   Ledger hash:  $stored_hash"
      echo "   Current hash: $current_hash"
      echo ""
      echo "Fail-closed: migration file content changed after being recorded."
      echo "Migrations must be immutable once applied."
      exit 1
    fi

    echo "⏭️  Skipped: $filename (already applied, hash verified ✓)"
    skipped_count=$((skipped_count + 1))
    continue
  fi

  # Not in ledger: apply new migration
    # Apply new migration
    echo "▶️  Applying: $filename"

    # Legacy reconciliation: if initial schema is already present, backfill ledger
    # instead of failing on re-creation (e.g., 'relation already exists').
    if [[ "$filename" == "001_initial_schema.sql" ]]; then
      schema_check=$(is_initial_schema_present)
      schema_present=$(echo "$schema_check" | head -n 1)
      if [[ "$schema_present" == "1" ]]; then
        record_migration "$filename" "$current_hash"
        echo "⚠️  Skipped: $filename (initial schema detected; ledger backfilled)"
        skipped_count=$((skipped_count + 1))
        continue
      else
        missing_tables=$(echo "$schema_check" | tail -n 1)
        if [[ -n "${missing_tables:-}" && "$missing_tables" != "0" ]]; then
          echo "ℹ️  Initial schema appears partially present; missing: $missing_tables" >&2
        fi
      fi
    fi

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
  
done

echo ""
echo "════════════════════════════════════════"
echo "✅ Migration run completed successfully"
echo "════════════════════════════════════════"
echo "Total migrations:   $total_count"
echo "Applied:            $applied_count"
echo "Skipped (verified): $skipped_count"
echo "════════════════════════════════════════"
