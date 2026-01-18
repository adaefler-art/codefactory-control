/**
 * Tests for ensureIssueForCommittedDraft function
 * 
 * AFU9-I-P1.4: Create canonical AFU-9 Issue on committed IssueDraft
 */

import { Pool } from 'pg';
import {
  ensureIssueForCommittedDraft,
  getAfu9IssueByCanonicalId,
} from '../../src/lib/db/afu9Issues';
import { getIssueTimelineEventsByType } from '../../src/lib/db/issueTimeline';
import { IssueTimelineEventType } from '../../src/lib/contracts/issueTimeline';
import { Afu9IssueStatus } from '../../src/lib/contracts/afu9Issue';

// Mock pool for testing
const mockPool = {
  connect: jest.fn(),
  query: jest.fn(),
} as unknown as Pool;

describe('ensureIssueForCommittedDraft', () => {
  let mockClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);
  });

  describe('idempotent creation', () => {
    it('should create a new AFU-9 Issue when none exists', async () => {
      const canonicalId = 'TEST-001';
      const sessionId = 'session-123';
      const draftVersionId = 'draft-456';
      
      // Mock: No existing issue
      mockClient.query
        .mockResolvedValueOnce({ command: 'BEGIN' }) // BEGIN transaction
        .mockResolvedValueOnce({ rows: [] }) // Check for existing issue - not found
        .mockResolvedValueOnce({ // Insert new issue
          rows: [{
            id: 'issue-uuid-123',
            title: 'Test Issue',
            body: 'Test body',
            status: Afu9IssueStatus.CREATED,
            labels: [],
            priority: 'P1',
            assignee: null,
            source: 'afu9',
            handoff_state: 'NOT_SENT',
            github_issue_number: null,
            github_url: null,
            last_error: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            activated_at: null,
            activated_by: null,
            execution_state: 'IDLE',
            execution_started_at: null,
            execution_completed_at: null,
            execution_output: null,
            deleted_at: null,
            handoff_at: null,
            handoff_error: null,
            github_repo: null,
            github_issue_last_sync_at: null,
            github_status_raw: null,
            github_status_updated_at: null,
            status_source: null,
            github_mirror_status: 'UNKNOWN',
            github_sync_error: null,
            source_session_id: sessionId,
            current_draft_id: draftVersionId,
            active_cr_id: null,
            github_synced_at: null,
            kpi_context: null,
            publish_batch_id: null,
            publish_request_id: null,
            canonical_id: canonicalId,
          }],
        })
        .mockResolvedValueOnce({ command: 'INSERT' }) // Insert timeline event
        .mockResolvedValueOnce({ command: 'COMMIT' }); // COMMIT transaction

      const result = await ensureIssueForCommittedDraft(
        mockPool,
        {
          title: 'Test Issue',
          body: 'Test body',
          canonical_id: canonicalId,
          priority: 'P1',
        },
        sessionId,
        draftVersionId
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.issue.canonical_id).toBe(canonicalId);
      expect(result.data?.isNew).toBe(true);
      
      // Verify timeline event was created
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO issue_timeline'),
        expect.arrayContaining([
          'issue-uuid-123',
          'ISSUE_CREATED',
          expect.any(String),
          'system',
          'system',
        ])
      );
    });

    it('should return existing AFU-9 Issue when one already exists', async () => {
      const canonicalId = 'TEST-002';
      const sessionId = 'session-123';
      const existingIssue = {
        id: 'existing-issue-uuid',
        title: 'Existing Issue',
        canonical_id: canonicalId,
        status: Afu9IssueStatus.CREATED,
        source_session_id: 'old-session',
        current_draft_id: 'old-draft',
      };
      
      // Mock: Existing issue found
      mockClient.query
        .mockResolvedValueOnce({ command: 'BEGIN' }) // BEGIN transaction
        .mockResolvedValueOnce({ rows: [existingIssue] }) // Check for existing issue - found
        .mockResolvedValueOnce({ command: 'UPDATE' }) // Update pointers
        .mockResolvedValueOnce({ command: 'COMMIT' }); // COMMIT transaction

      const result = await ensureIssueForCommittedDraft(
        mockPool,
        {
          title: 'Test Issue',
          body: 'Test body',
          canonical_id: canonicalId,
        },
        sessionId,
        'new-draft-id'
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.issue.id).toBe('existing-issue-uuid');
      expect(result.data?.isNew).toBe(false);
      
      // Verify no timeline event was created (already exists)
      expect(mockClient.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO issue_timeline'),
        expect.any(Array)
      );
    });

    it('should fail when canonical_id is missing', async () => {
      const result = await ensureIssueForCommittedDraft(
        mockPool,
        {
          title: 'Test Issue',
          body: 'Test body',
        },
        'session-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('canonical_id is required');
    });

    it('should handle unique constraint violation with retry', async () => {
      const canonicalId = 'TEST-003';
      const sessionId = 'session-123';
      
      // Simulate race condition: INSERT fails with unique constraint violation
      const constraintError = new Error('duplicate key value violates unique constraint');
      (constraintError as any).code = '23505';
      (constraintError as any).constraint = 'idx_afu9_issues_canonical_id_unique';
      
      const existingIssue = {
        id: 'race-winner-uuid',
        title: 'Race Winner Issue',
        canonical_id: canonicalId,
        status: Afu9IssueStatus.CREATED,
      };
      
      // Mock: No existing issue initially, then INSERT fails, then retry succeeds
      mockClient.query
        .mockResolvedValueOnce({ command: 'BEGIN' }) // BEGIN transaction
        .mockResolvedValueOnce({ rows: [] }) // Check for existing issue - not found
        .mockRejectedValueOnce(constraintError); // Insert fails with constraint violation
      
      // Mock retry query (uses pool, not client)
      (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [existingIssue] });

      const result = await ensureIssueForCommittedDraft(
        mockPool,
        {
          title: 'Test Issue',
          body: 'Test body',
          canonical_id: canonicalId,
        },
        sessionId
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.issue.id).toBe('race-winner-uuid');
      expect(result.data?.isNew).toBe(false);
    });
  });

  describe('field mapping', () => {
    it('should correctly map IssueDraft fields to AFU-9 Issue', async () => {
      const canonicalId = 'TEST-004';
      const sessionId = 'session-123';
      const draftVersionId = 'draft-456';
      
      mockClient.query
        .mockResolvedValueOnce({ command: 'BEGIN' })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'issue-uuid-123',
            title: 'Mapped Issue',
            body: 'Mapped body',
            status: Afu9IssueStatus.CREATED,
            labels: ['label1', 'label2'],
            priority: 'P0',
            canonical_id: canonicalId,
            kpi_context: { dcu: 1, intent: 'test-intent' },
          }],
        })
        .mockResolvedValueOnce({ command: 'INSERT' })
        .mockResolvedValueOnce({ command: 'COMMIT' });

      const result = await ensureIssueForCommittedDraft(
        mockPool,
        {
          title: 'Mapped Issue',
          body: 'Mapped body',
          canonical_id: canonicalId,
          labels: ['label1', 'label2'],
          priority: 'P0',
          kpi_context: { dcu: 1, intent: 'test-intent' },
        },
        sessionId,
        draftVersionId
      );

      expect(result.success).toBe(true);
      expect(result.data?.issue.labels).toEqual(['label1', 'label2']);
      expect(result.data?.issue.priority).toBe('P0');
      expect(result.data?.issue.kpi_context).toEqual({ dcu: 1, intent: 'test-intent' });
    });
  });
});
