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
} from '@/lib/db/migrations';

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
});
