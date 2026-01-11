/**
 * Unit Tests: schema_migrations adapter
 *
 * Ensures deterministic, priority-ordered identifier column selection.
 *
 * @jest-environment node
 */

import {
  pickSchemaMigrationsIdentifierColumn,
  SUPPORTED_SCHEMA_MIGRATIONS_IDENTIFIER_COLUMNS,
  listAppliedMigrations,
  SchemaMigrationsUnsupportedSchemaError,
} from '@/lib/db/migrations';

function createMockPool(responders: Array<(sql: string, params?: any[]) => any>) {
  const query = jest.fn(async (sql: string, params?: any[]) => {
    const responder = responders.shift();
    if (!responder) {
      throw new Error(`Unexpected query: ${sql} params=${JSON.stringify(params)}`);
    }
    return responder(sql, params);
  });

  return { query } as any;
}

describe('schema_migrations adapter', () => {
  test('picks filename when present', () => {
    expect(pickSchemaMigrationsIdentifierColumn(['id', 'filename', 'sha256'])).toBe('filename');
  });

  test('picks migration_id when filename missing', () => {
    expect(pickSchemaMigrationsIdentifierColumn(['migration_id', 'sha256'])).toBe('migration_id');
  });

  test('picks version when only version exists', () => {
    expect(pickSchemaMigrationsIdentifierColumn(['version', 'applied_at'])).toBe('version');
  });

  test('picks migration_name when present', () => {
    expect(pickSchemaMigrationsIdentifierColumn(['migration_name'])).toBe('migration_name');
  });

  test('returns null for unsupported schemas', () => {
    expect(pickSchemaMigrationsIdentifierColumn(['created_at', 'checksum'])).toBeNull();
  });

  test('supported columns list is stable', () => {
    expect(SUPPORTED_SCHEMA_MIGRATIONS_IDENTIFIER_COLUMNS).toEqual([
      'filename',
      'migration_id',
      'name',
      'migration_name',
      'version',
      'id',
    ]);
  });

  test('schema_migrations(filename): selects filename in priority order', async () => {
    const pool = createMockPool([
      // information_schema.columns
      () => ({ rows: [{ column_name: 'filename' }, { column_name: 'sha256' }, { column_name: 'applied_at' }] }),
      // schema_migrations read
      (sql, params) => {
        expect(params).toEqual([100]);
         expect(sql).toContain('SELECT COALESCE(filename::text, \'\') as filename');
        expect(sql).toContain('ORDER BY filename ASC');
        return {
          rows: [{ filename: '001_init.sql', sha256: 'h1', applied_at: '2026-01-01T00:00:00.000Z' }],
        };
      },
    ]);

    const rows = await listAppliedMigrations(pool, 100);
    expect(rows).toEqual([
      { filename: '001_init.sql', sha256: 'h1', applied_at: new Date('2026-01-01T00:00:00.000Z') },
    ]);
  });

  test('schema_migrations(migration_id): selects migration_id when filename absent', async () => {
    const pool = createMockPool([
      () => ({ rows: [{ column_name: 'migration_id' }, { column_name: 'applied_at' }] }),
      (sql) => {
         expect(sql).toContain('SELECT COALESCE(migration_id::text, \'\') as filename');
        expect(sql).toContain('ORDER BY migration_id ASC');
        return {
          rows: [{ filename: '54', sha256: '', applied_at: '2026-01-02T00:00:00.000Z' }],
        };
      },
    ]);

    const rows = await listAppliedMigrations(pool, 100);
    expect(rows[0]?.filename).toBe('54');
  });

  test('schema_migrations(version): selects version when filename/migration_id absent', async () => {
    const pool = createMockPool([
      () => ({ rows: [{ column_name: 'version' }] }),
      (sql) => {
          expect(sql).toContain('SELECT COALESCE(version::text, \'\') as filename');
        expect(sql).toContain('ORDER BY version ASC');
        return { rows: [{ filename: '202601090001', sha256: '', applied_at: null }] };
      },
    ]);

    const rows = await listAppliedMigrations(pool, 100);
    // Deterministic fallback when applied_at is missing
    expect(rows[0]?.applied_at.toISOString()).toBe(new Date(0).toISOString());
  });

  test('schema_migrations(migration_name): selects migration_name when present', async () => {
    const pool = createMockPool([
      () => ({ rows: [{ column_name: 'migration_name' }, { column_name: 'sha256' }] }),
      (sql) => {
          expect(sql).toContain('SELECT COALESCE(migration_name::text, \'\') as filename');
        expect(sql).toContain('ORDER BY migration_name ASC');
        return { rows: [{ filename: '054_create_table', sha256: 'h', applied_at: null }] };
      },
    ]);

    const rows = await listAppliedMigrations(pool, 100);
    expect(rows[0]?.filename).toBe('054_create_table');
    expect(rows[0]?.sha256).toBe('h');
  });

  test('unsupported schema: throws SchemaMigrationsUnsupportedSchemaError with diagnostics', async () => {
    const pool = createMockPool([
      () => ({ rows: [{ column_name: 'foo' }, { column_name: 'bar' }] }),
    ]);

    let caught: unknown;
    try {
      await listAppliedMigrations(pool, 100);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(SchemaMigrationsUnsupportedSchemaError);
    const err = caught as SchemaMigrationsUnsupportedSchemaError;
    expect(err.detectedColumns).toEqual(['bar', 'foo']);
    expect(err.supportedColumns).toEqual(['filename', 'migration_id', 'name', 'migration_name', 'version', 'id']);
  });
});
