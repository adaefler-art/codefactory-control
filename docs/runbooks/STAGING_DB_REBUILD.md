# Staging DB Rebuild Runbook

**Purpose**: Eliminate schema drift by rebuilding staging from migrations, then enforcing parity checks.

This runbook assumes the staging database is treated as disposable (no production data).

## Why rebuild?

If staging’s `schema_migrations` ledger is out of sync with the repository migration chain, incremental “apply the next migration” becomes unreliable. A rebuild makes staging deterministic again:

- Fresh DB → apply `database/migrations/*.sql` in order
- `schema_migrations` is populated with `filename + sha256 + applied_at`
- `/api/ops/db/migrations` becomes authoritative and safe to gate on

## Preconditions

- You can access AWS for the staging account (RDS, Secrets Manager, ECS).
- You know the staging RDS instance identifier (or snapshot identifier).
- You understand this will interrupt staging while the DB is replaced.

## Step 1 — Take a snapshot (recommended)

This gives you a rollback point even though staging is disposable.

```bash
aws rds create-db-snapshot \
  --db-instance-identifier <staging-db-instance-id> \
  --db-snapshot-identifier <staging-db-instance-id>-pre-rebuild-$(date +%Y%m%d-%H%M%S) \
  --region eu-central-1

aws rds wait db-snapshot-completed \
  --db-snapshot-identifier <snapshot-id> \
  --region eu-central-1
```

## Step 2 — Restore to a new DB instance

Use the existing deployment docs as baseline:

- See: docs/deploy/README.md (“Restore from automated snapshot”)

Example:

```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier <new-staging-db-id> \
  --db-snapshot-identifier <snapshot-id> \
  --region eu-central-1
```

Wait for availability:

```bash
aws rds wait db-instance-available \
  --db-instance-identifier <new-staging-db-id> \
  --region eu-central-1
```

## Step 3 — Point staging to the new DB (Secrets Manager)

The ECS task definition maps DB env vars from a Secrets Manager secret (commonly `afu9/database`).

Update that secret’s JSON fields to the new DB endpoint and credentials:

```bash
aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --query SecretString \
  --output text \
  --region eu-central-1

# Then update SecretString with host/port/database/username/password
aws secretsmanager update-secret \
  --secret-id afu9/database \
  --secret-string '{"host":"<endpoint>","port":5432,"database":"afu9","username":"<user>","password":"<pass>"}' \
  --region eu-central-1
```

Notes:
- Do not commit secrets to git.
- If your environment uses a different secret name, follow the task definition mapping.

## Step 4 — Force ECS to pick up the new secret

Restart the staging service so new tasks read the updated secret:

```bash
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-control-center-staging \
  --force-new-deployment \
  --region eu-central-1
```

## Step 5 — Run all DB migrations inside the VPC

The runtime image includes:
- `database/migrations/`
- `scripts/db-migrate.sh`

So migrations can be executed from an ECS one-off task without direct DB access.

From this repo on Windows PowerShell:

```powershell
.\scripts\run-db-migrate-ecs.ps1 -ServiceName afu9-control-center-staging
```

This will:
- Start a one-off task using the service’s task definition + awsvpc config
- Run `./scripts/db-migrate.sh`
- Populate `schema_migrations` deterministically

## Step 6 — Verify parity (must PASS)

Preferred: use the ops endpoint/UI as described in docs/runbooks/MIGRATION_PARITY_CHECK.md.

- UI: `https://<staging-domain>/ops/migrations`
- API: `GET /api/ops/db/migrations?env=staging&limit=500`

Expected:
- `parity.status = PASS`
- `missingInDb = []`
- `extraInDb = []`
- `hashMismatches = []`

## Step 7 — Enforce “stays current”

Make parity a required check before releases to staging/prod:
- Run the Migration Parity Check (UI/API/GitHub Action) as a gate.
- Fail closed on drift.

(Implementation choice depends on your current CI/CD shape; the runbook above gets staging back to a clean baseline first.)
