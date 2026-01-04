/**
 * State Model v1 API Tests (I2)
 * 
 * Tests that the API correctly exposes State Model v1 fields:
 * - localStatus
 * - githubStatusRaw
 * - githubMirrorStatus
 * - executionState
 * - handoffState
 * - effectiveStatus (computed server-side)
 * - githubLastSyncedAt
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as listIssues } from '../../app/api/issues/route';
import { GET as getIssue } from '../../app/api/issues/[id]/route';
import { Afu9IssueStatus, Afu9HandoffState, Afu9GithubMirrorStatus } from '../../src/lib/contracts/afu9Issue';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

// Mock database helpers
jest.mock('../../src/lib/db/afu9Issues', () => ({
  listAfu9Issues: jest.fn(),
  getAfu9IssueById: jest.fn(),
  getAfu9IssueByPublicId: jest.fn(),
}));

describe('State Model v1 API Fields (I2)', () => {
  const mockIssueWithStateModel = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Test Issue with State Model v1',
    body: 'Test body',
    status: Afu9IssueStatus.IMPLEMENTING,
    labels: ['bug'],
    priority: null,
    assignee: null,
    source: 'afu9',
    handoff_state: Afu9HandoffState.SYNCED,
    github_issue_number: 123,
    github_url: 'https://github.com/org/repo/issues/123',
    last_error: null,
    created_at: '2023-12-23T00:00:00Z',
    updated_at: '2023-12-23T01:00:00Z',
    activated_at: null,
    activated_by: null,
    execution_state: 'RUNNING',
    execution_started_at: '2023-12-23T00:30:00Z',
    execution_completed_at: null,
    execution_output: null,
    deleted_at: null,
    handoff_at: '2023-12-23T00:15:00Z',
    handoff_error: null,
    github_repo: 'org/repo',
    github_issue_last_sync_at: '2023-12-23T00:45:00Z',
    github_status_raw: 'In Progress',
    github_status_updated_at: '2023-12-23T00:45:00Z',
    status_source: 'github_project',
    github_mirror_status: Afu9GithubMirrorStatus.IN_PROGRESS,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/issues (list)', () => {
    test('includes State Model v1 fields in response', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({
        success: true,
        data: [mockIssueWithStateModel],
      });

      const request = new NextRequest('http://localhost/api/issues');
      const response = await listIssues(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.issues).toBeDefined();
      expect(body.issues.length).toBe(1);

      const issue = body.issues[0];

      // Verify State Model v1 fields are present (camelCase)
      expect(issue.localStatus).toBe('IMPLEMENTING');
      expect(issue.githubStatusRaw).toBe('In Progress');
      expect(issue.githubMirrorStatus).toBe('IN_PROGRESS');
      expect(issue.executionState).toBe('RUNNING');
      expect(issue.handoffState).toBe('SYNCED');
      expect(issue.githubLastSyncedAt).toBe('2023-12-23T00:45:00Z');

      // Verify effectiveStatus is computed (ExecutionState = RUNNING → uses localStatus)
      expect(issue.effectiveStatus).toBe('IMPLEMENTING');

      // Verify snake_case aliases are also present for backward compatibility
      expect(issue.local_status).toBe('IMPLEMENTING');
      expect(issue.github_status_raw).toBe('In Progress');
      expect(issue.github_mirror_status).toBe('IN_PROGRESS');
      expect(issue.execution_state).toBe('RUNNING');
      expect(issue.handoff_state).toBe('SYNCED');
      expect(issue.effective_status).toBe('IMPLEMENTING');
      expect(issue.github_last_synced_at).toBe('2023-12-23T00:45:00Z');
    });

    test('effectiveStatus uses GitHub status when not executing', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      
      // Issue with ExecutionState = IDLE, so GitHub status should be used
      const mockIdleIssue = {
        ...mockIssueWithStateModel,
        status: Afu9IssueStatus.IMPLEMENTING,
        execution_state: 'IDLE',
        github_mirror_status: Afu9GithubMirrorStatus.IN_REVIEW,
      };

      listAfu9Issues.mockResolvedValue({
        success: true,
        data: [mockIdleIssue],
      });

      const request = new NextRequest('http://localhost/api/issues');
      const response = await listIssues(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      const issue = body.issues[0];

      // ExecutionState = IDLE, GitHub status = IN_REVIEW → effectiveStatus should be MERGE_READY
      expect(issue.executionState).toBe('IDLE');
      expect(issue.githubMirrorStatus).toBe('IN_REVIEW');
      expect(issue.effectiveStatus).toBe('MERGE_READY');
    });

    test('effectiveStatus falls back to localStatus when GitHub unknown', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      
      // Issue with GitHub status UNKNOWN
      const mockUnknownGithubIssue = {
        ...mockIssueWithStateModel,
        status: Afu9IssueStatus.SPEC_READY,
        execution_state: 'IDLE',
        github_mirror_status: Afu9GithubMirrorStatus.UNKNOWN,
      };

      listAfu9Issues.mockResolvedValue({
        success: true,
        data: [mockUnknownGithubIssue],
      });

      const request = new NextRequest('http://localhost/api/issues');
      const response = await listIssues(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      const issue = body.issues[0];

      // ExecutionState = IDLE, GitHub status = UNKNOWN → use localStatus
      expect(issue.executionState).toBe('IDLE');
      expect(issue.githubMirrorStatus).toBe('UNKNOWN');
      expect(issue.localStatus).toBe('SPEC_READY');
      expect(issue.effectiveStatus).toBe('SPEC_READY');
    });
  });

  describe('GET /api/issues/[id] (detail)', () => {
    test('includes State Model v1 fields in single issue response', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: mockIssueWithStateModel,
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000');
      const response = await getIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const issue = await response.json();

      expect(response.status).toBe(200);

      // Verify State Model v1 fields
      expect(issue.localStatus).toBe('IMPLEMENTING');
      expect(issue.githubStatusRaw).toBe('In Progress');
      expect(issue.githubMirrorStatus).toBe('IN_PROGRESS');
      expect(issue.executionState).toBe('RUNNING');
      expect(issue.handoffState).toBe('SYNCED');
      expect(issue.effectiveStatus).toBe('IMPLEMENTING');
      expect(issue.githubLastSyncedAt).toBe('2023-12-23T00:45:00Z');
    });

    test('computes effectiveStatus correctly for different state combinations', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');

      // Test case: GitHub DONE status should map to effectiveStatus DONE
      const mockDoneIssue = {
        ...mockIssueWithStateModel,
        status: Afu9IssueStatus.VERIFIED,
        execution_state: 'IDLE',
        github_mirror_status: Afu9GithubMirrorStatus.DONE,
      };

      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: mockDoneIssue,
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567');
      const response = await getIssue(request, {
        params: Promise.resolve({ id: '123e4567' }),
      });
      const issue = await response.json();

      expect(response.status).toBe(200);
      expect(issue.localStatus).toBe('VERIFIED');
      expect(issue.githubMirrorStatus).toBe('DONE');
      expect(issue.effectiveStatus).toBe('DONE');
    });
  });

  describe('State Model v1 field validation', () => {
    test('all required fields are present in API response', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({
        success: true,
        data: [mockIssueWithStateModel],
      });

      const request = new NextRequest('http://localhost/api/issues');
      const response = await listIssues(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      const issue = body.issues[0];

      // Required State Model v1 fields (camelCase)
      expect(issue).toHaveProperty('localStatus');
      expect(issue).toHaveProperty('githubStatusRaw');
      expect(issue).toHaveProperty('githubMirrorStatus');
      expect(issue).toHaveProperty('executionState');
      expect(issue).toHaveProperty('handoffState');
      expect(issue).toHaveProperty('effectiveStatus');
      expect(issue).toHaveProperty('githubLastSyncedAt');

      // Required State Model v1 fields (snake_case for backward compatibility)
      expect(issue).toHaveProperty('local_status');
      expect(issue).toHaveProperty('github_status_raw');
      expect(issue).toHaveProperty('github_mirror_status');
      expect(issue).toHaveProperty('execution_state');
      expect(issue).toHaveProperty('handoff_state');
      expect(issue).toHaveProperty('effective_status');
      expect(issue).toHaveProperty('github_last_synced_at');
    });

    test('effectiveStatus is never stored (always computed)', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      
      // Database row should NOT have effectiveStatus field
      const mockDbRow = {
        ...mockIssueWithStateModel,
        effective_status: 'SHOULD_BE_IGNORED', // This should be ignored
      };

      listAfu9Issues.mockResolvedValue({
        success: true,
        data: [mockDbRow],
      });

      const request = new NextRequest('http://localhost/api/issues');
      const response = await listIssues(request);
      const body = await response.json();

      const issue = body.issues[0];

      // effectiveStatus should be computed based on state model rules, not from DB
      // ExecutionState = RUNNING → should use localStatus
      expect(issue.effectiveStatus).toBe('IMPLEMENTING');
      expect(issue.effectiveStatus).not.toBe('SHOULD_BE_IGNORED');
    });
  });
});
