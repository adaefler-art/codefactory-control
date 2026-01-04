/**
 * Tests for E78.1 KPI Measurements & Aggregates
 * 
 * Tests deterministic KPI computation, MTTR, Incident Rate, Auto-fix Rate
 */

import {
  calculateMTTRForWindow,
  calculateIncidentRateForWindow,
  calculateAutoFixRateForWindow,
  computeKpisForWindow,
  createKpiMeasurement,
  getKpiAggregates,
} from '../../src/lib/kpi-service';

// Mock the database pool
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

describe('E78.1: KPI Measurements & Aggregates', () => {
  let mockPool: any;

  beforeEach(() => {
    const { getPool } = require('../../src/lib/db');
    mockPool = {
      query: jest.fn(),
    };
    getPool.mockReturnValue(mockPool);
    jest.clearAllMocks();
  });

  describe('calculateMTTRForWindow', () => {
    test('should calculate MTTR correctly for closed incidents', async () => {
      // Mock database response
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            mttr_hours: '2.5',
            incident_count: '10',
            source_refs: {
              incidentIds: ['inc-1', 'inc-2', 'inc-3'],
              windowStart: '2024-01-01T00:00:00Z',
              windowEnd: '2024-01-02T00:00:00Z',
            },
          },
        ],
      });

      const result = await calculateMTTRForWindow(
        '2024-01-01T00:00:00Z',
        '2024-01-02T00:00:00Z'
      );

      expect(result).not.toBeNull();
      expect(result?.mttrHours).toBe(2.5);
      expect(result?.incidentCount).toBe(10);
      expect(result?.windowStart).toBe('2024-01-01T00:00:00Z');
      expect(result?.windowEnd).toBe('2024-01-02T00:00:00Z');

      // Verify query was called correctly
      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT * FROM calculate_mttr_for_window($1, $2)',
        ['2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z']
      );
    });

    test('should return null when no incidents closed in window', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
      });

      const result = await calculateMTTRForWindow(
        '2024-01-01T00:00:00Z',
        '2024-01-02T00:00:00Z'
      );

      expect(result).toBeNull();
    });

    test('should handle database errors gracefully', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      const result = await calculateMTTRForWindow(
        '2024-01-01T00:00:00Z',
        '2024-01-02T00:00:00Z'
      );

      expect(result).toBeNull();
    });
  });

  describe('calculateIncidentRateForWindow', () => {
    test('should calculate incident rate correctly', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            incidents_per_day: '5.5',
            total_incidents: '11',
            window_days: '2.0',
            source_refs: {
              windowStart: '2024-01-01T00:00:00Z',
              windowEnd: '2024-01-03T00:00:00Z',
              totalIncidents: '11',
              windowDays: '2.0',
            },
          },
        ],
      });

      const result = await calculateIncidentRateForWindow(
        '2024-01-01T00:00:00Z',
        '2024-01-03T00:00:00Z'
      );

      expect(result).not.toBeNull();
      expect(result?.incidentsPerDay).toBe(5.5);
      expect(result?.totalIncidents).toBe(11);
      expect(result?.windowDays).toBe(2.0);
    });

    test('should return null when query fails', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
      });

      const result = await calculateIncidentRateForWindow(
        '2024-01-01T00:00:00Z',
        '2024-01-02T00:00:00Z'
      );

      expect(result).toBeNull();
    });
  });

  describe('calculateAutoFixRateForWindow', () => {
    test('should calculate auto-fix rate correctly', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            autofix_rate_pct: '75.0',
            autofix_count: '15',
            total_runs: '20',
            source_refs: {
              windowStart: '2024-01-01T00:00:00Z',
              windowEnd: '2024-01-02T00:00:00Z',
              succeededCount: '15',
              totalRuns: '20',
            },
          },
        ],
      });

      const result = await calculateAutoFixRateForWindow(
        '2024-01-01T00:00:00Z',
        '2024-01-02T00:00:00Z'
      );

      expect(result).not.toBeNull();
      expect(result?.autofixRatePct).toBe(75.0);
      expect(result?.autofixCount).toBe(15);
      expect(result?.totalRuns).toBe(20);
      expect(result?.caveat).toContain('SUCCEEDED');
    });

    test('should handle zero remediation runs', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            autofix_rate_pct: '0.0',
            autofix_count: '0',
            total_runs: '0',
            source_refs: {},
          },
        ],
      });

      const result = await calculateAutoFixRateForWindow(
        '2024-01-01T00:00:00Z',
        '2024-01-02T00:00:00Z'
      );

      expect(result).not.toBeNull();
      expect(result?.autofixRatePct).toBe(0.0);
      expect(result?.totalRuns).toBe(0);
    });
  });

  describe('computeKpisForWindow', () => {
    test('should compute multiple KPIs for a window idempotently', async () => {
      // Mock incident rate calculation
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            incidents_per_day: '3.0',
            total_incidents: '6',
            window_days: '2.0',
            source_refs: {},
          },
        ],
      });

      // Mock MTTR calculation
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            mttr_hours: '1.5',
            incident_count: '4',
            source_refs: {},
          },
        ],
      });

      // Mock auto-fix rate calculation
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            autofix_rate_pct: '80.0',
            autofix_count: '8',
            total_runs: '10',
            source_refs: {},
          },
        ],
      });

      // Mock aggregate existence check (not exists for all 3)
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // incident_rate check
        .mockResolvedValueOnce({ rows: [] }) // mttr check
        .mockResolvedValueOnce({ rows: [] }); // autofix_rate check

      // Mock aggregate inserts
      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'agg-1',
              window: 'daily',
              window_start: new Date('2024-01-01T00:00:00Z'),
              window_end: new Date('2024-01-02T00:00:00Z'),
              kpi_name: 'incident_rate',
              value_num: '3.0',
              unit: 'incidents_per_day',
              compute_version: '0.7.0',
              inputs_hash: 'hash1',
              metadata: { totalIncidents: 6, windowDays: 2.0 },
              created_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'agg-2',
              window: 'daily',
              window_start: new Date('2024-01-01T00:00:00Z'),
              window_end: new Date('2024-01-02T00:00:00Z'),
              kpi_name: 'mttr',
              value_num: '1.5',
              unit: 'hours',
              compute_version: '0.7.0',
              inputs_hash: 'hash2',
              metadata: { incidentCount: 4 },
              created_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'agg-3',
              window: 'daily',
              window_start: new Date('2024-01-01T00:00:00Z'),
              window_end: new Date('2024-01-02T00:00:00Z'),
              kpi_name: 'autofix_rate',
              value_num: '80.0',
              unit: 'percentage',
              compute_version: '0.7.0',
              inputs_hash: 'hash3',
              metadata: { autofixCount: 8, totalRuns: 10 },
              created_at: new Date(),
            },
          ],
        });

      const result = await computeKpisForWindow({
        window: 'daily',
        windowStart: '2024-01-01T00:00:00Z',
        windowEnd: '2024-01-02T00:00:00Z',
        kpiNames: ['incident_rate', 'mttr', 'autofix_rate'],
      });

      expect(result).toBeDefined();
      expect(result.aggregates).toHaveLength(3);
      expect(result.computeVersion).toBe('0.7.0');
      expect(result.inputsHash).toBeDefined();
      expect(result.aggregates[0].kpiName).toBe('incident_rate');
      expect(result.aggregates[1].kpiName).toBe('mttr');
      expect(result.aggregates[2].kpiName).toBe('autofix_rate');
    });

    test('should skip existing aggregates when not forcing recompute', async () => {
      // Mock calculations
      mockPool.query.mockResolvedValueOnce({
        rows: [{ incidents_per_day: '3.0', total_incidents: '6', window_days: '2.0', source_refs: {} }],
      });

      // Mock aggregate existence check (exists)
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'existing-agg' }],
      });

      const result = await computeKpisForWindow({
        window: 'daily',
        windowStart: '2024-01-01T00:00:00Z',
        windowEnd: '2024-01-02T00:00:00Z',
        kpiNames: ['incident_rate'],
        forceRecompute: false,
      });

      expect(result.aggregates).toHaveLength(0);
    });
  });

  describe('createKpiMeasurement', () => {
    test('should create KPI measurement with upsert', async () => {
      const mockTimestamp = new Date('2024-01-01T12:00:00Z');
      
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'meas-1',
            kpi_name: 'd2d',
            entity_type: 'issue',
            entity_id: 'issue-123',
            occurred_at: mockTimestamp,
            value_num: '48.5',
            unit: 'hours',
            source_refs: { issueId: 'issue-123', deployId: 'dep-456' },
            created_at: mockTimestamp,
          },
        ],
      });

      const result = await createKpiMeasurement({
        kpiName: 'd2d',
        entityType: 'issue',
        entityId: 'issue-123',
        occurredAt: '2024-01-01T12:00:00Z',
        valueNum: 48.5,
        unit: 'hours',
        sourceRefs: { issueId: 'issue-123', deployId: 'dep-456' },
      });

      expect(result).toBeDefined();
      expect(result.kpiName).toBe('d2d');
      expect(result.entityType).toBe('issue');
      expect(result.valueNum).toBe(48.5);
    });
  });

  describe('getKpiAggregates', () => {
    test('should retrieve KPI aggregates with filters', async () => {
      const mockTimestamp = new Date('2024-01-01T00:00:00Z');
      
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'agg-1',
            window: 'daily',
            window_start: mockTimestamp,
            window_end: new Date('2024-01-02T00:00:00Z'),
            kpi_name: 'mttr',
            value_num: '2.5',
            unit: 'hours',
            compute_version: '0.7.0',
            inputs_hash: 'hash1',
            metadata: {},
            created_at: mockTimestamp,
          },
        ],
      });

      const result = await getKpiAggregates({
        window: 'daily',
        kpiNames: ['mttr'],
        limit: 10,
      });

      expect(result).toHaveLength(1);
      expect(result[0].kpiName).toBe('mttr');
      expect(result[0].window).toBe('daily');
    });
  });
});
