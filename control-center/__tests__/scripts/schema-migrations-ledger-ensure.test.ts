import * as fs from 'fs';
import * as path from 'path';

describe('afu9_migrations_ledger ensure (canonical ledger)', () => {
  test('db-migrate.sh ensures afu9_migrations_ledger exists', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const scriptPath = path.join(repoRoot, 'scripts', 'db-migrate.sh');
    const content = fs.readFileSync(scriptPath, 'utf8');

    expect(content).toContain('AFU9_LEDGER_TABLE="afu9_migrations_ledger"');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS ${AFU9_LEDGER_TABLE}');
    expect(content).toContain('afu9_migrations_ledger_deny_mutations');
  });

  test('db-migrate.sh does not render invalid SQL like "AS 1" (bash $$ expansion)', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const scriptPath = path.join(repoRoot, 'scripts', 'db-migrate.sh');
    const content = fs.readFileSync(scriptPath, 'utf8');

    // Simulate bash double-quoted string behavior:
    // - unescaped $$ expands to PID (PID=1 in many containers)
    // - escaped dollars (\$) remain literal
    const ESC = '__ESC_DOLLAR__';
    let simulated = content.replace(/\\\$/g, ESC);
    simulated = simulated.replace(/\$\$/g, '1');
    simulated = simulated.replace(new RegExp(ESC, 'g'), '$');

    expect(simulated).not.toMatch(/\bAS\s+1\b/);
    expect(simulated).not.toMatch(/\bDO\s+1\b/);
  });

  test('db-migrate.js ensure step creates table and triggers', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ensureAfu9MigrationsLedger } = require(path.join(repoRoot, 'scripts', 'db-migrate.js'));

    const queries: string[] = [];

    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      },
    };

    await ensureAfu9MigrationsLedger(client);

    const joined = queries.join('\n');
    expect(joined).toContain('CREATE TABLE IF NOT EXISTS afu9_migrations_ledger');
    expect(joined).toContain('trg_afu9_migrations_ledger_no_update');
    expect(joined).toContain('trg_afu9_migrations_ledger_no_delete');
  });
});
