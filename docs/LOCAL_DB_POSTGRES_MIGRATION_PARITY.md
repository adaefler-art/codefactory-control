# Local Postgres: deterministic bring-up + migration parity proof (AFU-9)

This repo uses Docker Compose + Postgres init scripts.
All SQL files in `database/migrations/*.sql` are bind-mounted into `/docker-entrypoint-initdb.d` and executed **once per fresh data volume**, in lexical filename order.

## Source of truth

- **Schema source of truth**: `database/migrations/*.sql`
- **“Applied” source of truth (local only)**: evidence from **initdb logs** on a fresh volume + schema existence checks.
  - There is no migration tracking table in this flow; init logs are the authoritative record of which scripts ran.

## Compose-derived connection parameters

From `docker-compose.yml` (local dev defaults):

- Host: `localhost`
- Port: `5432`
- DB: `afu9`
- User: `afu9_admin`
- Password: `dev_password`

## Deterministic replay (fail-closed)

From repo root:

```powershell
# 1) Hard reset DB state so init scripts replay deterministically
docker compose down -v

# 2) Start only Postgres
docker compose up -d postgres

# 3) Wait for health=healthy
# (repeat until "healthy")
docker ps --filter "name=postgres" --format "table {{.Names}}\t{{.Status}}"
```

## Evidence: last migration executed

### 1) Count migrations in repo

```powershell
Get-ChildItem .\database\migrations\*.sql | Sort-Object Name | Measure-Object | Select-Object -ExpandProperty Count
(Get-ChildItem .\database\migrations\*.sql | Sort-Object Name | Select-Object -Last 1).Name
```

### 2) Extract the last initdb “running … .sql” line from container logs

```powershell
$container = (docker ps --filter "name=postgres" --format "{{.Names}}" | Select-Object -First 1)

# Show all migration runs
docker logs $container 2>&1 | Select-String -Pattern "running .*\/docker-entrypoint-initdb\.d\/.*\.sql"

# Show only the final run
docker logs $container 2>&1 | Select-String -Pattern "running .*\/docker-entrypoint-initdb\.d\/.*\.sql" | Select-Object -Last 1
```

**Pass condition:** the final log line contains the same filename as the last file in `database/migrations` (lexical order).

## Evidence: connectivity + schema checks

Run `psql` inside the container (avoids needing a host-installed `psql`):

```powershell
$container = (docker ps --filter "name=postgres" --format "{{.Names}}" | Select-Object -First 1)

# Connectivity
docker exec -i $container psql -U afu9_admin -d afu9 -c "select 1;"

# Basic schema sanity (how many public tables exist)
docker exec -i $container psql -U afu9_admin -d afu9 -c "select count(*) as public_tables from information_schema.tables where table_schema='public' and table_type='BASE TABLE';"

# Verify specific table/column exists (example)
docker exec -i $container psql -U afu9_admin -d afu9 -c "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='tuning_suggestions' order by ordinal_position;"
```

## Control-center env vars (tests/build)

Note: the control-center code/tests primarily use discrete env vars (not just `DATABASE_URL`).

```powershell
$env:DATABASE_HOST = 'localhost'
$env:DATABASE_PORT = '5432'
$env:DATABASE_NAME = 'afu9'
$env:DATABASE_USER = 'afu9_admin'
$env:DATABASE_PASSWORD = 'dev_password'
```

## Required verification commands

From repo root:

```powershell
npm run repo:verify
npm --prefix control-center test
npm --prefix control-center run build
```
