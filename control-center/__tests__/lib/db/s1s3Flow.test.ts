/**
 * S1-S3 Flow DAO Tests
 * 
 * Tests for S1-S3 flow persistence layer:
 * - Issue upsert (idempotent by repo + issue number)
 * - Run creation and status updates
 * - Step event logging (append-only)
 * - Evidence refs persistence
 * 
 * Reference: E9.1_F1 - S1-S3 Live Flow MVP
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  upsertS1S3Issue,
  getS1S3IssueById,
  getS1S3IssueByGitHub,
  listS1S3Issues,
  updateS1S3IssueStatus,
  createS1S3Run,
  getS1S3RunById,
  listS1S3RunsByIssue,
  updateS1S3RunStatus,
  createS1S3RunStep,
  listS1S3RunSteps,
} from '../../../src/lib/db/s1s3Flow';
import {
  S1S3IssueStatus,
  S1S3RunType,
  S1S3RunStatus,
  S1S3StepStatus,
} from '../../../src/lib/contracts/s1s3Flow';

// Mock the database pool
const mockQuery = jest.fn();

const mockPool = {
  query: mockQuery,
} as unknown as Pool;

describe('S1S3 Flow DAO', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('upsertS1S3Issue', () => {
    test('creates new issue on first insert', async () => {
      const mockRow = {
        id: 'issue-uuid-1',
        public_id: 'a1b2c3d4',
        canonical_id: 'I123',
        repo_full_name: 'owner/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/owner/repo/issues/42',
        owner: 'afu9',
        status: S1S3IssueStatus.CREATED,
        problem: null,
        scope: null,
        acceptance_criteria: '[]',
        notes: null,
        pr_number: null,
        pr_url: null,
        branch_name: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:00:00Z'),
        spec_ready_at: null,
        pr_created_at: null,
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await upsertS1S3Issue(mockPool, {
        repo_full_name: 'owner/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/owner/repo/issues/42',
        canonical_id: 'I123',
      });

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('issue-uuid-1');
      expect(result.data?.github_issue_number).toBe(42);
      expect(result.data?.status).toBe(S1S3IssueStatus.CREATED);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO afu9_s1s3_issues'),
        expect.arrayContaining(['owner/repo', 42, 'https://github.com/owner/repo/issues/42'])
      );
    });

    test('updates existing issue on conflict (idempotent)', async () => {
      const mockRow = {
        id: 'issue-uuid-1',
        public_id: 'a1b2c3d4',
        canonical_id: 'I123',
        repo_full_name: 'owner/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/owner/repo/issues/42',
        owner: 'afu9',
        status: S1S3IssueStatus.SPEC_READY,
        problem: 'Test problem',
        scope: 'Test scope',
        acceptance_criteria: '["AC1", "AC2"]',
        notes: null,
        pr_number: null,
        pr_url: null,
        branch_name: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T01:00:00Z'),
        spec_ready_at: new Date('2024-01-01T01:00:00Z'),
        pr_created_at: null,
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await upsertS1S3Issue(mockPool, {
        repo_full_name: 'owner/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/owner/repo/issues/42',
        status: S1S3IssueStatus.SPEC_READY,
        problem: 'Test problem',
        scope: 'Test scope',
        acceptance_criteria: ['AC1', 'AC2'],
      });

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe(S1S3IssueStatus.SPEC_READY);
      expect(result.data?.problem).toBe('Test problem');
    });
  });

  describe('getS1S3IssueById', () => {
    test('returns issue by ID', async () => {
      const mockRow = {
        id: 'issue-uuid-1',
        public_id: 'a1b2c3d4',
        canonical_id: 'I123',
        repo_full_name: 'owner/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/owner/repo/issues/42',
        owner: 'afu9',
        status: S1S3IssueStatus.CREATED,
        problem: null,
        scope: null,
        acceptance_criteria: '[]',
        notes: null,
        pr_number: null,
        pr_url: null,
        branch_name: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:00:00Z'),
        spec_ready_at: null,
        pr_created_at: null,
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await getS1S3IssueById(mockPool, 'issue-uuid-1');

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('issue-uuid-1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM afu9_s1s3_issues WHERE id = $1'),
        ['issue-uuid-1']
      );
    });

    test('returns error when issue not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await getS1S3IssueById(mockPool, 'nonexistent-id');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Issue not found');
    });
  });

  describe('createS1S3Run', () => {
    test('creates new run', async () => {
      const mockRow = {
        id: 'run-uuid-1',
        type: S1S3RunType.S1_PICK_ISSUE,
        issue_id: 'issue-uuid-1',
        request_id: 'req-123',
        actor: 'afu9',
        status: S1S3RunStatus.CREATED,
        error_message: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
        started_at: null,
        completed_at: null,
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await createS1S3Run(mockPool, {
        type: S1S3RunType.S1_PICK_ISSUE,
        issue_id: 'issue-uuid-1',
        request_id: 'req-123',
        actor: 'afu9',
      });

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('run-uuid-1');
      expect(result.data?.type).toBe(S1S3RunType.S1_PICK_ISSUE);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO s1s3_runs'),
        expect.arrayContaining([S1S3RunType.S1_PICK_ISSUE, 'issue-uuid-1', 'req-123'])
      );
    });
  });

  describe('updateS1S3RunStatus', () => {
    test('updates run status to RUNNING', async () => {
      const mockRow = {
        id: 'run-uuid-1',
        type: S1S3RunType.S1_PICK_ISSUE,
        issue_id: 'issue-uuid-1',
        request_id: 'req-123',
        actor: 'afu9',
        status: S1S3RunStatus.RUNNING,
        error_message: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
        started_at: new Date('2024-01-01T00:01:00Z'),
        completed_at: null,
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await updateS1S3RunStatus(mockPool, 'run-uuid-1', S1S3RunStatus.RUNNING);

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe(S1S3RunStatus.RUNNING);
    });

    test('updates run status to DONE with completed_at', async () => {
      const mockRow = {
        id: 'run-uuid-1',
        type: S1S3RunType.S1_PICK_ISSUE,
        issue_id: 'issue-uuid-1',
        request_id: 'req-123',
        actor: 'afu9',
        status: S1S3RunStatus.DONE,
        error_message: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
        started_at: new Date('2024-01-01T00:01:00Z'),
        completed_at: new Date('2024-01-01T00:02:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await updateS1S3RunStatus(mockPool, 'run-uuid-1', S1S3RunStatus.DONE);

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe(S1S3RunStatus.DONE);
    });

    test('updates run status to FAILED with error message', async () => {
      const mockRow = {
        id: 'run-uuid-1',
        type: S1S3RunType.S1_PICK_ISSUE,
        issue_id: 'issue-uuid-1',
        request_id: 'req-123',
        actor: 'afu9',
        status: S1S3RunStatus.FAILED,
        error_message: 'GitHub API error',
        created_at: new Date('2024-01-01T00:00:00Z'),
        started_at: new Date('2024-01-01T00:01:00Z'),
        completed_at: new Date('2024-01-01T00:02:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await updateS1S3RunStatus(mockPool, 'run-uuid-1', S1S3RunStatus.FAILED, 'GitHub API error');

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe(S1S3RunStatus.FAILED);
      expect(result.data?.error_message).toBe('GitHub API error');
    });
  });

  describe('createS1S3RunStep', () => {
    test('creates step event with evidence refs', async () => {
      const mockRow = {
        id: 'step-uuid-1',
        run_id: 'run-uuid-1',
        step_id: 'S1',
        step_name: 'Pick GitHub Issue',
        status: S1S3StepStatus.SUCCEEDED,
        evidence_refs: JSON.stringify({
          issue_url: 'https://github.com/owner/repo/issues/42',
          issue_number: 42,
          request_id: 'req-123',
        }),
        error_message: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await createS1S3RunStep(mockPool, {
        run_id: 'run-uuid-1',
        step_id: 'S1',
        step_name: 'Pick GitHub Issue',
        status: S1S3StepStatus.SUCCEEDED,
        evidence_refs: {
          issue_url: 'https://github.com/owner/repo/issues/42',
          issue_number: 42,
          request_id: 'req-123',
        },
      });

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('step-uuid-1');
      expect(result.data?.step_id).toBe('S1');
      expect(result.data?.status).toBe(S1S3StepStatus.SUCCEEDED);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO s1s3_run_steps'),
        expect.arrayContaining(['run-uuid-1', 'S1', 'Pick GitHub Issue'])
      );
    });

    test('creates step event with failure and error message', async () => {
      const mockRow = {
        id: 'step-uuid-1',
        run_id: 'run-uuid-1',
        step_id: 'S3',
        step_name: 'Create Branch and PR',
        status: S1S3StepStatus.FAILED,
        evidence_refs: JSON.stringify({
          issue_id: 'issue-uuid-1',
          request_id: 'req-123',
        }),
        error_message: 'Branch already exists',
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await createS1S3RunStep(mockPool, {
        run_id: 'run-uuid-1',
        step_id: 'S3',
        step_name: 'Create Branch and PR',
        status: S1S3StepStatus.FAILED,
        error_message: 'Branch already exists',
        evidence_refs: {
          issue_id: 'issue-uuid-1',
          request_id: 'req-123',
        },
      });

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe(S1S3StepStatus.FAILED);
      expect(result.data?.error_message).toBe('Branch already exists');
    });
  });

  describe('listS1S3RunSteps', () => {
    test('returns steps ordered by created_at', async () => {
      const mockRows = [
        {
          id: 'step-uuid-1',
          run_id: 'run-uuid-1',
          step_id: 'S1',
          step_name: 'Pick GitHub Issue',
          status: S1S3StepStatus.STARTED,
          evidence_refs: '{}',
          error_message: null,
          created_at: new Date('2024-01-01T00:00:00Z'),
        },
        {
          id: 'step-uuid-2',
          run_id: 'run-uuid-1',
          step_id: 'S1',
          step_name: 'Pick GitHub Issue',
          status: S1S3StepStatus.SUCCEEDED,
          evidence_refs: '{}',
          error_message: null,
          created_at: new Date('2024-01-01T00:01:00Z'),
        },
      ];

      mockQuery.mockResolvedValue({ rows: mockRows });

      const result = await listS1S3RunSteps(mockPool, 'run-uuid-1');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.[0].step_id).toBe('S1');
      expect(result.data?.[0].status).toBe(S1S3StepStatus.STARTED);
      expect(result.data?.[1].status).toBe(S1S3StepStatus.SUCCEEDED);
    });
  });
});
