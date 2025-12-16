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
  aggregateRunKPIs,
  aggregateProductKPIsFromRuns,
  aggregateFactoryKPIsFromProducts,
  executeKpiAggregationPipeline,
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

  describe('aggregateRunKPIs', () => {
    test('should aggregate run-level KPIs for a completed execution', async () => {
      const executionId = 'exec-123';
      const now = new Date();
      
      // Mock execution query
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: executionId,
            repository_id: 'repo-123',
            started_at: new Date(now.getTime() - 300000), // 5 minutes ago
            completed_at: now,
            status: 'completed',
            duration_ms: 300000,
          }],
        })
        // Mock run duration snapshot creation
        .mockResolvedValueOnce({
          rows: [{
            id: 'snapshot-1',
            kpi_name: 'run_duration',
            kpi_version: '1.0.0',
            level: 'run',
            scope_id: executionId,
            value: 300000,
            unit: 'milliseconds',
            metadata: { status: 'completed', repositoryId: 'repo-123' },
            calculated_at: now,
            period_start: new Date(now.getTime() - 300000),
            period_end: now,
            created_at: now,
          }],
        })
        // Mock token usage query (no results)
        .mockResolvedValueOnce({
          rows: [],
        })
        // Mock tool call query (no results)
        .mockResolvedValueOnce({
          rows: [{ total_calls: '0' }],
        });

      const result = await aggregateRunKPIs(executionId);

      expect(result).toHaveLength(1);
      expect(result[0].kpiName).toBe('run_duration');
      expect(result[0].value).toBe(300000);
    });

    test('should return empty array for non-existent execution', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
      });

      const result = await aggregateRunKPIs('non-existent');

      expect(result).toEqual([]);
    });
  });

  describe('aggregateProductKPIsFromRuns', () => {
    test('should aggregate product-level KPIs from runs', async () => {
      const repositoryId = 'repo-123';
      const now = new Date();
      
      // Mock repository query
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            product_name: 'org/repo',
          }],
        })
        // Mock success rate query
        .mockResolvedValueOnce({
          rows: [{
            completed: '8',
            failed: '2',
            total: '10',
          }],
        })
        // Mock success rate snapshot creation
        .mockResolvedValueOnce({
          rows: [{
            id: 'snapshot-1',
            kpi_name: 'product_success_rate',
            kpi_version: '1.0.0',
            level: 'product',
            scope_id: repositoryId,
            value: 80,
            unit: 'percentage',
            metadata: { productName: 'org/repo', completedRuns: 8, totalRuns: 10 },
            calculated_at: now,
            period_start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            period_end: now,
            created_at: now,
          }],
        })
        // Mock throughput query
        .mockResolvedValueOnce({
          rows: [{
            total_runs: '10',
          }],
        })
        // Mock throughput snapshot creation
        .mockResolvedValueOnce({
          rows: [{
            id: 'snapshot-2',
            kpi_name: 'product_throughput',
            kpi_version: '1.0.0',
            level: 'product',
            scope_id: repositoryId,
            value: 10,
            unit: 'runs_per_day',
            metadata: { productName: 'org/repo', totalRuns: 10 },
            calculated_at: now,
            period_start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            period_end: now,
            created_at: now,
          }],
        })
        // Mock avg duration query
        .mockResolvedValueOnce({
          rows: [{
            avg_duration: '250000',
          }],
        })
        // Mock avg duration snapshot creation
        .mockResolvedValueOnce({
          rows: [{
            id: 'snapshot-3',
            kpi_name: 'product_avg_duration',
            kpi_version: '1.0.0',
            level: 'product',
            scope_id: repositoryId,
            value: 250000,
            unit: 'milliseconds',
            metadata: { productName: 'org/repo' },
            calculated_at: now,
            period_start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            period_end: now,
            created_at: now,
          }],
        });

      const result = await aggregateProductKPIsFromRuns(repositoryId, 24);

      expect(result).toHaveLength(3);
      expect(result[0].kpiName).toBe('product_success_rate');
      expect(result[0].value).toBe(80);
      expect(result[1].kpiName).toBe('product_throughput');
      expect(result[2].kpiName).toBe('product_avg_duration');
    });
  });

  describe('aggregateFactoryKPIsFromProducts', () => {
    test('should aggregate factory-level KPIs', async () => {
      const now = new Date();
      
      // Mock MTTI query
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            mtti_ms: '285000',
          }],
        })
        // Mock MTTI snapshot creation
        .mockResolvedValueOnce({
          rows: [{
            id: 'snapshot-1',
            kpi_name: 'mtti',
            kpi_version: '1.0.0',
            level: 'factory',
            scope_id: null,
            value: 285000,
            unit: 'milliseconds',
            metadata: { targetMs: 300000 },
            calculated_at: now,
            period_start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            period_end: now,
            created_at: now,
          }],
        })
        // Mock success rate query
        .mockResolvedValueOnce({
          rows: [{
            completed: '42',
            total: '50',
          }],
        })
        // Mock success rate snapshot creation
        .mockResolvedValueOnce({
          rows: [{
            id: 'snapshot-2',
            kpi_name: 'success_rate',
            kpi_version: '1.0.0',
            level: 'factory',
            scope_id: null,
            value: 84,
            unit: 'percentage',
            metadata: { completedRuns: 42, totalRuns: 50, targetPct: 85 },
            calculated_at: now,
            period_start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            period_end: now,
            created_at: now,
          }],
        })
        // Mock throughput query
        .mockResolvedValueOnce({
          rows: [{
            total_runs: '50',
          }],
        })
        // Mock throughput snapshot creation
        .mockResolvedValueOnce({
          rows: [{
            id: 'snapshot-3',
            kpi_name: 'factory_throughput',
            kpi_version: '1.0.0',
            level: 'factory',
            scope_id: null,
            value: 50,
            unit: 'runs_per_day',
            metadata: { totalRuns: 50 },
            calculated_at: now,
            period_start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            period_end: now,
            created_at: now,
          }],
        })
        // Mock table check for steering accuracy
        .mockResolvedValueOnce({
          rows: [{ exists: false }],
        });

      const result = await aggregateFactoryKPIsFromProducts(24);

      expect(result).toHaveLength(3);
      expect(result[0].kpiName).toBe('mtti');
      expect(result[1].kpiName).toBe('success_rate');
      expect(result[2].kpiName).toBe('factory_throughput');
    });
  });

  describe('executeKpiAggregationPipeline', () => {
    test('should execute full aggregation pipeline', async () => {
      const now = new Date();
      const jobId = 'job-123';
      
      // Mock job creation
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: jobId,
            job_type: 'incremental',
            status: 'running',
            kpi_names: ['run_duration', 'product_success_rate', 'mtti'],
            period_start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            period_end: now,
            started_at: now,
            created_at: now,
          }],
        })
        // Mock executions query (no new executions)
        .mockResolvedValueOnce({
          rows: [],
        })
        // Mock repositories query (no repositories)
        .mockResolvedValueOnce({
          rows: [],
        })
        // Mock factory-level aggregations (MTTI)
        .mockResolvedValueOnce({
          rows: [{ mtti_ms: null }],
        })
        // Mock factory success rate
        .mockResolvedValueOnce({
          rows: [{ completed: '0', total: '0' }],
        })
        // Mock factory throughput
        .mockResolvedValueOnce({
          rows: [{ total_runs: '0' }],
        })
        // Mock table check for steering accuracy
        .mockResolvedValueOnce({
          rows: [{ exists: false }],
        })
        // Mock materialized views refresh
        .mockResolvedValueOnce({
          rows: [],
        })
        // Mock job update
        .mockResolvedValueOnce({
          rows: [{
            id: jobId,
            job_type: 'incremental',
            status: 'completed',
            kpi_names: ['run_duration', 'product_success_rate', 'mtti'],
            period_start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            period_end: now,
            started_at: now,
            completed_at: now,
            duration_ms: 100,
            snapshots_created: 0,
            error: null,
            metadata: { pipeline: 'run->product->factory' },
            created_at: now,
          }],
        });

      const result = await executeKpiAggregationPipeline(24);

      expect(result.id).toBe(jobId);
      expect(result.status).toBe('completed');
      expect(result.snapshotsCreated).toBe(0);
    });
  });
});
