/**
 * Unit tests for github-status-sync manual protection
 * E7_extra: Protect manually set statuses from GitHub sync override
 */

import { Pool } from 'pg';
import { syncGitHubStatusToAfu9, GitHubIssueForSync } from '../../src/lib/github-status-sync';
import { Afu9IssueStatus, Afu9StatusSource } from '../../src/lib/contracts/afu9Issue';
import { getAfu9IssueById } from '../../src/lib/db/afu9Issues';

// Mock the database functions
jest.mock('../../src/lib/db/afu9Issues');

const mockGetAfu9IssueById = getAfu9IssueById as jest.MockedFunction<typeof getAfu9IssueById>;

describe('github-status-sync: manual protection', () => {
  let mockPool: Pool;

  beforeEach(() => {
    mockPool = {} as Pool;
    jest.clearAllMocks();
  });

  describe('syncGitHubStatusToAfu9 with manual status_source', () => {
    it('should NOT override manual status (deny-by-default)', async () => {
      // Mock AFU9 issue with manual status
      mockGetAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'test-issue-id',
          status: Afu9IssueStatus.HOLD,  // Manually set to HOLD
          status_source: Afu9StatusSource.MANUAL,  // Manual source
          github_issue_number: 123,
          // ... other fields
        } as any,
      });

      // GitHub says "Implementing" but manual status should be protected
      const githubIssue: GitHubIssueForSync = {
        number: 123,
        state: 'open',
        labels: [{ name: 'status: implementing' }],
        projectStatus: null,
      };

      const result = await syncGitHubStatusToAfu9(mockPool, 'test-issue-id', githubIssue);

      // Status should NOT change
      expect(result.success).toBe(true);
      expect(result.changed).toBe(false);
      expect(result.previousStatus).toBe(Afu9IssueStatus.HOLD);
      expect(result.newStatus).toBe(Afu9IssueStatus.HOLD);
      expect(result.statusSource).toBe(Afu9StatusSource.MANUAL);
    });

    it('should override manual status when allowManualOverride = true', async () => {
      // Mock AFU9 issue with manual status
      mockGetAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'test-issue-id',
          status: Afu9IssueStatus.HOLD,
          status_source: Afu9StatusSource.MANUAL,
          github_issue_number: 123,
        } as any,
      });

      // Mock updateAfu9Issue to return success
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      updateAfu9Issue.mockResolvedValue({ success: true, data: {} });

      const githubIssue: GitHubIssueForSync = {
        number: 123,
        state: 'open',
        labels: [{ name: 'status: implementing' }],
        projectStatus: null,
      };

      // Explicitly allow override
      const result = await syncGitHubStatusToAfu9(
        mockPool,
        'test-issue-id',
        githubIssue,
        true  // allowManualOverride = true
      );

      // Status SHOULD change when override is allowed
      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);
      expect(result.previousStatus).toBe(Afu9IssueStatus.HOLD);
      expect(result.newStatus).toBe(Afu9IssueStatus.IMPLEMENTING);
    });

    it('should allow sync for non-manual status sources', async () => {
      // Mock AFU9 issue with GitHub label source (not manual)
      mockGetAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'test-issue-id',
          status: Afu9IssueStatus.IMPLEMENTING,
          status_source: Afu9StatusSource.GITHUB_LABEL,  // NOT manual
          github_issue_number: 123,
        } as any,
      });

      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      updateAfu9Issue.mockResolvedValue({ success: true, data: {} });

      const githubIssue: GitHubIssueForSync = {
        number: 123,
        state: 'open',
        labels: [{ name: 'status: done' }],
        projectStatus: null,
      };

      const result = await syncGitHubStatusToAfu9(mockPool, 'test-issue-id', githubIssue);

      // Status SHOULD change (not protected)
      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);
      expect(result.newStatus).toBe(Afu9IssueStatus.DONE);
    });

    it('should allow sync when status_source is null (legacy data)', async () => {
      // Mock AFU9 issue without status_source (legacy)
      mockGetAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'test-issue-id',
          status: Afu9IssueStatus.CREATED,
          status_source: null,  // Legacy data
          github_issue_number: 123,
        } as any,
      });

      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      updateAfu9Issue.mockResolvedValue({ success: true, data: {} });

      const githubIssue: GitHubIssueForSync = {
        number: 123,
        state: 'open',
        labels: [{ name: 'status: implementing' }],
        projectStatus: null,
      };

      const result = await syncGitHubStatusToAfu9(mockPool, 'test-issue-id', githubIssue);

      // Status SHOULD change (null source is not protected)
      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);
      expect(result.newStatus).toBe(Afu9IssueStatus.IMPLEMENTING);
    });
  });
});
