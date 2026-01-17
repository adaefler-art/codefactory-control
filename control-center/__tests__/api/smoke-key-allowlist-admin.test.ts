/**
 * Smoke Key Allowlist Admin API Tests (I906)
 * 
 * Tests for /api/admin/smoke-key/allowlist endpoint:
 * - GET: List current allowlist
 * - POST: Add/remove routes
 * - Admin authentication
 * - Input validation
 * - Error handling
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET, POST } from '../../app/api/admin/smoke-key/allowlist/route';

// Mock dependencies
jest.mock('@/lib/db/smokeKeyAllowlist', () => ({
  getActiveAllowlist: jest.fn(),
  getAllowlistHistory: jest.fn(),
  getAllowlistStats: jest.fn(),
  addRouteToAllowlist: jest.fn(),
  removeRouteFromAllowlist: jest.fn(),
}));

import {
  getActiveAllowlist,
  getAllowlistHistory,
  getAllowlistStats,
  addRouteToAllowlist,
  removeRouteFromAllowlist,
} from '@/lib/db/smokeKeyAllowlist';

const mockGetActiveAllowlist = getActiveAllowlist as jest.MockedFunction<typeof getActiveAllowlist>;
const mockGetAllowlistHistory = getAllowlistHistory as jest.MockedFunction<typeof getAllowlistHistory>;
const mockGetAllowlistStats = getAllowlistStats as jest.MockedFunction<typeof getAllowlistStats>;
const mockAddRouteToAllowlist = addRouteToAllowlist as jest.MockedFunction<typeof addRouteToAllowlist>;
const mockRemoveRouteFromAllowlist = removeRouteFromAllowlist as jest.MockedFunction<typeof removeRouteFromAllowlist>;

const MOCK_ALLOWLIST = [
  {
    id: 1,
    route_pattern: '/api/test',
    method: 'GET',
    is_regex: false,
    description: 'Test route',
    added_by: 'admin-user',
    added_at: '2025-01-01T00:00:00Z',
    removed_by: null,
    removed_at: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
];

const MOCK_STATS = {
  activeCount: 20,
  totalCount: 25,
  limitRemaining: 80,
  maxLimit: 100,
};

describe('GET /api/admin/smoke-key/allowlist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AFU9_ADMIN_SUBS = 'admin-user';
  });

  afterEach(() => {
    delete process.env.AFU9_ADMIN_SUBS;
  });

  test('returns 401 when not authenticated', async () => {
    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'GET',
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  test('returns 401 when user is not admin', async () => {
    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'GET',
      headers: {
        'x-afu9-sub': 'regular-user',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  test('returns active allowlist for admin user', async () => {
    mockGetActiveAllowlist.mockResolvedValueOnce({
      success: true,
      data: MOCK_ALLOWLIST,
    });
    mockGetAllowlistStats.mockResolvedValueOnce(MOCK_STATS);

    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'GET',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.allowlist).toEqual(MOCK_ALLOWLIST);
    expect(data.stats).toEqual(MOCK_STATS);
    expect(data.includeHistory).toBe(false);
    expect(mockGetActiveAllowlist).toHaveBeenCalled();
    expect(mockGetAllowlistStats).toHaveBeenCalled();
  });

  test('returns history when requested', async () => {
    mockGetAllowlistHistory.mockResolvedValueOnce({
      success: true,
      data: MOCK_ALLOWLIST,
    });
    mockGetAllowlistStats.mockResolvedValueOnce(MOCK_STATS);

    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist?history=true', {
      method: 'GET',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.includeHistory).toBe(true);
    expect(mockGetAllowlistHistory).toHaveBeenCalled();
    expect(mockGetActiveAllowlist).not.toHaveBeenCalled();
  });

  test('handles database error gracefully', async () => {
    mockGetActiveAllowlist.mockResolvedValueOnce({
      success: false,
      error: 'Database connection failed',
    });

    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'GET',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toContain('Failed to fetch allowlist');
  });
});

describe('POST /api/admin/smoke-key/allowlist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AFU9_ADMIN_SUBS = 'admin-user';
  });

  afterEach(() => {
    delete process.env.AFU9_ADMIN_SUBS;
  });

  test('returns 401 when not authenticated', async () => {
    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'POST',
      body: JSON.stringify({ op: 'add', route: '/api/test' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  test('returns 401 when user is not admin', async () => {
    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'regular-user',
      },
      body: JSON.stringify({ op: 'add', route: '/api/test' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  test('returns 400 for invalid operation', async () => {
    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
      body: JSON.stringify({ op: 'invalid', route: '/api/test' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid operation');
  });

  test('returns 400 for missing route', async () => {
    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
      body: JSON.stringify({ op: 'add' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid route');
  });

  test('successfully adds a route', async () => {
    const mockEntry = MOCK_ALLOWLIST[0];
    mockAddRouteToAllowlist.mockResolvedValueOnce({
      success: true,
      data: mockEntry,
    });

    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
      body: JSON.stringify({
        op: 'add',
        route: '/api/test',
        method: 'GET',
        description: 'Test route',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.ok).toBe(true);
    expect(data.operation).toBe('add');
    expect(data.data).toEqual(mockEntry);
    expect(mockAddRouteToAllowlist).toHaveBeenCalledWith({
      routePattern: '/api/test',
      method: 'GET',
      isRegex: false,
      description: 'Test route',
      addedBy: 'admin-user',
    });
  });

  test('successfully adds a regex route', async () => {
    const mockEntry = {
      ...MOCK_ALLOWLIST[0],
      route_pattern: '^/api/issues/\\d+$',
      is_regex: true,
    };
    mockAddRouteToAllowlist.mockResolvedValueOnce({
      success: true,
      data: mockEntry,
    });

    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
      body: JSON.stringify({
        op: 'add',
        route: '^/api/issues/\\d+$',
        method: 'POST',
        isRegex: true,
        description: 'Issue route pattern',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.ok).toBe(true);
    expect(mockAddRouteToAllowlist).toHaveBeenCalledWith({
      routePattern: '^/api/issues/\\d+$',
      method: 'POST',
      isRegex: true,
      description: 'Issue route pattern',
      addedBy: 'admin-user',
    });
  });

  test('returns 429 when limit exceeded', async () => {
    mockAddRouteToAllowlist.mockResolvedValueOnce({
      success: false,
      error: 'Maximum active routes limit reached (100)',
      code: 'LIMIT_EXCEEDED',
    });

    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
      body: JSON.stringify({ op: 'add', route: '/api/test' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error).toContain('Maximum active routes limit');
  });

  test('returns 409 for duplicate route', async () => {
    mockAddRouteToAllowlist.mockResolvedValueOnce({
      success: false,
      error: 'Route already exists',
      code: 'DUPLICATE',
    });

    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
      body: JSON.stringify({ op: 'add', route: '/api/test' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(409);
  });

  test('returns 400 for invalid input', async () => {
    mockAddRouteToAllowlist.mockResolvedValueOnce({
      success: false,
      error: 'Invalid regex pattern',
      code: 'INVALID_INPUT',
    });

    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
      body: JSON.stringify({ op: 'add', route: '[invalid', isRegex: true }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
  });

  test('successfully removes a route', async () => {
    mockRemoveRouteFromAllowlist.mockResolvedValueOnce({
      success: true,
      removed: true,
    });

    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
      body: JSON.stringify({
        op: 'remove',
        route: '/api/test',
        method: 'GET',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.operation).toBe('remove');
    expect(data.removed).toBe(true);
    expect(mockRemoveRouteFromAllowlist).toHaveBeenCalledWith({
      routePattern: '/api/test',
      method: 'GET',
      removedBy: 'admin-user',
    });
  });

  test('returns 404 when removing non-existent route', async () => {
    mockRemoveRouteFromAllowlist.mockResolvedValueOnce({
      success: true,
      removed: false,
      error: 'Route not found',
    });

    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
      body: JSON.stringify({ op: 'remove', route: '/api/nonexistent' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Route not found');
  });

  test('uses wildcard method by default', async () => {
    const mockEntry = { ...MOCK_ALLOWLIST[0], method: '*' };
    mockAddRouteToAllowlist.mockResolvedValueOnce({
      success: true,
      data: mockEntry,
    });

    const request = new NextRequest('http://localhost:3000/api/admin/smoke-key/allowlist', {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
      body: JSON.stringify({
        op: 'add',
        route: '/api/test',
      }),
    });

    await POST(request);

    expect(mockAddRouteToAllowlist).toHaveBeenCalledWith(
      expect.objectContaining({ method: '*' })
    );
  });
});
