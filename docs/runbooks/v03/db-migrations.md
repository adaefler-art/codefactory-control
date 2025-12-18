# AFU-9 v0.3 Database Migrations (001-009)

## Kontext
- RDS ist privat (kein Public Endpoint). Migrationen laufen aus dem laufenden `control-center` Task via `ecs exec` (innerhalb des VPC).
- Secrets werden per AWS Secrets Manager gelesen (`afu9/database/master`, `afu9/github`). Keine Secrets in Logs ausgeben.

## Preconditions
- AWS CLI konfiguriert: `--profile codefactory --region eu-central-1`.
- Service `afu9-control-center` läuft im Cluster `afu9-cluster` und `ecs exec` ist erlaubt.
- Secrets Zugriff getestet (`SECRETS_OK`).

## TaskArn holen
```powershell
$taskArn = (aws ecs list-tasks --cluster afu9-cluster --service-name afu9-control-center --desired-status RUNNING --profile codefactory --region eu-central-1 --output json | ConvertFrom-Json).taskArns[0]
```

## Preflight (Connectivity + schema_migrations vorhanden?)
```powershell
$cmd = @'
WORK=/tmp/afu9-db
mkdir -p "$WORK"
cd "$WORK"
npm init -y || true
npm install pg @aws-sdk/client-secrets-manager
cat > preflight.js <<'NODE'
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { Client } = require("pg");

async function getSecret(name) {
  const sm = new SecretsManagerClient({ region: process.env.AWS_REGION || "eu-central-1" });
  const out = await sm.send(new GetSecretValueCommand({ SecretId: name }));
  return JSON.parse(out.SecretString);
}

async function main() {
  const s = await getSecret("afu9/database/master");
  const cfg = {
    host: s.host,
    port: Number(s.port || 5432),
    user: s.username,
    password: s.password,
    database: s.dbname,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 15000,
    query_timeout: 15000,
  };

  const c = new Client(cfg);
  await c.connect();

  const now = await c.query("select now() as now");
  const tables = await c.query("select count(*)::int as n from information_schema.tables where table_schema='public'");
  const mig = await c.query("select count(*)::int as n from information_schema.tables where table_schema='public' and table_name='schema_migrations'");
  console.log(JSON.stringify({
    now: now.rows[0].now,
    public_tables: tables.rows[0].n,
    schema_migrations_exists: mig.rows[0].n > 0
  }, null, 2));

  await c.end();
}

main().catch(e => { console.error("PREFLIGHT_FAILED:" + e.message); process.exit(1); });
NODE
node preflight.js
'@

$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cmd))
aws ecs execute-command --cluster afu9-cluster --task $taskArn --container control-center --interactive --profile codefactory --region eu-central-1 --command "/bin/sh -lc 'echo $b64 | base64 -d > /tmp/run.sh && tr -d \\\r </tmp/run.sh > /tmp/run.sh.lf && mv /tmp/run.sh.lf /tmp/run.sh && chmod +x /tmp/run.sh && /bin/sh /tmp/run.sh'"
```
Erwartet: JSON mit `now`, `public_tables`, `schema_migrations_exists`.

## Apply (001..009 aus GitHub laden, schema_migrations pflegen)
```powershell
$cmd = @'
WORK=/tmp/afu9-db
mkdir -p "$WORK"
cd "$WORK"
npm init -y || true
npm install pg @aws-sdk/client-secrets-manager
cat > migrate.js <<'NODE'
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { Client } = require("pg");
const { createHash } = require("crypto");

async function getSecret(name) {
  const sm = new SecretsManagerClient({ region: process.env.AWS_REGION || "eu-central-1" });
  const out = await sm.send(new GetSecretValueCommand({ SecretId: name }));
  return JSON.parse(out.SecretString);
}

async function fetchSql(owner, repo, token, file) {
  const paths = [
    `db/migrations/v03/${file}`,
    `database/migrations/${file}`,
  ];
  let lastStatus;
  for (const path of paths) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}`;
    const res = await fetch(url, { headers: { Authorization: `token ${token}` } });
    if (res.ok) return await res.text();
    lastStatus = res.status;
  }
  throw new Error(`fetch failed ${file}: ${lastStatus}`);
}

async function ensureMigrationsTable(client) {
  await client.query("create table if not exists schema_migrations (version text primary key, applied_at timestamptz default now(), checksum text not null)");
}

