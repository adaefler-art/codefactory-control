/**
 * Tests for Manual Touchpoints Database Operations (E88.1)
 * 
 * Validates:
 * - Insert operations with idempotency
 * - Query operations (by cycle, issue, PR)
 * - Aggregation statistics
 */

import {
  insertTouchpoint,
  getTouchpointsByCycle,
  getTouchpointsByIssue,
  getTouchpointsByGhIssue,
  getTouchpointsByPr,
  getRecentTouchpoints,
  getTouchpointStatsByCycle,
  getTouchpointStatsByIssue,
  getGlobalTouchpointStats,
  type InsertTouchpointParams,
} from '@/lib/db/manualTouchpoints';
import { Pool } from 'pg';

// Mock pool for testing
const createMockPool = () => ({
  query: jest.fn(),
} as unknown as Pool);

describe('Manual Touchpoints Database Operations', () => {
  describe('insertTouchpoint', () => {
    it('should insert new touchpoint successfully', async () => {
      const mockPool = createMockPool();
      const mockRecord = {
        id: 1,
        idempotency_key: 'test-key-123',
        cycle_id: 'v0.5.0',
        issue_id: 'issue-uuid',
        gh_issue_number: 42,
        pr_number: null,
        session_id: null,
        type: 'ASSIGN',
        source: 'API',
        actor: 'user123',
        request_id: 'req-123',
        metadata: {},
        created_at: new Date(),
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRecord],
      });

      const params: InsertTouchpointParams = {
        idempotencyKey: 'test-key-123',
        cycleId: 'v0.5.0',
        issueId: 'issue-uuid',
        ghIssueNumber: 42,
        type: 'ASSIGN',
        source: 'API',
        actor: 'user123',
        requestId: 'req-123',
        metadata: {},
      };

      const result = await insertTouchpoint(mockPool, params);

      expect(result).toEqual(mockRecord);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO manual_touchpoints'),
        expect.arrayContaining(['test-key-123', 'v0.5.0', 'issue-uuid'])
      );
    });

    it('should return existing record on duplicate key (idempotent)', async () => {
      const mockPool = createMockPool();
      const existingRecord = {
        id: 1,
        idempotency_key: 'test-key-123',
        type: 'ASSIGN',
        source: 'API',
        actor: 'user123',
        created_at: new Date(),
      };

      // First call returns no rows (conflict)
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [existingRecord] });

      const params: InsertTouchpointParams = {
        idempotencyKey: 'test-key-123',
        type: 'ASSIGN',
        source: 'API',
        actor: 'user123',
        requestId: 'req-123',
      };

      const result = await insertTouchpoint(mockPool, params);

      expect(result).toEqual(existingRecord);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      // First call: INSERT ... ON CONFLICT DO NOTHING
      // Second call: SELECT ... WHERE idempotency_key = ...
    });
  });

  describe('getTouchpointsByCycle', () => {
    it('should query touchpoints by cycle ID', async () => {
      const mockPool = createMockPool();
      const mockRecords = [
        {
          id: 1,
          cycle_id: 'v0.5.0',
          type: 'ASSIGN',
          actor: 'user1',
          created_at: new Date(),
        },
        {
          id: 2,
          cycle_id: 'v0.5.0',
          type: 'REVIEW',
          actor: 'user2',
          created_at: new Date(),
        },
      ];

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: mockRecords,
      });

      const result = await getTouchpointsByCycle(mockPool, 'v0.5.0', 100);

      expect(result).toEqual(mockRecords);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE cycle_id = $1'),
        ['v0.5.0', 100]
      );
    });
  });

  describe('getTouchpointsByIssue', () => {
    it('should query touchpoints by issue ID', async () => {
      const mockPool = createMockPool();
      const mockRecords = [
        {
          id: 1,
          issue_id: 'issue-uuid',
          type: 'ASSIGN',
          created_at: new Date(),
        },
      ];

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: mockRecords,
      });

      const result = await getTouchpointsByIssue(mockPool, 'issue-uuid', 100);

      expect(result).toEqual(mockRecords);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE issue_id = $1'),
        ['issue-uuid', 100]
      );
    });
  });

  describe('getTouchpointsByGhIssue', () => {
    it('should query touchpoints by GitHub issue number', async () => {
      const mockPool = createMockPool();
      const mockRecords = [
        {
          id: 1,
          gh_issue_number: 42,
          type: 'ASSIGN',
          created_at: new Date(),
        },
      ];

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: mockRecords,
      });

      const result = await getTouchpointsByGhIssue(mockPool, 42, 100);

      expect(result).toEqual(mockRecords);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE gh_issue_number = $1'),
        [42, 100]
      );
    });
  });

  describe('getTouchpointsByPr', () => {
    it('should query touchpoints by PR number', async () => {
      const mockPool = createMockPool();
      const mockRecords = [
        {
          id: 1,
          pr_number: 100,
          type: 'REVIEW',
          created_at: new Date(),
        },
      ];

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: mockRecords,
      });

      const result = await getTouchpointsByPr(mockPool, 100, 100);

      expect(result).toEqual(mockRecords);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE pr_number = $1'),
        [100, 100]
      );
    });
  });

  describe('getRecentTouchpoints', () => {
    it('should query recent touchpoints', async () => {
      const mockPool = createMockPool();
      const mockRecords = [
        {
          id: 2,
          type: 'REVIEW',
          created_at: new Date('2026-01-15T10:05:00Z'),
        },
        {
          id: 1,
          type: 'ASSIGN',
          created_at: new Date('2026-01-15T10:00:00Z'),
        },
      ];

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: mockRecords,
      });

      const result = await getRecentTouchpoints(mockPool, 100);

      expect(result).toEqual(mockRecords);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        [100]
      );
    });
  });

  describe('getTouchpointStatsByCycle', () => {
    it('should aggregate touchpoint statistics by cycle', async () => {
      const mockPool = createMockPool();
      const mockRow = {
        total: '5',
        assign_count: '1',
        review_count: '2',
        merge_approval_count: '1',
        debug_intervention_count: '1',
        ui_count: '0',
        intent_count: '0',
        gh_count: '0',
        api_count: '5',
        unique_actors: '3',
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
      });

      const result = await getTouchpointStatsByCycle(mockPool, 'v0.5.0');

      expect(result).toEqual({
        total: 5,
        byType: {
          ASSIGN: 1,
          REVIEW: 2,
          MERGE_APPROVAL: 1,
          DEBUG_INTERVENTION: 1,
        },
        bySource: {
          UI: 0,
          INTENT: 0,
          GH: 0,
          API: 5,
        },
        uniqueActors: 3,
      });
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE cycle_id = $1'),
        ['v0.5.0']
      );
    });
  });

  describe('getTouchpointStatsByIssue', () => {
    it('should aggregate touchpoint statistics by issue', async () => {
      const mockPool = createMockPool();
      const mockRow = {
        total: '3',
        assign_count: '1',
        review_count: '1',
        merge_approval_count: '1',
        debug_intervention_count: '0',
        ui_count: '0',
        intent_count: '0',
        gh_count: '0',
        api_count: '3',
        unique_actors: '2',
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
      });

      const result = await getTouchpointStatsByIssue(mockPool, 'issue-uuid');

      expect(result).toEqual({
        total: 3,
        byType: {
          ASSIGN: 1,
          REVIEW: 1,
          MERGE_APPROVAL: 1,
          DEBUG_INTERVENTION: 0,
        },
        bySource: {
          UI: 0,
          INTENT: 0,
          GH: 0,
          API: 3,
        },
        uniqueActors: 2,
      });
    });
  });

  describe('getGlobalTouchpointStats', () => {
    it('should aggregate global touchpoint statistics', async () => {
      const mockPool = createMockPool();
      const mockRow = {
        total: '10',
        assign_count: '2',
        review_count: '4',
        merge_approval_count: '2',
        debug_intervention_count: '2',
        ui_count: '1',
        intent_count: '0',
        gh_count: '1',
        api_count: '8',
        unique_actors: '5',
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
      });

      const result = await getGlobalTouchpointStats(mockPool);

      expect(result).toEqual({
        total: 10,
        byType: {
          ASSIGN: 2,
          REVIEW: 4,
          MERGE_APPROVAL: 2,
          DEBUG_INTERVENTION: 2,
        },
        bySource: {
          UI: 1,
          INTENT: 0,
          GH: 1,
          API: 8,
        },
        uniqueActors: 5,
      });
    });

    it('should filter by time period when hours specified', async () => {
      const mockPool = createMockPool();
      const mockRow = {
        total: '5',
        assign_count: '1',
        review_count: '2',
        merge_approval_count: '1',
        debug_intervention_count: '1',
        ui_count: '0',
        intent_count: '0',
        gh_count: '0',
        api_count: '5',
        unique_actors: '3',
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockRow],
      });

      const result = await getGlobalTouchpointStats(mockPool, 24);

      expect(result.total).toBe(5);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE created_at >= NOW() - INTERVAL '24 hours'")
      );
    });
  });
});
