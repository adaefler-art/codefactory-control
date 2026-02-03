/**
 * Tests for E9.2-CONTROL-02: GitHub Handoff Mirror Metadata
 * 
 * Verifies that all mirror metadata fields are correctly returned in API responses:
 * - handoff_at / handoffAt
 * - handoff_error / handoffError
 * - github_repo / githubRepo
 * - github_issue_last_sync_at / githubLastSyncedAt
 * 
 * @jest-environment node
 */

import { normalizeIssueForApi } from '../../app/api/issues/_shared';

describe('E9.2-CONTROL-02: GitHub Handoff Mirror Metadata', () => {
  describe('normalizeIssueForApi', () => {
    it('includes all mirror metadata fields in camelCase', () => {
      const mockIssue = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Test Issue',
        body: 'Test body',
        status: 'SPEC_READY',
        labels: ['bug'],
        priority: 'P1',
        assignee: null,
        source: 'afu9',
        handoff_state: 'SYNCED',
        github_issue_number: 123,
        github_url: 'https://github.com/owner/repo/issues/123',
        last_error: null,
        created_at: '2024-01-01T10:00:00Z',
        updated_at: '2024-01-01T11:00:00Z',
        handoff_at: '2024-01-01T10:00:00Z',
        handoff_error: null,
        github_repo: 'owner/repo',
        github_issue_last_sync_at: '2024-01-01T11:00:00Z',
      };

      const normalized = normalizeIssueForApi(mockIssue);

      // Verify camelCase fields
      expect(normalized.handoffAt).toBe('2024-01-01T10:00:00.000Z');
      expect(normalized.handoffError).toBeNull();
      expect(normalized.githubRepo).toBe('owner/repo');
      expect(normalized.githubLastSyncedAt).toBe('2024-01-01T11:00:00.000Z');
    });

    it('includes all mirror metadata fields in snake_case for backward compatibility', () => {
      const mockIssue = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Test Issue',
        body: 'Test body',
        status: 'SPEC_READY',
        labels: ['bug'],
        priority: 'P1',
        assignee: null,
        source: 'afu9',
        handoff_state: 'SYNCED',
        github_issue_number: 123,
        github_url: 'https://github.com/owner/repo/issues/123',
        last_error: null,
        created_at: '2024-01-01T10:00:00Z',
        updated_at: '2024-01-01T11:00:00Z',
        handoff_at: '2024-01-01T10:00:00Z',
        handoff_error: null,
        github_repo: 'owner/repo',
        github_issue_last_sync_at: '2024-01-01T11:00:00Z',
      };

      const normalized = normalizeIssueForApi(mockIssue);

      // Verify snake_case fields
      expect(normalized.handoff_at).toBe('2024-01-01T10:00:00.000Z');
      expect(normalized.handoff_error).toBeNull();
      expect(normalized.github_repo).toBe('owner/repo');
      expect(normalized.github_last_synced_at).toBe('2024-01-01T11:00:00.000Z');
    });

    it('handles null/missing mirror metadata fields gracefully', () => {
      const mockIssue = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Test Issue',
        body: 'Test body',
        status: 'CREATED',
        labels: [],
        priority: null,
        assignee: null,
        source: 'afu9',
        handoff_state: 'NOT_SENT',
        github_issue_number: null,
        github_url: null,
        last_error: null,
        created_at: '2024-01-01T10:00:00Z',
        updated_at: '2024-01-01T10:00:00Z',
        // Mirror metadata fields are null/missing
        handoff_at: null,
        handoff_error: null,
        github_repo: null,
        github_issue_last_sync_at: null,
      };

      const normalized = normalizeIssueForApi(mockIssue);

      // Verify all fields are present but null
      expect(normalized.handoffAt).toBeNull();
      expect(normalized.handoffError).toBeNull();
      expect(normalized.githubRepo).toBeNull();
      expect(normalized.githubLastSyncedAt).toBeNull();

      // Verify snake_case versions
      expect(normalized.handoff_at).toBeNull();
      expect(normalized.handoff_error).toBeNull();
      expect(normalized.github_repo).toBeNull();
      expect(normalized.github_last_synced_at).toBeNull();
    });

    it('includes handoff_error when handoff fails', () => {
      const mockIssue = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Test Issue',
        body: 'Test body',
        status: 'SPEC_READY',
        labels: ['bug'],
        priority: 'P1',
        assignee: null,
        source: 'afu9',
        handoff_state: 'FAILED',
        github_issue_number: null,
        github_url: null,
        last_error: 'GitHub API rate limit exceeded',
        created_at: '2024-01-01T10:00:00Z',
        updated_at: '2024-01-01T11:00:00Z',
        handoff_at: '2024-01-01T10:00:00Z',
        handoff_error: 'GitHub API rate limit exceeded',
        github_repo: null,
        github_issue_last_sync_at: null,
      };

      const normalized = normalizeIssueForApi(mockIssue);

      // Verify error is included
      expect(normalized.handoffError).toBe('GitHub API rate limit exceeded');
      expect(normalized.handoff_error).toBe('GitHub API rate limit exceeded');
      expect(normalized.handoffState).toBe('FAILED');
    });

    it('normalizes timestamps to ISO 8601 format', () => {
      const mockIssue = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Test Issue',
        body: 'Test body',
        status: 'SYNCED',
        labels: [],
        priority: null,
        assignee: null,
        source: 'afu9',
        handoff_state: 'SYNCED',
        github_issue_number: 123,
        github_url: 'https://github.com/owner/repo/issues/123',
        last_error: null,
        created_at: '2024-01-01T10:00:00Z',
        updated_at: '2024-01-01T11:00:00Z',
        // Test that various timestamp formats are normalized
        handoff_at: new Date('2024-01-01T10:00:00Z'),
        handoff_error: null,
        github_repo: 'owner/repo',
        github_issue_last_sync_at: new Date('2024-01-01T11:00:00Z'),
      };

      const normalized = normalizeIssueForApi(mockIssue);

      // Verify timestamps are ISO strings
      expect(normalized.handoffAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(normalized.githubLastSyncedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
});
