/**
 * Tests for E61.3 Idempotent GitHub Handoff
 * @jest-environment node
 */

import { POST as handoffIssue } from '../../app/api/issues/[id]/handoff/route';
import { NextRequest } from 'next/server';
import { Afu9HandoffState } from '../../src/lib/contracts/afu9Issue';

// Mock dependencies
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/github', () => ({
  createIssue: jest.fn(),
  updateIssue: jest.fn(),
}));

jest.mock('../../src/lib/db/afu9Issues', () => ({
  updateAfu9Issue: jest.fn(),
}));

jest.mock('../../app/api/issues/_shared', () => ({
  fetchIssueRowByIdentifier: jest.fn(),
  normalizeIssueForApi: jest.fn((issue) => issue),
}));

describe('E61.3: Idempotent GitHub Handoff', () => {
  const mockIssue = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Test Issue',
    body: 'Test body',
    status: 'SPEC_READY',
    labels: ['bug', 'enhancement'],
    priority: 'P1',
    assignee: null,
    source: 'afu9',
    handoff_state: 'NOT_SENT',
    github_issue_number: null,
    github_url: null,
    last_error: null,
    handoff_at: null,
    handoff_error: null,
    github_repo: null,
    github_issue_last_sync_at: null,
    created_at: '2023-12-23T00:00:00Z',
    updated_at: '2023-12-23T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock current time for consistent timestamps
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('First handoff (CREATE)', () => {
    it('creates a new GitHub issue when github_issue_number is null', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue } = require('../../src/lib/github');

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: mockIssue,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: { ...mockIssue, handoff_state: Afu9HandoffState.SYNCED },
      });

      createIssue.mockResolvedValue({
        number: 123,
        html_url: 'https://github.com/owner/repo/issues/123',
      });

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      
      // Should create, not update
      expect(createIssue).toHaveBeenCalledTimes(1);
      expect(createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Issue',
          body: expect.stringContaining('AFU9-ISSUE:123e4567-e89b-12d3-a456-426614174000'),
          labels: expect.arrayContaining(['bug', 'enhancement', 'priority:P1']),
        })
      );

      // Should set state to PENDING first, then SYNCED
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        mockIssue.id,
        expect.objectContaining({
          handoff_state: Afu9HandoffState.PENDING,
          handoff_at: expect.any(String),
          handoff_error: null,
        })
      );

      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        mockIssue.id,
        expect.objectContaining({
          handoff_state: Afu9HandoffState.SYNCED,
          github_issue_number: 123,
          github_url: 'https://github.com/owner/repo/issues/123',
          github_repo: expect.any(String),
          github_issue_last_sync_at: expect.any(String),
          handoff_error: null,
        })
      );

      expect(body.message).toContain('handed off to GitHub successfully');
      expect(body.github_issue_number).toBe(123);
      expect(body.handoff_state).toBe(Afu9HandoffState.SYNCED);
    });

    it('stores handoff metadata on successful creation', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue } = require('../../src/lib/github');

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: mockIssue,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      createIssue.mockResolvedValue({
        number: 456,
        html_url: 'https://github.com/owner/repo/issues/456',
      });

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      // Verify handoff_at timestamp was set
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        mockIssue.id,
        expect.objectContaining({
          handoff_at: '2024-01-01T12:00:00.000Z',
        })
      );

      // Verify github_repo was set
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        mockIssue.id,
        expect.objectContaining({
          github_repo: expect.stringMatching(/^[^/]+\/[^/]+$/), // owner/repo format
        })
      );

      // Verify github_issue_last_sync_at was set
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        mockIssue.id,
        expect.objectContaining({
          github_issue_last_sync_at: '2024-01-01T12:00:00.000Z',
        })
      );
    });
  });

  describe('Repeated handoff (UPDATE - Idempotency)', () => {
    it('updates existing GitHub issue when github_issue_number exists', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue, updateIssue } = require('../../src/lib/github');

      const issueWithGitHubNumber = {
        ...mockIssue,
        github_issue_number: 123,
        github_url: 'https://github.com/owner/repo/issues/123',
        handoff_state: Afu9HandoffState.SYNCED,
        handoff_at: '2024-01-01T10:00:00Z',
        github_repo: 'owner/repo',
      };

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: issueWithGitHubNumber,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: { ...issueWithGitHubNumber, handoff_state: Afu9HandoffState.SYNCHRONIZED },
      });

      updateIssue.mockResolvedValue({
        number: 123,
        html_url: 'https://github.com/owner/repo/issues/123',
      });

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      
      // Should update, not create
      expect(createIssue).not.toHaveBeenCalled();
      expect(updateIssue).toHaveBeenCalledTimes(1);
      expect(updateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          number: 123,
          title: 'Test Issue',
          body: expect.stringContaining('AFU9-ISSUE:123e4567-e89b-12d3-a456-426614174000'),
          labels: expect.arrayContaining(['bug', 'enhancement', 'priority:P1']),
        })
      );

      // Should set state to PENDING first, then SYNCHRONIZED
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        mockIssue.id,
        expect.objectContaining({
          handoff_state: Afu9HandoffState.PENDING,
        })
      );

      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        mockIssue.id,
        expect.objectContaining({
          handoff_state: Afu9HandoffState.SYNCHRONIZED,
          github_issue_last_sync_at: expect.any(String),
        })
      );

      expect(body.message).toContain('synchronized with GitHub successfully');
      expect(body.handoff_state).toBe(Afu9HandoffState.SYNCHRONIZED);
    });

    it('returns success immediately if already SYNCHRONIZED', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue, updateIssue } = require('../../src/lib/github');

      const alreadySynchronized = {
        ...mockIssue,
        github_issue_number: 123,
        github_url: 'https://github.com/owner/repo/issues/123',
        handoff_state: Afu9HandoffState.SYNCHRONIZED,
        github_repo: 'owner/repo',
      };

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: alreadySynchronized,
      });

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      
      // Should not call GitHub API or update database
      expect(createIssue).not.toHaveBeenCalled();
      expect(updateIssue).not.toHaveBeenCalled();
      expect(updateAfu9Issue).not.toHaveBeenCalled();

      expect(body.message).toContain('already synchronized');
    });

    it('allows re-sync of SYNCED issue (UPDATE path)', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue, updateIssue } = require('../../src/lib/github');

      const alreadySynced = {
        ...mockIssue,
        github_issue_number: 123,
        github_url: 'https://github.com/owner/repo/issues/123',
        handoff_state: Afu9HandoffState.SYNCED,
        github_repo: 'owner/repo',
      };

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: alreadySynced,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: { ...alreadySynced, handoff_state: Afu9HandoffState.SYNCHRONIZED },
      });

      updateIssue.mockResolvedValue({
        number: 123,
        html_url: 'https://github.com/owner/repo/issues/123',
      });

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      
      // Should allow re-sync: call UPDATE not CREATE
      expect(createIssue).not.toHaveBeenCalled();
      expect(updateIssue).toHaveBeenCalledTimes(1);

      expect(body.message).toContain('synchronized with GitHub successfully');
      expect(body.handoff_state).toBe(Afu9HandoffState.SYNCHRONIZED);
    });
  });

  describe('Error handling and recovery', () => {
    it('stores handoff_error on GitHub API failure during create', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue } = require('../../src/lib/github');

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: mockIssue,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      createIssue.mockRejectedValue(new Error('GitHub API rate limit exceeded'));

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      
      // Should update state to FAILED with error message
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        mockIssue.id,
        expect.objectContaining({
          handoff_state: Afu9HandoffState.FAILED,
          handoff_error: 'GitHub API rate limit exceeded',
        })
      );

      expect(body.error).toContain('Failed to create GitHub issue');
      expect(body.handoff_state).toBe(Afu9HandoffState.FAILED);
    });

    it('stores handoff_error on GitHub API failure during update', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { updateIssue } = require('../../src/lib/github');

      const issueWithGitHubNumber = {
        ...mockIssue,
        github_issue_number: 123,
        github_url: 'https://github.com/owner/repo/issues/123',
        handoff_state: Afu9HandoffState.SYNCED,
      };

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: issueWithGitHubNumber,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: issueWithGitHubNumber,
      });

      updateIssue.mockRejectedValue(new Error('GitHub issue not found'));

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      
      // Should update state to FAILED with error message
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        mockIssue.id,
        expect.objectContaining({
          handoff_state: Afu9HandoffState.FAILED,
          handoff_error: 'GitHub issue not found',
        })
      );

      expect(body.error).toContain('Failed to update GitHub issue');
      expect(body.handoff_state).toBe(Afu9HandoffState.FAILED);
    });

    it('can retry after FAILED state', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue } = require('../../src/lib/github');

      const failedIssue = {
        ...mockIssue,
        handoff_state: Afu9HandoffState.FAILED,
        handoff_error: 'Previous error',
      };

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: failedIssue,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: { ...failedIssue, handoff_state: Afu9HandoffState.SYNCED },
      });

      createIssue.mockResolvedValue({
        number: 789,
        html_url: 'https://github.com/owner/repo/issues/789',
      });

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      expect(response.status).toBe(200);
      
      // Should clear the error when setting PENDING
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        mockIssue.id,
        expect.objectContaining({
          handoff_state: Afu9HandoffState.PENDING,
          handoff_error: null,
        })
      );

      // Should complete successfully
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        mockIssue.id,
        expect.objectContaining({
          handoff_state: Afu9HandoffState.SYNCED,
          handoff_error: null,
        })
      );

      expect(createIssue).toHaveBeenCalledTimes(1);
    });
  });

  describe('State transitions', () => {
    it('transitions NOT_SENT -> PENDING -> SYNCED on first handoff', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue } = require('../../src/lib/github');

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: mockIssue,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      createIssue.mockResolvedValue({
        number: 999,
        html_url: 'https://github.com/owner/repo/issues/999',
      });

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      const calls = updateAfu9Issue.mock.calls;
      expect(calls[0][2]).toMatchObject({ handoff_state: Afu9HandoffState.PENDING });
      expect(calls[1][2]).toMatchObject({ handoff_state: Afu9HandoffState.SYNCED });
    });

    it('transitions SYNCED -> PENDING -> SYNCHRONIZED on repeated handoff', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { updateIssue } = require('../../src/lib/github');

      const syncedIssue = {
        ...mockIssue,
        github_issue_number: 123,
        handoff_state: Afu9HandoffState.SYNCED,
      };

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: syncedIssue,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: syncedIssue,
      });

      updateIssue.mockResolvedValue({
        number: 123,
        html_url: 'https://github.com/owner/repo/issues/123',
      });

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      const calls = updateAfu9Issue.mock.calls;
      expect(calls[0][2]).toMatchObject({ handoff_state: Afu9HandoffState.PENDING });
      expect(calls[1][2]).toMatchObject({ handoff_state: Afu9HandoffState.SYNCHRONIZED });
    });
  });

  describe('Metadata persistence', () => {
    it('updates github_issue_last_sync_at on each successful sync', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { updateIssue } = require('../../src/lib/github');

      const syncedIssue = {
        ...mockIssue,
        github_issue_number: 123,
        handoff_state: Afu9HandoffState.SYNCED,
        github_issue_last_sync_at: '2024-01-01T10:00:00Z',
      };

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: syncedIssue,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: syncedIssue,
      });

      updateIssue.mockResolvedValue({
        number: 123,
        html_url: 'https://github.com/owner/repo/issues/123',
      });

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      // Verify that github_issue_last_sync_at was updated to current time
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        mockIssue.id,
        expect.objectContaining({
          github_issue_last_sync_at: '2024-01-01T12:00:00.000Z', // Current mocked time
        })
      );
    });
  });
});
