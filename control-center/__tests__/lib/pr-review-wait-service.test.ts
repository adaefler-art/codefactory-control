/**
 * PR Review and Wait Service Tests
 * 
 * Tests for E83.4: Tool request_review_and_wait_checks
 * 
 * @jest-environment node
 */

import { PrReviewWaitService } from '../../src/lib/pr-review-wait-service';
import { RegistryAuthorizationError, PrNotFoundError } from '../../src/lib/types/pr-review-wait';

// Mock dependencies
jest.mock('../../src/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/lib/github/auth-wrapper', () => ({
  createAuthenticatedClient: jest.fn(),
}));

jest.mock('../../src/lib/repo-actions-registry-service', () => ({
  getRepoActionsRegistryService: jest.fn(),
}));

describe('PrReviewWaitService', () => {
  let service: PrReviewWaitService;
  let mockOctokit: any;
  let mockRegistryService: any;

  beforeEach(() => {
    // Mock timers to avoid actual delays in tests
    jest.useFakeTimers();
    
    service = new PrReviewWaitService();

    // Mock Octokit
    mockOctokit = {
      rest: {
        pulls: {
          requestReviewers: jest.fn(),
          get: jest.fn(),
          listReviews: jest.fn(),
        },
        checks: {
          listForRef: jest.fn(),
        },
      },
    };

    const { createAuthenticatedClient } = require('../../src/lib/github/auth-wrapper');
    createAuthenticatedClient.mockResolvedValue(mockOctokit);

    // Mock registry service
    mockRegistryService = {
      getActiveRegistry: jest.fn(),
    };

    const { getRepoActionsRegistryService } = require('../../src/lib/repo-actions-registry-service');
    getRepoActionsRegistryService.mockReturnValue(mockRegistryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('Registry Authorization', () => {
    it('should throw RegistryAuthorizationError if no registry exists', async () => {
      mockRegistryService.getActiveRegistry.mockResolvedValue(null);

      await expect(
        service.requestReviewAndWait({
          owner: 'test-owner',
          repo: 'test-repo',
          prNumber: 123,
          reviewers: [],
          maxWaitSeconds: 30,
          pollSeconds: 5,
        })
      ).rejects.toThrow(RegistryAuthorizationError);
    });

    it('should throw RegistryAuthorizationError if request_review not allowed', async () => {
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        content: {
          allowedActions: [
            { actionType: 'wait_for_checks', enabled: true },
          ],
        },
      });

      await expect(
        service.requestReviewAndWait({
          owner: 'test-owner',
          repo: 'test-repo',
          prNumber: 123,
          reviewers: [],
          maxWaitSeconds: 30,
          pollSeconds: 5,
        })
      ).rejects.toThrow(RegistryAuthorizationError);
    });

    it('should throw RegistryAuthorizationError if wait_for_checks not allowed', async () => {
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        content: {
          allowedActions: [
            { actionType: 'request_review', enabled: true },
          ],
        },
      });

      await expect(
        service.requestReviewAndWait({
          owner: 'test-owner',
          repo: 'test-repo',
          prNumber: 123,
          reviewers: [],
          maxWaitSeconds: 30,
          pollSeconds: 5,
        })
      ).rejects.toThrow(RegistryAuthorizationError);
    });
  });

  describe('Bounded Polling', () => {
    beforeEach(() => {
      // Setup registry to allow actions
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        content: {
          allowedActions: [
            { actionType: 'request_review', enabled: true },
            { actionType: 'wait_for_checks', enabled: true },
          ],
        },
      });

      // Setup PR state
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: { sha: 'test-sha' },
          mergeable: null,
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [],
      });
    });

    it('should calculate correct maximum polls', async () => {
      const maxWaitSeconds = 60;
      const pollSeconds = 10;
      const expectedMaxPolls = Math.ceil(maxWaitSeconds / pollSeconds); // 6

      const promise = service.requestReviewAndWait({
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        reviewers: [],
        maxWaitSeconds,
        pollSeconds,
      });

      // Advance timers to trigger all polls
      for (let i = 0; i < expectedMaxPolls; i++) {
        await jest.advanceTimersByTimeAsync(pollSeconds * 1000);
      }

      const result = await promise;

      expect(result.pollingStats.totalPolls).toBeLessThanOrEqual(expectedMaxPolls);
    });

    it('should timeout after maxWaitSeconds', async () => {
      const promise = service.requestReviewAndWait({
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        reviewers: [],
        maxWaitSeconds: 10,
        pollSeconds: 5,
      });

      // Advance timers to trigger timeout
      await jest.advanceTimersByTimeAsync(10 * 1000);

      const result = await promise;

      expect(result.pollingStats.timedOut).toBe(true);
      expect(result.pollingStats.totalPolls).toBeGreaterThan(0);
    });
  });

  describe('Early Termination', () => {
    beforeEach(() => {
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        content: {
          allowedActions: [
            { actionType: 'request_review', enabled: true },
            { actionType: 'wait_for_checks', enabled: true },
          ],
        },
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: { sha: 'test-sha' },
          mergeable: null,
        },
      });
    });

    it('should terminate early on RED checks', async () => {
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 1,
              name: 'test-check',
              status: 'completed',
              conclusion: 'failure',
              completed_at: '2025-01-01T00:00:00Z',
              html_url: 'https://github.com/test/check/1',
            },
          ],
        },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [],
      });

      const result = await service.requestReviewAndWait({
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        reviewers: [],
        maxWaitSeconds: 60,
        pollSeconds: 5,
      });

      expect(result.rollup.checks).toBe('RED');
      expect(result.pollingStats.terminatedEarly).toBe(true);
      expect(result.pollingStats.terminationReason).toBe('checks_failed');
    });

    it('should terminate early on CHANGES_REQUESTED', async () => {
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: 'reviewer' },
            state: 'CHANGES_REQUESTED',
            submitted_at: '2025-01-01T00:00:00Z',
            html_url: 'https://github.com/test/review/1',
          },
        ],
      });

      const result = await service.requestReviewAndWait({
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        reviewers: [],
        maxWaitSeconds: 60,
        pollSeconds: 5,
      });

      expect(result.rollup.reviews).toBe('CHANGES_REQUESTED');
      expect(result.pollingStats.terminatedEarly).toBe(true);
      expect(result.pollingStats.terminationReason).toBe('changes_requested');
    });

    it('should terminate early on not mergeable', async () => {
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: { sha: 'test-sha' },
          mergeable: false,
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [],
      });

      const result = await service.requestReviewAndWait({
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        reviewers: [],
        maxWaitSeconds: 60,
        pollSeconds: 5,
      });

      expect(result.rollup.mergeable).toBe(false);
      expect(result.pollingStats.terminatedEarly).toBe(true);
      expect(result.pollingStats.terminationReason).toBe('not_mergeable');
    });

    it('should terminate early on success (GREEN checks + APPROVED + mergeable)', async () => {
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: { sha: 'test-sha' },
          mergeable: true,
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 1,
              name: 'test-check',
              status: 'completed',
              conclusion: 'success',
              completed_at: '2025-01-01T00:00:00Z',
              html_url: 'https://github.com/test/check/1',
            },
          ],
        },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: 'reviewer' },
            state: 'APPROVED',
            submitted_at: '2025-01-01T00:00:00Z',
            html_url: 'https://github.com/test/review/1',
          },
        ],
      });

      const result = await service.requestReviewAndWait({
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        reviewers: [],
        maxWaitSeconds: 60,
        pollSeconds: 5,
      });

      expect(result.rollup.checks).toBe('GREEN');
      expect(result.rollup.reviews).toBe('APPROVED');
      expect(result.rollup.mergeable).toBe(true);
      expect(result.pollingStats.terminatedEarly).toBe(true);
      expect(result.pollingStats.terminationReason).toBe('success');
    });
  });

  describe('Status Rollup', () => {
    beforeEach(() => {
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        content: {
          allowedActions: [
            { actionType: 'request_review', enabled: true },
            { actionType: 'wait_for_checks', enabled: true },
          ],
        },
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: { sha: 'test-sha' },
          mergeable: true,
        },
      });
    });

    it('should return GREEN when all checks pass', async () => {
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 1,
              name: 'check-1',
              status: 'completed',
              conclusion: 'success',
              completed_at: '2025-01-01T00:00:00Z',
              html_url: 'https://github.com/test/check/1',
            },
            {
              id: 2,
              name: 'check-2',
              status: 'completed',
              conclusion: 'success',
              completed_at: '2025-01-01T00:00:00Z',
              html_url: 'https://github.com/test/check/2',
            },
          ],
        },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [],
      });

      const promise = service.requestReviewAndWait({
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        reviewers: [],
        maxWaitSeconds: 10,
        pollSeconds: 5,
      });

      // Advance timers to complete the test
      await jest.advanceTimersByTimeAsync(10 * 1000);
      const result = await promise;

      expect(result.rollup.checks).toBe('GREEN');
    });

    it('should return YELLOW when checks are pending', async () => {
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 1,
              name: 'check-1',
              status: 'in_progress',
              conclusion: null,
              completed_at: null,
              html_url: 'https://github.com/test/check/1',
            },
          ],
        },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [],
      });

      const promise = service.requestReviewAndWait({
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        reviewers: [],
        maxWaitSeconds: 10,
        pollSeconds: 5,
      });

      // Advance timers to complete the test
      await jest.advanceTimersByTimeAsync(10 * 1000);
      const result = await promise;

      expect(result.rollup.checks).toBe('YELLOW');
    });

    it('should return RED when any check fails', async () => {
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 1,
              name: 'check-1',
              status: 'completed',
              conclusion: 'success',
              completed_at: '2025-01-01T00:00:00Z',
              html_url: 'https://github.com/test/check/1',
            },
            {
              id: 2,
              name: 'check-2',
              status: 'completed',
              conclusion: 'failure',
              completed_at: '2025-01-01T00:00:00Z',
              html_url: 'https://github.com/test/check/2',
            },
          ],
        },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [],
      });

      const result = await service.requestReviewAndWait({
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        reviewers: [],
        maxWaitSeconds: 10,
        pollSeconds: 5,
      });

      expect(result.rollup.checks).toBe('RED');
    });

    it('should return APPROVED when at least one review approves', async () => {
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: 'reviewer-1' },
            state: 'APPROVED',
            submitted_at: '2025-01-01T00:00:00Z',
            html_url: 'https://github.com/test/review/1',
          },
        ],
      });

      const promise = service.requestReviewAndWait({
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        reviewers: [],
        maxWaitSeconds: 10,
        pollSeconds: 5,
      });

      // Advance timers to complete the test
      await jest.advanceTimersByTimeAsync(10 * 1000);
      const result = await promise;

      expect(result.rollup.reviews).toBe('APPROVED');
    });

    it('should return PENDING when no reviews exist', async () => {
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [],
      });

      const promise = service.requestReviewAndWait({
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        reviewers: [],
        maxWaitSeconds: 10,
        pollSeconds: 5,
      });

      // Advance timers to complete the test
      await jest.advanceTimersByTimeAsync(10 * 1000);
      const result = await promise;

      expect(result.rollup.reviews).toBe('PENDING');
    });
  });

  describe('Request Reviewers', () => {
    beforeEach(() => {
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        content: {
          allowedActions: [
            { actionType: 'request_review', enabled: true },
            { actionType: 'wait_for_checks', enabled: true },
          ],
        },
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: { sha: 'test-sha' },
          mergeable: null,
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [],
      });
    });

    it('should request reviewers when provided', async () => {
      mockOctokit.rest.pulls.requestReviewers.mockResolvedValue({});

      const promise = service.requestReviewAndWait({
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        reviewers: ['reviewer1', 'reviewer2'],
        maxWaitSeconds: 10,
        pollSeconds: 5,
      });

      // Advance timers to complete the test
      await jest.advanceTimersByTimeAsync(10 * 1000);
      await promise;

      expect(mockOctokit.rest.pulls.requestReviewers).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        reviewers: ['reviewer1', 'reviewer2'],
      });
    });

    it('should not request reviewers when empty array provided', async () => {
      const promise = service.requestReviewAndWait({
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        reviewers: [],
        maxWaitSeconds: 10,
        pollSeconds: 5,
      });

      // Advance timers to complete the test
      await jest.advanceTimersByTimeAsync(10 * 1000);
      await promise;

      expect(mockOctokit.rest.pulls.requestReviewers).not.toHaveBeenCalled();
    });

    it('should throw PrNotFoundError when PR does not exist', async () => {
      mockOctokit.rest.pulls.requestReviewers.mockRejectedValue(
        Object.assign(new Error('Not Found'), { status: 404 })
      );

      await expect(
        service.requestReviewAndWait({
          owner: 'test-owner',
          repo: 'test-repo',
          prNumber: 999,
          reviewers: ['reviewer1'],
          maxWaitSeconds: 10,
          pollSeconds: 5,
        })
      ).rejects.toThrow(PrNotFoundError);
    });
  });
});
