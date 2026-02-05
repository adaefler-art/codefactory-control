/**
 * Tests for S6 Step Executor: Deployment Observation
 * 
 * E9.3-CTRL-05: Validates deployment observation, authenticity checks, and idempotency
 */

import { Pool } from 'pg';
import { executeS6, StepContext, StepExecutionResult } from '../../../src/lib/loop/stepExecutors/s6-deployment-observe';
import { BlockerCode, IssueState } from '../../../src/lib/loop/stateMachine';
import * as deploymentObserver from '../../../src/lib/github/deployment-observer';
import * as authWrapper from '../../../src/lib/github/auth-wrapper';

// Mock dependencies
jest.mock('../../../src/lib/github/deployment-observer');
jest.mock('../../../src/lib/github/auth-wrapper');

// Mock pg Pool
const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
} as unknown as Pool;

// Mock Octokit
const mockOctokit = {
  rest: {
    pulls: {
      get: jest.fn(),
    },
    repos: {
      listDeployments: jest.fn(),
      listDeploymentStatuses: jest.fn(),
      getDeployment: jest.fn(),
    },
  },
} as any;

describe('S6 Step Executor: Deployment Observation', () => {
  const baseContext: StepContext = {
    issueId: 'test-issue-id',
    runId: 'test-run-id',
    requestId: 'test-request-id',
    actor: 'test-actor',
    mode: 'execute',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
    (authWrapper.createAuthenticatedClient as jest.Mock).mockResolvedValue(mockOctokit);
  });

  describe('Blocked scenarios', () => {
    test('should block with INVARIANT_VIOLATION when issue is not in DONE state', async () => {
      // Mock issue in REVIEW_READY state
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: IssueState.REVIEW_READY,
            github_url: 'https://github.com/owner/repo/issues/1',
            pr_url: 'https://github.com/owner/repo/pull/123',
          },
        ],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS6(mockPool, baseContext);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.INVARIANT_VIOLATION);
      expect(result.blockerMessage).toContain('expected DONE');
      expect(result.fieldsChanged).toEqual([]);
      expect(result.stateBefore).toBe(IssueState.REVIEW_READY);
      expect(result.stateAfter).toBe(IssueState.REVIEW_READY);
    });

    test('should block with NO_PR_LINKED when pr_url is null', async () => {
      // Mock issue without pr_url
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: IssueState.DONE,
            github_url: 'https://github.com/owner/repo/issues/1',
            pr_url: null,
          },
        ],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS6(mockPool, baseContext);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.NO_PR_LINKED);
      expect(result.blockerMessage).toBe('Cannot execute S6: Issue has no PR URL');
      expect(result.stateBefore).toBe(IssueState.DONE);
      expect(result.stateAfter).toBe(IssueState.DONE);

      // Verify timeline event was logged
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    test('should block with PR_NOT_MERGED when PR is not merged', async () => {
      // Mock issue with pr_url
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: IssueState.DONE,
            github_url: 'https://github.com/owner/repo/issues/1',
            pr_url: 'https://github.com/owner/repo/pull/123',
          },
        ],
      });

      // Mock PR not merged
      mockOctokit.rest.pulls.get.mockResolvedValueOnce({
        data: {
          merged: false,
          state: 'open',
          merge_commit_sha: null,
        },
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS6(mockPool, baseContext);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.PR_NOT_MERGED);
      expect(result.blockerMessage).toBe('PR is not merged yet');
      expect(result.stateBefore).toBe(IssueState.DONE);
      expect(result.stateAfter).toBe(IssueState.DONE);
    });

    test('should block with GITHUB_API_ERROR when PR fetch fails', async () => {
      // Mock issue with pr_url
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: IssueState.DONE,
            github_url: 'https://github.com/owner/repo/issues/1',
            pr_url: 'https://github.com/owner/repo/pull/123',
          },
        ],
      });

      // Mock PR fetch error
      mockOctokit.rest.pulls.get.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const result = await executeS6(mockPool, baseContext);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.GITHUB_API_ERROR);
      expect(result.blockerMessage).toContain('Failed to fetch PR');
    });
  });

  describe('Success scenarios', () => {
    test('should succeed when deployments are found', async () => {
      // Mock issue with pr_url
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: IssueState.DONE,
            github_url: 'https://github.com/owner/repo/issues/1',
            pr_url: 'https://github.com/owner/repo/pull/123',
          },
        ],
      });

      // Mock merged PR
      mockOctokit.rest.pulls.get.mockResolvedValueOnce({
        data: {
          merged: true,
          merge_commit_sha: 'abc123def456',
          state: 'closed',
        },
      });

      // Mock successful deployment observation
      (deploymentObserver.observeDeployments as jest.Mock).mockResolvedValueOnce({
        success: true,
        deploymentsFound: 2,
        observations: [
          {
            id: 'obs-1',
            issue_id: 'test-issue-id',
            github_deployment_id: 12345,
            environment: 'production',
            sha: 'abc123def456',
            target_url: 'https://app.example.com',
            is_authentic: true,
            created_at: '2024-01-01T12:00:00Z',
          },
          {
            id: 'obs-2',
            issue_id: 'test-issue-id',
            github_deployment_id: 12346,
            environment: 'staging',
            sha: 'abc123def456',
            target_url: 'https://staging.example.com',
            is_authentic: true,
            created_at: '2024-01-01T12:05:00Z',
          },
        ],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS6(mockPool, baseContext);

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.stateBefore).toBe(IssueState.DONE);
      expect(result.stateAfter).toBe(IssueState.DONE); // S6 doesn't change state
      expect(result.message).toContain('Observed 2 deployment(s)');
      expect(result.fieldsChanged).toEqual([]);

      // Verify observeDeployments was called correctly
      expect(deploymentObserver.observeDeployments).toHaveBeenCalledWith({
        pool: mockPool,
        octokit: mockOctokit,
        issueId: 'test-issue-id',
        owner: 'owner',
        repo: 'repo',
        sha: 'abc123def456',
      });

      // Verify timeline event was logged
      expect(mockQuery).toHaveBeenCalledTimes(2);
      const timelineCall = mockQuery.mock.calls[1];
      expect(timelineCall[0]).toContain('INSERT INTO loop_events');
    });

    test('should succeed when no deployments are found', async () => {
      // Mock issue with pr_url
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: IssueState.DONE,
            github_url: 'https://github.com/owner/repo/issues/1',
            pr_url: 'https://github.com/owner/repo/pull/123',
          },
        ],
      });

      // Mock merged PR
      mockOctokit.rest.pulls.get.mockResolvedValueOnce({
        data: {
          merged: true,
          merge_commit_sha: 'abc123def456',
          state: 'closed',
        },
      });

      // Mock no deployments found
      (deploymentObserver.observeDeployments as jest.Mock).mockResolvedValueOnce({
        success: true,
        deploymentsFound: 0,
        observations: [],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS6(mockPool, baseContext);

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.message).toBe('S6 complete: No deployments found');
      expect(result.stateBefore).toBe(IssueState.DONE);
      expect(result.stateAfter).toBe(IssueState.DONE);
    });
  });

  describe('Dry run mode', () => {
    test('should skip observation in dry run mode', async () => {
      const dryRunContext: StepContext = {
        ...baseContext,
        mode: 'dryRun',
      };

      // Mock issue with pr_url
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: IssueState.DONE,
            github_url: 'https://github.com/owner/repo/issues/1',
            pr_url: 'https://github.com/owner/repo/pull/123',
          },
        ],
      });

      // Mock merged PR
      mockOctokit.rest.pulls.get.mockResolvedValueOnce({
        data: {
          merged: true,
          merge_commit_sha: 'abc123def456',
          state: 'closed',
        },
      });

      const result = await executeS6(mockPool, dryRunContext);

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.message).toBe('S6 dry run: Would observe deployments');
      expect(result.stateBefore).toBe(IssueState.DONE);
      expect(result.stateAfter).toBe(IssueState.DONE);

      // Verify observeDeployments was NOT called
      expect(deploymentObserver.observeDeployments).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    test('should handle observation service errors', async () => {
      // Mock issue with pr_url
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: IssueState.DONE,
            github_url: 'https://github.com/owner/repo/issues/1',
            pr_url: 'https://github.com/owner/repo/pull/123',
          },
        ],
      });

      // Mock merged PR
      mockOctokit.rest.pulls.get.mockResolvedValueOnce({
        data: {
          merged: true,
          merge_commit_sha: 'abc123def456',
          state: 'closed',
        },
      });

      // Mock observation service error
      (deploymentObserver.observeDeployments as jest.Mock).mockResolvedValueOnce({
        success: false,
        deploymentsFound: 0,
        observations: [],
        error: 'Network timeout',
      });

      const result = await executeS6(mockPool, baseContext);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.GITHUB_API_ERROR);
      expect(result.blockerMessage).toContain('Network timeout');
    });

    test('should handle invalid PR URL format', async () => {
      // Mock issue with invalid pr_url
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: IssueState.DONE,
            github_url: 'https://github.com/owner/repo/issues/1',
            pr_url: 'invalid-url',
          },
        ],
      });

      const result = await executeS6(mockPool, baseContext);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.INVARIANT_VIOLATION);
      expect(result.blockerMessage).toContain('Invalid PR URL format');
    });
  });
});
