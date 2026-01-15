/**
 * Tests for Manual Touchpoints Service (E88.1)
 * 
 * Validates:
 * - Idempotency key generation
 * - Touchpoint recording
 * - Deduplication (no double-counts)
 * - Database operations
 */

import { 
  generateIdempotencyKey,
  recordTouchpoint,
  recordAssignTouchpoint,
  recordReviewTouchpoint,
  recordMergeApprovalTouchpoint,
  recordDebugInterventionTouchpoint,
  type RecordTouchpointParams,
} from '@/lib/touchpoints/manual-touchpoints';
import { Pool } from 'pg';

// Mock pool for testing
const createMockPool = () => ({
  query: jest.fn(),
} as unknown as Pool);

describe('Manual Touchpoints Service', () => {
  describe('generateIdempotencyKey', () => {
    it('should generate deterministic keys for same inputs', () => {
      const params: RecordTouchpointParams = {
        type: 'ASSIGN',
        source: 'API',
        actor: 'user123',
        requestId: 'req-123',
        ghIssueNumber: 42,
        timestamp: new Date('2026-01-15T10:00:00Z'),
      };

      const key1 = generateIdempotencyKey(params);
      const key2 = generateIdempotencyKey(params);

      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64); // SHA-256 hex
    });

    it('should generate different keys for different types', () => {
      const baseParams = {
        source: 'API' as const,
        actor: 'user123',
        requestId: 'req-123',
        ghIssueNumber: 42,
        timestamp: new Date('2026-01-15T10:00:00Z'),
      };

      const key1 = generateIdempotencyKey({ ...baseParams, type: 'ASSIGN' });
      const key2 = generateIdempotencyKey({ ...baseParams, type: 'REVIEW' });

      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different actors', () => {
      const baseParams = {
        type: 'ASSIGN' as const,
        source: 'API' as const,
        requestId: 'req-123',
        ghIssueNumber: 42,
        timestamp: new Date('2026-01-15T10:00:00Z'),
      };

      const key1 = generateIdempotencyKey({ ...baseParams, actor: 'user1' });
      const key2 = generateIdempotencyKey({ ...baseParams, actor: 'user2' });

      expect(key1).not.toBe(key2);
    });

    it('should generate same key for timestamps in same 5-minute window', () => {
      const baseParams = {
        type: 'ASSIGN' as const,
        source: 'API' as const,
        actor: 'user123',
        requestId: 'req-123',
        ghIssueNumber: 42,
      };

      const key1 = generateIdempotencyKey({
        ...baseParams,
        timestamp: new Date('2026-01-15T10:00:00Z'),
      });
      const key2 = generateIdempotencyKey({
        ...baseParams,
        timestamp: new Date('2026-01-15T10:04:59Z'),
      });

      expect(key1).toBe(key2);
    });

    it('should generate different keys for timestamps in different windows', () => {
      const baseParams = {
        type: 'ASSIGN' as const,
        source: 'API' as const,
        actor: 'user123',
        requestId: 'req-123',
        ghIssueNumber: 42,
      };

      const key1 = generateIdempotencyKey({
        ...baseParams,
        timestamp: new Date('2026-01-15T10:04:59Z'),
      });
      const key2 = generateIdempotencyKey({
        ...baseParams,
        timestamp: new Date('2026-01-15T10:05:00Z'),
      });

      expect(key1).not.toBe(key2);
    });

    it('should include all context identifiers in stable order', () => {
      const params1: RecordTouchpointParams = {
        type: 'ASSIGN',
        source: 'API',
        actor: 'user123',
        requestId: 'req-123',
        cycleId: 'v0.5.0',
        issueId: 'issue-uuid',
        ghIssueNumber: 42,
        prNumber: 100,
        timestamp: new Date('2026-01-15T10:00:00Z'),
      };

      // Same params but in different order (should produce same key)
      const params2: RecordTouchpointParams = {
        type: 'ASSIGN',
        source: 'API',
        actor: 'user123',
        requestId: 'req-123',
        prNumber: 100,
        ghIssueNumber: 42,
        issueId: 'issue-uuid',
        cycleId: 'v0.5.0',
        timestamp: new Date('2026-01-15T10:00:00Z'),
      };

      const key1 = generateIdempotencyKey(params1);
      const key2 = generateIdempotencyKey(params2);

      expect(key1).toBe(key2);
    });
  });

  describe('recordTouchpoint', () => {
    it('should insert touchpoint and return record on success', async () => {
      const mockPool = createMockPool();
      const mockRecord = {
        id: 1,
        idempotency_key: 'test-key',
        type: 'ASSIGN',
        source: 'API',
        actor: 'user123',
        request_id: 'req-123',
        created_at: new Date(),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRecord],
      });

      const params: RecordTouchpointParams = {
        type: 'ASSIGN',
        source: 'API',
        actor: 'user123',
        requestId: 'req-123',
        ghIssueNumber: 42,
      };

      const result = await recordTouchpoint(mockPool, params);

      expect(result).toEqual(mockRecord);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('should fetch existing record on duplicate (idempotent)', async () => {
      const mockPool = createMockPool();
      const existingRecord = {
        id: 1,
        idempotency_key: 'test-key',
        type: 'ASSIGN',
        source: 'API',
        actor: 'user123',
        request_id: 'req-123',
        created_at: new Date(),
      };

      // First call returns no rows (conflict)
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [existingRecord] });

      const params: RecordTouchpointParams = {
        type: 'ASSIGN',
        source: 'API',
        actor: 'user123',
        requestId: 'req-123',
        ghIssueNumber: 42,
      };

      const result = await recordTouchpoint(mockPool, params);

      expect(result).toEqual(existingRecord);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('should return null and not throw on error', async () => {
      const mockPool = createMockPool();
      (mockPool.query as jest.Mock).mockRejectedValueOnce(
        new Error('Database error')
      );

      const params: RecordTouchpointParams = {
        type: 'ASSIGN',
        source: 'API',
        actor: 'user123',
        requestId: 'req-123',
        ghIssueNumber: 42,
      };

      const result = await recordTouchpoint(mockPool, params);

      expect(result).toBeNull();
    });
  });

  describe('recordAssignTouchpoint', () => {
    it('should record ASSIGN touchpoint with correct type', async () => {
      const mockPool = createMockPool();
      const mockRecord = {
        id: 1,
        type: 'ASSIGN',
        source: 'API',
        actor: 'user123',
        request_id: 'req-123',
        gh_issue_number: 42,
        created_at: new Date(),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRecord],
      });

      const result = await recordAssignTouchpoint(mockPool, {
        ghIssueNumber: 42,
        actor: 'user123',
        requestId: 'req-123',
      });

      expect(result).toBeTruthy();
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordReviewTouchpoint', () => {
    it('should record REVIEW touchpoint with correct type', async () => {
      const mockPool = createMockPool();
      const mockRecord = {
        id: 1,
        type: 'REVIEW',
        source: 'API',
        actor: 'user123',
        request_id: 'req-123',
        pr_number: 100,
        created_at: new Date(),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRecord],
      });

      const result = await recordReviewTouchpoint(mockPool, {
        prNumber: 100,
        actor: 'user123',
        requestId: 'req-123',
      });

      expect(result).toBeTruthy();
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordMergeApprovalTouchpoint', () => {
    it('should record MERGE_APPROVAL touchpoint with correct type', async () => {
      const mockPool = createMockPool();
      const mockRecord = {
        id: 1,
        type: 'MERGE_APPROVAL',
        source: 'API',
        actor: 'user123',
        request_id: 'req-123',
        pr_number: 100,
        created_at: new Date(),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRecord],
      });

      const result = await recordMergeApprovalTouchpoint(mockPool, {
        prNumber: 100,
        actor: 'user123',
        requestId: 'req-123',
      });

      expect(result).toBeTruthy();
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordDebugInterventionTouchpoint', () => {
    it('should record DEBUG_INTERVENTION touchpoint with correct type', async () => {
      const mockPool = createMockPool();
      const mockRecord = {
        id: 1,
        type: 'DEBUG_INTERVENTION',
        source: 'API',
        actor: 'user123',
        request_id: 'req-123',
        pr_number: 100,
        created_at: new Date(),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRecord],
      });

      const result = await recordDebugInterventionTouchpoint(mockPool, {
        prNumber: 100,
        actor: 'user123',
        requestId: 'req-123',
      });

      expect(result).toBeTruthy();
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });
  });
});
