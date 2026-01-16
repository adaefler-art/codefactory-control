/**
 * Tests for Capabilities Registry API (E89.8)
 * 
 * Purpose: Verify capabilities manifest endpoint and probe functionality
 */

import { NextRequest } from 'next/server';

// Mock dependencies
jest.mock('../../../src/lib/db', () => ({
  getDbPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../../src/lib/capability-manifest-service', () => ({
  buildCapabilityManifest: jest.fn(),
}));

jest.mock('../../../src/lib/capability-probe-service', () => ({
  getLatestProbeResults: jest.fn(),
  probeAllCapabilities: jest.fn(),
}));

import { GET as manifestGet } from '../../../app/api/ops/capabilities/manifest/route';
import { POST as probePost } from '../../../app/api/ops/capabilities/probe/route';
import { buildCapabilityManifest } from '../../../src/lib/capability-manifest-service';
import { getLatestProbeResults, probeAllCapabilities } from '../../../src/lib/capability-probe-service';
import { getDbPool } from '../../../src/lib/db';

const mockBuildCapabilityManifest = buildCapabilityManifest as jest.MockedFunction<typeof buildCapabilityManifest>;
const mockGetLatestProbeResults = getLatestProbeResults as jest.MockedFunction<typeof getLatestProbeResults>;
const mockProbeAllCapabilities = probeAllCapabilities as jest.MockedFunction<typeof probeAllCapabilities>;
const mockGetDbPool = getDbPool as jest.MockedFunction<typeof getDbPool>;

describe('Capabilities Manifest API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/ops/capabilities/manifest', () => {
    it('returns 401 when x-afu9-sub header is missing', async () => {
      const request = new NextRequest('http://localhost/api/ops/capabilities/manifest', {
        method: 'GET',
      });

      const response = await manifestGet(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
      expect(mockBuildCapabilityManifest).not.toHaveBeenCalled();
    });

    it('returns manifest with hash when authenticated', async () => {
      const mockManifest = {
        version: '2026-01-15',
        hash: 'sha256:abc123',
        capabilities: [
          {
            id: 'test-tool',
            kind: 'tool',
            source: 'intent_registry',
            enabled: true,
          },
        ],
        sources: {
          intentTools: 1,
          mcpTools: 0,
          featureFlags: 0,
          lawbookConstraints: 0,
        },
      };

      mockBuildCapabilityManifest.mockResolvedValue(mockManifest as any);
      mockGetLatestProbeResults.mockResolvedValue([]);
      mockGetDbPool.mockReturnValue({ query: jest.fn() } as any);

      const request = new NextRequest('http://localhost/api/ops/capabilities/manifest', {
        method: 'GET',
        headers: {
          'x-afu9-sub': 'user-123',
        },
      });

      const response = await manifestGet(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.version).toBe('2026-01-15');
      expect(data.hash).toMatch(/^sha256:/);
      expect(data.capabilities).toHaveLength(1);
      expect(mockBuildCapabilityManifest).toHaveBeenCalledWith({
        userId: 'user-123',
        sessionId: 'manifest-request',
      });
    });

    it('includes probe results when available', async () => {
      const mockManifest = {
        version: '2026-01-15',
        hash: 'sha256:abc123',
        capabilities: [
          {
            id: 'test-tool',
            kind: 'tool',
            source: 'intent_registry',
            enabled: true,
          },
        ],
        sources: {
          intentTools: 1,
          mcpTools: 0,
          featureFlags: 0,
          lawbookConstraints: 0,
        },
      };

      const mockProbeResults = [
        {
          capabilityName: 'test-tool',
          capabilityKind: 'tool',
          capabilitySource: 'intent_registry',
          lastProbeAt: new Date('2026-01-15T10:00:00Z'),
          lastProbeStatus: 'ok',
          lastProbeLatencyMs: 50,
          lastProbeError: null,
          lastProbeErrorCode: null,
          enabled: true,
          requiresApproval: false,
          version: null,
        },
      ];

      mockBuildCapabilityManifest.mockResolvedValue(mockManifest as any);
      mockGetLatestProbeResults.mockResolvedValue(mockProbeResults as any);
      mockGetDbPool.mockReturnValue({ query: jest.fn() } as any);

      const request = new NextRequest('http://localhost/api/ops/capabilities/manifest', {
        method: 'GET',
        headers: {
          'x-afu9-sub': 'user-123',
        },
      });

      const response = await manifestGet(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.capabilities[0].lastProbeStatus).toBe('ok');
      expect(data.capabilities[0].lastProbeLatencyMs).toBe(50);
    });

    it('returns 304 when ETag matches', async () => {
      const mockManifest = {
        version: '2026-01-15',
        hash: 'sha256:abc123',
        capabilities: [],
        sources: {
          intentTools: 0,
          mcpTools: 0,
          featureFlags: 0,
          lawbookConstraints: 0,
        },
      };

      mockBuildCapabilityManifest.mockResolvedValue(mockManifest as any);
      mockGetLatestProbeResults.mockResolvedValue([]);
      mockGetDbPool.mockReturnValue({ query: jest.fn() } as any);

      // First request to get the actual hash
      const firstRequest = new NextRequest('http://localhost/api/ops/capabilities/manifest', {
        method: 'GET',
        headers: {
          'x-afu9-sub': 'user-123',
        },
      });
      const firstResponse = await manifestGet(firstRequest);
      const firstData = await firstResponse.json();
      const actualHash = firstData.hash;

      // Second request with matching ETag
      const request = new NextRequest('http://localhost/api/ops/capabilities/manifest', {
        method: 'GET',
        headers: {
          'x-afu9-sub': 'user-123',
          'if-none-match': actualHash,
        },
      });

      const response = await manifestGet(request);

      expect(response.status).toBe(304);
    });
  });
});

