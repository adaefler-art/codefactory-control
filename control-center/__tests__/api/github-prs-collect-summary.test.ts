/**
 * POST /api/github/prs/{prNumber}/collect-summary
 * 
 * API endpoint tests for implementation summary collection
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/github/prs/[prNumber]/collect-summary/route';

// Mock dependencies
jest.mock('@/lib/implementation-summary-service', () => ({
  getImplementationSummaryService: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('POST /api/github/prs/{prNumber}/collect-summary', () => {
  let mockService: any;

  beforeEach(() => {
    const { getImplementationSummaryService } = require('@/lib/implementation-summary-service');
    mockService = {
      collectSummary: jest.fn(),
    };
    getImplementationSummaryService.mockReturnValue(mockService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return 201 for new version', async () => {
    mockService.collectSummary.mockResolvedValue({
      summaryId: 'test-uuid-123',
      contentHash: 'a'.repeat(64),
      sources: [
        {
          type: 'pr_description',
          url: 'https://github.com/owner/repo/pull/123',
          timestamp: '2025-01-01T00:00:00Z',
        },
      ],
      version: 1,
      content: {
        prDescription: {
          body: 'Test PR',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
        comments: [],
        checkRuns: [],
        metadata: {
          prNumber: 123,
          repository: 'owner/repo',
          owner: 'owner',
          repo: 'repo',
          collectCount: 0,
          totalComments: 0,
        },
      },
      collectedAt: '2025-01-01T00:00:00Z',
      isNewVersion: true,
    });

    const request = new NextRequest('http://localhost/api/github/prs/123/collect-summary', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-1',
        'x-afu9-sub': 'user-123',
      },
      body: JSON.stringify({
        owner: 'owner',
        repo: 'repo',
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.summaryId).toBe('test-uuid-123');
    expect(body.isNewVersion).toBe(true);
    expect(body.version).toBe(1);
  });

  it('should return 200 for unchanged version', async () => {
    mockService.collectSummary.mockResolvedValue({
      summaryId: 'test-uuid-123',
      contentHash: 'a'.repeat(64),
      sources: [],
      version: 2,
      content: {
        prDescription: null,
        comments: [],
        checkRuns: [],
        metadata: {
          prNumber: 123,
          repository: 'owner/repo',
          owner: 'owner',
          repo: 'repo',
          collectCount: 0,
          totalComments: 0,
        },
      },
      collectedAt: '2025-01-01T00:00:00Z',
      isNewVersion: false,
    });

    const request = new NextRequest('http://localhost/api/github/prs/123/collect-summary', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-2',
        'x-afu9-sub': 'user-123',
      },
      body: JSON.stringify({
        owner: 'owner',
        repo: 'repo',
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summaryId).toBe('test-uuid-123');
    expect(body.isNewVersion).toBe(false);
    expect(body.version).toBe(2);
  });

  it('should return 400 for invalid PR number', async () => {
    const request = new NextRequest('http://localhost/api/github/prs/invalid/collect-summary', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-3',
      },
      body: JSON.stringify({
        owner: 'owner',
        repo: 'repo',
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: 'invalid' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('INVALID_PR_NUMBER');
  });

  it('should return 404 for non-existent PR', async () => {
    const { PrNotFoundError } = require('@/lib/types/implementation-summary');
    mockService.collectSummary.mockRejectedValue(
      new PrNotFoundError('owner', 'repo', 999)
    );

    const request = new NextRequest('http://localhost/api/github/prs/999/collect-summary', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-4',
      },
      body: JSON.stringify({
        owner: 'owner',
        repo: 'repo',
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '999' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe('PR_NOT_FOUND');
  });

  it('should return 403 for registry authorization failure', async () => {
    const { RegistryAuthorizationError } = require('@/lib/types/implementation-summary');
    mockService.collectSummary.mockRejectedValue(
      new RegistryAuthorizationError('owner/repo', 'collect_summary')
    );

    const request = new NextRequest('http://localhost/api/github/prs/123/collect-summary', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-5',
      },
      body: JSON.stringify({
        owner: 'owner',
        repo: 'repo',
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe('REGISTRY_AUTHORIZATION_FAILED');
  });

  it('should include request-id in response headers', async () => {
    mockService.collectSummary.mockResolvedValue({
      summaryId: 'test-uuid-123',
      contentHash: 'a'.repeat(64),
      sources: [],
      version: 1,
      content: {
        prDescription: null,
        comments: [],
        checkRuns: [],
        metadata: {
          prNumber: 123,
          repository: 'owner/repo',
          owner: 'owner',
          repo: 'repo',
          collectCount: 0,
          totalComments: 0,
        },
      },
      collectedAt: '2025-01-01T00:00:00Z',
      isNewVersion: true,
    });

    const request = new NextRequest('http://localhost/api/github/prs/123/collect-summary', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-correlation-id',
      },
      body: JSON.stringify({
        owner: 'owner',
        repo: 'repo',
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.headers.get('x-request-id')).toBe('test-correlation-id');
  });

  it('should pass include options to service', async () => {
    mockService.collectSummary.mockResolvedValue({
      summaryId: 'test-uuid-123',
      contentHash: 'a'.repeat(64),
      sources: [],
      version: 1,
      content: {
        prDescription: null,
        comments: [],
        checkRuns: [],
        metadata: {
          prNumber: 123,
          repository: 'owner/repo',
          owner: 'owner',
          repo: 'repo',
          collectCount: 0,
          totalComments: 0,
        },
      },
      collectedAt: '2025-01-01T00:00:00Z',
      isNewVersion: true,
    });

    const request = new NextRequest('http://localhost/api/github/prs/123/collect-summary', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-6',
      },
      body: JSON.stringify({
        owner: 'owner',
        repo: 'repo',
        include: {
          description: false,
          comments: true,
          checks: false,
        },
        maxComments: 25,
      }),
    });

    await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(mockService.collectSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'owner',
        repo: 'repo',
        prNumber: 123,
        include: {
          description: false,
          comments: true,
          checks: false,
        },
        maxComments: 25,
      }),
      'system'
    );
  });
});
