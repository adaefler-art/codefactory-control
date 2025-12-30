/**
 * Deploy Status API Contract Tests (E65.1)
 * 
 * Validates the /api/deploy/status endpoint contract
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/deploy/status/route';

// Mock dependencies
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/deploy-status/signal-collector', () => ({
  collectStatusSignals: jest.fn(),
}));

jest.mock('../../src/lib/db/deployStatusSnapshots', () => ({
  getLatestDeployStatusSnapshot: jest.fn(),
  insertDeployStatusSnapshot: jest.fn(),
}));

describe('Deploy Status API Contract', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Request Validation', () => {
    test('returns 400 when env parameter is missing', async () => {
      process.env.DATABASE_ENABLED = 'false';

      const request = new NextRequest('http://localhost/api/deploy/status', {
        method: 'GET',
      });

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid environment');
    });

    test('returns 400 when env parameter is invalid', async () => {
      process.env.DATABASE_ENABLED = 'false';

      const request = new NextRequest(
        'http://localhost/api/deploy/status?env=INVALID!ENV',
        { method: 'GET' }
      );

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid environment');
    });

    test('accepts valid environment identifiers', async () => {
      process.env.DATABASE_ENABLED = 'false';

      const { collectStatusSignals } = require('../../src/lib/deploy-status/signal-collector');
      collectStatusSignals.mockResolvedValue({
        checked_at: new Date().toISOString(),
        health: { status: 200, ok: true, latency_ms: 50 },
        ready: { status: 200, ok: true, ready: true, latency_ms: 50 },
        deploy_events: [],
      });

      const validEnvs = ['prod', 'stage', 'dev', 'prod-us-east-1', 'staging_v2'];

      for (const env of validEnvs) {
        const request = new NextRequest(
          `http://localhost/api/deploy/status?env=${env}`,
          { method: 'GET' }
        );

        const response = await GET(request);
        expect(response.status).toBe(200);
      }
    });
  });

  describe('Database Disabled Mode', () => {
    test('returns status without database when DB disabled', async () => {
      process.env.DATABASE_ENABLED = 'false';

      const { collectStatusSignals } = require('../../src/lib/deploy-status/signal-collector');
      const mockSignals = {
        checked_at: new Date().toISOString(),
        health: { status: 200, ok: true, latency_ms: 50 },
        ready: { status: 200, ok: true, ready: true, latency_ms: 50 },
        deploy_events: [],
      };
      collectStatusSignals.mockResolvedValue(mockSignals);

      const request = new NextRequest(
        'http://localhost/api/deploy/status?env=prod',
        { method: 'GET' }
      );

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.env).toBe('prod');
      expect(body.status).toBe('GREEN');
      expect(body.observed_at).toBeDefined();
      expect(body.reasons).toBeDefined();
      expect(body.signals).toBeDefined();
      expect(body.staleness_seconds).toBeDefined();
      
      // Should not call DB functions
      expect(collectStatusSignals).toHaveBeenCalledWith(null, {
        env: 'prod',
        includeDeployEvents: false,
      });
    });

    test('handles signal collection errors gracefully when DB disabled', async () => {
      process.env.DATABASE_ENABLED = 'false';

      const { collectStatusSignals } = require('../../src/lib/deploy-status/signal-collector');
      collectStatusSignals.mockRejectedValue(new Error('Network error'));

      const request = new NextRequest(
        'http://localhost/api/deploy/status?env=prod',
        { method: 'GET' }
      );

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.error).toBe('Service unavailable');
    });
  });

  describe('Database Enabled Mode with Caching', () => {
    test('returns cached status when available and fresh', async () => {
      process.env.DATABASE_ENABLED = 'true';

      const { getLatestDeployStatusSnapshot } = require('../../src/lib/db/deployStatusSnapshots');
      const mockSnapshot = {
        id: 'test-snapshot-id',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        env: 'prod',
        status: 'GREEN',
        observed_at: new Date(Date.now() - 10000).toISOString(), // 10 seconds ago
        reasons: [{ code: 'ALL_HEALTHY', severity: 'info', message: 'All checks passing' }],
        signals: {
          checked_at: new Date(Date.now() - 10000).toISOString(),
          health: { status: 200, ok: true, latency_ms: 50 },
          ready: { status: 200, ok: true, ready: true, latency_ms: 50 },
          deploy_events: [],
        },
        related_deploy_event_id: null,
        staleness_seconds: 0,
      };
      getLatestDeployStatusSnapshot.mockResolvedValue({
        success: true,
        snapshot: mockSnapshot,
      });

      const request = new NextRequest(
        'http://localhost/api/deploy/status?env=prod',
        { method: 'GET' }
      );

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.env).toBe('prod');
      expect(body.status).toBe('GREEN');
      expect(body.snapshot_id).toBe('test-snapshot-id');

      // Should use cached data
      const { collectStatusSignals } = require('../../src/lib/deploy-status/signal-collector');
      expect(collectStatusSignals).not.toHaveBeenCalled();
    });

    test('collects fresh signals when cache is stale', async () => {
      process.env.DATABASE_ENABLED = 'true';

      const { getLatestDeployStatusSnapshot, insertDeployStatusSnapshot } =
        require('../../src/lib/db/deployStatusSnapshots');
      const { collectStatusSignals } = require('../../src/lib/deploy-status/signal-collector');

      // Cache is 60 seconds old (stale)
      const staleSnapshot = {
        id: 'old-snapshot-id',
        env: 'prod',
        status: 'GREEN',
        observed_at: new Date(Date.now() - 60000).toISOString(),
        reasons: [],
        signals: {},
        staleness_seconds: 60,
      };
      getLatestDeployStatusSnapshot.mockResolvedValue({
        success: true,
        snapshot: staleSnapshot,
      });

      const freshSignals = {
        checked_at: new Date().toISOString(),
        health: { status: 200, ok: true, latency_ms: 50 },
        ready: { status: 200, ok: true, ready: true, latency_ms: 50 },
        deploy_events: [],
      };
      collectStatusSignals.mockResolvedValue(freshSignals);

      const mockNewSnapshot = {
        id: 'new-snapshot-id',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        env: 'prod',
        status: 'GREEN',
        observed_at: freshSignals.checked_at,
        reasons: [{ code: 'ALL_HEALTHY', severity: 'info', message: 'All checks passing' }],
        signals: freshSignals,
        related_deploy_event_id: null,
        staleness_seconds: 0,
      };
      insertDeployStatusSnapshot.mockResolvedValue({
        success: true,
        snapshot: mockNewSnapshot,
      });

      const request = new NextRequest(
        'http://localhost/api/deploy/status?env=prod',
        { method: 'GET' }
      );

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.snapshot_id).toBe('new-snapshot-id');
      expect(collectStatusSignals).toHaveBeenCalled();
      expect(insertDeployStatusSnapshot).toHaveBeenCalled();
    });

    test('force parameter bypasses cache', async () => {
      process.env.DATABASE_ENABLED = 'true';

      const { getLatestDeployStatusSnapshot, insertDeployStatusSnapshot } =
        require('../../src/lib/db/deployStatusSnapshots');
      const { collectStatusSignals } = require('../../src/lib/deploy-status/signal-collector');

      // Fresh cache available
      const freshSnapshot = {
        id: 'fresh-snapshot-id',
        env: 'prod',
        status: 'GREEN',
        observed_at: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago
        reasons: [],
        signals: {},
        staleness_seconds: 0,
      };
      getLatestDeployStatusSnapshot.mockResolvedValue({
        success: true,
        snapshot: freshSnapshot,
      });

      const freshSignals = {
        checked_at: new Date().toISOString(),
        health: { status: 200, ok: true, latency_ms: 50 },
        ready: { status: 200, ok: true, ready: true, latency_ms: 50 },
        deploy_events: [],
      };
      collectStatusSignals.mockResolvedValue(freshSignals);

      insertDeployStatusSnapshot.mockResolvedValue({
        success: true,
        snapshot: { id: 'forced-snapshot-id' },
      });

      const request = new NextRequest(
        'http://localhost/api/deploy/status?env=prod&force=true',
        { method: 'GET' }
      );

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.snapshot_id).toBe('forced-snapshot-id');
      expect(collectStatusSignals).toHaveBeenCalled();
    });

    test('continues even if snapshot persistence fails', async () => {
      process.env.DATABASE_ENABLED = 'true';

      const { getLatestDeployStatusSnapshot, insertDeployStatusSnapshot } =
        require('../../src/lib/db/deployStatusSnapshots');
      const { collectStatusSignals } = require('../../src/lib/deploy-status/signal-collector');

      getLatestDeployStatusSnapshot.mockResolvedValue({
        success: false,
        error: 'No snapshots found',
      });

      const freshSignals = {
        checked_at: new Date().toISOString(),
        health: { status: 200, ok: true, latency_ms: 50 },
        ready: { status: 200, ok: true, ready: true, latency_ms: 50 },
        deploy_events: [],
      };
      collectStatusSignals.mockResolvedValue(freshSignals);

      // Persistence fails
      insertDeployStatusSnapshot.mockResolvedValue({
        success: false,
        error: 'Database error',
      });

      const request = new NextRequest(
        'http://localhost/api/deploy/status?env=prod',
        { method: 'GET' }
      );

      const response = await GET(request);
      const body = await response.json();

      // Should still return status even though persistence failed
      expect(response.status).toBe(200);
      expect(body.status).toBe('GREEN');
      expect(body.snapshot_id).toBeUndefined();
    });
  });

  describe('Response Contract', () => {
    test('response contains all required fields', async () => {
      process.env.DATABASE_ENABLED = 'false';

      const { collectStatusSignals } = require('../../src/lib/deploy-status/signal-collector');
      const mockSignals = {
        checked_at: new Date().toISOString(),
        health: { status: 200, ok: true, latency_ms: 50 },
        ready: { status: 200, ok: true, ready: true, latency_ms: 50 },
        deploy_events: [],
      };
      collectStatusSignals.mockResolvedValue(mockSignals);

      const request = new NextRequest(
        'http://localhost/api/deploy/status?env=prod',
        { method: 'GET' }
      );

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      
      // Required fields
      expect(body).toHaveProperty('env');
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('observed_at');
      expect(body).toHaveProperty('reasons');
      expect(body).toHaveProperty('signals');
      expect(body).toHaveProperty('staleness_seconds');

      // Validate types
      expect(typeof body.env).toBe('string');
      expect(['GREEN', 'YELLOW', 'RED']).toContain(body.status);
      expect(typeof body.observed_at).toBe('string');
      expect(Array.isArray(body.reasons)).toBe(true);
      expect(typeof body.signals).toBe('object');
      expect(typeof body.staleness_seconds).toBe('number');
    });

    test('reasons array contains properly structured objects', async () => {
      process.env.DATABASE_ENABLED = 'false';

      const { collectStatusSignals } = require('../../src/lib/deploy-status/signal-collector');
      const mockSignals = {
        checked_at: new Date().toISOString(),
        health: { status: 200, ok: true, latency_ms: 50 },
        ready: { status: 200, ok: true, ready: true, latency_ms: 50 },
        deploy_events: [],
      };
      collectStatusSignals.mockResolvedValue(mockSignals);

      const request = new NextRequest(
        'http://localhost/api/deploy/status?env=prod',
        { method: 'GET' }
      );

      const response = await GET(request);
      const body = await response.json();

      expect(body.reasons.length).toBeGreaterThan(0);
      
      body.reasons.forEach((reason: any) => {
        expect(reason).toHaveProperty('code');
        expect(reason).toHaveProperty('severity');
        expect(reason).toHaveProperty('message');
        expect(typeof reason.code).toBe('string');
        expect(['error', 'warning', 'info']).toContain(reason.severity);
        expect(typeof reason.message).toBe('string');
      });
    });
  });

  describe('Error Handling', () => {
    test('handles unexpected errors gracefully', async () => {
      process.env.DATABASE_ENABLED = 'true';

      const { getLatestDeployStatusSnapshot } = require('../../src/lib/db/deployStatusSnapshots');
      getLatestDeployStatusSnapshot.mockRejectedValue(new Error('Unexpected database error'));

      const request = new NextRequest(
        'http://localhost/api/deploy/status?env=prod',
        { method: 'GET' }
      );

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.error).toBe('Service unavailable');
    });
  });
});