describe('Capabilities Probe API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DEPLOYMENT_ENV;
    delete process.env.NODE_ENV;
  });

  describe('POST /api/ops/capabilities/probe', () => {
    it('returns 401 when x-afu9-sub header is missing', async () => {
      const request = new NextRequest('http://localhost/api/ops/capabilities/probe', {
        method: 'POST',
      });

      const response = await probePost(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
      expect(mockProbeAllCapabilities).not.toHaveBeenCalled();
    });

    it('returns 403 in production environment', async () => {
      process.env.DEPLOYMENT_ENV = 'production';

      const request = new NextRequest('http://localhost/api/ops/capabilities/probe', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'user-123',
        },
      });

      const response = await probePost(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.code).toBe('PROD_BLOCKED');
      expect(mockProbeAllCapabilities).not.toHaveBeenCalled();
    });

    it('triggers probe in staging environment', async () => {
      process.env.DEPLOYMENT_ENV = 'staging';

      const mockProbeSummary = {
        totalProbed: 10,
        successCount: 8,
        errorCount: 1,
        timeoutCount: 1,
        unreachableCount: 0,
        probedAt: '2026-01-15T10:00:00Z',
      };

      mockProbeAllCapabilities.mockResolvedValue(mockProbeSummary);
      mockGetDbPool.mockReturnValue({ query: jest.fn() } as any);

      const request = new NextRequest('http://localhost/api/ops/capabilities/probe', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'user-123',
        },
      });

      const response = await probePost(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.summary.totalProbed).toBe(10);
      expect(data.environment).toBe('staging');
      expect(mockProbeAllCapabilities).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: 'user-123',
        })
      );
    });

    it('allows probe in development environment', async () => {
      process.env.DEPLOYMENT_ENV = 'development';

      const mockProbeSummary = {
        totalProbed: 5,
        successCount: 5,
        errorCount: 0,
        timeoutCount: 0,
        unreachableCount: 0,
        probedAt: '2026-01-15T10:00:00Z',
      };

      mockProbeAllCapabilities.mockResolvedValue(mockProbeSummary);
      mockGetDbPool.mockReturnValue({ query: jest.fn() } as any);

      const request = new NextRequest('http://localhost/api/ops/capabilities/probe', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'user-123',
        },
      });

      const response = await probePost(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.environment).toBe('development');
    });
  });
});
