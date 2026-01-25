/**
 * Smoke Key Allowlist Database Operations Tests (I906)
 * 
 * Tests for runtime-configurable smoke-key allowlist:
 * - Add/remove route patterns
 * - Pattern matching (exact and regex)
 * - Hard limits enforcement
 * - Audit trail
 * - Fail-closed security
 * 
 * @jest-environment node
 */

import {
  getActiveAllowlist,
  getAllowlistHistory,
  getAllowlistStats,
  addRouteToAllowlist,
  removeRouteFromAllowlist,
  isRouteAllowed,
  type SmokeKeyAllowlistEntry,
} from '../../src/lib/db/smokeKeyAllowlist';

// Mock the database pool
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(),
}));

import { getPool } from '../../src/lib/db';

const mockQuery = jest.fn();
const mockPool = { query: mockQuery } as any;

(getPool as jest.Mock).mockReturnValue(mockPool);

describe('Smoke Key Allowlist Database Operations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getActiveAllowlist', () => {
    test('returns active routes only', async () => {
      const mockRows: SmokeKeyAllowlistEntry[] = [
        {
          id: 1,
          route_pattern: '/api/test',
          method: 'GET',
          is_regex: false,
          description: 'Test route',
          added_by: 'admin',
          added_at: '2025-01-01T00:00:00Z',
          removed_by: null,
          removed_at: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      mockQuery.mockResolvedValueOnce({ rows: mockRows });

      const result = await getActiveAllowlist(mockPool);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockRows);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE removed_at IS NULL'));
    });

    test('returns error on database failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));

      const result = await getActiveAllowlist(mockPool);

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB connection failed');
    });
  });

  describe('addRouteToAllowlist', () => {
    test('successfully adds a route', async () => {
      const mockEntry: SmokeKeyAllowlistEntry = {
        id: 1,
        route_pattern: '/api/new-route',
        method: 'POST',
        is_regex: false,
        description: 'New test route',
        added_by: 'admin',
        added_at: '2025-01-01T00:00:00Z',
        removed_by: null,
        removed_at: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      // Mock count check
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '10' }] });
      // Mock duplicate check
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // Mock insert
      mockQuery.mockResolvedValueOnce({ rows: [mockEntry] });

      const result = await addRouteToAllowlist({
        routePattern: '/api/new-route',
        method: 'POST',
        isRegex: false,
        description: 'New test route',
        addedBy: 'admin',
      }, mockPool);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockEntry);
    });

    test('rejects empty route pattern', async () => {
      const result = await addRouteToAllowlist({
        routePattern: '  ',
        addedBy: 'admin',
      }, mockPool);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_INPUT');
      expect(result.error).toContain('cannot be empty');
    });

    test('rejects invalid HTTP method', async () => {
      const result = await addRouteToAllowlist({
        routePattern: '/api/test',
        method: 'INVALID',
        addedBy: 'admin',
      }, mockPool);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_INPUT');
      expect(result.error).toContain('Invalid method');
    });

    test('rejects invalid regex pattern', async () => {
      const result = await addRouteToAllowlist({
        routePattern: '[invalid(regex',
        isRegex: true,
        addedBy: 'admin',
      }, mockPool);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_INPUT');
      expect(result.error).toContain('Invalid regex pattern');
    });

    test('enforces max routes limit', async () => {
      // Mock count at limit
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '100' }] });

      const result = await addRouteToAllowlist({
        routePattern: '/api/test',
        addedBy: 'admin',
      }, mockPool);

      expect(result.success).toBe(false);
      expect(result.code).toBe('LIMIT_EXCEEDED');
      expect(result.error).toContain('Maximum active routes limit');
    });

    test('prevents duplicate entries', async () => {
      // Mock count check
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '10' }] });
      // Mock duplicate found
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const result = await addRouteToAllowlist({
        routePattern: '/api/test',
        method: 'GET',
        addedBy: 'admin',
      }, mockPool);

      expect(result.success).toBe(false);
      expect(result.code).toBe('DUPLICATE');
      expect(result.error).toContain('already exists');
    });

    test('accepts valid regex patterns', async () => {
      const mockEntry: SmokeKeyAllowlistEntry = {
        id: 1,
        route_pattern: '^/api/issues/\\d+/state$',
        method: 'GET',
        is_regex: true,
        description: 'Issue state endpoint',
        added_by: 'admin',
        added_at: '2025-01-01T00:00:00Z',
        removed_by: null,
        removed_at: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      mockQuery.mockResolvedValueOnce({ rows: [{ count: '10' }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [mockEntry] });

      const result = await addRouteToAllowlist({
        routePattern: '^/api/issues/\\d+/state$',
        method: 'GET',
        isRegex: true,
        description: 'Issue state endpoint',
        addedBy: 'admin',
      }, mockPool);

      expect(result.success).toBe(true);
      expect(result.data?.is_regex).toBe(true);
    });
  });

  describe('removeRouteFromAllowlist', () => {
    test('successfully removes a route', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const result = await removeRouteFromAllowlist({
        routePattern: '/api/test',
        method: 'GET',
        removedBy: 'admin',
      }, mockPool);

      expect(result.success).toBe(true);
      expect(result.removed).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE smoke_key_allowlist'),
        expect.arrayContaining(['admin', '/api/test', 'GET'])
      );
    });

    test('returns false when route not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await removeRouteFromAllowlist({
        routePattern: '/api/nonexistent',
        removedBy: 'admin',
      }, mockPool);

      expect(result.success).toBe(true);
      expect(result.removed).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('rejects empty route pattern', async () => {
      const result = await removeRouteFromAllowlist({
        routePattern: '  ',
        removedBy: 'admin',
      }, mockPool);

      expect(result.success).toBe(false);
      expect(result.removed).toBe(false);
      expect(result.error).toContain('cannot be empty');
    });
  });

  describe('isRouteAllowed', () => {
    const mockAllowlist: SmokeKeyAllowlistEntry[] = [
      {
        id: 1,
        route_pattern: '/api/exact',
        method: 'GET',
        is_regex: false,
        description: null,
        added_by: 'admin',
        added_at: '2025-01-01T00:00:00Z',
        removed_by: null,
        removed_at: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
      {
        id: 2,
        route_pattern: '^/api/issues/\\d+$',
        method: 'POST',
        is_regex: true,
        description: null,
        added_by: 'admin',
        added_at: '2025-01-01T00:00:00Z',
        removed_by: null,
        removed_at: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
      {
        id: 3,
        route_pattern: '/api/wildcard',
        method: '*',
        is_regex: false,
        description: null,
        added_by: 'admin',
        added_at: '2025-01-01T00:00:00Z',
        removed_by: null,
        removed_at: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
    ];

    test('matches exact route', () => {
      expect(isRouteAllowed('/api/exact', 'GET', mockAllowlist)).toBe(true);
    });

    test('does not match when method differs', () => {
      expect(isRouteAllowed('/api/exact', 'POST', mockAllowlist)).toBe(false);
    });

    test('matches regex pattern', () => {
      expect(isRouteAllowed('/api/issues/123', 'POST', mockAllowlist)).toBe(true);
      expect(isRouteAllowed('/api/issues/456', 'POST', mockAllowlist)).toBe(true);
    });

    test('does not match invalid regex pattern format', () => {
      expect(isRouteAllowed('/api/issues/abc', 'POST', mockAllowlist)).toBe(false);
      expect(isRouteAllowed('/api/issues/', 'POST', mockAllowlist)).toBe(false);
    });

    test('matches wildcard method', () => {
      expect(isRouteAllowed('/api/wildcard', 'GET', mockAllowlist)).toBe(true);
      expect(isRouteAllowed('/api/wildcard', 'POST', mockAllowlist)).toBe(true);
      expect(isRouteAllowed('/api/wildcard', 'DELETE', mockAllowlist)).toBe(true);
    });

    test('returns false for non-matching routes', () => {
      expect(isRouteAllowed('/api/unknown', 'GET', mockAllowlist)).toBe(false);
    });

    test('handles empty allowlist', () => {
      expect(isRouteAllowed('/api/test', 'GET', [])).toBe(false);
    });

    test('is case-sensitive for routes', () => {
      expect(isRouteAllowed('/API/EXACT', 'GET', mockAllowlist)).toBe(false);
    });

    test('is case-insensitive for methods', () => {
      expect(isRouteAllowed('/api/exact', 'get', mockAllowlist)).toBe(true);
      expect(isRouteAllowed('/api/exact', 'Get', mockAllowlist)).toBe(true);
    });

    test('matches AFU9 S1S3 issue spec route', () => {
      const s1s3Allowlist: SmokeKeyAllowlistEntry[] = [
        {
          id: 10,
          route_pattern: '^/api/afu9/s1s3/issues/[^/]+/spec$',
          method: 'POST',
          is_regex: true,
          description: 'AFU9 S1S3 issue spec (E9.1 smoke)',
          added_by: 'system:migration:087',
          added_at: '2026-01-25T00:00:00Z',
          removed_by: null,
          removed_at: null,
          created_at: '2026-01-25T00:00:00Z',
          updated_at: '2026-01-25T00:00:00Z',
        },
      ];

      expect(isRouteAllowed('/api/afu9/s1s3/issues/abc123/spec', 'POST', s1s3Allowlist)).toBe(true);
      expect(isRouteAllowed('/api/afu9/s1s3/issues/abc123/spec', 'GET', s1s3Allowlist)).toBe(false);
      expect(isRouteAllowed('/api/afu9/s1s3/issues/abc123/implement', 'POST', s1s3Allowlist)).toBe(false);
    });

    test('handles invalid regex in allowlist gracefully (fail-closed)', () => {
      const badAllowlist: SmokeKeyAllowlistEntry[] = [
        {
          id: 1,
          route_pattern: '[invalid(regex',
          method: 'GET',
          is_regex: true,
          description: null,
          added_by: 'admin',
          added_at: '2025-01-01T00:00:00Z',
          removed_by: null,
          removed_at: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      // Should not crash, should fail-closed (deny)
      expect(isRouteAllowed('/api/test', 'GET', badAllowlist)).toBe(false);
    });
  });

  describe('getAllowlistStats', () => {
    test('returns correct statistics', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ active: '25', total: '50' }],
      });

      const stats = await getAllowlistStats(mockPool);

      expect(stats.activeCount).toBe(25);
      expect(stats.totalCount).toBe(50);
      expect(stats.limitRemaining).toBe(75); // 100 - 25
      expect(stats.maxLimit).toBe(100);
    });

    test('handles database error gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const stats = await getAllowlistStats(mockPool);

      expect(stats.activeCount).toBe(0);
      expect(stats.totalCount).toBe(0);
      expect(stats.limitRemaining).toBe(0);
    });
  });

  describe('getAllowlistHistory', () => {
    test('returns all entries including removed', async () => {
      const mockRows: SmokeKeyAllowlistEntry[] = [
        {
          id: 1,
          route_pattern: '/api/active',
          method: 'GET',
          is_regex: false,
          description: null,
          added_by: 'admin',
          added_at: '2025-01-01T00:00:00Z',
          removed_by: null,
          removed_at: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
        {
          id: 2,
          route_pattern: '/api/removed',
          method: 'GET',
          is_regex: false,
          description: null,
          added_by: 'admin',
          added_at: '2025-01-01T00:00:00Z',
          removed_by: 'admin',
          removed_at: '2025-01-02T00:00:00Z',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      mockQuery.mockResolvedValueOnce({ rows: mockRows });

      const result = await getAllowlistHistory(100, mockPool);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.not.stringContaining('WHERE'),
        [100]
      );
    });
  });
});
