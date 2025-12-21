#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -z "${DATABASE_HOST:-}" || -z "${DATABASE_PORT:-}" || -z "${DATABASE_NAME:-}" || -z "${DATABASE_USER:-}" || -z "${DATABASE_PASSWORD:-}" ]]; then
    echo "DATABASE_URL or DATABASE_(HOST,PORT,NAME,USER,PASSWORD) are required" >&2
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

for f in $(ls database/migrations/*.sql | sort); do
  echo "Applying $f ..."
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" -f "$f"
  else
    psql -f "$f"
  fi
done

echo "✅ Migrations completed"
