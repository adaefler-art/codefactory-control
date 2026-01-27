/**
 * Unit Tests: Bi-directional Sync Engine
 * E85.2: AFU-9 ↔ GitHub Bi-directional Sync
 */

import { Pool } from 'pg';
import { Octokit } from 'octokit';
import { BidirectionalSyncEngine } from '../../src/lib/bidirectional-sync';
import { Afu9IssueStatus } from '../../src/lib/contracts/afu9Issue';

// Mock dependencies
jest.mock('../../src/lib/db/syncAudit');
jest.mock('../../src/lib/db/afu9Issues');
jest.mock('../../src/lib/state-machine/loader');

describe('BidirectionalSyncEngine', () => {
  let pool: Pool;
  let octokit: Octokit;
  let syncEngine: BidirectionalSyncEngine;

  beforeEach(() => {
    // Create mock instances
    pool = {} as Pool;
    octokit = {
      rest: {
        pulls: {
          get: jest.fn(),
          listReviews: jest.fn(),
        },
        checks: {
          listForRef: jest.fn(),
        },
        issues: {
          setLabels: jest.fn(),
        },
      },
    } as any;

    // Mock state machine loader
    const {
      loadStateMachineSpec,
      isTransitionAllowed,
      getTransition,
      checkPreconditions,
      mapGitHubStatusToAfu9,
      getGitHubLabelsForStatus,
    } = require('../../src/lib/state-machine/loader');
    
    const mockTransitions = new Map([
      ['MERGE_READY_to_DONE', {
        from: 'MERGE_READY',
        to: 'DONE',
        preconditions: [
          { type: 'pr_merged', required: true },
          { type: 'ci_checks_green', required: true },
        ],
        evidence_required: true,
      }],
      ['IMPLEMENTING_to_VERIFIED', {
        from: 'IMPLEMENTING',
        to: 'VERIFIED',
        preconditions: [
          { type: 'tests_pass', required: true },
          { type: 'code_committed', required: true },
        ],
        evidence_required: true,
      }],
    ]);

    loadStateMachineSpec.mockReturnValue({
      states: new Map([
        ['CREATED', { terminal: false, successors: ['SPEC_READY', 'HOLD', 'KILLED'] }],
        ['SPEC_READY', { terminal: false, successors: ['IMPLEMENTING', 'HOLD', 'KILLED'] }],
        ['IMPLEMENTING', { terminal: false, successors: ['VERIFIED', 'SPEC_READY', 'HOLD', 'KILLED'] }],
        ['VERIFIED', { terminal: false, successors: ['MERGE_READY', 'IMPLEMENTING', 'HOLD', 'KILLED'] }],
        ['MERGE_READY', { terminal: false, successors: ['DONE', 'VERIFIED', 'HOLD', 'KILLED'] }],
        ['DONE', { terminal: true, successors: [] }],
        ['HOLD', { terminal: false, successors: ['CREATED', 'SPEC_READY', 'IMPLEMENTING', 'VERIFIED', 'MERGE_READY', 'KILLED'] }],
        ['KILLED', { terminal: true, successors: [] }],
      ]),
      transitions: mockTransitions,
      githubMapping: {
        afu9_to_github_labels: {
          CREATED: { primary_label: 'status:created', additional_labels: [] },
          SPEC_READY: { primary_label: 'status:spec-ready', additional_labels: [] },
          IMPLEMENTING: { primary_label: 'status:implementing', additional_labels: [] },
          VERIFIED: { primary_label: 'status:verified', additional_labels: [] },
          MERGE_READY: { primary_label: 'status:merge-ready', additional_labels: [] },
          DONE: { primary_label: 'status:done', additional_labels: [] },
          HOLD: { primary_label: 'status:hold', additional_labels: [] },
          KILLED: { primary_label: 'status:killed', additional_labels: [] },
        },
        github_to_afu9_state: {
          project_status: {},
          labels: {
            'status:created': 'CREATED',
            'status:spec-ready': 'SPEC_READY',
            'status:implementing': 'IMPLEMENTING',
            'status:verified': 'VERIFIED',
            'status:merge-ready': 'MERGE_READY',
            'status:done': 'DONE',
            'status:hold': 'HOLD',
            'status:killed': 'KILLED',
          },
          issue_state: {},
        },
        github_pr_status_to_afu9: {
          draft: 'IMPLEMENTING',
          open: 'MERGE_READY',
          merged: 'DONE',
          closed: null,
        },
        github_checks_requirements: {},
      },
    });

    // Mock helper functions
    isTransitionAllowed.mockImplementation((spec: any, from: string, to: string) => {
      const state = spec.states.get(from);
      if (!state || state.terminal) return false;
      return state.successors.includes(to);
    });

    getTransition.mockImplementation((spec: any, from: string, to: string) => {
      for (const [, transition] of spec.transitions) {
        if (transition.from === from && transition.to === to) {
          return transition;
        }
      }
      return null;
    });

    checkPreconditions.mockImplementation((transition: any, evidence: any) => {
      const missing = [];
      for (const precondition of transition.preconditions || []) {
        if (precondition.required && !evidence[precondition.type]) {
          missing.push(precondition.type);
        }
      }
      return { met: missing.length === 0, missing };
    });

    mapGitHubStatusToAfu9.mockImplementation((spec: any, value: string, source: string) => {
      if (source === 'labels') {
        return spec.githubMapping.github_to_afu9_state.labels[value] || null;
      }
      return null;
    });

    getGitHubLabelsForStatus.mockImplementation((spec: any, status: string) => {
      const mapping = spec.githubMapping.afu9_to_github_labels[status];
      if (!mapping) return null;
      return {
        primary: mapping.primary_label,
        additional: mapping.additional_labels || [],
      };
    });

    syncEngine = new BidirectionalSyncEngine(pool, octokit);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('syncGitHubToAfu9', () => {
    it('should sync merged PR to DONE status', async () => {
      // Mock AFU-9 issue
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'issue-1',
          status: Afu9IssueStatus.MERGE_READY,
          status_source: 'manual',
        },
      });

      // Mock GitHub PR data
      (octokit.rest.pulls.get as jest.Mock).mockResolvedValue({
        data: {
          number: 123,
          state: 'closed',
          merged: true,
          mergeable_state: 'clean',
          labels: [],
          head: { sha: 'abc123' },
        },
      });

      (octokit.rest.pulls.listReviews as jest.Mock).mockResolvedValue({
        data: [{ state: 'APPROVED', submitted_at: '2026-01-13T00:00:00Z' }],
      });

      (octokit.rest.checks.listForRef as jest.Mock).mockResolvedValue({
        data: {
          total_count: 2,
          check_runs: [
            { name: 'test', status: 'completed', conclusion: 'success' },
            { name: 'build', status: 'completed', conclusion: 'success' },
          ],
        },
      });

      // Mock update
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      updateAfu9Issue.mockResolvedValue({ success: true });

      // Mock audit
      const { recordSyncAuditEvent } = require('../../src/lib/db/syncAudit');
      recordSyncAuditEvent.mockResolvedValue({ success: true, data: 'audit-1' });

      const result = await syncEngine.syncGitHubToAfu9(
        'issue-1',
        'owner',
        'repo',
        123,
        { dryRun: false }
      );

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(Afu9IssueStatus.DONE);
      expect(result.statusChanged).toBe(true);
      expect(result.transitionAllowed).toBe(true);
      expect(result.conflictDetected).toBe(false);
    });

    it('should detect conflict for invalid transition', async () => {
      // Mock AFU-9 issue in DONE state (terminal)
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'issue-1',
          status: Afu9IssueStatus.DONE,
          status_source: 'manual',
        },
      });

      // Mock GitHub PR data
      (octokit.rest.pulls.get as jest.Mock).mockResolvedValue({
        data: {
          number: 123,
          state: 'open',
          merged: false,
          mergeable_state: 'clean',
          labels: [{ name: 'status:implementing' }],
          head: { sha: 'abc123' },
        },
      });

      (octokit.rest.pulls.listReviews as jest.Mock).mockResolvedValue({
        data: [],
      });

      (octokit.rest.checks.listForRef as jest.Mock).mockResolvedValue({
        data: {
          total_count: 0,
          check_runs: [],
        },
      });

      // Mock audit
      const { recordSyncAuditEvent } = require('../../src/lib/db/syncAudit');
      recordSyncAuditEvent.mockResolvedValue({ success: true, data: 'audit-1' });

      // Mock conflict creation
      const { createSyncConflict } = require('../../src/lib/db/syncAudit');
      createSyncConflict.mockResolvedValue({ success: true, data: 'conflict-1' });

      const result = await syncEngine.syncGitHubToAfu9(
        'issue-1',
        'owner',
        'repo',
        123,
        { dryRun: false }
      );

      expect(result.success).toBe(true);
      expect(result.statusChanged).toBe(false);
      expect(result.transitionAllowed).toBe(false);
      expect(result.conflictDetected).toBe(true);
    });

    it('should respect dry-run mode', async () => {
      // Mock AFU-9 issue
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'issue-1',
          status: Afu9IssueStatus.IMPLEMENTING,
          status_source: 'manual',
        },
      });

      // Mock GitHub PR data
      (octokit.rest.pulls.get as jest.Mock).mockResolvedValue({
        data: {
          number: 123,
          state: 'open',
          merged: false,
          mergeable_state: 'clean',
          labels: [{ name: 'status:verified' }],
          head: { sha: 'abc123' },
        },
      });

      (octokit.rest.pulls.listReviews as jest.Mock).mockResolvedValue({
        data: [],
      });

      (octokit.rest.checks.listForRef as jest.Mock).mockResolvedValue({
        data: {
          total_count: 2,
          check_runs: [
            { name: 'test', status: 'completed', conclusion: 'success' },
            { name: 'build', status: 'completed', conclusion: 'success' },
          ],
        },
      });

      // Mock update
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      updateAfu9Issue.mockResolvedValue({ success: true });

      // Mock audit
      const { recordSyncAuditEvent } = require('../../src/lib/db/syncAudit');
      recordSyncAuditEvent.mockResolvedValue({ success: true, data: 'audit-1' });

      const result = await syncEngine.syncGitHubToAfu9(
        'issue-1',
        'owner',
        'repo',
        123,
        { dryRun: true }
      );

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe(Afu9IssueStatus.VERIFIED);
      // In dry-run mode, updateAfu9Issue should not be called
      expect(updateAfu9Issue).not.toHaveBeenCalled();
    });
  });

  describe('syncAfu9ToGitHub', () => {
    it('should sync AFU-9 status to GitHub labels', async () => {
      // Mock AFU-9 issue
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'issue-1',
          status: Afu9IssueStatus.IMPLEMENTING,
          status_source: 'manual',
        },
      });

      // Mock GitHub label update
      (octokit.rest.issues.setLabels as jest.Mock).mockResolvedValue({});

      // Mock audit
      const { recordSyncAuditEvent } = require('../../src/lib/db/syncAudit');
      recordSyncAuditEvent.mockResolvedValue({ success: true, data: 'audit-1' });

      const result = await syncEngine.syncAfu9ToGitHub(
        'issue-1',
        'owner',
        'repo',
        123,
        { dryRun: false }
      );

      expect(result.success).toBe(true);
      expect(octokit.rest.issues.setLabels).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 123,
        labels: ['status:implementing'],
      });
    });

    it('should respect dry-run mode for GitHub updates', async () => {
      // Mock AFU-9 issue
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'issue-1',
          status: Afu9IssueStatus.VERIFIED,
          status_source: 'manual',
        },
      });

      // Mock GitHub label update
      (octokit.rest.issues.setLabels as jest.Mock).mockResolvedValue({});

      // Mock audit
      const { recordSyncAuditEvent } = require('../../src/lib/db/syncAudit');
      recordSyncAuditEvent.mockResolvedValue({ success: true, data: 'audit-1' });

      const result = await syncEngine.syncAfu9ToGitHub(
        'issue-1',
        'owner',
        'repo',
        123,
        { dryRun: true }
      );

      expect(result.success).toBe(true);
      // In dry-run mode, setLabels should not be called
      expect(octokit.rest.issues.setLabels).not.toHaveBeenCalled();
    });
  });
});
