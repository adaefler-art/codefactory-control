/**
 * Tests for KPI Service
 * 
 * Tests the KPI calculation, aggregation, and historization service
 * EPIC 3: KPI System & Telemetry
 */

import {
  getExtendedFactoryKPIs,
  calculateSteeringAccuracy,
  getKpiFreshness,
  getProductKPIs,
  createKpiSnapshot,
} from '../../src/lib/kpi-service';
import type { CreateKpiSnapshotRequest } from '../../src/lib/types/kpi';

// Mock the database pool
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

describe('KPI Service', () => {
  let mockPool: any;

  beforeEach(() => {
    const { getPool } = require('../../src/lib/db');
    mockPool = {
      query: jest.fn(),
    };
    getPool.mockReturnValue(mockPool);
    jest.clearAllMocks();
  });

  describe('getExtendedFactoryKPIs', () => {
    test('should return extended factory KPIs with steering accuracy', async () => {
      // Mock base KPIs query
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            total_executions: '50',
            completed_executions: '42',
            failed_executions: '8',
            running_executions: '2',
            avg_duration_ms: '275000',
            mean_time_to_insight_ms: '285000',
          }],
        })
        // Mock table check for steering accuracy
        .mockResolvedValueOnce({
          rows: [{ exists: true }],
        })
        // Mock steering accuracy calculation
        .mockResolvedValueOnce({
          rows: [{
            steering_accuracy_pct: '92.5',
            total_decisions: '80',
            accepted_decisions: '74',
            overridden_decisions: '4',
            escalated_decisions: '2',
          }],
        })
        // Mock KPI freshness
        .mockResolvedValueOnce({
          rows: [
            {
              kpi_name: 'mtti',
              freshness_seconds: '45',
              last_calculated_at: new Date(),
            },
            {
              kpi_name: 'success_rate',
              freshness_seconds: '30',
              last_calculated_at: new Date(),
            },
          ],
        });

      const result = await getExtendedFactoryKPIs(24);

      expect(result).toHaveProperty('meanTimeToInsightMs', 285000);
      expect(result).toHaveProperty('successRate', 84);
      expect(result).toHaveProperty('totalExecutions', 50);
      expect(result).toHaveProperty('completedExecutions', 42);
      expect(result).toHaveProperty('failedExecutions', 8);
      expect(result).toHaveProperty('runningExecutions', 2);
      expect(result).toHaveProperty('steeringAccuracy');
      expect(result.steeringAccuracy).toHaveProperty('steeringAccuracyPct', 92.5);
      expect(result).toHaveProperty('kpiFreshness');
      expect(result.kpiFreshness).toHaveLength(2);
      expect(result.kpiVersion).toBe('1.0.0');
    });

    test('should handle missing steering accuracy gracefully', async () => {
      // Mock base KPIs query
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            total_executions: '10',
            completed_executions: '8',
            failed_executions: '2',
            running_executions: '0',
            avg_duration_ms: '200000',
            mean_time_to_insight_ms: '210000',
          }],
        })
        // Mock table check - table doesn't exist
        .mockResolvedValueOnce({
          rows: [{ exists: false }],
        })
        // Mock KPI freshness
        .mockResolvedValueOnce({
          rows: [],
        });

      const result = await getExtendedFactoryKPIs(24);

      expect(result.steeringAccuracy).toBeUndefined();
      expect(result.kpiFreshness).toEqual([]);
    });
  });

  describe('calculateSteeringAccuracy', () => {
    test('should calculate steering accuracy correctly', async () => {
      // Mock table check
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ exists: true }],
        })
        // Mock steering accuracy calculation
        .mockResolvedValueOnce({
          rows: [{
            steering_accuracy_pct: '95.0',
            total_decisions: '100',
            accepted_decisions: '95',
            overridden_decisions: '3',
            escalated_decisions: '2',
          }],
        });

      const result = await calculateSteeringAccuracy(24);

      expect(result).toBeDefined();
      expect(result?.steeringAccuracyPct).toBe(95.0);
      expect(result?.totalDecisions).toBe(100);
      expect(result?.acceptedDecisions).toBe(95);
      expect(result?.overriddenDecisions).toBe(3);
      expect(result?.escalatedDecisions).toBe(2);
    });

    test('should return undefined when table does not exist', async () => {
      // Mock table check - table doesn't exist
      mockPool.query.mockResolvedValueOnce({
        rows: [{ exists: false }],
      });

      const result = await calculateSteeringAccuracy(24);

      expect(result).toBeUndefined();
    });

    test('should return undefined when no decisions exist', async () => {
      // Mock table check
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ exists: true }],
        })
        // Mock empty result
        .mockResolvedValueOnce({
          rows: [{
            steering_accuracy_pct: null,
            total_decisions: '0',
            accepted_decisions: '0',
            overridden_decisions: '0',
            escalated_decisions: '0',
          }],
        });

      const result = await calculateSteeringAccuracy(24);

      expect(result).toBeUndefined();
    });
  });

  describe('getKpiFreshness', () => {
    test('should return freshness for all KPIs', async () => {
      const now = new Date();
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            kpi_name: 'mtti',
            freshness_seconds: '30',
            last_calculated_at: now,
          },
          {
            kpi_name: 'success_rate',
            freshness_seconds: '120',
            last_calculated_at: now,
          },
          {
            kpi_name: 'steering_accuracy',
            freshness_seconds: '400',
            last_calculated_at: now,
          },
        ],
      });

      const result = await getKpiFreshness();

      expect(result).toHaveLength(3);
      expect(result[0].kpiName).toBe('mtti');
      expect(result[0].freshnessSeconds).toBe(30);
      expect(result[0].isFresh).toBe(true);
      expect(result[0].status).toBe('fresh');

      expect(result[1].kpiName).toBe('success_rate');
      expect(result[1].freshnessSeconds).toBe(120);
      expect(result[1].isFresh).toBe(false);
      expect(result[1].status).toBe('stale');

      expect(result[2].kpiName).toBe('steering_accuracy');
      expect(result[2].freshnessSeconds).toBe(400);
      expect(result[2].isFresh).toBe(false);
      expect(result[2].status).toBe('expired');
    });

    test('should return empty array on error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      const result = await getKpiFreshness();

      expect(result).toEqual([]);
    });
  });

  describe('getProductKPIs', () => {
    test('should return product-level KPIs', async () => {
      const now = new Date();
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            repository_id: 'repo-1',
            product_name: 'owner/repo1',
            success_rate_pct: '90.5',
            daily_throughput: '5.2',
            total_executions: '36',
            completed_executions: '32',
            failed_executions: '4',
            avg_duration_ms: '250000',
            period_start: now,
            period_end: now,
          },
          {
            repository_id: 'repo-2',
            product_name: 'owner/repo2',
            success_rate_pct: '95.0',
            daily_throughput: '3.8',
            total_executions: '27',
            completed_executions: '25',
            failed_executions: '2',
            avg_duration_ms: '180000',
            period_start: now,
            period_end: now,
          },
        ],
      });

      const result = await getProductKPIs(undefined, 7);

      expect(result).toHaveLength(2);
      expect(result[0].productName).toBe('owner/repo1');
      expect(result[0].successRatePct).toBe(90.5);
      expect(result[0].dailyThroughput).toBe(5.2);
      expect(result[1].productName).toBe('owner/repo2');
      expect(result[1].successRatePct).toBe(95.0);
    });
  });

  describe('createKpiSnapshot', () => {
    test('should create a KPI snapshot', async () => {
      const now = new Date();
      const request: CreateKpiSnapshotRequest = {
        kpiName: 'mtti',
        level: 'factory',
        value: 285000,
        unit: 'milliseconds',
        periodStart: now.toISOString(),
        periodEnd: now.toISOString(),
      };

      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'snapshot-1',
          kpi_name: 'mtti',
          kpi_version: '1.0.0',
          level: 'factory',
          scope_id: null,
          value: '285000',
          unit: 'milliseconds',
          metadata: null,
          calculated_at: now,
          period_start: now,
          period_end: now,
          created_at: now,
        }],
      });

      const result = await createKpiSnapshot(request);

      expect(result.id).toBe('snapshot-1');
      expect(result.kpiName).toBe('mtti');
      expect(result.level).toBe('factory');
      expect(result.value).toBe(285000);
      expect(result.unit).toBe('milliseconds');
    });
  });
});
