/**
 * INTENT Status API Tests
 * 
 * Tests for /api/intent/status endpoint
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/intent/status/route';

describe('GET /api/intent/status', () => {
  const originalEnv = process.env.AFU9_INTENT_ENABLED;

  afterEach(() => {
    // Restore original env value
    if (originalEnv !== undefined) {
      process.env.AFU9_INTENT_ENABLED = originalEnv;
    } else {
      delete process.env.AFU9_INTENT_ENABLED;
    }
  });

  test('returns 401 when x-afu9-sub header is missing', async () => {
    const request = new NextRequest('http://localhost/api/intent/status', {
      headers: {
        'x-request-id': 'test-req-1',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(body.details).toContain('Authentication required');
  });

  test('returns enabled=true when AFU9_INTENT_ENABLED=true', async () => {
    process.env.AFU9_INTENT_ENABLED = 'true';

    const request = new NextRequest('http://localhost/api/intent/status', {
      headers: {
        'x-request-id': 'test-req-2',
        'x-afu9-sub': 'user-123',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.mode).toBe('enabled');
  });

  test('returns enabled=false when AFU9_INTENT_ENABLED=false', async () => {
    process.env.AFU9_INTENT_ENABLED = 'false';

    const request = new NextRequest('http://localhost/api/intent/status', {
      headers: {
        'x-request-id': 'test-req-3',
        'x-afu9-sub': 'user-456',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.mode).toBe('disabled');
  });

  test('returns enabled=false when AFU9_INTENT_ENABLED is not set', async () => {
    delete process.env.AFU9_INTENT_ENABLED;

    const request = new NextRequest('http://localhost/api/intent/status', {
      headers: {
        'x-request-id': 'test-req-4',
        'x-afu9-sub': 'user-789',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.mode).toBe('disabled');
  });

  test('does not leak secrets in response', async () => {
    process.env.AFU9_INTENT_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'unit-test-not-a-real-key';

    const request = new NextRequest('http://localhost/api/intent/status', {
      headers: {
        'x-request-id': 'test-req-5',
        'x-afu9-sub': 'user-999',
      },
    });

    const response = await GET(request);
    const body = await response.json();
    const responseText = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(responseText).not.toContain('unit-test-not-a-real-key');
    expect(responseText).not.toContain('secret');
    expect(responseText).not.toContain('OPENAI_API_KEY');
    expect(Object.keys(body)).toEqual(['enabled', 'mode']);
  });
});
