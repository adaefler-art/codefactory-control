#!/usr/bin/env bash
set -e
set -u

# Best-effort: enable pipefail when supported.
set -o pipefail 2>/dev/null || true

# Reality-check runner: emits deterministic DB/schema/search_path evidence.
# Intended to be executed inside the ECS task (same container/env as migrations).

export PGSSLMODE=${PGSSLMODE:-require}

psql_exec() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -qAt "$@"
  else
    psql -v ON_ERROR_STOP=1 -X -qAt "$@"
  fi
}

banner() {
  echo ""
  echo "========== $1 =========="
}

banner "connection"
psql_exec -c "SELECT 'current_database=' || current_database();"
psql_exec -c "SELECT 'current_schema=' || current_schema();"
psql_exec -c "SELECT 'current_user=' || current_user;"
psql_exec -c "SELECT 'server_version=' || version();"
psql_exec -c "SELECT 'search_path=' || current_setting('search_path');"

banner "table_presence"
psql_exec -c "SELECT 'to_regclass(intent_issue_authoring_events)=' || COALESCE(to_regclass('intent_issue_authoring_events')::text, 'NULL');"
psql_exec -c "SELECT 'to_regclass(public.intent_issue_authoring_events)=' || COALESCE(to_regclass('public.intent_issue_authoring_events')::text, 'NULL');"

banner "schema_scan_intent_issue_authoring_events"
psql_exec -c "SELECT n.nspname || '.' || c.relname AS fqtn
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r'
   AND c.relname = 'intent_issue_authoring_events'
 ORDER BY n.nspname, c.relname;"

banner "ledger_presence"
psql_exec -c "SELECT 'to_regclass(public.afu9_migrations_ledger)=' || COALESCE(to_regclass('public.afu9_migrations_ledger')::text, 'NULL');"

ledger_exists=$(psql_exec -c "SELECT to_regclass('public.afu9_migrations_ledger') IS NOT NULL;" | tr -d ' ')
if [[ "$ledger_exists" == "t" ]]; then
  banner "ledger_entry_054"
  psql_exec -c "SELECT filename || '|' || sha256 || '|' || applied_at
    FROM public.afu9_migrations_ledger
   WHERE filename IN ('054_intent_issue_authoring_events.sql')
   ORDER BY filename ASC;"
fi

echo ""
echo "✅ Reality-check complete"
