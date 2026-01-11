/*
  Database migration runner with schema_migrations ledger tracking.
  Intended to be invoked from the control-center workspace via:
    npm --prefix control-center run db:migrate

  This avoids relying on WSL/Git Bash on Windows and keeps migration execution
  deterministic and idempotent.
*/

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function computeSha256Hex(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function listSqlMigrations(migrationsDir) {
  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.sql'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

function deriveMigrationVersion(filename) {
  const match = /^\d+/.exec(String(filename || ''));
  if (match && match[0]) return match[0];
  return filename;
}

async function getSchemaMigrationsVersionColumn(client) {
  const res = await client.query(
    `
      SELECT column_name, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'schema_migrations'
        AND column_name = 'version'
      LIMIT 1;
    `
  );

  const row = res && Array.isArray(res.rows) ? res.rows[0] : null;
  if (!row) return null;

  return {
    udtName: String(row.udt_name || ''),
    isNullable: String(row.is_nullable || ''),
    columnDefault: row.column_default == null ? null : String(row.column_default),
  };
}

function coerceVersionValue(rawVersion, versionColumn) {
  const version = rawVersion == null ? '' : String(rawVersion);
  const udt = (versionColumn?.udtName || '').toLowerCase();

  // Handle common numeric types.
  const isNumeric = udt === 'int2' || udt === 'int4' || udt === 'int8' || udt === 'numeric';
  if (isNumeric) {
    const n = Number.parseInt(version, 10);
    return Number.isFinite(n) ? n : 0;
  }

  // Default: treat as string/text.
  return version;
}

async function ensureSchemaMigrationsLedger(client) {
  console.log('📋 Ensuring schema_migrations ledger...');

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      sha256 TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Legacy compatibility: schema_migrations may already exist without filename.
  // This must happen before any SELECT/INSERT references filename.
  await client.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS filename TEXT;`);

  // Ensure ON CONFLICT(filename) is valid on legacy tables (requires a unique index/constraint).
  // If the table was created above, the PRIMARY KEY already covers filename and this is a no-op.
  const hasUniqueFilenameRes = await client.query(`
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
    WHERE n.nspname = 'public'
      AND c.relname = 'schema_migrations'
      AND i.indisunique
      AND a.attname = 'filename'
    LIMIT 1;
  `);
  if (!hasUniqueFilenameRes || !Array.isArray(hasUniqueFilenameRes.rows) || hasUniqueFilenameRes.rows.length === 0) {
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_schema_migrations_filename_unique ON schema_migrations(filename);`
    );
  }

  await client.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS sha256 TEXT;`);
  await client.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;`);
  await client.query(`UPDATE schema_migrations SET applied_at = COALESCE(applied_at, NOW());`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations(applied_at DESC);`);
}

async function main() {
  const { Client } = require('pg');

  const databaseUrl = process.env.DATABASE_URL;

  /** @type {import('pg').ClientConfig} */
  let clientConfig;

  if (databaseUrl) {
    clientConfig = { connectionString: databaseUrl };
  } else {
    clientConfig = {
      host: requireEnv('DATABASE_HOST'),
      port: Number(requireEnv('DATABASE_PORT')),
      database: requireEnv('DATABASE_NAME'),
      user: requireEnv('DATABASE_USER'),
      password: requireEnv('DATABASE_PASSWORD'),
    };
  }

  // Optional SSL behavior via PGSSLMODE (default: no SSL).
  // For local docker-compose Postgres, ssl should remain disabled.
  const sslMode = (process.env.PGSSLMODE || '').toLowerCase();
  if (sslMode === 'require' || sslMode === 'prefer') {
    clientConfig.ssl = { rejectUnauthorized: false };
  }

  const repoRoot = path.resolve(__dirname, '..');
  const migrationsDir = path.resolve(repoRoot, 'database', 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  const migrationFiles = listSqlMigrations(migrationsDir);
  if (migrationFiles.length === 0) {
    console.log('ℹ️  No migrations found.');
    return;
  }

  const client = new Client(clientConfig);
  await client.connect();

  try {
    await ensureSchemaMigrationsLedger(client);

      // Legacy compatibility: some environments may have schema_migrations.version defined
      // as NOT NULL (no default). In that case, we must always populate it.
      const versionColumn = await getSchemaMigrationsVersionColumn(client);
      const hasVersionColumn = !!versionColumn;

    const ledgerCountRes = await client.query(`SELECT COUNT(*)::int AS count FROM schema_migrations;`);
    const ledgerCount = Number(ledgerCountRes.rows[0]?.count ?? 0);

    const userTableCountRes = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> 'schema_migrations';
    `);
    const userTableCount = Number(userTableCountRes.rows[0]?.count ?? 0);

    // If Postgres was initialized via docker-entrypoint-initdb.d, the schema may already exist
    // but the ledger is empty. In that case, bootstrap the ledger from repo migrations.
    if (ledgerCount === 0 && userTableCount > 0) {
      console.log('');
      console.log('⚠️  Detected existing schema without migration ledger.');
      console.log('⚠️  Bootstrapping schema_migrations from repository files (no SQL will be executed).');
      console.log('');

      await client.query('BEGIN;');
      try {
        for (const filename of migrationFiles) {
          const fullPath = path.join(migrationsDir, filename);
          const sql = fs.readFileSync(fullPath, 'utf8');
          const sha256 = computeSha256Hex(sql);

            if (hasVersionColumn) {
              const derivedVersion = coerceVersionValue(
                deriveMigrationVersion(filename),
                versionColumn
              );
              await client.query(
                `INSERT INTO schema_migrations (filename, sha256, applied_at, version)
                 VALUES ($1, $2, NOW(), $3)
                 ON CONFLICT (filename) DO NOTHING;`,
                [filename, sha256, derivedVersion]
              );
            } else {
              await client.query(
                `INSERT INTO schema_migrations (filename, sha256, applied_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (filename) DO NOTHING;`,
                [filename, sha256]
              );
            }
        }
        await client.query('COMMIT;');
      } catch (err) {
        await client.query('ROLLBACK;');
        throw err;
      }

      console.log(`✅ Ledger bootstrap complete. Total recorded: ${migrationFiles.length}`);
      return;
    }

    console.log('🔍 Starting database migration...');
    console.log('');

    let appliedCount = 0;
    let skippedCount = 0;

    for (const filename of migrationFiles) {
      const fullPath = path.join(migrationsDir, filename);
      const sql = fs.readFileSync(fullPath, 'utf8');
      const sha256 = computeSha256Hex(sql);

      const existing = await client.query(
        `SELECT sha256 FROM schema_migrations WHERE filename = $1 LIMIT 1;`,
        [filename]
      );

      if (existing.rowCount > 0) {
        const stored = (existing.rows[0].sha256 || '').trim();
        if (stored && stored !== sha256) {
          throw new Error(
            `Migration hash mismatch for ${filename}. Ledger=${stored}, File=${sha256}. ` +
              `Refusing to continue (migration files must be immutable).`
          );
        }

        console.log(`⏭️  Skipping (already applied): ${filename}`);
        skippedCount += 1;
        continue;
      }

      console.log(`▶️  Applying: ${filename}`);

      await client.query('BEGIN;');
      try {
        await client.query(sql);

          if (hasVersionColumn) {
            const derivedVersion = coerceVersionValue(
              deriveMigrationVersion(filename),
              versionColumn
            );
            await client.query(
              `INSERT INTO schema_migrations (filename, sha256, applied_at, version) VALUES ($1, $2, NOW(), $3);`,
              [filename, sha256, derivedVersion]
            );
          } else {
            await client.query(
              `INSERT INTO schema_migrations (filename, sha256, applied_at) VALUES ($1, $2, NOW());`,
              [filename, sha256]
            );
          }
        await client.query('COMMIT;');
        console.log(`✅ Applied: ${filename}`);
        appliedCount += 1;
      } catch (err) {
        await client.query('ROLLBACK;');
        throw err;
      }
    }

    console.log('');
    console.log(`✅ Migration complete. Applied: ${appliedCount}, Skipped: ${skippedCount}, Total: ${migrationFiles.length}`);
  } finally {
    await client.end();
  }
}

module.exports = {
  ensureSchemaMigrationsLedger,
  deriveMigrationVersion,
  getSchemaMigrationsVersionColumn,
  coerceVersionValue,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`❌ ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
  });
}
