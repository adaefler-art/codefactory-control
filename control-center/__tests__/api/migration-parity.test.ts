/**
 * API Tests: GET /api/ops/db/migrations
 * 
 * Tests auth (401/403), prod-block (409), bounds, ledger scenarios, and deterministic output.
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/ops/db/migrations/route';
import { GET as GET_ALIAS } from '../../app/api/ops/db/migration-parity/route';

// Mock deployment-env module
jest.mock('@/lib/utils/deployment-env', () => ({
  getDeploymentEnv: jest.fn(() => 'staging'),
}));

// Mock database module
jest.mock('@/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(),
  })),
}));

// Mock migration DAO
jest.mock('@/lib/db/migrations', () => ({
  SUPPORTED_SCHEMA_MIGRATIONS_IDENTIFIER_COLUMNS: [
    'filename',
    'migration_id',
    'name',
    'migration_name',
    'version',
    'id',
  ],
  SchemaMigrationsUnsupportedSchemaError: class SchemaMigrationsUnsupportedSchemaError extends Error {
    detectedColumns: string[];
    supportedColumns: readonly string[];

    constructor(detectedColumns: string[]) {
      super('schema_migrations table has no supported identifier column');
      this.name = 'SchemaMigrationsUnsupportedSchemaError';
      this.detectedColumns = [...detectedColumns];
      this.supportedColumns = [
        'filename',
        'migration_id',
        'name',
        'migration_name',
        'version',
        'id',
      ];
    }
  },
  checkDbReachability: jest.fn(),
  checkLedgerExists: jest.fn(),
  listAppliedMigrations: jest.fn(),
  getLastAppliedMigration: jest.fn(),
  getAppliedMigrationCount: jest.fn(),
}));

// Mock migration parity utility
jest.mock('@/lib/utils/migration-parity', () => ({
  listRepoMigrations: jest.fn(),
  computeParity: jest.fn(),
  getLatestMigration: jest.fn(),
}));

// Mock lawbook version helper
jest.mock('@/lib/lawbook-version-helper', () => ({
  getLawbookVersion: jest.fn().mockResolvedValue('v0.7.0'),
}));

describe('GET /api/ops/db/migrations - Security Tests', () => {
  const mockGetDeploymentEnv = require('@/lib/utils/deployment-env').getDeploymentEnv;
  const mockCheckDbReachability = require('@/lib/db/migrations').checkDbReachability;
  const mockCheckLedgerExists = require('@/lib/db/migrations').checkLedgerExists;
  const mockListAppliedMigrations = require('@/lib/db/migrations').listAppliedMigrations;
  const mockGetLastAppliedMigration = require('@/lib/db/migrations').getLastAppliedMigration;
  const mockGetAppliedMigrationCount = require('@/lib/db/migrations').getAppliedMigrationCount;
  const SchemaMigrationsUnsupportedSchemaError = require('@/lib/db/migrations').SchemaMigrationsUnsupportedSchemaError;
  const mockListRepoMigrations = require('@/lib/utils/migration-parity').listRepoMigrations;
  const mockComputeParity = require('@/lib/utils/migration-parity').computeParity;
  const mockGetLatestMigration = require('@/lib/utils/migration-parity').getLatestMigration;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AFU9_ADMIN_SUBS;
    // Default to staging
    mockGetDeploymentEnv.mockReturnValue('staging');
  });

  test('401: Unauthorized without x-afu9-sub header (auth-first)', async () => {
    const request = new NextRequest('http://localhost/api/ops/db/migrations', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-no-auth',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(body.code).toBe('UNAUTHORIZED');
    expect(body.details).toContain('Authentication required');
    
    // Ensure no DB calls were made (auth-first)
    expect(mockCheckDbReachability).not.toHaveBeenCalled();
  });

  test('401: Unauthenticated in production returns 401 (not 409)', async () => {
    // Simulate production environment
    mockGetDeploymentEnv.mockReturnValue('production');

    const request = new NextRequest('http://localhost/api/ops/db/migrations', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-prod-unauth',
        // No x-afu9-sub header
      },
    });

    const response = await GET(request);
    const body = await response.json();

    // Auth check happens BEFORE env gating (401-first)
    expect(response.status).toBe(401);
    expect(body.code).toBe('UNAUTHORIZED');
    
    // Ensure no DB calls were made
    expect(mockCheckDbReachability).not.toHaveBeenCalled();
  });

  test('409: Production environment disabled (env gating)', async () => {
    // Simulate production environment
    mockGetDeploymentEnv.mockReturnValue('production');

    const request = new NextRequest('http://localhost/api/ops/db/migrations', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-prod-env-disabled',
        'x-afu9-sub': 'admin-123',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('Environment access disabled');
    expect(body.code).toBe('ENV_DISABLED');
    expect(body.details).toContain('production');

    // Ensure no DB calls were made (fail-closed)
    expect(mockCheckDbReachability).not.toHaveBeenCalled();
  });

  test('409: Unknown environment disabled (fail-closed)', async () => {
    // Simulate unknown environment
    mockGetDeploymentEnv.mockReturnValue('unknown');

    const request = new NextRequest('http://localhost/api/ops/db/migrations', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-unknown-env',
        'x-afu9-sub': 'admin-123',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('ENV_DISABLED');
    expect(body.details).toContain('unknown');

    // Ensure no DB calls were made (fail-closed for unknown)
    expect(mockCheckDbReachability).not.toHaveBeenCalled();
  });

  test('401: Unauthorized with empty x-afu9-sub header', async () => {
    const request = new NextRequest('http://localhost/api/ops/db/migrations', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-empty-auth',
        'x-afu9-sub': '   ',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(body.code).toBe('UNAUTHORIZED');
  });

  test('403: Forbidden when AFU9_ADMIN_SUBS is missing (fail-closed)', async () => {
    // No AFU9_ADMIN_SUBS set
    const request = new NextRequest('http://localhost/api/ops/db/migrations', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-no-allowlist',
        'x-afu9-sub': 'user-123',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(body.code).toBe('FORBIDDEN');
    expect(body.details).toContain('Admin privileges required');

    // Ensure no DB calls were made (fail-closed)
    expect(mockCheckDbReachability).not.toHaveBeenCalled();
  });

  test('403: Forbidden when AFU9_ADMIN_SUBS is empty (fail-closed)', async () => {
    process.env.AFU9_ADMIN_SUBS = '   ';

    const request = new NextRequest('http://localhost/api/ops/db/migrations', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-empty-allowlist',
        'x-afu9-sub': 'user-123',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe('FORBIDDEN');
    expect(mockCheckDbReachability).not.toHaveBeenCalled();
  });

  test('403: Forbidden when user not in admin allowlist', async () => {
    process.env.AFU9_ADMIN_SUBS = 'admin-1,admin-2,admin-3';

    const request = new NextRequest('http://localhost/api/ops/db/migrations', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-not-admin',
        'x-afu9-sub': 'regular-user',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe('FORBIDDEN');
    expect(mockCheckDbReachability).not.toHaveBeenCalled();
  });

  test('500: DB unreachable error', async () => {
    process.env.AFU9_ADMIN_SUBS = 'admin-123';
    
    mockCheckDbReachability.mockResolvedValue({
      reachable: false,
      host: 'localhost',
      port: 5432,
      database: 'afu9',
      error: 'Connection timeout',
    });

    const request = new NextRequest('http://localhost/api/ops/db/migrations', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-db-unreachable',
        'x-afu9-sub': 'admin-123',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Database unreachable');
    expect(body.code).toBe('DB_UNREACHABLE');
    expect(body.details).toContain('Connection timeout');
  });

  test('500: Migration ledger missing error', async () => {
    process.env.AFU9_ADMIN_SUBS = 'admin-123';
    
    mockCheckDbReachability.mockResolvedValue({
      reachable: true,
      host: 'localhost',
      port: 5432,
      database: 'afu9',
    });
    
    mockCheckLedgerExists.mockResolvedValue(false);

    const request = new NextRequest('http://localhost/api/ops/db/migrations', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-ledger-missing',
        'x-afu9-sub': 'admin-123',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Migration ledger not found');
    expect(body.code).toBe('MIGRATION_LEDGER_MISSING');
    expect(body.details).toContain('schema_migrations');
  });

  test('400: Unsupported schema_migrations schema returns diagnostics (not 500)', async () => {
    process.env.AFU9_ADMIN_SUBS = 'admin-123';

    mockCheckDbReachability.mockResolvedValue({
      reachable: true,
      host: 'localhost',
      port: 5432,
      database: 'afu9',
    });

    mockCheckLedgerExists.mockResolvedValue(true);

    mockListAppliedMigrations.mockRejectedValue(
      new SchemaMigrationsUnsupportedSchemaError(['created_at', 'checksum'])
    );

    const request = new NextRequest('http://localhost/api/ops/db/migrations', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-unsupported-schema',
        'x-afu9-sub': 'admin-123',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Unsupported migration ledger schema');
    expect(body.code).toBe('MIGRATION_LEDGER_UNSUPPORTED_SCHEMA');
    expect(body.details).toContain('Detected columns');
    expect(body.details).toContain('supported');
  });

  test('200: PASS scenario - migrations in sync', async () => {
    process.env.AFU9_ADMIN_SUBS = 'admin-123';
    
    mockCheckDbReachability.mockResolvedValue({
      reachable: true,
      host: 'localhost',
      port: 5432,
      database: 'afu9',
    });
    
    mockCheckLedgerExists.mockResolvedValue(true);
    
    mockListRepoMigrations.mockReturnValue([
      { filename: '001_initial.sql', sha256: 'abc123' },
      { filename: '002_users.sql', sha256: 'def456' },
    ]);
    
    mockGetLatestMigration.mockReturnValue('002_users.sql');
    
    mockListAppliedMigrations.mockResolvedValue([
      { filename: '001_initial.sql', sha256: 'abc123', applied_at: new Date('2026-01-01') },
      { filename: '002_users.sql', sha256: 'def456', applied_at: new Date('2026-01-02') },
    ]);
    
    mockGetLastAppliedMigration.mockResolvedValue({
      filename: '002_users.sql',
      sha256: 'def456',
      applied_at: new Date('2026-01-02'),
    });
    
    mockGetAppliedMigrationCount.mockResolvedValue(2);
    
    mockComputeParity.mockReturnValue({
      status: 'PASS',
      missingInDb: [],
      extraInDb: [],
      hashMismatches: [],
    });

    const request = new NextRequest('http://localhost/api/ops/db/migrations', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-pass',
        'x-afu9-sub': 'admin-123',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe('0.7.0');
    expect(body.db.reachable).toBe(true);
    expect(body.repo.migrationCount).toBe(2);
    expect(body.repo.latest).toBe('002_users.sql');
    expect(body.ledger.appliedCount).toBe(2);
    expect(body.ledger.lastApplied).toBe('002_users.sql');
    expect(body.parity.status).toBe('PASS');
    expect(body.parity.missingInDb).toEqual([]);
    expect(body.parity.extraInDb).toEqual([]);
    expect(body.parity.hashMismatches).toEqual([]);
  });

  test('200: deterministic ordering snapshot (route enforces sorting)', async () => {
    process.env.AFU9_ADMIN_SUBS = 'admin-123';

    mockCheckDbReachability.mockResolvedValue({
      reachable: true,
      host: 'localhost',
      port: 5432,
      database: 'afu9',
    });
    mockCheckLedgerExists.mockResolvedValue(true);

    mockListRepoMigrations.mockReturnValue([
      { filename: '010_apple.sql', sha256: 'a' },
      { filename: '002_banana.sql', sha256: 'b' },
    ]);
    mockGetLatestMigration.mockReturnValue('010_apple.sql');

    mockListAppliedMigrations.mockResolvedValue([
      { filename: '2', sha256: 'b', applied_at: new Date('2026-01-01') },
      { filename: '999', sha256: 'x', applied_at: new Date('2026-01-02') },
    ]);
    mockGetLastAppliedMigration.mockResolvedValue({
      filename: '999',
      sha256: 'x',
      applied_at: new Date('2026-01-02'),
    });
    mockGetAppliedMigrationCount.mockResolvedValue(2);

    // Intentionally UNSORTED to verify route-level determinism
    mockComputeParity.mockReturnValue({
      status: 'FAIL',
      missingInDb: ['010_apple.sql', '002_banana.sql'],
      extraInDb: ['zzz_extra', 'aaa_extra'],
      hashMismatches: [
        { filename: 'z.sql', repoHash: '1', dbHash: '2' },
        { filename: 'a.sql', repoHash: '3', dbHash: '4' },
      ],
    });

    const request = new NextRequest('http://localhost/api/ops/db/migrations?limit=200', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-snapshot',
        'x-afu9-sub': 'admin-123',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.parity).toMatchInlineSnapshot(`
{
  "extraInDb": [
    "aaa_extra",
    "zzz_extra",
  ],
  "hashMismatches": [
    {
      "dbHash": "4",
      "filename": "a.sql",
      "repoHash": "3",
    },
    {
      "dbHash": "2",
      "filename": "z.sql",
      "repoHash": "1",
    },
  ],
  "missingInDb": [
    "002_banana.sql",
    "010_apple.sql",
  ],
  "status": "FAIL",
}
`);
  });

  test('alias route: /api/ops/db/migration-parity responds (non-500)', async () => {
    process.env.AFU9_ADMIN_SUBS = 'admin-123';

    mockCheckDbReachability.mockResolvedValue({
      reachable: true,
      host: 'localhost',
      port: 5432,
      database: 'afu9',
    });
    mockCheckLedgerExists.mockResolvedValue(true);

    mockListRepoMigrations.mockReturnValue([]);
    mockGetLatestMigration.mockReturnValue(null);
    mockListAppliedMigrations.mockResolvedValue([]);
    mockGetLastAppliedMigration.mockResolvedValue(null);
    mockGetAppliedMigrationCount.mockResolvedValue(0);
    mockComputeParity.mockReturnValue({ status: 'PASS', missingInDb: [], extraInDb: [], hashMismatches: [] });

    const request = new NextRequest('http://localhost/api/ops/db/migration-parity', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-alias',
        'x-afu9-sub': 'admin-123',
      },
    });

    const response = await GET_ALIAS(request);
    expect(response.status).not.toBe(500);
  });

  test('200: FAIL scenario - missing in DB', async () => {
    process.env.AFU9_ADMIN_SUBS = 'admin-123';
    
    mockCheckDbReachability.mockResolvedValue({
      reachable: true,
      host: 'localhost',
      port: 5432,
      database: 'afu9',
    });
    
    mockCheckLedgerExists.mockResolvedValue(true);
    
    mockListRepoMigrations.mockReturnValue([
      { filename: '001_initial.sql', sha256: 'abc123' },
      { filename: '002_users.sql', sha256: 'def456' },
      { filename: '003_posts.sql', sha256: 'ghi789' },
    ]);
    
    mockGetLatestMigration.mockReturnValue('003_posts.sql');
    
    mockListAppliedMigrations.mockResolvedValue([
      { filename: '001_initial.sql', sha256: 'abc123', applied_at: new Date('2026-01-01') },
      { filename: '002_users.sql', sha256: 'def456', applied_at: new Date('2026-01-02') },
    ]);
    
    mockGetLastAppliedMigration.mockResolvedValue({
      filename: '002_users.sql',
      sha256: 'def456',
      applied_at: new Date('2026-01-02'),
    });
    
    mockGetAppliedMigrationCount.mockResolvedValue(2);
    
    mockComputeParity.mockReturnValue({
      status: 'FAIL',
      missingInDb: ['003_posts.sql'],
      extraInDb: [],
      hashMismatches: [],
    });

    const request = new NextRequest('http://localhost/api/ops/db/migrations', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-fail-missing',
        'x-afu9-sub': 'admin-123',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.parity.status).toBe('FAIL');
    expect(body.parity.missingInDb).toEqual(['003_posts.sql']);
  });

  test('Bounded output: limit parameter respected', async () => {
    process.env.AFU9_ADMIN_SUBS = 'admin-123';
    
    mockCheckDbReachability.mockResolvedValue({
      reachable: true,
      host: 'localhost',
      port: 5432,
      database: 'afu9',
    });
    
    mockCheckLedgerExists.mockResolvedValue(true);
    mockListRepoMigrations.mockReturnValue([]);
    mockGetLatestMigration.mockReturnValue(null);
    mockListAppliedMigrations.mockResolvedValue([]);
    mockGetLastAppliedMigration.mockResolvedValue(null);
    mockGetAppliedMigrationCount.mockResolvedValue(0);
    mockComputeParity.mockReturnValue({
      status: 'PASS',
      missingInDb: [],
      extraInDb: [],
      hashMismatches: [],
    });

    const request = new NextRequest('http://localhost/api/ops/db/migrations?limit=50', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-bounded',
        'x-afu9-sub': 'admin-123',
      },
    });

    await GET(request);

    // Verify limit was passed to DB query
    expect(mockListAppliedMigrations).toHaveBeenCalledWith(expect.anything(), 50);
  });

  test('Bounded output: limit capped at 500', async () => {
    process.env.AFU9_ADMIN_SUBS = 'admin-123';
    
    mockCheckDbReachability.mockResolvedValue({
      reachable: true,
      host: 'localhost',
      port: 5432,
      database: 'afu9',
    });
    
    mockCheckLedgerExists.mockResolvedValue(true);
    mockListRepoMigrations.mockReturnValue([]);
    mockGetLatestMigration.mockReturnValue(null);
    mockListAppliedMigrations.mockResolvedValue([]);
    mockGetLastAppliedMigration.mockResolvedValue(null);
    mockGetAppliedMigrationCount.mockResolvedValue(0);
    mockComputeParity.mockReturnValue({
      status: 'PASS',
      missingInDb: [],
      extraInDb: [],
      hashMismatches: [],
    });

    const request = new NextRequest('http://localhost/api/ops/db/migrations?limit=9999', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-max-limit',
        'x-afu9-sub': 'admin-123',
      },
    });

    await GET(request);

    // Verify limit was capped at 500
    expect(mockListAppliedMigrations).toHaveBeenCalledWith(expect.anything(), 500);
  });

  test('Admin allowlist: exact match required', async () => {
    process.env.AFU9_ADMIN_SUBS = 'admin-1,admin-2,admin-3';
    
    mockCheckDbReachability.mockResolvedValue({
      reachable: true,
      host: 'localhost',
      port: 5432,
      database: 'afu9',
    });
    
    mockCheckLedgerExists.mockResolvedValue(true);
    mockListRepoMigrations.mockReturnValue([]);
    mockGetLatestMigration.mockReturnValue(null);
    mockListAppliedMigrations.mockResolvedValue([]);
    mockGetLastAppliedMigration.mockResolvedValue(null);
    mockGetAppliedMigrationCount.mockResolvedValue(0);
    mockComputeParity.mockReturnValue({
      status: 'PASS',
      missingInDb: [],
      extraInDb: [],
      hashMismatches: [],
    });

    const request = new NextRequest('http://localhost/api/ops/db/migrations', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-admin-match',
        'x-afu9-sub': 'admin-2', // Exact match
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockCheckDbReachability).toHaveBeenCalled();
  });
});
