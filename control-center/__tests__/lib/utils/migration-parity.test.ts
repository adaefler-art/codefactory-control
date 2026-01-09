/**
 * Unit Tests: Migration Parity Utility
 * 
 * Tests deterministic parity computation and stable sorting.
 * 
 * @jest-environment node
 */

import {
  canonicalizeDbMigrationId,
  canonicalizeRepoMigrationId,
  computeParity,
  getLatestMigration,
  type MigrationFile,
  type MigrationLedgerEntry,
} from '@/lib/utils/migration-parity';

describe('Migration Parity Utility', () => {
  describe('canonical id normalization', () => {
    test('repo: uses leading numeric prefix (without extension)', () => {
      expect(canonicalizeRepoMigrationId('054_create_table.sql')).toBe('54');
      expect(canonicalizeRepoMigrationId('0001_bootstrap.sql')).toBe('1');
      expect(canonicalizeRepoMigrationId('create_users.sql')).toBe('create_users');
    });

    test('db: extracts leading digits from version-like strings', () => {
      expect(canonicalizeDbMigrationId('54')).toBe('54');
      expect(canonicalizeDbMigrationId(54)).toBe('54');
      expect(canonicalizeDbMigrationId('054')).toBe('54');
      expect(canonicalizeDbMigrationId('054_some_name')).toBe('54');
      expect(canonicalizeDbMigrationId('create_users')).toBe('create_users');
    });

    test('db: large version-like strings stay precise (no numeric coercion)', () => {
      expect(canonicalizeDbMigrationId('000202601090001234567890123')).toBe('202601090001234567890123');
      expect(canonicalizeDbMigrationId('202601090001234567890123_suffix')).toBe('202601090001234567890123');
    });
  });

  describe('computeParity', () => {
    test('PASS: identical migrations in repo and DB', () => {
      const repoMigrations: MigrationFile[] = [
        { filename: '001_initial.sql', sha256: 'abc123' },
        { filename: '002_users.sql', sha256: 'def456' },
        { filename: '003_posts.sql', sha256: 'ghi789' },
      ];

      const dbMigrations: MigrationLedgerEntry[] = [
        { filename: '001_initial.sql', sha256: 'abc123', applied_at: new Date('2026-01-01') },
        { filename: '002_users.sql', sha256: 'def456', applied_at: new Date('2026-01-02') },
        { filename: '003_posts.sql', sha256: 'ghi789', applied_at: new Date('2026-01-03') },
      ];

      const result = computeParity(repoMigrations, dbMigrations);

      expect(result.status).toBe('PASS');
      expect(result.missingInDb).toEqual([]);
      expect(result.extraInDb).toEqual([]);
      expect(result.hashMismatches).toEqual([]);
    });

    test('FAIL: missing in DB (repo has more migrations)', () => {
      const repoMigrations: MigrationFile[] = [
        { filename: '001_initial.sql', sha256: 'abc123' },
        { filename: '002_users.sql', sha256: 'def456' },
        { filename: '003_posts.sql', sha256: 'ghi789' },
      ];

      const dbMigrations: MigrationLedgerEntry[] = [
        { filename: '001_initial.sql', sha256: 'abc123', applied_at: new Date('2026-01-01') },
        { filename: '002_users.sql', sha256: 'def456', applied_at: new Date('2026-01-02') },
      ];

      const result = computeParity(repoMigrations, dbMigrations);

      expect(result.status).toBe('FAIL');
      expect(result.missingInDb).toEqual(['003_posts.sql']);
      expect(result.extraInDb).toEqual([]);
      expect(result.hashMismatches).toEqual([]);
    });

    test('FAIL: extra in DB (DB has migrations not in repo)', () => {
      const repoMigrations: MigrationFile[] = [
        { filename: '001_initial.sql', sha256: 'abc123' },
        { filename: '002_users.sql', sha256: 'def456' },
      ];

      const dbMigrations: MigrationLedgerEntry[] = [
        { filename: '001_initial.sql', sha256: 'abc123', applied_at: new Date('2026-01-01') },
        { filename: '002_users.sql', sha256: 'def456', applied_at: new Date('2026-01-02') },
        { filename: '003_orphaned.sql', sha256: 'orphan', applied_at: new Date('2026-01-03') },
      ];

      const result = computeParity(repoMigrations, dbMigrations);

      expect(result.status).toBe('FAIL');
      expect(result.missingInDb).toEqual([]);
      expect(result.extraInDb).toEqual(['003_orphaned.sql']);
      expect(result.hashMismatches).toEqual([]);
    });

    test('FAIL: hash mismatch (same filename, different hash)', () => {
      const repoMigrations: MigrationFile[] = [
        { filename: '001_initial.sql', sha256: 'abc123' },
        { filename: '002_users.sql', sha256: 'def456_modified' }, // Modified
      ];

      const dbMigrations: MigrationLedgerEntry[] = [
        { filename: '001_initial.sql', sha256: 'abc123', applied_at: new Date('2026-01-01') },
        { filename: '002_users.sql', sha256: 'def456_original', applied_at: new Date('2026-01-02') },
      ];

      const result = computeParity(repoMigrations, dbMigrations);

      expect(result.status).toBe('FAIL');
      expect(result.missingInDb).toEqual([]);
      expect(result.extraInDb).toEqual([]);
      expect(result.hashMismatches).toHaveLength(1);
      expect(result.hashMismatches[0]).toEqual({
        filename: '002_users.sql',
        repoHash: 'def456_modified',
        dbHash: 'def456_original',
      });
    });

    test('FAIL: multiple discrepancies', () => {
      const repoMigrations: MigrationFile[] = [
        { filename: '001_initial.sql', sha256: 'abc123' },
        { filename: '002_users.sql', sha256: 'def456_modified' },
        { filename: '004_new.sql', sha256: 'new123' },
      ];

      const dbMigrations: MigrationLedgerEntry[] = [
        { filename: '001_initial.sql', sha256: 'abc123', applied_at: new Date('2026-01-01') },
        { filename: '002_users.sql', sha256: 'def456_original', applied_at: new Date('2026-01-02') },
        { filename: '003_orphaned.sql', sha256: 'orphan', applied_at: new Date('2026-01-03') },
      ];

      const result = computeParity(repoMigrations, dbMigrations);

      expect(result.status).toBe('FAIL');
      expect(result.missingInDb).toEqual(['004_new.sql']);
      expect(result.extraInDb).toEqual(['003_orphaned.sql']);
      expect(result.hashMismatches).toHaveLength(1);
      expect(result.hashMismatches[0].filename).toBe('002_users.sql');
    });

    test('Deterministic ordering: missingInDb sorted lexicographically', () => {
      const repoMigrations: MigrationFile[] = [
        { filename: '050_zebra.sql', sha256: 'z' },
        { filename: '010_apple.sql', sha256: 'a' },
        { filename: '030_mango.sql', sha256: 'm' },
      ];

      const dbMigrations: MigrationLedgerEntry[] = [];

      const result = computeParity(repoMigrations, dbMigrations);

      // Should be sorted lexicographically
      expect(result.missingInDb).toEqual([
        '010_apple.sql',
        '030_mango.sql',
        '050_zebra.sql',
      ]);
    });

    test('Deterministic ordering: extraInDb sorted lexicographically', () => {
      const repoMigrations: MigrationFile[] = [];

      const dbMigrations: MigrationLedgerEntry[] = [
        { filename: '050_zebra.sql', sha256: 'z', applied_at: new Date() },
        { filename: '010_apple.sql', sha256: 'a', applied_at: new Date() },
        { filename: '030_mango.sql', sha256: 'm', applied_at: new Date() },
      ];

      const result = computeParity(repoMigrations, dbMigrations);

      // Should be sorted lexicographically
      expect(result.extraInDb).toEqual([
        '010_apple.sql',
        '030_mango.sql',
        '050_zebra.sql',
      ]);
    });

    test('Deterministic ordering: hashMismatches sorted lexicographically', () => {
      const repoMigrations: MigrationFile[] = [
        { filename: '050_zebra.sql', sha256: 'z_repo' },
        { filename: '010_apple.sql', sha256: 'a_repo' },
        { filename: '030_mango.sql', sha256: 'm_repo' },
      ];

      const dbMigrations: MigrationLedgerEntry[] = [
        { filename: '050_zebra.sql', sha256: 'z_db', applied_at: new Date() },
        { filename: '010_apple.sql', sha256: 'a_db', applied_at: new Date() },
        { filename: '030_mango.sql', sha256: 'm_db', applied_at: new Date() },
      ];

      const result = computeParity(repoMigrations, dbMigrations);

      // Should be sorted lexicographically
      expect(result.hashMismatches.map(m => m.filename)).toEqual([
        '010_apple.sql',
        '030_mango.sql',
        '050_zebra.sql',
      ]);
    });

    test('Empty repo and DB: PASS', () => {
      const result = computeParity([], []);
      
      expect(result.status).toBe('PASS');
      expect(result.missingInDb).toEqual([]);
      expect(result.extraInDb).toEqual([]);
      expect(result.hashMismatches).toEqual([]);
    });

    test('Idempotent: same inputs produce same output', () => {
      const repoMigrations: MigrationFile[] = [
        { filename: '002_b.sql', sha256: 'b' },
        { filename: '001_a.sql', sha256: 'a' },
      ];

      const dbMigrations: MigrationLedgerEntry[] = [
        { filename: '001_a.sql', sha256: 'a_different', applied_at: new Date() },
      ];

      const result1 = computeParity(repoMigrations, dbMigrations);
      const result2 = computeParity(repoMigrations, dbMigrations);

      expect(result1).toEqual(result2);
    });

    test('version-based schema_migrations: numeric DB ids match repo numeric prefixes', () => {
      const repoMigrations: MigrationFile[] = [
        { filename: '054_create_table.sql', sha256: 'h1' },
        { filename: '055_add_index.sql', sha256: 'h2' },
      ];

      const dbMigrations: MigrationLedgerEntry[] = [
        { filename: '54', sha256: 'h1', applied_at: new Date('2026-01-01') },
        { filename: '55', sha256: 'h2', applied_at: new Date('2026-01-02') },
      ];

      const result = computeParity(repoMigrations, dbMigrations);
      expect(result.status).toBe('PASS');
      expect(result.missingInDb).toEqual([]);
      expect(result.extraInDb).toEqual([]);
      expect(result.hashMismatches).toEqual([]);
    });

    test('deterministic snapshot: ordering stable across mixed identifiers', () => {
      const repoMigrations: MigrationFile[] = [
        { filename: '010_apple.sql', sha256: 'a' },
        { filename: '002_banana.sql', sha256: 'b' },
        { filename: 'zeta.sql', sha256: 'z' },
      ];

      const dbMigrations: MigrationLedgerEntry[] = [
        { filename: '2', sha256: 'b', applied_at: new Date('2026-01-01') },
        { filename: '999', sha256: 'x', applied_at: new Date('2026-01-02') },
      ];

      expect(computeParity(repoMigrations, dbMigrations)).toMatchInlineSnapshot(`
{
  "extraInDb": [
    "999",
  ],
  "hashMismatches": [],
  "missingInDb": [
    "010_apple.sql",
    "zeta.sql",
  ],
  "status": "FAIL",
}
`);
    });
  });

  describe('getLatestMigration', () => {
    test('Returns last element from sorted list', () => {
      const migrations: MigrationFile[] = [
        { filename: '001_initial.sql', sha256: 'a' },
        { filename: '002_users.sql', sha256: 'b' },
        { filename: '003_posts.sql', sha256: 'c' },
      ];

      const latest = getLatestMigration(migrations);
      
      expect(latest).toBe('003_posts.sql');
    });

    test('Returns null for empty list', () => {
      const latest = getLatestMigration([]);
      
      expect(latest).toBeNull();
    });

    test('Returns single element', () => {
      const migrations: MigrationFile[] = [
        { filename: '001_only.sql', sha256: 'x' },
      ];

      const latest = getLatestMigration(migrations);
      
      expect(latest).toBe('001_only.sql');
    });

    test('Assumes input is already sorted', () => {
      // Assumes listRepoMigrations already sorted the list
      const migrations: MigrationFile[] = [
        { filename: '010_first.sql', sha256: 'a' },
        { filename: '020_second.sql', sha256: 'b' },
        { filename: '005_actually_first.sql', sha256: 'c' }, // Out of order
      ];

      const latest = getLatestMigration(migrations);
      
      // Returns last element (assumes input is sorted)
      expect(latest).toBe('005_actually_first.sql');
    });
  });
});
