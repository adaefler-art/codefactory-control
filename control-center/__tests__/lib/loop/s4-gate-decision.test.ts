/**
 * Unit Tests: S4 Gate Decision Service (E9.3-CTRL-03)
 * 
 * Tests combined Review + Checks gate decision logic.
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import { Octokit } from 'octokit';
import {
  makeS4GateDecision,
  fetchReviewApprovalStatus,
  S4BlockReason,
  type S4GateDecisionInput,
  type ReviewApprovalStatus,
} from '../../../src/lib/loop/s4-gate-decision';
import { getSnapshotById } from '../../../src/lib/db/checksSnapshots';
import { createAuthenticatedClient } from '../../../src/lib/github/auth-wrapper';
import type { ChecksSnapshotRow } from '../../../src/lib/contracts/checksSnapshot';

// Mock dependencies
jest.mock('../../../src/lib/db/checksSnapshots', () => ({
  getSnapshotById: jest.fn(),
}));

jest.mock('../../../src/lib/github/auth-wrapper', () => ({
  createAuthenticatedClient: jest.fn(),
}));

jest.mock('../../../src/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('E9.3-CTRL-03: S4 Gate Decision Service', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockOctokit: jest.Mocked<Octokit>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPool = {
      query: jest.fn(),
    } as any;

    mockOctokit = {
      rest: {
        pulls: {
          listReviews: jest.fn(),
        },
      },
    } as any;

    (createAuthenticatedClient as jest.Mock).mockResolvedValue(mockOctokit);
  });

  describe('fetchReviewApprovalStatus', () => {
    test('should return APPROVED when at least one review is approved', async () => {
      (mockOctokit.rest.pulls.listReviews as jest.Mock).mockResolvedValue({
        data: [
          {
            user: { login: 'reviewer1' },
            state: 'APPROVED',
            submitted_at: '2026-02-04T10:00:00Z',
          },
        ],
      });

      const status = await fetchReviewApprovalStatus(
        mockOctokit,
        'owner',
        'repo',
        123
      );

      expect(status).toBe('APPROVED');
    });

    test('should return CHANGES_REQUESTED when review requests changes', async () => {
      (mockOctokit.rest.pulls.listReviews as jest.Mock).mockResolvedValue({
        data: [
          {
            user: { login: 'reviewer1' },
            state: 'APPROVED',
            submitted_at: '2026-02-04T10:00:00Z',
          },
          {
            user: { login: 'reviewer2' },
            state: 'CHANGES_REQUESTED',
            submitted_at: '2026-02-04T10:30:00Z',
          },
        ],
      });

      const status = await fetchReviewApprovalStatus(
        mockOctokit,
        'owner',
        'repo',
        123
      );

      expect(status).toBe('CHANGES_REQUESTED');
    });

    test('should return NOT_APPROVED when no approvals found', async () => {
      (mockOctokit.rest.pulls.listReviews as jest.Mock).mockResolvedValue({
        data: [],
      });

      const status = await fetchReviewApprovalStatus(
        mockOctokit,
        'owner',
        'repo',
        123
      );

      expect(status).toBe('NOT_APPROVED');
    });

    test('should use latest review per user', async () => {
      (mockOctokit.rest.pulls.listReviews as jest.Mock).mockResolvedValue({
        data: [
          {
            user: { login: 'reviewer1' },
            state: 'CHANGES_REQUESTED',
            submitted_at: '2026-02-04T10:00:00Z',
          },
          {
            user: { login: 'reviewer1' },
            state: 'APPROVED',
            submitted_at: '2026-02-04T11:00:00Z',
          },
        ],
      });

      const status = await fetchReviewApprovalStatus(
        mockOctokit,
        'owner',
        'repo',
        123
      );

      expect(status).toBe('APPROVED');
    });
  });

  describe('makeS4GateDecision', () => {
    const baseInput: S4GateDecisionInput = {
      owner: 'owner',
      repo: 'repo',
      prNumber: 123,
      requestId: 'req-123',
    };

    const mockSnapshot: ChecksSnapshotRow = {
      id: 'snap-123',
      run_id: 'run-123',
      issue_id: 'issue-123',
      repo_owner: 'owner',
      repo_name: 'repo',
      ref: 'abc123',
      captured_at: '2026-02-04T10:00:00Z',
      checks: [],
      total_checks: 5,
      failed_checks: 0,
      pending_checks: 0,
      snapshot_hash: 'hash123',
      request_id: 'req-123',
      created_at: '2026-02-04T10:00:00Z',
      updated_at: '2026-02-04T10:00:00Z',
    };

    test('should return PASS when review approved AND checks passed', async () => {
      const input: S4GateDecisionInput = {
        ...baseInput,
        snapshotId: 'snap-123',
      };

      (mockOctokit.rest.pulls.listReviews as jest.Mock).mockResolvedValue({
        data: [
          {
            user: { login: 'reviewer1' },
            state: 'APPROVED',
            submitted_at: '2026-02-04T10:00:00Z',
          },
        ],
      });

      (getSnapshotById as jest.Mock).mockResolvedValue({
        success: true,
        data: mockSnapshot,
      });

      const result = await makeS4GateDecision(mockPool, input);

      expect(result.verdict).toBe('PASS');
      expect(result.blockReason).toBeUndefined();
      expect(result.reviewStatus).toBe('APPROVED');
      expect(result.checksStatus).toBe('PASS');
    });

    test('should return FAIL when review not approved', async () => {
      const input: S4GateDecisionInput = {
        ...baseInput,
        snapshotId: 'snap-123',
      };

      (mockOctokit.rest.pulls.listReviews as jest.Mock).mockResolvedValue({
        data: [],
      });

      (getSnapshotById as jest.Mock).mockResolvedValue({
        success: true,
        data: mockSnapshot,
      });

      const result = await makeS4GateDecision(mockPool, input);

      expect(result.verdict).toBe('FAIL');
      expect(result.blockReason).toBe(S4BlockReason.NO_REVIEW_APPROVAL);
      expect(result.blockMessage).toBe('PR review not approved');
      expect(result.reviewStatus).toBe('NOT_APPROVED');
      expect(result.checksStatus).toBe('PASS');
    });

    test('should return FAIL when changes requested', async () => {
      const input: S4GateDecisionInput = {
        ...baseInput,
        snapshotId: 'snap-123',
      };

      (mockOctokit.rest.pulls.listReviews as jest.Mock).mockResolvedValue({
        data: [
          {
            user: { login: 'reviewer1' },
            state: 'CHANGES_REQUESTED',
            submitted_at: '2026-02-04T10:00:00Z',
          },
        ],
      });

      (getSnapshotById as jest.Mock).mockResolvedValue({
        success: true,
        data: mockSnapshot,
      });

      const result = await makeS4GateDecision(mockPool, input);

      expect(result.verdict).toBe('FAIL');
      expect(result.blockReason).toBe(S4BlockReason.CHANGES_REQUESTED);
      expect(result.blockMessage).toBe('PR review requested changes');
      expect(result.reviewStatus).toBe('CHANGES_REQUESTED');
    });

    test('should return FAIL when checks failed', async () => {
      const input: S4GateDecisionInput = {
        ...baseInput,
        snapshotId: 'snap-123',
      };

      const failedSnapshot: ChecksSnapshotRow = {
        ...mockSnapshot,
        failed_checks: 2,
      };

      (mockOctokit.rest.pulls.listReviews as jest.Mock).mockResolvedValue({
        data: [
          {
            user: { login: 'reviewer1' },
            state: 'APPROVED',
            submitted_at: '2026-02-04T10:00:00Z',
          },
        ],
      });

      (getSnapshotById as jest.Mock).mockResolvedValue({
        success: true,
        data: failedSnapshot,
      });

      const result = await makeS4GateDecision(mockPool, input);

      expect(result.verdict).toBe('FAIL');
      expect(result.blockReason).toBe(S4BlockReason.CHECKS_FAILED);
      expect(result.reviewStatus).toBe('APPROVED');
      expect(result.checksStatus).toBe('FAIL');
    });

    test('should return FAIL when checks pending', async () => {
      const input: S4GateDecisionInput = {
        ...baseInput,
        snapshotId: 'snap-123',
      };

      const pendingSnapshot: ChecksSnapshotRow = {
        ...mockSnapshot,
        pending_checks: 3,
      };

      (mockOctokit.rest.pulls.listReviews as jest.Mock).mockResolvedValue({
        data: [
          {
            user: { login: 'reviewer1' },
            state: 'APPROVED',
            submitted_at: '2026-02-04T10:00:00Z',
          },
        ],
      });

      (getSnapshotById as jest.Mock).mockResolvedValue({
        success: true,
        data: pendingSnapshot,
      });

      const result = await makeS4GateDecision(mockPool, input);

      expect(result.verdict).toBe('FAIL');
      expect(result.blockReason).toBe(S4BlockReason.CHECKS_PENDING);
      expect(result.reviewStatus).toBe('APPROVED');
      expect(result.checksStatus).toBe('FAIL');
    });

    test('should return FAIL when no checks found (fail-closed)', async () => {
      const input: S4GateDecisionInput = {
        ...baseInput,
        snapshotId: 'snap-123',
      };

      const noChecksSnapshot: ChecksSnapshotRow = {
        ...mockSnapshot,
        total_checks: 0,
      };

      (mockOctokit.rest.pulls.listReviews as jest.Mock).mockResolvedValue({
        data: [
          {
            user: { login: 'reviewer1' },
            state: 'APPROVED',
            submitted_at: '2026-02-04T10:00:00Z',
          },
        ],
      });

      (getSnapshotById as jest.Mock).mockResolvedValue({
        success: true,
        data: noChecksSnapshot,
      });

      const result = await makeS4GateDecision(mockPool, input);

      expect(result.verdict).toBe('FAIL');
      expect(result.blockReason).toBe(S4BlockReason.NO_CHECKS_FOUND);
      expect(result.reviewStatus).toBe('APPROVED');
      expect(result.checksStatus).toBe('FAIL');
    });

    test('should return FAIL when no snapshot provided (fail-closed)', async () => {
      const input: S4GateDecisionInput = {
        ...baseInput,
        // No snapshotId
      };

      (mockOctokit.rest.pulls.listReviews as jest.Mock).mockResolvedValue({
        data: [
          {
            user: { login: 'reviewer1' },
            state: 'APPROVED',
            submitted_at: '2026-02-04T10:00:00Z',
          },
        ],
      });

      const result = await makeS4GateDecision(mockPool, input);

      expect(result.verdict).toBe('FAIL');
      expect(result.blockReason).toBe(S4BlockReason.NO_CHECKS_FOUND);
      expect(result.blockMessage).toBe('No checks snapshot provided (fail-closed)');
      expect(result.reviewStatus).toBe('APPROVED');
      expect(result.checksStatus).toBe('FAIL');
    });

    test('should return FAIL when snapshot not found', async () => {
      const input: S4GateDecisionInput = {
        ...baseInput,
        snapshotId: 'snap-nonexistent',
      };

      (mockOctokit.rest.pulls.listReviews as jest.Mock).mockResolvedValue({
        data: [
          {
            user: { login: 'reviewer1' },
            state: 'APPROVED',
            submitted_at: '2026-02-04T10:00:00Z',
          },
        ],
      });

      (getSnapshotById as jest.Mock).mockResolvedValue({
        success: true,
        data: null,
      });

      const result = await makeS4GateDecision(mockPool, input);

      expect(result.verdict).toBe('FAIL');
      expect(result.blockReason).toBe(S4BlockReason.SNAPSHOT_NOT_FOUND);
      expect(result.reviewStatus).toBe('APPROVED');
      expect(result.checksStatus).toBe('FAIL');
    });

    test('should return FAIL when PR fetch fails', async () => {
      const input: S4GateDecisionInput = {
        ...baseInput,
        snapshotId: 'snap-123',
      };

      (mockOctokit.rest.pulls.listReviews as jest.Mock).mockRejectedValue(
        new Error('GitHub API error')
      );

      const result = await makeS4GateDecision(mockPool, input);

      expect(result.verdict).toBe('FAIL');
      expect(result.blockReason).toBe(S4BlockReason.PR_FETCH_FAILED);
      expect(result.blockMessage).toBe('Failed to fetch PR review status from GitHub');
      expect(result.reviewStatus).toBe('NOT_APPROVED');
      expect(result.checksStatus).toBe('FAIL');
    });
  });
});
