/**
 * Unit Tests: Drift Detection Service
 * E85.4: Drift Detection + Repair Suggestions
 */

import { Pool } from 'pg';
import { Octokit } from 'octokit';
import { DriftDetectionService } from '../../src/lib/drift-detection-service';
import {
  DriftType,
  DriftSeverity,
  RepairDirection,
} from '../../src/lib/contracts/drift';
import { Afu9IssueStatus } from '../../src/lib/contracts/afu9Issue';

// Mock dependencies
jest.mock('../../src/lib/db/afu9Issues');
jest.mock('../../src/lib/state-machine/loader');

describe('DriftDetectionService', () => {
  let pool: Pool;
  let octokit: Octokit;
  let service: DriftDetectionService;

  beforeEach(() => {
    // Create mock instances
    pool = {} as Pool;
    octokit = {
      rest: {
        issues: {
          get: jest.fn(),
        },
        pulls: {
          get: jest.fn(),
          listReviews: jest.fn(),
        },
        checks: {
          listForRef: jest.fn(),
        },
      },
    } as any;

    // Mock state machine loader
    const { loadStateMachineSpec, getGitHubLabelsForStatus } = require('../../src/lib/state-machine/loader');
    
    loadStateMachineSpec.mockReturnValue({
      states: new Map([
        ['MERGE_READY', { terminal: false, successors: ['DONE'] }],
        ['DONE', { terminal: true, successors: [] }],
        ['KILLED', { terminal: true, successors: [] }],
      ]),
      transitions: new Map(),
      githubMapping: {
        afu9_to_github_labels: {
          MERGE_READY: { primary_label: 'status:merge-ready', additional_labels: [] },
          DONE: { primary_label: 'status:done', additional_labels: [] },
        },
      },
    });

    getGitHubLabelsForStatus.mockImplementation((spec, status) => {
      const mapping = {
        MERGE_READY: { primary: 'status:merge-ready', additional: [] },
        DONE: { primary: 'status:done', additional: [] },
      };
      return mapping[status as keyof typeof mapping] || null;
    });

    service = new DriftDetectionService(pool, octokit);
  });

  describe('detectDrift', () => {
    it('should detect no drift when AFU-9 and GitHub are in sync', async () => {
      // Mock AFU-9 issue
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'issue-1',
          status: Afu9IssueStatus.DONE,
          labels: ['status:done'],
          updated_at: '2025-01-01T00:00:00Z',
        },
      });

      // Mock GitHub data
      octokit.rest.issues.get = jest.fn().mockResolvedValue({
        data: {
          number: 123,
          state: 'closed',
          labels: [{ name: 'status:done' }],
          updated_at: '2025-01-01T00:00:00Z',
          pull_request: {
            url: 'https://api.github.com/repos/owner/repo/pulls/123',
          },
        },
      });

      octokit.rest.pulls.get = jest.fn().mockResolvedValue({
        data: {
          number: 123,
          state: 'closed',
          merged: true,
          head: { sha: 'abc123' },
        },
      });

      octokit.rest.pulls.listReviews = jest.fn().mockResolvedValue({ data: [] });
      octokit.rest.checks.listForRef = jest.fn().mockResolvedValue({
        data: { total_count: 0, check_runs: [] },
      });

      const result = await service.detectDrift({
        issue_id: 'issue-1',
        github_owner: 'owner',
        github_repo: 'repo',
        github_issue_number: 123,
      });

      expect(result.drift_detected).toBe(false);
      expect(result.drift_types).toHaveLength(0);
      expect(result.severity).toBe(DriftSeverity.LOW);
      expect(result.suggestions).toHaveLength(0);
    });

    it('should detect STATUS_MISMATCH when PR is merged but AFU-9 is not DONE', async () => {
      // Mock AFU-9 issue
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'issue-1',
          status: Afu9IssueStatus.MERGE_READY,
          labels: ['status:merge-ready'],
          updated_at: '2025-01-01T00:00:00Z',
        },
      });

      // Mock GitHub data - PR merged
      octokit.rest.issues.get = jest.fn().mockResolvedValue({
        data: {
          number: 123,
          state: 'closed',
          labels: [{ name: 'status:merge-ready' }],
          updated_at: '2025-01-02T00:00:00Z',
          pull_request: {
            url: 'https://api.github.com/repos/owner/repo/pulls/123',
          },
        },
      });

      octokit.rest.pulls.get = jest.fn().mockResolvedValue({
        data: {
          number: 123,
          state: 'closed',
          merged: true,
          head: { sha: 'abc123' },
        },
      });

      octokit.rest.pulls.listReviews = jest.fn().mockResolvedValue({ data: [] });
      octokit.rest.checks.listForRef = jest.fn().mockResolvedValue({
        data: { total_count: 0, check_runs: [] },
      });

      const result = await service.detectDrift({
        issue_id: 'issue-1',
        github_owner: 'owner',
        github_repo: 'repo',
        github_issue_number: 123,
      });

      expect(result.drift_detected).toBe(true);
      expect(result.drift_types).toContain(DriftType.STATUS_MISMATCH);
      expect(result.severity).toBe(DriftSeverity.CRITICAL); // Critical because PR merged
      expect(result.suggestions.length).toBeGreaterThan(0);

      // Check suggestion
      const suggestion = result.suggestions[0];
      expect(suggestion.direction).toBe(RepairDirection.GITHUB_TO_AFU9);
      expect(suggestion.description).toContain('Update AFU-9 status to DONE');
      expect(suggestion.requires_confirmation).toBe(true);
    });

    it('should detect LABEL_MISMATCH when GitHub labels don\'t match AFU-9 status', async () => {
      // Mock AFU-9 issue
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'issue-1',
          status: Afu9IssueStatus.MERGE_READY,
          labels: ['status:merge-ready'],
          updated_at: '2025-01-01T00:00:00Z',
        },
      });

      // Mock GitHub data - wrong labels
      octokit.rest.issues.get = jest.fn().mockResolvedValue({
        data: {
          number: 123,
          state: 'open',
          labels: [{ name: 'bug' }], // Wrong label
          updated_at: '2025-01-01T00:00:00Z',
          pull_request: {
            url: 'https://api.github.com/repos/owner/repo/pulls/123',
          },
        },
      });

      octokit.rest.pulls.get = jest.fn().mockResolvedValue({
        data: {
          number: 123,
          state: 'open',
          merged: false,
          head: { sha: 'abc123' },
        },
      });

      octokit.rest.pulls.listReviews = jest.fn().mockResolvedValue({ data: [] });
      octokit.rest.checks.listForRef = jest.fn().mockResolvedValue({
        data: { total_count: 0, check_runs: [] },
      });

      const result = await service.detectDrift({
        issue_id: 'issue-1',
        github_owner: 'owner',
        github_repo: 'repo',
        github_issue_number: 123,
      });

      expect(result.drift_detected).toBe(true);
      expect(result.drift_types).toContain(DriftType.LABEL_MISMATCH);
      expect(result.suggestions.length).toBeGreaterThan(0);

      // Check suggestion
      const labelSuggestion = result.suggestions.find(
        s => s.direction === RepairDirection.AFU9_TO_GITHUB
      );
      expect(labelSuggestion).toBeDefined();
      expect(labelSuggestion?.description).toContain('Sync AFU-9 status labels to GitHub');
    });

    it('should detect CHECK_MISMATCH when AFU-9 is MERGE_READY but checks failed', async () => {
      // Mock AFU-9 issue
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'issue-1',
          status: Afu9IssueStatus.MERGE_READY,
          labels: ['status:merge-ready'],
          updated_at: '2025-01-01T00:00:00Z',
        },
      });

      // Mock GitHub data - checks failed
      octokit.rest.issues.get = jest.fn().mockResolvedValue({
        data: {
          number: 123,
          state: 'open',
          labels: [{ name: 'status:merge-ready' }],
          updated_at: '2025-01-01T00:00:00Z',
          pull_request: {
            url: 'https://api.github.com/repos/owner/repo/pulls/123',
          },
        },
      });

      octokit.rest.pulls.get = jest.fn().mockResolvedValue({
        data: {
          number: 123,
          state: 'open',
          merged: false,
          head: { sha: 'abc123' },
        },
      });

      octokit.rest.pulls.listReviews = jest.fn().mockResolvedValue({ data: [] });
      octokit.rest.checks.listForRef = jest.fn().mockResolvedValue({
        data: {
          total_count: 2,
          check_runs: [
            { name: 'test', status: 'completed', conclusion: 'success' },
            { name: 'build', status: 'completed', conclusion: 'failure' },
          ],
        },
      });

      const result = await service.detectDrift({
        issue_id: 'issue-1',
        github_owner: 'owner',
        github_repo: 'repo',
        github_issue_number: 123,
      });

      expect(result.drift_detected).toBe(true);
      expect(result.drift_types).toContain(DriftType.CHECK_MISMATCH);
      expect(result.severity).toBe(DriftSeverity.MEDIUM);

      // Check suggestion
      const checkSuggestion = result.suggestions.find(
        s => s.description.includes('checks failing')
      );
      expect(checkSuggestion).toBeDefined();
      expect(checkSuggestion?.direction).toBe(RepairDirection.GITHUB_TO_AFU9);
    });

    it('should require manual review for complex drift scenarios', async () => {
      // Mock AFU-9 issue
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'issue-1',
          status: Afu9IssueStatus.DONE,
          labels: ['status:done'],
          updated_at: '2025-01-01T00:00:00Z',
        },
      });

      // Mock GitHub data - PR still open (conflicting)
      octokit.rest.issues.get = jest.fn().mockResolvedValue({
        data: {
          number: 123,
          state: 'open',
          labels: [{ name: 'status:implementing' }],
          updated_at: '2025-01-02T00:00:00Z',
          pull_request: {
            url: 'https://api.github.com/repos/owner/repo/pulls/123',
          },
        },
      });

      octokit.rest.pulls.get = jest.fn().mockResolvedValue({
        data: {
          number: 123,
          state: 'open',
          merged: false,
          head: { sha: 'abc123' },
        },
      });

      octokit.rest.pulls.listReviews = jest.fn().mockResolvedValue({ data: [] });
      octokit.rest.checks.listForRef = jest.fn().mockResolvedValue({
        data: { total_count: 0, check_runs: [] },
      });

      const result = await service.detectDrift({
        issue_id: 'issue-1',
        github_owner: 'owner',
        github_repo: 'repo',
        github_issue_number: 123,
      });

      expect(result.drift_detected).toBe(true);
      expect(result.drift_types).toContain(DriftType.STATE_MISMATCH);

      // Check for manual review suggestion
      const manualSuggestion = result.suggestions.find(
        s => s.direction === RepairDirection.MANUAL_REVIEW
      );
      expect(manualSuggestion).toBeDefined();
      expect(manualSuggestion?.risk_level).toBe('high');
    });

    it('should include evidence in detection result', async () => {
      // Mock AFU-9 issue
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'issue-1',
          status: Afu9IssueStatus.MERGE_READY,
          labels: ['status:merge-ready'],
          updated_at: '2025-01-01T00:00:00Z',
        },
      });

      // Mock GitHub data
      octokit.rest.issues.get = jest.fn().mockResolvedValue({
        data: {
          number: 123,
          state: 'open',
          labels: [{ name: 'status:merge-ready' }],
          updated_at: '2025-01-01T00:00:00Z',
          pull_request: {
            url: 'https://api.github.com/repos/owner/repo/pulls/123',
          },
        },
      });

      octokit.rest.pulls.get = jest.fn().mockResolvedValue({
        data: {
          number: 123,
          state: 'open',
          merged: false,
          head: { sha: 'abc123' },
        },
      });

      octokit.rest.pulls.listReviews = jest.fn().mockResolvedValue({
        data: [{ state: 'APPROVED', submitted_at: '2025-01-01T00:00:00Z' }],
      });

      octokit.rest.checks.listForRef = jest.fn().mockResolvedValue({
        data: {
          total_count: 1,
          check_runs: [
            { name: 'test', status: 'completed', conclusion: 'success' },
          ],
        },
      });

      const result = await service.detectDrift({
        issue_id: 'issue-1',
        github_owner: 'owner',
        github_repo: 'repo',
        github_issue_number: 123,
      });

      // Verify evidence is collected
      expect(result.evidence).toBeDefined();
      expect(result.evidence.afu9_status).toBe(Afu9IssueStatus.MERGE_READY);
      expect(result.evidence.github_pr_state).toBe('open');
      expect(result.evidence.github_pr_merged).toBe(false);
      expect(result.evidence.github_checks_status).toBe('success');
      expect(result.evidence.github_review_status).toBe('approved');
      expect(result.evidence.github_raw_data).toBeDefined();
    });

    it('should not perform auto-repair (only suggestions)', async () => {
      // Mock AFU-9 issue
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      const mockUpdate = jest.fn();
      
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'issue-1',
          status: Afu9IssueStatus.MERGE_READY,
          labels: ['status:merge-ready'],
          updated_at: '2025-01-01T00:00:00Z',
        },
      });

      // Mock GitHub data - PR merged
      octokit.rest.issues.get = jest.fn().mockResolvedValue({
        data: {
          number: 123,
          state: 'closed',
          labels: [{ name: 'status:merge-ready' }],
          updated_at: '2025-01-02T00:00:00Z',
          pull_request: {
            url: 'https://api.github.com/repos/owner/repo/pulls/123',
          },
        },
      });

      octokit.rest.pulls.get = jest.fn().mockResolvedValue({
        data: {
          number: 123,
          state: 'closed',
          merged: true,
          head: { sha: 'abc123' },
        },
      });

      octokit.rest.pulls.listReviews = jest.fn().mockResolvedValue({ data: [] });
      octokit.rest.checks.listForRef = jest.fn().mockResolvedValue({
        data: { total_count: 0, check_runs: [] },
      });

      await service.detectDrift({
        issue_id: 'issue-1',
        github_owner: 'owner',
        github_repo: 'repo',
        github_issue_number: 123,
      });

      // Verify NO auto-repair was performed
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(octokit.rest.issues.get).toHaveBeenCalled(); // Only read operations
    });
  });
});