async function main() {
  const db = await getSecret("afu9/database/master");
  const gh = await getSecret("afu9/github");
  const files = [
    "001_initial_schema.sql",
    "002_add_example_workflows.sql",
    "003_webhook_events.sql",
    "004_verdict_engine.sql",
    "005_add_policy_snapshot_to_executions.sql",
    "006_kpi_aggregation.sql",
    "007_product_registry.sql",
    "008_prompt_action_library.sql",
    "009_cost_tracking.sql",
  ];

  const cfg = {
    host: db.host,
    port: Number(db.port || 5432),
    user: db.username,
    password: db.password,
    database: db.dbname,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 30000,
    query_timeout: 30000,
  };

  const client = new Client(cfg);
  await client.connect();
  await ensureMigrationsTable(client);
  await client.query("ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS repository_id UUID REFERENCES repositories(id)");

  const existing = new Map();
  const existingRows = await client.query("select version, checksum from schema_migrations");
  for (const row of existingRows.rows) existing.set(row.version, row.checksum);

  const results = [];

  for (const file of files) {
    const version = file.slice(0, 3);
    const sql = await fetchSql(gh.owner, gh.repo, gh.token, file);
    const checksum = createHash("sha256").update(sql).digest("hex");

    if (existing.has(version)) {
      if (existing.get(version) !== checksum) throw new Error(`checksum mismatch for ${version}`);
      results.push(`SKIPPED ${file}`);
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations(version, checksum) values ($1, $2)", [version, checksum]);
      await client.query("COMMIT");
      results.push(`APPLIED ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }

  const final = await client.query("select version, applied_at from schema_migrations order by version");
  console.log(JSON.stringify({ results, schema_migrations: final.rows }, null, 2));

  await client.end();
}

main().catch(e => { console.error("MIGRATION_FAILED:" + e.message); process.exit(1); });
NODE
node migrate.js
'@

$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cmd))
aws ecs execute-command --cluster afu9-cluster --task $taskArn --container control-center --interactive --profile codefactory --region eu-central-1 --command "/bin/sh -lc 'echo $b64 | base64 -d > /tmp/run.sh && tr -d \\\r </tmp/run.sh > /tmp/run.sh.lf && mv /tmp/run.sh.lf /tmp/run.sh && chmod +x /tmp/run.sh && /bin/sh /tmp/run.sh'"
```
Erwartet: Status pro File (APPLIED/SKIPPED) und `schema_migrations` Liste.

## Verify
```powershell
$cmd = @'
WORK=/tmp/afu9-db
mkdir -p "$WORK"
cd "$WORK"
npm init -y || true
npm install pg @aws-sdk/client-secrets-manager
cat > status.js <<'NODE'
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { Client } = require("pg");

async function getSecret(name) {
  const sm = new SecretsManagerClient({ region: process.env.AWS_REGION || "eu-central-1" });
  const out = await sm.send(new GetSecretValueCommand({ SecretId: name }));
  return JSON.parse(out.SecretString);
}

async function main() {
  const s = await getSecret("afu9/database/master");
  const cfg = {
    host: s.host,
    port: Number(s.port || 5432),
    user: s.username,
    password: s.password,
    database: s.dbname,
    ssl: { rejectUnauthorized: false },
  };

  const c = new Client(cfg);
  await c.connect();

  const tables = await c.query("select count(*)::int as n from information_schema.tables where table_schema='public'");
  const tablesToCheck = ['workflows','workflow_executions','webhook_events','kpi_snapshots','products'];
  const tablePresence = await c.query("select table_name from information_schema.tables where table_schema='public' and table_name = ANY($1)", [tablesToCheck]);
  const migrations = await c.query("select version, applied_at, checksum from schema_migrations order by version");

  console.log(JSON.stringify({
    public_tables: tables.rows[0].n,
    schema_migrations: migrations.rows,
    tables_present: tablePresence.rows.map(r => r.table_name).sort()
  }, null, 2));

  await c.end();
}

main().catch(e => { console.error("STATUS_FAILED:" + e.message); process.exit(1); });
NODE
node status.js
'@

$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cmd))
aws ecs execute-command --cluster afu9-cluster --task $taskArn --container control-center --interactive --profile codefactory --region eu-central-1 --command "/bin/sh -lc 'echo $b64 | base64 -d > /tmp/run.sh && tr -d \\\r </tmp/run.sh > /tmp/run.sh.lf && mv /tmp/run.sh.lf /tmp/run.sh && chmod +x /tmp/run.sh && /bin/sh /tmp/run.sh'"
```
Sollte `schema_migrations` 001..009, `public_tables > 0` und Präsenz der Kern-Tabellen zeigen.

## Safety / Hinweise
- Master-Secret nur für Migrationen verwenden; nach Go-Live separaten Migrator-Task-Role oder Secret mit least-privilege überlegen.
- Commands loggen keine Secrets, nur Status/Counts.
- Runner fügt bei Bedarf `workflow_executions.repository_id` hinzu, damit KPIs/Cost-Views funktionieren.
