/**
 * Capability Manifest API Tests (E86.2)
 * 
 * Tests for GET /api/intent/capabilities endpoint
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/intent/capabilities/route';
import * as capabilityManifest from '../../src/lib/capability-manifest-service';

// Mock capability manifest service
jest.mock('../../src/lib/capability-manifest-service');

const mockCapabilityManifest = capabilityManifest as jest.Mocked<typeof capabilityManifest>;

const MOCK_MANIFEST = {
  version: '2026-01-14',
  hash: 'sha256:abc123def456',
  capabilities: [
    {
      id: 'get_context_pack',
      kind: 'tool' as const,
      source: 'intent_registry' as const,
      description: 'Get context pack',
    },
    {
      id: 'github.get_repo',
      kind: 'mcp_tool' as const,
      source: 'mcp' as const,
      description: 'Get repository',
      metadata: {
        server: 'github',
      },
    },
  ],
  sources: {
    intentTools: 10,
    mcpTools: 25,
    featureFlags: 30,
    lawbookConstraints: 3,
  },
};

describe('GET /api/intent/capabilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCapabilityManifest.buildCapabilityManifest.mockResolvedValue(MOCK_MANIFEST);
  });

  test('returns 401 when x-afu9-sub header is missing', async () => {
    const request = new NextRequest('http://localhost/api/intent/capabilities', {
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

  test('returns capability manifest when authenticated', async () => {
    const request = new NextRequest('http://localhost/api/intent/capabilities', {
      headers: {
        'x-request-id': 'test-req-2',
        'x-afu9-sub': 'user-123',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe('2026-01-14');
    expect(body.hash).toBe('sha256:abc123def456');
    expect(body.capabilities).toHaveLength(2);
    expect(body.sources).toEqual({
      intentTools: 10,
      mcpTools: 25,
      featureFlags: 30,
      lawbookConstraints: 3,
    });
  });

  test('sets ETag header', async () => {
    const request = new NextRequest('http://localhost/api/intent/capabilities', {
      headers: {
        'x-request-id': 'test-req-3',
        'x-afu9-sub': 'user-456',
      },
    });

    const response = await GET(request);

    expect(response.headers.get('ETag')).toBe('sha256:abc123def456');
  });

  test('sets Cache-Control header', async () => {
    const request = new NextRequest('http://localhost/api/intent/capabilities', {
      headers: {
        'x-request-id': 'test-req-4',
        'x-afu9-sub': 'user-789',
      },
    });

    const response = await GET(request);

    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
  });

  test('returns 304 Not Modified when ETag matches', async () => {
    const request = new NextRequest('http://localhost/api/intent/capabilities', {
      headers: {
        'x-request-id': 'test-req-5',
        'x-afu9-sub': 'user-abc',
        'if-none-match': 'sha256:abc123def456',
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(304);
    expect(response.headers.get('ETag')).toBe('sha256:abc123def456');
    expect(response.body).toBeNull();
  });

  test('returns 200 when ETag does not match', async () => {
    const request = new NextRequest('http://localhost/api/intent/capabilities', {
      headers: {
        'x-request-id': 'test-req-6',
        'x-afu9-sub': 'user-def',
        'if-none-match': 'sha256:oldHash',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hash).toBe('sha256:abc123def456');
  });

  test('calls buildCapabilityManifest with user context', async () => {
    const request = new NextRequest('http://localhost/api/intent/capabilities', {
      headers: {
        'x-request-id': 'test-req-7',
        'x-afu9-sub': 'user-ghi',
      },
    });

    await GET(request);

    expect(mockCapabilityManifest.buildCapabilityManifest).toHaveBeenCalledWith({
      userId: 'user-ghi',
      sessionId: 'manifest-request',
    });
  });

  test('returns 500 when buildCapabilityManifest throws error', async () => {
    mockCapabilityManifest.buildCapabilityManifest.mockRejectedValue(
      new Error('Database connection failed')
    );

    const request = new NextRequest('http://localhost/api/intent/capabilities', {
      headers: {
        'x-request-id': 'test-req-8',
        'x-afu9-sub': 'user-jkl',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to build capability manifest');
    expect(body.details).toContain('Database connection failed');
  });

  test('includes all capability fields in response', async () => {
    const detailedManifest = {
      version: '2026-01-14',
      hash: 'sha256:detailed123',
      capabilities: [
        {
          id: 'publish_to_github',
          kind: 'tool' as const,
          source: 'intent_registry' as const,
          description: 'Publish to GitHub',
          constraints: ['prod_blocked' as const, 'auth_required' as const],
          metadata: {
            hasParameters: true,
          },
        },
      ],
      sources: {
        intentTools: 1,
        mcpTools: 0,
        featureFlags: 0,
        lawbookConstraints: 0,
      },
    };

    mockCapabilityManifest.buildCapabilityManifest.mockResolvedValue(detailedManifest);

    const request = new NextRequest('http://localhost/api/intent/capabilities', {
      headers: {
        'x-request-id': 'test-req-9',
        'x-afu9-sub': 'user-mno',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.capabilities[0]).toEqual({
      id: 'publish_to_github',
      kind: 'tool',
      source: 'intent_registry',
      description: 'Publish to GitHub',
      constraints: ['prod_blocked', 'auth_required'],
      metadata: {
        hasParameters: true,
      },
    });
  });

  test('response is deterministic (same manifest = same response)', async () => {
    const request1 = new NextRequest('http://localhost/api/intent/capabilities', {
      headers: {
        'x-request-id': 'test-req-10',
        'x-afu9-sub': 'user-pqr',
      },
    });

    const request2 = new NextRequest('http://localhost/api/intent/capabilities', {
      headers: {
        'x-request-id': 'test-req-11',
        'x-afu9-sub': 'user-pqr',
      },
    });

    const response1 = await GET(request1);
    const body1 = await response1.json();

    const response2 = await GET(request2);
    const body2 = await response2.json();

    // Responses should be identical
    expect(body1).toEqual(body2);
    expect(response1.headers.get('ETag')).toBe(response2.headers.get('ETag'));
  });
});
