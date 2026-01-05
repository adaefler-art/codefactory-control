/**
 * API Tests: GET /api/whoami
 * 
 * Tests authentication (401) and admin status detection.
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/whoami/route';

describe('GET /api/whoami - Authentication and Authorization Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AFU9_ADMIN_SUBS;
  });

  test('401: Unauthorized without x-afu9-sub header', async () => {
    const request = new NextRequest('http://localhost/api/whoami', {
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
  });

  test('401: Unauthorized with empty x-afu9-sub header', async () => {
    const request = new NextRequest('http://localhost/api/whoami', {
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

  test('200: isAdmin false when AFU9_ADMIN_SUBS is missing (fail-closed)', async () => {
    // No AFU9_ADMIN_SUBS set
    const request = new NextRequest('http://localhost/api/whoami', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-no-allowlist',
        'x-afu9-sub': 'user-123',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sub).toBe('user-123');
    expect(body.isAdmin).toBe(false);
  });

  test('200: isAdmin false when AFU9_ADMIN_SUBS is empty (fail-closed)', async () => {
    process.env.AFU9_ADMIN_SUBS = '   ';

    const request = new NextRequest('http://localhost/api/whoami', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-empty-allowlist',
        'x-afu9-sub': 'user-123',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sub).toBe('user-123');
    expect(body.isAdmin).toBe(false);
  });

  test('200: isAdmin false when user not in admin allowlist', async () => {
    process.env.AFU9_ADMIN_SUBS = 'admin-1,admin-2,admin-3';

    const request = new NextRequest('http://localhost/api/whoami', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-not-admin',
        'x-afu9-sub': 'regular-user',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sub).toBe('regular-user');
    expect(body.isAdmin).toBe(false);
  });

  test('200: isAdmin true when user in admin allowlist', async () => {
    process.env.AFU9_ADMIN_SUBS = 'admin-1,admin-2,admin-3';

    const request = new NextRequest('http://localhost/api/whoami', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-is-admin',
        'x-afu9-sub': 'admin-2', // Exact match
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sub).toBe('admin-2');
    expect(body.isAdmin).toBe(true);
  });

  test('200: Admin allowlist handles whitespace correctly', async () => {
    process.env.AFU9_ADMIN_SUBS = '  admin-1  ,  admin-2  ,  admin-3  ';

    const request = new NextRequest('http://localhost/api/whoami', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-whitespace',
        'x-afu9-sub': 'admin-2',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sub).toBe('admin-2');
    expect(body.isAdmin).toBe(true);
  });

  test('200: Returns sub correctly for various user IDs', async () => {
    process.env.AFU9_ADMIN_SUBS = 'admin@example.com';

    const testCases = [
      { sub: 'user-123', isAdmin: false },
      { sub: 'admin@example.com', isAdmin: true },
      { sub: 'github|12345', isAdmin: false },
      { sub: 'auth0|67890', isAdmin: false },
    ];

    for (const testCase of testCases) {
      const request = new NextRequest('http://localhost/api/whoami', {
        method: 'GET',
        headers: {
          'x-request-id': `test-${testCase.sub}`,
          'x-afu9-sub': testCase.sub,
        },
      });

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.sub).toBe(testCase.sub);
      expect(body.isAdmin).toBe(testCase.isAdmin);
    }
  });

  test('Response includes x-request-id header', async () => {
    process.env.AFU9_ADMIN_SUBS = 'admin-1';

    const request = new NextRequest('http://localhost/api/whoami', {
      method: 'GET',
      headers: {
        'x-request-id': 'test-request-id-123',
        'x-afu9-sub': 'admin-1',
      },
    });

    const response = await GET(request);

    expect(response.headers.get('x-request-id')).toBe('test-request-id-123');
  });
});
