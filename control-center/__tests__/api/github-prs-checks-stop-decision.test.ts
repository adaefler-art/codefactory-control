/**
 * Tests for Stop Decision API (E84.4)
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/github/prs/[prNumber]/checks/stop-decision/route';

// Mock dependencies
jest.mock('../../src/lib/github/stop-decision-service', () => ({
  makeStopDecision: jest.fn(),
}));

jest.mock('../../src/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Stop Decision API', () => {
  let mockMakeStopDecision: jest.Mock;

  beforeEach(() => {
    const { makeStopDecision } = require('../../src/lib/github/stop-decision-service');
    mockMakeStopDecision = makeStopDecision;

    // Default mock response
    mockMakeStopDecision.mockResolvedValue({
      schemaVersion: '1.0',
      requestId: 'test-request-id',
      lawbookHash: 'test-hash',
      deploymentEnv: 'staging',
      target: {
        prNumber: 123,
        runId: 456,
      },
      decision: 'CONTINUE',
      reasons: ['All checks passed'],
      recommendedNextStep: 'PROMPT',
      evidence: {
        attemptCounts: {
          currentJobAttempts: 0,
          totalPrAttempts: 0,
        },
        thresholds: {
          maxRerunsPerJob: 2,
          maxTotalRerunsPerPr: 5,
          cooldownMinutes: 5,
        },
        appliedRules: ['all_checks_passed'],
      },
      metadata: {
        evaluatedAt: new Date().toISOString(),
      },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/github/prs/[prNumber]/checks/stop-decision', () => {
    it('should return stop decision for valid request', async () => {
      const url = new URL('http://localhost:3000/api/github/prs/123/checks/stop-decision?owner=test-owner&repo=test-repo&currentJobAttempts=1&totalPrAttempts=2');
      const request = new NextRequest(url);
      
      const context = {
        params: Promise.resolve({ prNumber: '123' }),
      };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.decision).toBe('CONTINUE');
      expect(data.target.prNumber).toBe(123);
      expect(mockMakeStopDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'test-owner',
          repo: 'test-repo',
          prNumber: 123,
          attemptCounts: {
            currentJobAttempts: 1,
            totalPrAttempts: 2,
          },
        })
      );
    });

    it('should handle optional parameters', async () => {
      const url = new URL('http://localhost:3000/api/github/prs/123/checks/stop-decision?owner=test-owner&repo=test-repo&currentJobAttempts=1&totalPrAttempts=2&runId=456&failureClass=flaky+probable');
      const request = new NextRequest(url);
      
      const context = {
        params: Promise.resolve({ prNumber: '123' }),
      };

      const response = await GET(request, context);

      expect(response.status).toBe(200);
      expect(mockMakeStopDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 456,
          failureClass: 'flaky probable',
        })
      );
    });

    it('should handle timestamp parameters', async () => {
      const lastChangedAt = new Date('2025-01-13T10:00:00Z').toISOString();
      const firstFailureAt = new Date('2025-01-13T09:00:00Z').toISOString();
      
      const url = new URL(`http://localhost:3000/api/github/prs/123/checks/stop-decision?owner=test-owner&repo=test-repo&currentJobAttempts=1&totalPrAttempts=2&lastChangedAt=${encodeURIComponent(lastChangedAt)}&firstFailureAt=${encodeURIComponent(firstFailureAt)}`);
      const request = new NextRequest(url);
      
      const context = {
        params: Promise.resolve({ prNumber: '123' }),
      };

      const response = await GET(request, context);

      expect(response.status).toBe(200);
      expect(mockMakeStopDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          lastChangedAt,
          firstFailureAt,
        })
      );
    });

    it('should handle previousFailureSignals parameter', async () => {
      const url = new URL('http://localhost:3000/api/github/prs/123/checks/stop-decision?owner=test-owner&repo=test-repo&currentJobAttempts=1&totalPrAttempts=2&previousFailureSignals=hash1,hash2,hash3');
      const request = new NextRequest(url);
      
      const context = {
        params: Promise.resolve({ prNumber: '123' }),
      };

      const response = await GET(request, context);

      expect(response.status).toBe(200);
      expect(mockMakeStopDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          previousFailureSignals: ['hash1', 'hash2', 'hash3'],
        })
      );
    });

    it('should return 400 for invalid PR number', async () => {
      const url = new URL('http://localhost:3000/api/github/prs/invalid/checks/stop-decision?owner=test-owner&repo=test-repo&currentJobAttempts=1&totalPrAttempts=2');
      const request = new NextRequest(url);
      
      const context = {
        params: Promise.resolve({ prNumber: 'invalid' }),
      };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('INVALID_PR_NUMBER');
    });

    it('should return 400 when owner is missing', async () => {
      const url = new URL('http://localhost:3000/api/github/prs/123/checks/stop-decision?repo=test-repo&currentJobAttempts=1&totalPrAttempts=2');
      const request = new NextRequest(url);
      
      const context = {
        params: Promise.resolve({ prNumber: '123' }),
      };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('MISSING_PARAMS');
      expect(data.error).toContain('owner');
    });

    it('should return 400 when repo is missing', async () => {
      const url = new URL('http://localhost:3000/api/github/prs/123/checks/stop-decision?owner=test-owner&currentJobAttempts=1&totalPrAttempts=2');
      const request = new NextRequest(url);
      
      const context = {
        params: Promise.resolve({ prNumber: '123' }),
      };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('MISSING_PARAMS');
      expect(data.error).toContain('repo');
    });

    it('should return 400 when currentJobAttempts is missing', async () => {
      const url = new URL('http://localhost:3000/api/github/prs/123/checks/stop-decision?owner=test-owner&repo=test-repo&totalPrAttempts=2');
      const request = new NextRequest(url);
      
      const context = {
        params: Promise.resolve({ prNumber: '123' }),
      };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('MISSING_PARAMS');
      expect(data.error).toContain('currentJobAttempts');
    });

    it('should return 400 when totalPrAttempts is missing', async () => {
      const url = new URL('http://localhost:3000/api/github/prs/123/checks/stop-decision?owner=test-owner&repo=test-repo&currentJobAttempts=1');
      const request = new NextRequest(url);
      
      const context = {
        params: Promise.resolve({ prNumber: '123' }),
      };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('MISSING_PARAMS');
      expect(data.error).toContain('totalPrAttempts');
    });

    it('should return 400 for invalid input validation', async () => {
      const url = new URL('http://localhost:3000/api/github/prs/123/checks/stop-decision?owner=test-owner&repo=test-repo&currentJobAttempts=-1&totalPrAttempts=2');
      const request = new NextRequest(url);
      
      const context = {
        params: Promise.resolve({ prNumber: '123' }),
      };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('INVALID_INPUT');
    });

    it('should return 500 for internal errors', async () => {
      mockMakeStopDecision.mockRejectedValueOnce(new Error('Database error'));

      const url = new URL('http://localhost:3000/api/github/prs/123/checks/stop-decision?owner=test-owner&repo=test-repo&currentJobAttempts=1&totalPrAttempts=2');
      const request = new NextRequest(url);
      
      const context = {
        params: Promise.resolve({ prNumber: '123' }),
      };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.code).toBe('INTERNAL_ERROR');
      expect(data.message).toBe('Database error');
    });

    it('should include x-request-id in response headers', async () => {
      const url = new URL('http://localhost:3000/api/github/prs/123/checks/stop-decision?owner=test-owner&repo=test-repo&currentJobAttempts=1&totalPrAttempts=2');
      const request = new NextRequest(url);
      
      const context = {
        params: Promise.resolve({ prNumber: '123' }),
      };

      const response = await GET(request, context);

      expect(response.headers.get('x-request-id')).toBeTruthy();
    });

    it('should return HOLD decision when max attempts reached', async () => {
      mockMakeStopDecision.mockResolvedValueOnce({
        schemaVersion: '1.0',
        requestId: 'test-request-id',
        lawbookHash: 'test-hash',
        deploymentEnv: 'staging',
        target: {
          prNumber: 123,
          runId: 456,
        },
        decision: 'HOLD',
        reasonCode: 'MAX_ATTEMPTS',
        reasons: ['Max attempts exceeded'],
        recommendedNextStep: 'MANUAL_REVIEW',
        evidence: {
          attemptCounts: {
            currentJobAttempts: 2,
            totalPrAttempts: 2,
          },
          thresholds: {
            maxRerunsPerJob: 2,
            maxTotalRerunsPerPr: 5,
            cooldownMinutes: 5,
          },
          appliedRules: ['maxRerunsPerJob'],
        },
        metadata: {
          evaluatedAt: new Date().toISOString(),
        },
      });

      const url = new URL('http://localhost:3000/api/github/prs/123/checks/stop-decision?owner=test-owner&repo=test-repo&currentJobAttempts=2&totalPrAttempts=2');
      const request = new NextRequest(url);
      
      const context = {
        params: Promise.resolve({ prNumber: '123' }),
      };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.decision).toBe('HOLD');
      expect(data.reasonCode).toBe('MAX_ATTEMPTS');
      expect(data.recommendedNextStep).toBe('MANUAL_REVIEW');
    });
  });
});
