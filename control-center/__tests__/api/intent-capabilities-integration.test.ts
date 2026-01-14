/**
 * Integration test for capability manifest API
 * 
 * Verifies:
 * - Endpoint responds correctly
 * - Hash is deterministic
 * - Response structure is correct
 * - ETag caching works
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/intent/capabilities/route';

// We need to ensure real dependencies are used here (not mocked)
// So we run this without mocks to do full integration testing

describe('Capability Manifest Integration Test', () => {
  const TEST_USER_ID = 'integration-test-user';

  test('endpoint returns valid manifest structure', async () => {
    const request = new NextRequest('http://localhost:3000/api/intent/capabilities', {
      headers: {
        'x-request-id': 'integration-test-1',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);

    // Verify manifest structure
    expect(body.version).toBeDefined();
    expect(body.hash).toBeDefined();
    expect(body.capabilities).toBeDefined();
    expect(body.sources).toBeDefined();

    // Verify version format (YYYY-MM-DD)
    expect(body.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Verify hash format (sha256:...)
    expect(body.hash).toMatch(/^sha256:[0-9a-f]{64}$/);

    // Verify capabilities is an array
    expect(Array.isArray(body.capabilities)).toBe(true);

    // Verify sources structure
    expect(body.sources).toHaveProperty('intentTools');
    expect(body.sources).toHaveProperty('mcpTools');
    expect(body.sources).toHaveProperty('featureFlags');
    expect(body.sources).toHaveProperty('lawbookConstraints');

    // Verify we have some capabilities
    expect(body.capabilities.length).toBeGreaterThan(0);

    // Verify capabilities have required fields
    if (body.capabilities.length > 0) {
      const firstCap = body.capabilities[0];
      expect(firstCap).toHaveProperty('id');
      expect(firstCap).toHaveProperty('kind');
      expect(firstCap).toHaveProperty('source');
    }
  });

  test('manifest is deterministic across requests', async () => {
    const request1 = new NextRequest('http://localhost:3000/api/intent/capabilities', {
      headers: {
        'x-request-id': 'integration-test-2a',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const request2 = new NextRequest('http://localhost:3000/api/intent/capabilities', {
      headers: {
        'x-request-id': 'integration-test-2b',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response1 = await GET(request1);
    const body1 = await response1.json();

    const response2 = await GET(request2);
    const body2 = await response2.json();

    // Same manifest hash means deterministic
    expect(body1.hash).toBe(body2.hash);

    // Entire response should be identical
    expect(body1).toEqual(body2);
  });

  test('capabilities are sorted alphabetically by id', async () => {
    const request = new NextRequest('http://localhost:3000/api/intent/capabilities', {
      headers: {
        'x-request-id': 'integration-test-3',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await GET(request);
    const body = await response.json();

    const ids = body.capabilities.map((cap: any) => cap.id);
    const sortedIds = [...ids].sort((a, b) => a.localeCompare(b));

    expect(ids).toEqual(sortedIds);
  });

  test('ETag header is set correctly', async () => {
    const request = new NextRequest('http://localhost:3000/api/intent/capabilities', {
      headers: {
        'x-request-id': 'integration-test-4',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.headers.get('ETag')).toBe(body.hash);
  });

  test('Cache-Control header is set', async () => {
    const request = new NextRequest('http://localhost:3000/api/intent/capabilities', {
      headers: {
        'x-request-id': 'integration-test-5',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await GET(request);

    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
  });

  test('304 Not Modified when If-None-Match matches ETag', async () => {
    // First request to get the ETag
    const request1 = new NextRequest('http://localhost:3000/api/intent/capabilities', {
      headers: {
        'x-request-id': 'integration-test-6a',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response1 = await GET(request1);
    const body1 = await response1.json();
    const etag = body1.hash;

    // Second request with If-None-Match
    const request2 = new NextRequest('http://localhost:3000/api/intent/capabilities', {
      headers: {
        'x-request-id': 'integration-test-6b',
        'x-afu9-sub': TEST_USER_ID,
        'if-none-match': etag,
      },
    });

    const response2 = await GET(request2);

    expect(response2.status).toBe(304);
    expect(response2.headers.get('ETag')).toBe(etag);
  });

  test('includes capabilities from all expected sources', async () => {
    const request = new NextRequest('http://localhost:3000/api/intent/capabilities', {
      headers: {
        'x-request-id': 'integration-test-7',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await GET(request);
    const body = await response.json();

    // Should have INTENT tools
    const intentTools = body.capabilities.filter((c: any) => c.source === 'intent_registry');
    expect(intentTools.length).toBeGreaterThan(0);

    // Should have feature flags
    const flags = body.capabilities.filter((c: any) => c.source === 'flags');
    expect(flags.length).toBeGreaterThan(0);

    // Should match source counts
    expect(intentTools.length).toBe(body.sources.intentTools);
    expect(flags.length).toBe(body.sources.featureFlags);
  });
});
