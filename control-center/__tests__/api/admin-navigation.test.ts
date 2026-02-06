/**
 * V09-I01: Navigation Management API Tests
 * 
 * Tests for /api/admin/navigation/[role] endpoints
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET, PUT } from '../../app/api/admin/navigation/[role]/route';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/navigationItems', () => ({
  getNavigationItemsByRole: jest.fn(),
  updateNavigationItems: jest.fn(),
}));

const ADMIN_USER_ID = 'admin-123';
const REGULAR_USER_ID = 'user-456';

// Set admin user for tests
process.env.AFU9_ADMIN_SUBS = ADMIN_USER_ID;

describe('GET /api/admin/navigation/[role]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 200 and navigation items for admin role', async () => {
    const { getNavigationItemsByRole } = require('../../src/lib/db/navigationItems');

    const mockItems = [
      {
        id: 'item-1',
        role: 'admin',
        href: '/intent',
        label: 'INTENT',
        position: 0,
        enabled: true,
        icon: null,
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'item-2',
        role: 'admin',
        href: '/admin/lawbook',
        label: 'Admin',
        position: 1,
        enabled: true,
        icon: null,
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
      },
    ];

    getNavigationItemsByRole.mockResolvedValue(mockItems);

    const request = new NextRequest('http://localhost/api/admin/navigation/admin', {
      headers: {
        'x-request-id': 'test-req-get-nav-1',
        'x-afu9-sub': ADMIN_USER_ID,
      },
    });

    const response = await GET(request, { params: { role: 'admin' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('test-req-get-nav-1');
    expect(body.ok).toBe(true);
    expect(body.role).toBe('admin');
    expect(body.items).toHaveLength(2);
    expect(body.items[0].href).toBe('/intent');
    expect(body.items[1].href).toBe('/admin/lawbook');
    expect(getNavigationItemsByRole).toHaveBeenCalledWith(
      expect.anything(),
      'admin'
    );
  });

  test('returns 401 when not authenticated', async () => {
    const request = new NextRequest('http://localhost/api/admin/navigation/admin', {
      headers: {
        'x-request-id': 'test-req-unauth',
      },
    });

    const response = await GET(request, { params: { role: 'admin' } });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBeTruthy();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  test('returns 403 when not admin', async () => {
    const request = new NextRequest('http://localhost/api/admin/navigation/admin', {
      headers: {
        'x-request-id': 'test-req-forbidden',
        'x-afu9-sub': REGULAR_USER_ID,
      },
    });

    const response = await GET(request, { params: { role: 'admin' } });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBeTruthy();
    expect(body.code).toBe('FORBIDDEN');
  });

  test('returns 400 for invalid role', async () => {
    const request = new NextRequest('http://localhost/api/admin/navigation/invalid', {
      headers: {
        'x-request-id': 'test-req-invalid-role',
        'x-afu9-sub': ADMIN_USER_ID,
      },
    });

    const response = await GET(request, { params: { role: 'invalid' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeTruthy();
    expect(body.code).toBe('INVALID_ROLE');
  });

  test('returns 500 when database error occurs', async () => {
    const { getNavigationItemsByRole } = require('../../src/lib/db/navigationItems');

    getNavigationItemsByRole.mockRejectedValue(new Error('Database connection failed'));

    const request = new NextRequest('http://localhost/api/admin/navigation/admin', {
      headers: {
        'x-request-id': 'test-req-db-error',
        'x-afu9-sub': ADMIN_USER_ID,
      },
    });

    const response = await GET(request, { params: { role: 'admin' } });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBeTruthy();
  });
});

describe('PUT /api/admin/navigation/[role]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('updates navigation items successfully', async () => {
    const { updateNavigationItems } = require('../../src/lib/db/navigationItems');

    const inputItems = [
      { href: '/intent', label: 'INTENT', position: 0, enabled: true },
      { href: '/issues', label: 'Issues', position: 1, enabled: true },
    ];

    const mockUpdatedItems = inputItems.map((item, idx) => ({
      id: `item-${idx}`,
      role: 'admin',
      ...item,
      icon: null,
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z',
    }));

    updateNavigationItems.mockResolvedValue(mockUpdatedItems);

    const request = new NextRequest('http://localhost/api/admin/navigation/admin', {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-nav-1',
        'x-afu9-sub': ADMIN_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ items: inputItems }),
    });

    const response = await PUT(request, { params: { role: 'admin' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.role).toBe('admin');
    expect(body.items).toHaveLength(2);
    expect(body.items[0].href).toBe('/intent');
    expect(body.items[1].href).toBe('/issues');
    expect(updateNavigationItems).toHaveBeenCalledWith(
      expect.anything(),
      'admin',
      inputItems
    );
  });

  test('returns 401 when not authenticated', async () => {
    const request = new NextRequest('http://localhost/api/admin/navigation/admin', {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-unauth',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ items: [] }),
    });

    const response = await PUT(request, { params: { role: 'admin' } });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  test('returns 403 when not admin', async () => {
    const request = new NextRequest('http://localhost/api/admin/navigation/admin', {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-forbidden',
        'x-afu9-sub': REGULAR_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ items: [] }),
    });

    const response = await PUT(request, { params: { role: 'admin' } });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe('FORBIDDEN');
  });

  test('returns 400 for invalid role', async () => {
    const request = new NextRequest('http://localhost/api/admin/navigation/invalid', {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-invalid-role',
        'x-afu9-sub': ADMIN_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ items: [] }),
    });

    const response = await PUT(request, { params: { role: 'invalid' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('INVALID_ROLE');
  });

  test('returns 400 for missing items array', async () => {
    const request = new NextRequest('http://localhost/api/admin/navigation/admin', {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-no-items',
        'x-afu9-sub': ADMIN_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ notItems: [] }),
    });

    const response = await PUT(request, { params: { role: 'admin' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('INVALID_ITEMS');
  });

  test('returns 400 for invalid item structure (missing href)', async () => {
    const request = new NextRequest('http://localhost/api/admin/navigation/admin', {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-bad-item',
        'x-afu9-sub': ADMIN_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        items: [{ label: 'Test', position: 0 }], // missing href
      }),
    });

    const response = await PUT(request, { params: { role: 'admin' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('INVALID_HREF');
  });

  test('returns 400 for invalid item structure (missing label)', async () => {
    const request = new NextRequest('http://localhost/api/admin/navigation/admin', {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-bad-label',
        'x-afu9-sub': ADMIN_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        items: [{ href: '/test', position: 0 }], // missing label
      }),
    });

    const response = await PUT(request, { params: { role: 'admin' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('INVALID_LABEL');
  });

  test('returns 400 for invalid item structure (negative position)', async () => {
    const request = new NextRequest('http://localhost/api/admin/navigation/admin', {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-bad-position',
        'x-afu9-sub': ADMIN_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        items: [{ href: '/test', label: 'Test', position: -1 }], // negative position
      }),
    });

    const response = await PUT(request, { params: { role: 'admin' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('INVALID_POSITION');
  });

  test('returns 500 when database error occurs', async () => {
    const { updateNavigationItems } = require('../../src/lib/db/navigationItems');

    updateNavigationItems.mockRejectedValue(new Error('Database write failed'));

    const request = new NextRequest('http://localhost/api/admin/navigation/admin', {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-db-error',
        'x-afu9-sub': ADMIN_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        items: [{ href: '/test', label: 'Test', position: 0 }],
      }),
    });

    const response = await PUT(request, { params: { role: 'admin' } });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBeTruthy();
  });
});
