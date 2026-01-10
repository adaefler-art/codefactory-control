/**
 * Tests for INTENT Issue Set Publishing
 * Issue E82.3: Publish Audit Log + Backlinks (AFU9 Issue ↔ GitHub Issue)
 */

import { Pool } from 'pg';
import {
  createPublishBatch,
  createPublishItem,
  queryPublishBatches,
  queryPublishItems,
  queryPublishItemsByCanonicalId,
  generateBatchHash,
} from '../../src/lib/db/intentIssueSetPublishLedger';

// Mock the database pool
const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
} as unknown as Pool;

describe('INTENT Issue Set Publish Ledger Database Layer', () => {
  const issueSetId = 'set-123';
  const sessionId = 'session-456';
  const requestId = 'req-789';
  const lawbookVersion = 'v1.0.0';
  const sourceHash = 'abc123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateBatchHash', () => {
    it('should generate consistent hash for same inputs', () => {
      const hash1 = generateBatchHash(issueSetId, sourceHash, 'owner1', 'repo1');
      const hash2 = generateBatchHash(issueSetId, sourceHash, 'owner1', 'repo1');
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex length
    });

    it('should generate different hashes for different inputs', () => {
      const hash1 = generateBatchHash(issueSetId, sourceHash, 'owner1', 'repo1');
      const hash2 = generateBatchHash(issueSetId, 'different-hash', 'owner1', 'repo1');
      
      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hashes for different repos', () => {
      const hash1 = generateBatchHash(issueSetId, sourceHash, 'owner1', 'repo1');
      const hash2 = generateBatchHash(issueSetId, sourceHash, 'owner1', 'repo2');
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('createPublishBatch', () => {
    it('should create a new publish batch', async () => {
      const batchData = {
        id: 'batch-123',
        issue_set_id: issueSetId,
        session_id: sessionId,
        created_at: new Date(),
        request_id: requestId,
        lawbook_version: lawbookVersion,
        status: 'pending',
        started_at: null,
        completed_at: null,
        total_items: 5,
        created_count: 0,
        updated_count: 0,
        skipped_count: 0,
        failed_count: 0,
        error_message: null,
        error_details: null,
        batch_hash: generateBatchHash(issueSetId, sourceHash, 'adaefler-art', 'codefactory-control'),
      };

      mockQuery.mockResolvedValueOnce({
        rows: [batchData],
      });

      const result = await createPublishBatch(mockPool, {
        issue_set_id: issueSetId,
        session_id: sessionId,
        request_id: requestId,
        lawbook_version: lawbookVersion,
        total_items: 5,
        source_hash: sourceHash,
        owner: 'adaefler-art',
        repo: 'codefactory-control',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('batch-123');
        expect(result.data.status).toBe('pending');
        expect(result.data.total_items).toBe(5);
      }
    });

    it('should handle database errors gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const result = await createPublishBatch(mockPool, {
        issue_set_id: issueSetId,
        session_id: sessionId,
        request_id: requestId,
        lawbook_version: lawbookVersion,
        total_items: 5,
        source_hash: sourceHash,
        owner: 'adaefler-art',
        repo: 'codefactory-control',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Database error');
      }
    });
  });

  describe('createPublishItem', () => {
    it('should create a publish item with success status', async () => {
      const itemData = {
        id: 'item-123',
        batch_id: 'batch-123',
        issue_set_item_id: 'item-set-123',
        created_at: new Date(),
        canonical_id: 'E82.1',
        issue_hash: 'hash123',
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/adaefler-art/codefactory-control/issues/42',
        action: 'created',
        status: 'success',
        error_message: null,
        error_details: null,
        lawbook_version: lawbookVersion,
        rendered_issue_hash: 'rendered123',
        labels_applied: ['afu9', 'epic-e82'],
        request_id: requestId,
      };

      mockQuery.mockResolvedValueOnce({
        rows: [itemData],
      });

      const result = await createPublishItem(mockPool, {
        batch_id: 'batch-123',
        issue_set_item_id: 'item-set-123',
        canonical_id: 'E82.1',
        issue_hash: 'hash123',
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/adaefler-art/codefactory-control/issues/42',
        action: 'created',
        status: 'success',
        lawbook_version: lawbookVersion,
        rendered_issue_hash: 'rendered123',
        labels_applied: ['afu9', 'epic-e82'],
        request_id: requestId,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.canonical_id).toBe('E82.1');
        expect(result.data.action).toBe('created');
        expect(result.data.status).toBe('success');
        expect(result.data.github_issue_number).toBe(42);
      }
    });

    it('should create a publish item with failed status', async () => {
      const itemData = {
        id: 'item-456',
        batch_id: 'batch-123',
        issue_set_item_id: 'item-set-456',
        created_at: new Date(),
        canonical_id: 'E82.2',
        issue_hash: 'hash456',
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        github_issue_number: null,
        github_issue_url: null,
        action: 'failed',
        status: 'failed',
        error_message: 'API rate limit exceeded',
        error_details: { code: 'rate_limit' },
        lawbook_version: lawbookVersion,
        rendered_issue_hash: null,
        labels_applied: null,
        request_id: requestId,
      };

      mockQuery.mockResolvedValueOnce({
        rows: [itemData],
      });

      const result = await createPublishItem(mockPool, {
        batch_id: 'batch-123',
        issue_set_item_id: 'item-set-456',
        canonical_id: 'E82.2',
        issue_hash: 'hash456',
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        action: 'failed',
        status: 'failed',
        error_message: 'API rate limit exceeded',
        error_details: { code: 'rate_limit' },
        lawbook_version: lawbookVersion,
        request_id: requestId,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.action).toBe('failed');
        expect(result.data.status).toBe('failed');
        expect(result.data.error_message).toBe('API rate limit exceeded');
      }
    });
  });

  describe('queryPublishBatches', () => {
    it('should query batches by issue set ID', async () => {
      const batches = [
        {
          id: 'batch-1',
          issue_set_id: issueSetId,
          session_id: sessionId,
          created_at: new Date('2024-01-02'),
          request_id: 'req-1',
          lawbook_version: lawbookVersion,
          status: 'completed',
          started_at: new Date('2024-01-02'),
          completed_at: new Date('2024-01-02'),
          total_items: 5,
          created_count: 3,
          updated_count: 2,
          skipped_count: 0,
          failed_count: 0,
          error_message: null,
          error_details: null,
          batch_hash: 'hash1',
        },
        {
          id: 'batch-2',
          issue_set_id: issueSetId,
          session_id: sessionId,
          created_at: new Date('2024-01-01'),
          request_id: 'req-2',
          lawbook_version: lawbookVersion,
          status: 'completed',
          started_at: new Date('2024-01-01'),
          completed_at: new Date('2024-01-01'),
          total_items: 5,
          created_count: 5,
          updated_count: 0,
          skipped_count: 0,
          failed_count: 0,
          error_message: null,
          error_details: null,
          batch_hash: 'hash2',
        },
      ];

      mockQuery.mockResolvedValueOnce({
        rows: batches,
      });

      const result = await queryPublishBatches(mockPool, issueSetId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        // Should be ordered by created_at DESC
        expect(result.data[0].id).toBe('batch-1');
        expect(result.data[1].id).toBe('batch-2');
      }
    });
  });

  describe('queryPublishItems', () => {
    it('should query items by batch ID', async () => {
      const items = [
        {
          id: 'item-1',
          batch_id: 'batch-123',
          issue_set_item_id: 'item-set-1',
          created_at: new Date(),
          canonical_id: 'E82.1',
          issue_hash: 'hash1',
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          github_issue_number: 41,
          github_issue_url: 'https://github.com/adaefler-art/codefactory-control/issues/41',
          action: 'created',
          status: 'success',
          error_message: null,
          error_details: null,
          lawbook_version: lawbookVersion,
          rendered_issue_hash: 'rendered1',
          labels_applied: ['afu9'],
          request_id: requestId,
        },
        {
          id: 'item-2',
          batch_id: 'batch-123',
          issue_set_item_id: 'item-set-2',
          created_at: new Date(),
          canonical_id: 'E82.2',
          issue_hash: 'hash2',
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          github_issue_number: 42,
          github_issue_url: 'https://github.com/adaefler-art/codefactory-control/issues/42',
          action: 'updated',
          status: 'success',
          error_message: null,
          error_details: null,
          lawbook_version: lawbookVersion,
          rendered_issue_hash: 'rendered2',
          labels_applied: ['afu9'],
          request_id: requestId,
        },
      ];

      mockQuery.mockResolvedValueOnce({
        rows: items,
      });

      const result = await queryPublishItems(mockPool, 'batch-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0].canonical_id).toBe('E82.1');
        expect(result.data[1].canonical_id).toBe('E82.2');
      }
    });
  });

  describe('queryPublishItemsByCanonicalId', () => {
    it('should query items by canonical ID', async () => {
      const items = [
        {
          id: 'item-1',
          batch_id: 'batch-1',
          issue_set_item_id: 'item-set-1',
          created_at: new Date('2024-01-02'),
          canonical_id: 'E82.1',
          issue_hash: 'hash1',
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          github_issue_number: 42,
          github_issue_url: 'https://github.com/adaefler-art/codefactory-control/issues/42',
          action: 'updated',
          status: 'success',
          error_message: null,
          error_details: null,
          lawbook_version: lawbookVersion,
          rendered_issue_hash: 'rendered1',
          labels_applied: ['afu9'],
          request_id: 'req-1',
        },
        {
          id: 'item-2',
          batch_id: 'batch-2',
          issue_set_item_id: 'item-set-2',
          created_at: new Date('2024-01-01'),
          canonical_id: 'E82.1',
          issue_hash: 'hash1',
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          github_issue_number: 42,
          github_issue_url: 'https://github.com/adaefler-art/codefactory-control/issues/42',
          action: 'created',
          status: 'success',
          error_message: null,
          error_details: null,
          lawbook_version: lawbookVersion,
          rendered_issue_hash: 'rendered1',
          labels_applied: ['afu9'],
          request_id: 'req-2',
        },
      ];

      mockQuery.mockResolvedValueOnce({
        rows: items,
      });

      const result = await queryPublishItemsByCanonicalId(mockPool, 'E82.1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        // Should be ordered by created_at DESC
        expect(result.data[0].created_at).toBe('2024-01-02T00:00:00.000Z');
        expect(result.data[0].action).toBe('updated');
        expect(result.data[1].created_at).toBe('2024-01-01T00:00:00.000Z');
        expect(result.data[1].action).toBe('created');
      }
    });
  });
});
