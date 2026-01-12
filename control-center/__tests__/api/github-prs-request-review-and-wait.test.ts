/**
 * POST /api/github/prs/{prNumber}/request-review-and-wait
 * 
 * API endpoint tests for PR review and wait
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST } from '../../app/api/github/prs/[prNumber]/request-review-and-wait/route';

// Mock dependencies
jest.mock('../../src/lib/pr-review-wait-service', () => ({
  getPrReviewWaitService: jest.fn(),
}));

jest.mock('../../src/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('POST /api/github/prs/{prNumber}/request-review-and-wait', () => {
  let mockService: any;

  beforeEach(() => {
    const { getPrReviewWaitService } = require('../../src/lib/pr-review-wait-service');
    mockService = {
      requestReviewAndWait: jest.fn(),
    };
    getPrReviewWaitService.mockReturnValue(mockService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return 200 with rollup when checks pass', async () => {
    mockService.requestReviewAndWait.mockResolvedValue({
      rollup: {
        checks: 'GREEN',
        reviews: 'APPROVED',
        mergeable: true,
      },
      evidence: {
        checks: [
          {
            id: 1,
            name: 'test-check',
            status: 'completed',
            conclusion: 'success',
            completedAt: '2025-01-01T00:00:00Z',
            url: 'https://github.com/test/check/1',
          },
        ],
        reviews: [
          {
            id: 1,
            user: 'reviewer',
            state: 'APPROVED',
            submittedAt: '2025-01-01T00:00:00Z',
            url: 'https://github.com/test/review/1',
          },
        ],
      },
      pollingStats: {
        totalPolls: 2,
        elapsedSeconds: 10,
        timedOut: false,
        terminatedEarly: true,
        terminationReason: 'success',
      },
    });

    const request = new NextRequest('http://localhost/api/github/prs/123/request-review-and-wait', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-1',
      },
      body: JSON.stringify({
        owner: 'test-owner',
        repo: 'test-repo',
        reviewers: ['reviewer1'],
        maxWaitSeconds: 60,
        pollSeconds: 10,
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rollup.checks).toBe('GREEN');
    expect(body.rollup.reviews).toBe('APPROVED');
    expect(body.rollup.mergeable).toBe(true);
    expect(body.pollingStats.terminatedEarly).toBe(true);
    expect(body.pollingStats.terminationReason).toBe('success');
  });

  it('should return 200 with RED rollup when checks fail', async () => {
    mockService.requestReviewAndWait.mockResolvedValue({
      rollup: {
        checks: 'RED',
        reviews: 'PENDING',
        mergeable: null,
      },
      evidence: {
        checks: [
          {
            id: 1,
            name: 'test-check',
            status: 'completed',
            conclusion: 'failure',
            completedAt: '2025-01-01T00:00:00Z',
            url: 'https://github.com/test/check/1',
          },
        ],
        reviews: [],
      },
      pollingStats: {
        totalPolls: 1,
        elapsedSeconds: 5,
        timedOut: false,
        terminatedEarly: true,
        terminationReason: 'checks_failed',
      },
    });

    const request = new NextRequest('http://localhost/api/github/prs/123/request-review-and-wait', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        owner: 'test-owner',
        repo: 'test-repo',
        reviewers: [],
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rollup.checks).toBe('RED');
    expect(body.pollingStats.terminationReason).toBe('checks_failed');
  });

  it('should return 200 with timeout when maxWaitSeconds exceeded', async () => {
    mockService.requestReviewAndWait.mockResolvedValue({
      rollup: {
        checks: 'YELLOW',
        reviews: 'PENDING',
        mergeable: null,
      },
      evidence: {
        checks: [
          {
            id: 1,
            name: 'test-check',
            status: 'in_progress',
            conclusion: null,
            completedAt: null,
            url: 'https://github.com/test/check/1',
          },
        ],
        reviews: [],
      },
      pollingStats: {
        totalPolls: 6,
        elapsedSeconds: 60,
        timedOut: true,
        terminatedEarly: false,
      },
    });

    const request = new NextRequest('http://localhost/api/github/prs/123/request-review-and-wait', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        owner: 'test-owner',
        repo: 'test-repo',
        maxWaitSeconds: 60,
        pollSeconds: 10,
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pollingStats.timedOut).toBe(true);
    expect(body.pollingStats.totalPolls).toBe(6);
  });

  it('should return 400 for invalid PR number', async () => {
    const request = new NextRequest('http://localhost/api/github/prs/invalid/request-review-and-wait', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        owner: 'test-owner',
        repo: 'test-repo',
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: 'invalid' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('INVALID_PR_NUMBER');
  });

  it('should return 400 for invalid input schema', async () => {
    const request = new NextRequest('http://localhost/api/github/prs/123/request-review-and-wait', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        owner: 'test-owner',
        // Missing repo field
        maxWaitSeconds: 60,
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(400);
  });

  it('should return 403 for registry authorization failure', async () => {
    const RegistryAuthorizationError = require('../../src/lib/types/pr-review-wait').RegistryAuthorizationError;
    
    mockService.requestReviewAndWait.mockRejectedValue(
      new RegistryAuthorizationError('test-owner/test-repo', 'request_review,wait_for_checks')
    );

    const request = new NextRequest('http://localhost/api/github/prs/123/request-review-and-wait', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        owner: 'test-owner',
        repo: 'test-repo',
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe('REGISTRY_AUTHORIZATION_FAILED');
  });

  it('should return 404 for PR not found', async () => {
    const PrNotFoundError = require('../../src/lib/types/pr-review-wait').PrNotFoundError;
    
    mockService.requestReviewAndWait.mockRejectedValue(
      new PrNotFoundError('test-owner', 'test-repo', 999)
    );

    const request = new NextRequest('http://localhost/api/github/prs/999/request-review-and-wait', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        owner: 'test-owner',
        repo: 'test-repo',
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '999' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe('PR_NOT_FOUND');
  });

  it('should use default values for optional parameters', async () => {
    mockService.requestReviewAndWait.mockResolvedValue({
      rollup: {
        checks: 'YELLOW',
        reviews: 'PENDING',
        mergeable: null,
      },
      evidence: {
        checks: [],
        reviews: [],
      },
      pollingStats: {
        totalPolls: 1,
        elapsedSeconds: 5,
        timedOut: false,
        terminatedEarly: false,
      },
    });

    const request = new NextRequest('http://localhost/api/github/prs/123/request-review-and-wait', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        owner: 'test-owner',
        repo: 'test-repo',
        // Omit reviewers, maxWaitSeconds, pollSeconds to test defaults
      }),
    });

    await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(mockService.requestReviewAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        reviewers: [], // Default
        maxWaitSeconds: 900, // Default
        pollSeconds: 15, // Default
      })
    );
  });

  it('should respect maxWaitSeconds limit of 3600', async () => {
    const request = new NextRequest('http://localhost/api/github/prs/123/request-review-and-wait', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        owner: 'test-owner',
        repo: 'test-repo',
        maxWaitSeconds: 5000, // Over the limit
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(400); // Validation error
  });

  it('should respect pollSeconds minimum of 5', async () => {
    const request = new NextRequest('http://localhost/api/github/prs/123/request-review-and-wait', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        owner: 'test-owner',
        repo: 'test-repo',
        pollSeconds: 2, // Under the minimum
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(400); // Validation error
  });
});
