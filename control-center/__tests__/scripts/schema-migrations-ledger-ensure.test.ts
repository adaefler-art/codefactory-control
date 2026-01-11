import * as fs from 'fs';
import * as path from 'path';

describe('schema_migrations ledger ensure (legacy compatibility)', () => {
  test('db-migrate.sh ensures filename column exists (pre-INSERT)', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const scriptPath = path.join(repoRoot, 'scripts', 'db-migrate.sh');
    const content = fs.readFileSync(scriptPath, 'utf8');

    expect(content).toContain('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS filename');
  });

  test('db-migrate.js ensure step adds filename column before use', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ensureSchemaMigrationsLedger } = require(path.join(repoRoot, 'scripts', 'db-migrate.js'));

    const queries: string[] = [];

    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        // The ensure step probes for an existing unique index/constraint.
        if (sql.includes('FROM pg_index') && sql.includes("a.attname = 'filename'")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    await ensureSchemaMigrationsLedger(client);

    const joined = queries.join('\n');
    expect(joined).toContain('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS filename');
  });

  test('db-migrate.js can derive and coerce version for legacy schema', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { deriveMigrationVersion, coerceVersionValue } = require(path.join(repoRoot, 'scripts', 'db-migrate.js'));

    const v1 = deriveMigrationVersion('001_initial_schema.sql');
    expect(v1).toBe('001');

    const v2 = deriveMigrationVersion('no_prefix.sql');
    expect(v2).toBe('no_prefix.sql');

    expect(coerceVersionValue('001', { udtName: 'text' })).toBe('001');
    expect(coerceVersionValue('001', { udtName: 'int4' })).toBe(1);
    expect(coerceVersionValue('not-a-number', { udtName: 'int4' })).toBe(0);
  });
});
