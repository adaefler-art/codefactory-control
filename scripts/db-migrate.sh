#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

export PGSSLMODE=${PGSSLMODE:-require}

for f in $(ls database/migrations/*.sql | sort); do
  echo "Applying $f ..."
  psql "$DATABASE_URL" -f "$f"
done

echo "✅ Migrations completed"
