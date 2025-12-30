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

jest.mock('../../src/lib/deploy-status/verification-resolver', () => ({
  resolveDeployStatusFromVerificationRuns: jest.fn(),
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

      const validEnvs = ['prod', 'stage', 'dev', 'prod-us-east-1', 'staging_v2'];

      for (const env of validEnvs) {
        const request = new NextRequest(
          `http://localhost/api/deploy/status?env=${env}`,
          { method: 'GET' }
        );

        const response = await GET(request);
        // Env is valid, but DB is required for verification-run-derived status.
        expect(response.status).toBe(503);
      }
    });
  });

  describe('Database Disabled Mode', () => {
    test('returns 503 when DB disabled (verification runs required)', async () => {
      process.env.DATABASE_ENABLED = 'false';

      const request = new NextRequest('http://localhost/api/deploy/status?env=prod', { method: 'GET' });
      const response = await GET(request);
      expect(response.status).toBe(503);
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
        reasons: [{ code: 'VERIFICATION_SUCCESS', severity: 'info', message: 'ok' }],
        signals: {
          checked_at: new Date(Date.now() - 10000).toISOString(),
          verification_run: null,
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
      const { resolveDeployStatusFromVerificationRuns } = require('../../src/lib/deploy-status/verification-resolver');
      expect(resolveDeployStatusFromVerificationRuns).not.toHaveBeenCalled();
    });

    test('collects fresh signals when cache is stale', async () => {
      process.env.DATABASE_ENABLED = 'true';

      const { getLatestDeployStatusSnapshot, insertDeployStatusSnapshot } =
        require('../../src/lib/db/deployStatusSnapshots');
      const { resolveDeployStatusFromVerificationRuns } = require('../../src/lib/deploy-status/verification-resolver');

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

      const resolved = {
        env: 'prod',
        status: 'YELLOW',
        observed_at: new Date().toISOString(),
        reasons: [{ code: 'NO_VERIFICATION_RUN', severity: 'warning', message: 'No run' }],
        signals: { checked_at: new Date().toISOString(), verification_run: null },
        staleness_seconds: 0,
      };
      resolveDeployStatusFromVerificationRuns.mockResolvedValue(resolved);

      const mockNewSnapshot = {
        id: 'new-snapshot-id',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        env: 'prod',
        status: resolved.status,
        observed_at: resolved.observed_at,
        reasons: resolved.reasons,
        signals: resolved.signals,
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
      expect(resolveDeployStatusFromVerificationRuns).toHaveBeenCalled();
      expect(insertDeployStatusSnapshot).toHaveBeenCalled();
    });

    test('force parameter bypasses cache', async () => {
      process.env.DATABASE_ENABLED = 'true';

      const { getLatestDeployStatusSnapshot, insertDeployStatusSnapshot } =
        require('../../src/lib/db/deployStatusSnapshots');
      const { resolveDeployStatusFromVerificationRuns } = require('../../src/lib/deploy-status/verification-resolver');

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

      resolveDeployStatusFromVerificationRuns.mockResolvedValue({
        env: 'prod',
        status: 'YELLOW',
        observed_at: new Date().toISOString(),
        reasons: [{ code: 'NO_VERIFICATION_RUN', severity: 'warning', message: 'No run' }],
        signals: { checked_at: new Date().toISOString(), verification_run: null },
        staleness_seconds: 0,
      });

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
      expect(resolveDeployStatusFromVerificationRuns).toHaveBeenCalled();
    });

    test('continues even if snapshot persistence fails', async () => {
      process.env.DATABASE_ENABLED = 'true';

      const { getLatestDeployStatusSnapshot, insertDeployStatusSnapshot } =
        require('../../src/lib/db/deployStatusSnapshots');
      const { resolveDeployStatusFromVerificationRuns } = require('../../src/lib/deploy-status/verification-resolver');

      getLatestDeployStatusSnapshot.mockResolvedValue({
        success: false,
        error: 'No snapshots found',
      });

      resolveDeployStatusFromVerificationRuns.mockResolvedValue({
        env: 'prod',
        status: 'YELLOW',
        observed_at: new Date().toISOString(),
        reasons: [{ code: 'NO_VERIFICATION_RUN', severity: 'warning', message: 'No run' }],
        signals: { checked_at: new Date().toISOString(), verification_run: null },
        staleness_seconds: 0,
      });

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
      expect(body.status).toBe('YELLOW');
      expect(body.snapshot_id).toBeUndefined();
    });
  });

  describe('Response Contract', () => {
    test('response contains all required fields', async () => {
      process.env.DATABASE_ENABLED = 'true';

      const { getLatestDeployStatusSnapshot } = require('../../src/lib/db/deployStatusSnapshots');
      getLatestDeployStatusSnapshot.mockResolvedValue({
        success: true,
        snapshot: {
          id: 'snapshot-1',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          env: 'prod',
          status: 'YELLOW',
          observed_at: new Date().toISOString(),
          reasons: [{ code: 'NO_VERIFICATION_RUN', severity: 'warning', message: 'No run' }],
          signals: { checked_at: new Date().toISOString(), verification_run: null },
          related_deploy_event_id: null,
          staleness_seconds: 0,
        },
      });

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
      process.env.DATABASE_ENABLED = 'true';

      const { getLatestDeployStatusSnapshot } = require('../../src/lib/db/deployStatusSnapshots');
      getLatestDeployStatusSnapshot.mockResolvedValue({
        success: true,
        snapshot: {
          id: 'snapshot-1',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          env: 'prod',
          status: 'YELLOW',
          observed_at: new Date().toISOString(),
          reasons: [{ code: 'NO_VERIFICATION_RUN', severity: 'warning', message: 'No run' }],
          signals: { checked_at: new Date().toISOString(), verification_run: null },
          related_deploy_event_id: null,
          staleness_seconds: 0,
        },
      });

      const request = new NextRequest(
        'http://localhost/api/deploy/status?env=prod',
        { method: 'GET' }
      );

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
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
