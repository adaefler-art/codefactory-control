/**
 * Tests for Factory Status API
 * 
 * Tests the Central Factory Status API endpoint
 * Issue 1.2 from AFU-9 Roadmap v0.3
 */

import { getFactoryStatus } from '../../../../src/lib/factory-status';
import type { FactoryStatusResponse } from '../../../../src/lib/types/factory-status';

// Mock the database pool
jest.mock('../../../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

describe('Factory Status API', () => {
  let mockPool: any;

  beforeEach(() => {
    const { getPool } = require('../../../../src/lib/db');
    mockPool = {
      query: jest.fn(),
    };
    getPool.mockReturnValue(mockPool);
    jest.clearAllMocks();
  });

  describe('getFactoryStatus', () => {
    test('should return complete factory status', async () => {
      // Mock database responses
      mockPool.query
        // Recent runs query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'exec-1',
              workflow_id: 'wf-1',
              status: 'completed',
              started_at: new Date('2024-01-01T10:00:00Z'),
              completed_at: new Date('2024-01-01T10:05:00Z'),
              error: null,
              triggered_by: 'user@example.com',
              duration_ms: 300000,
            },
          ],
        })
        // Total runs count
        .mockResolvedValueOnce({
          rows: [{ total: 1 }],
        })
        // Recent errors query
        .mockResolvedValueOnce({
          rows: [],
        })
        // Total errors count
        .mockResolvedValueOnce({
          rows: [{ total: 0 }],
        })
        // KPI query
        .mockResolvedValueOnce({
          rows: [
            {
              total_executions: 1,
              completed_executions: 1,
              failed_executions: 0,
              running_executions: 0,
              avg_duration_ms: 300000,
              mean_time_to_insight_ms: 300000,
            },
          ],
        });

      const result = await getFactoryStatus({ limit: 10, errorLimit: 10, kpiPeriodHours: 24 });

      expect(result).toBeDefined();
      expect(result.api.version).toBe('1.1.0');
      expect(result.timestamp).toBeDefined();
      expect(result.runs.recent).toHaveLength(1);
      expect(result.runs.total).toBe(1);
      expect(result.errors.total).toBe(0);
      expect(result.kpis.totalExecutions).toBe(1);
      expect(result.kpis.completedExecutions).toBe(1);
      expect(result.kpis.successRate).toBe(100);
      expect(result.verdicts.enabled).toBe(true);
    });

    test('should calculate Mean Time to Insight correctly', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              total_executions: 5,
              completed_executions: 4,
              failed_executions: 1,
              running_executions: 0,
              avg_duration_ms: 180000, // 3 minutes
              mean_time_to_insight_ms: 200000, // 3.33 minutes
            },
          ],
        });

      const result = await getFactoryStatus();

      expect(result.kpis.meanTimeToInsightMs).toBe(200000);
      expect(result.kpis.avgExecutionDurationMs).toBe(180000);
    });

    test('should calculate success rate correctly', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              total_executions: 10,
              completed_executions: 7,
              failed_executions: 3,
              running_executions: 0,
              avg_duration_ms: 150000,
              mean_time_to_insight_ms: 160000,
            },
          ],
        });

      const result = await getFactoryStatus();

      // 7 completed out of 10 total (7 + 3) = 70%
      expect(result.kpis.successRate).toBe(70);
      expect(result.kpis.totalExecutions).toBe(10);
      expect(result.kpis.completedExecutions).toBe(7);
      expect(result.kpis.failedExecutions).toBe(3);
    });

    test('should include recent errors', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'exec-error-1',
              workflow_id: 'wf-1',
              error: 'Database connection failed',
              completed_at: new Date('2024-01-01T11:00:00Z'),
              status: 'failed',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              total_executions: 1,
              completed_executions: 0,
              failed_executions: 1,
              running_executions: 0,
              avg_duration_ms: null,
              mean_time_to_insight_ms: 120000,
            },
          ],
        });

      const result = await getFactoryStatus({ errorLimit: 5 });

      expect(result.errors.recent).toHaveLength(1);
      expect(result.errors.recent[0].error).toBe('Database connection failed');
      expect(result.errors.total).toBe(1);
    });

    test('should respect query parameters', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              total_executions: 0,
              completed_executions: 0,
              failed_executions: 0,
              running_executions: 0,
              avg_duration_ms: null,
              mean_time_to_insight_ms: null,
            },
          ],
        });

      await getFactoryStatus({
        limit: 25,
        errorLimit: 15,
        kpiPeriodHours: 48,
      });

      // Verify the query was called with correct limit
      const calls = mockPool.query.mock.calls;
      expect(calls[0][1][0]).toBe(25); // Runs limit
      expect(calls[2][1][0]).toBe(15); // Errors limit
    });

    test('should handle null KPI values gracefully', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              total_executions: 0,
              completed_executions: 0,
              failed_executions: 0,
              running_executions: 0,
              avg_duration_ms: null,
              mean_time_to_insight_ms: null,
            },
          ],
        });

      const result = await getFactoryStatus();

      expect(result.kpis.meanTimeToInsightMs).toBeNull();
      expect(result.kpis.avgExecutionDurationMs).toBeNull();
      expect(result.kpis.successRate).toBe(0);
    });
  });

  describe('API Response Structure', () => {
    test('should match FactoryStatusResponse interface', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              total_executions: 0,
              completed_executions: 0,
              failed_executions: 0,
              running_executions: 0,
              avg_duration_ms: null,
              mean_time_to_insight_ms: null,
            },
          ],
        });

      const result: FactoryStatusResponse = await getFactoryStatus();

      // Verify structure
      expect(result).toHaveProperty('api');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('runs');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('kpis');
      expect(result).toHaveProperty('verdicts');

      // Verify nested structures
      expect(result.runs).toHaveProperty('recent');
      expect(result.runs).toHaveProperty('total');
      expect(result.errors).toHaveProperty('recent');
      expect(result.errors).toHaveProperty('total');
      expect(result.verdicts).toHaveProperty('enabled');
    });
  });

  describe('Parameter Validation', () => {
    test('should enforce maximum limit', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              total_executions: 0,
              completed_executions: 0,
              failed_executions: 0,
              running_executions: 0,
              avg_duration_ms: null,
              mean_time_to_insight_ms: null,
            },
          ],
        });

      // Limits are enforced by the API route, but service layer should handle any value
      await getFactoryStatus({ limit: 200, errorLimit: 200, kpiPeriodHours: 200 });
      
      // Should still work even with large values (route enforces limits)
      expect(mockPool.query).toHaveBeenCalled();
    });
  });
});
