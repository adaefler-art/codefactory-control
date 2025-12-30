/**
 * Deploy Status Rules Engine Tests (E65.1)
 * 
 * Comprehensive unit tests for deterministic status determination.
 * Tests all combinatorial cases and edge conditions.
 * 
 * @jest-environment node
 */

import {
  determineDeployStatus,
  isHealthHealthy,
  isReadyHealthy,
  hasRecentDeployFailure,
  hasRecentDeployWarning,
  calculateStaleness,
  isDataStale,
  hasMissingSignals,
  hasHighLatency,
  REASON_CODES,
} from '../../src/lib/deploy-status/rules-engine';
import { StatusSignals } from '../../src/lib/contracts/deployStatus';
import { createMockSignals } from '../../src/lib/deploy-status/signal-collector';

describe('Deploy Status Rules Engine', () => {
  const fixedTime = new Date('2024-01-01T12:00:00Z');

  describe('Helper Functions', () => {
    describe('isHealthHealthy', () => {
      test('returns true when health is ok and status 200', () => {
        const signals = createMockSignals();
        expect(isHealthHealthy(signals)).toBe(true);
      });

      test('returns false when health is missing', () => {
        const signals = createMockSignals({ health: undefined });
        expect(isHealthHealthy(signals)).toBe(false);
      });

      test('returns false when health status is not 200', () => {
        const signals = createMockSignals({
          health: { status: 500, ok: false, latency_ms: 50 },
        });
        expect(isHealthHealthy(signals)).toBe(false);
      });

      test('returns false when health ok is false', () => {
        const signals = createMockSignals({
          health: { status: 200, ok: false, latency_ms: 50 },
        });
        expect(isHealthHealthy(signals)).toBe(false);
      });
    });

    describe('isReadyHealthy', () => {
      test('returns true when ready is ok, status 200, and ready=true', () => {
        const signals = createMockSignals();
        expect(isReadyHealthy(signals)).toBe(true);
      });

      test('returns false when ready is missing', () => {
        const signals = createMockSignals({ ready: undefined });
        expect(isReadyHealthy(signals)).toBe(false);
      });

      test('returns false when ready status is not 200', () => {
        const signals = createMockSignals({
          ready: { status: 503, ok: false, ready: false, latency_ms: 50 },
        });
        expect(isReadyHealthy(signals)).toBe(false);
      });

      test('returns false when ready=false', () => {
        const signals = createMockSignals({
          ready: { status: 200, ok: true, ready: false, latency_ms: 50 },
        });
        expect(isReadyHealthy(signals)).toBe(false);
      });
    });

    describe('hasRecentDeployFailure', () => {
      test('returns false when no deploy events', () => {
        const signals = createMockSignals({ deploy_events: [] });
        expect(hasRecentDeployFailure(signals)).toBe(false);
      });

      test('returns true when recent failed deployment', () => {
        const signals = createMockSignals({
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'failed',
              message: null,
            },
          ],
        });
        expect(hasRecentDeployFailure(signals)).toBe(true);
      });

      test('returns true when status contains "fail"', () => {
        const signals = createMockSignals({
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'deployment_failed',
              message: null,
            },
          ],
        });
        expect(hasRecentDeployFailure(signals)).toBe(true);
      });

      test('returns false when failure is too old', () => {
        const signals = createMockSignals({
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 60 min ago
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'failed',
              message: null,
            },
          ],
        });
        expect(hasRecentDeployFailure(signals)).toBe(false);
      });

      test('returns false when status is success', () => {
        const signals = createMockSignals({
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'success',
              message: null,
            },
          ],
        });
        expect(hasRecentDeployFailure(signals)).toBe(false);
      });
    });

    describe('hasRecentDeployWarning', () => {
      test('returns false when no deploy events', () => {
        const signals = createMockSignals({ deploy_events: [] });
        expect(hasRecentDeployWarning(signals)).toBe(false);
      });

      test('returns true when recent warning deployment', () => {
        const signals = createMockSignals({
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'success_with_warnings',
              message: null,
            },
          ],
        });
        expect(hasRecentDeployWarning(signals)).toBe(true);
      });

      test('returns true when status contains "degraded"', () => {
        const signals = createMockSignals({
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'degraded',
              message: null,
            },
          ],
        });
        expect(hasRecentDeployWarning(signals)).toBe(true);
      });

      test('returns false when warning is too old', () => {
        const signals = createMockSignals({
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'success_with_warnings',
              message: null,
            },
          ],
        });
        expect(hasRecentDeployWarning(signals)).toBe(false);
      });
    });

    describe('calculateStaleness', () => {
      test('calculates staleness correctly', () => {
        const signals: StatusSignals = {
          checked_at: new Date('2024-01-01T11:55:00Z').toISOString(),
          health: { status: 200, ok: true, latency_ms: 50 },
          ready: { status: 200, ok: true, ready: true, latency_ms: 50 },
          deploy_events: [],
        };
        const staleness = calculateStaleness(signals, fixedTime);
        expect(staleness).toBe(300); // 5 minutes = 300 seconds
      });

      test('returns 0 for same time', () => {
        const signals: StatusSignals = {
          checked_at: fixedTime.toISOString(),
          health: { status: 200, ok: true, latency_ms: 50 },
          ready: { status: 200, ok: true, ready: true, latency_ms: 50 },
          deploy_events: [],
        };
        const staleness = calculateStaleness(signals, fixedTime);
        expect(staleness).toBe(0);
      });
    });

    describe('isDataStale', () => {
      test('returns true when data exceeds threshold', () => {
        const signals: StatusSignals = {
          checked_at: new Date('2024-01-01T11:54:00Z').toISOString(), // 6 min ago
          health: { status: 200, ok: true, latency_ms: 50 },
          ready: { status: 200, ok: true, ready: true, latency_ms: 50 },
          deploy_events: [],
        };
        const isStale = isDataStale(signals, fixedTime, 300); // 5 min threshold
        expect(isStale).toBe(true);
      });

      test('returns false when data within threshold', () => {
        const signals: StatusSignals = {
          checked_at: new Date('2024-01-01T11:56:00Z').toISOString(), // 4 min ago
          health: { status: 200, ok: true, latency_ms: 50 },
          ready: { status: 200, ok: true, ready: true, latency_ms: 50 },
          deploy_events: [],
        };
        const isStale = isDataStale(signals, fixedTime, 300);
        expect(isStale).toBe(false);
      });
    });

    describe('hasMissingSignals', () => {
      test('returns false when all signals present', () => {
        const signals = createMockSignals();
        expect(hasMissingSignals(signals)).toBe(false);
      });

      test('returns true when health is missing', () => {
        const signals = createMockSignals({ health: undefined });
        expect(hasMissingSignals(signals)).toBe(true);
      });

      test('returns true when ready is missing', () => {
        const signals = createMockSignals({ ready: undefined });
        expect(hasMissingSignals(signals)).toBe(true);
      });

      test('returns true when checked_at is missing', () => {
        const signals = createMockSignals();
        delete (signals as any).checked_at;
        expect(hasMissingSignals(signals)).toBe(true);
      });
    });

    describe('hasHighLatency', () => {
      test('returns false when latency is normal', () => {
        const signals = createMockSignals({
          health: { status: 200, ok: true, latency_ms: 100 },
          ready: { status: 200, ok: true, ready: true, latency_ms: 150 },
        });
        expect(hasHighLatency(signals)).toBe(false);
      });

      test('returns true when health latency is high', () => {
        const signals = createMockSignals({
          health: { status: 200, ok: true, latency_ms: 3000 },
        });
        expect(hasHighLatency(signals)).toBe(true);
      });

      test('returns true when ready latency is high', () => {
        const signals = createMockSignals({
          ready: { status: 200, ok: true, ready: true, latency_ms: 2500 },
        });
        expect(hasHighLatency(signals)).toBe(true);
      });
    });
  });

  describe('Status Determination (Combinatorial Tests)', () => {
    describe('GREEN status cases', () => {
      test('Case 1: All healthy, no deploy events', () => {
        const signals = createMockSignals();
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('GREEN');
        expect(result.reasons).toHaveLength(1);
        expect(result.reasons[0].code).toBe(REASON_CODES.ALL_HEALTHY);
        expect(result.reasons[0].severity).toBe('info');
      });

      test('Case 2: All healthy, with successful deploy events', () => {
        const signals = createMockSignals({
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'success',
              message: null,
            },
          ],
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('GREEN');
        expect(result.reasons[0].code).toBe(REASON_CODES.ALL_HEALTHY);
      });
    });

    describe('YELLOW status cases', () => {
      test('Case 3: Stale data (> 5 minutes)', () => {
        const signals: StatusSignals = {
          checked_at: new Date('2024-01-01T11:54:30Z').toISOString(), // 5.5 min ago
          health: { status: 200, ok: true, latency_ms: 50 },
          ready: { status: 200, ok: true, ready: true, latency_ms: 50 },
          deploy_events: [],
        };
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
          stalenessThresholdSeconds: 300,
        });

        expect(result.status).toBe('YELLOW');
        expect(result.reasons[0].code).toBe(REASON_CODES.STALE_DATA);
        expect(result.reasons[0].severity).toBe('warning');
        expect(result.staleness_seconds).toBeGreaterThan(300);
      });

      test('Case 4: Recent deploy warning', () => {
        const signals = createMockSignals({
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'success_with_warnings',
              message: null,
            },
          ],
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('YELLOW');
        expect(result.reasons[0].code).toBe(REASON_CODES.DEPLOY_WARNING);
        expect(result.reasons[0].severity).toBe('warning');
      });

      test('Case 5: High latency health check', () => {
        const signals = createMockSignals({
          health: { status: 200, ok: true, latency_ms: 2500 },
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('YELLOW');
        expect(result.reasons[0].code).toBe(REASON_CODES.HIGH_LATENCY);
        expect(result.reasons[0].severity).toBe('warning');
      });

      test('Case 6: High latency ready check', () => {
        const signals = createMockSignals({
          ready: { status: 200, ok: true, ready: true, latency_ms: 3000 },
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('YELLOW');
        expect(result.reasons[0].code).toBe(REASON_CODES.HIGH_LATENCY);
      });
    });

    describe('RED status cases', () => {
      test('Case 7: Missing health signal', () => {
        const signals = createMockSignals({ health: undefined });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('RED');
        expect(result.reasons[0].code).toBe(REASON_CODES.SIGNALS_MISSING);
        expect(result.reasons[0].severity).toBe('error');
      });

      test('Case 8: Missing ready signal', () => {
        const signals = createMockSignals({ ready: undefined });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('RED');
        expect(result.reasons[0].code).toBe(REASON_CODES.SIGNALS_MISSING);
      });

      test('Case 9: Health check failed (500)', () => {
        const signals = createMockSignals({
          health: { status: 500, ok: false, error: 'Internal Server Error', latency_ms: 50 },
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('RED');
        expect(result.reasons[0].code).toBe(REASON_CODES.HEALTH_FAIL);
        expect(result.reasons[0].severity).toBe('error');
      });

      test('Case 10: Health check timeout', () => {
        const signals = createMockSignals({
          health: { status: 0, ok: false, error: 'Request timeout', latency_ms: 5000 },
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('RED');
        expect(result.reasons[0].code).toBe(REASON_CODES.HEALTH_FAIL);
      });

      test('Case 11: Ready check failed (503)', () => {
        const signals = createMockSignals({
          ready: { status: 503, ok: false, ready: false, error: 'Service Unavailable', latency_ms: 50 },
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('RED');
        expect(result.reasons[0].code).toBe(REASON_CODES.READY_FAIL);
        expect(result.reasons[0].severity).toBe('error');
      });

      test('Case 12: Ready check returns ready=false', () => {
        const signals = createMockSignals({
          ready: { status: 200, ok: true, ready: false, latency_ms: 50 },
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('RED');
        expect(result.reasons[0].code).toBe(REASON_CODES.READY_FAIL);
      });

      test('Case 13: Recent deploy failure', () => {
        const signals = createMockSignals({
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'failed',
              message: 'Deployment failed',
            },
          ],
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('RED');
        expect(result.reasons[0].code).toBe(REASON_CODES.DEPLOY_FAILED);
        expect(result.reasons[0].severity).toBe('error');
      });

      test('Case 14: Deploy failure with error status', () => {
        const signals = createMockSignals({
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'deployment_error',
              message: null,
            },
          ],
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('RED');
        expect(result.reasons[0].code).toBe(REASON_CODES.DEPLOY_FAILED);
      });
    });

    describe('Priority and cascading rules', () => {
      test('Case 15: Missing signals takes priority over other failures', () => {
        const signals = createMockSignals({
          health: undefined,
          ready: { status: 503, ok: false, ready: false, latency_ms: 50 },
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('RED');
        expect(result.reasons[0].code).toBe(REASON_CODES.SIGNALS_MISSING);
      });

      test('Case 16: Health failure takes priority over ready failure', () => {
        const signals = createMockSignals({
          health: { status: 500, ok: false, latency_ms: 50 },
          ready: { status: 503, ok: false, ready: false, latency_ms: 50 },
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('RED');
        expect(result.reasons[0].code).toBe(REASON_CODES.HEALTH_FAIL);
      });

      test('Case 17: Ready failure takes priority over deploy failure', () => {
        const signals = createMockSignals({
          ready: { status: 503, ok: false, ready: false, latency_ms: 50 },
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'failed',
              message: null,
            },
          ],
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('RED');
        expect(result.reasons[0].code).toBe(REASON_CODES.READY_FAIL);
      });

      test('Case 18: Deploy failure takes priority over stale data', () => {
        const signals = createMockSignals({
          checked_at: new Date('2024-01-01T11:54:00Z').toISOString(), // Stale
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'failed',
              message: null,
            },
          ],
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
          stalenessThresholdSeconds: 300,
        });

        expect(result.status).toBe('RED');
        expect(result.reasons[0].code).toBe(REASON_CODES.DEPLOY_FAILED);
      });

      test('Case 19: Stale data takes priority over deploy warning', () => {
        const signals = createMockSignals({
          checked_at: new Date('2024-01-01T11:54:00Z').toISOString(),
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'success_with_warnings',
              message: null,
            },
          ],
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
          stalenessThresholdSeconds: 300,
        });

        expect(result.status).toBe('YELLOW');
        expect(result.reasons[0].code).toBe(REASON_CODES.STALE_DATA);
      });

      test('Case 20: Deploy warning takes priority over high latency', () => {
        const signals = createMockSignals({
          health: { status: 200, ok: true, latency_ms: 2500 },
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'success_with_warnings',
              message: null,
            },
          ],
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('YELLOW');
        expect(result.reasons[0].code).toBe(REASON_CODES.DEPLOY_WARNING);
      });
    });

    describe('Edge cases', () => {
      test('Case 21: Empty deploy events array', () => {
        const signals = createMockSignals({ deploy_events: [] });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('GREEN');
        expect(result.reasons[0].code).toBe(REASON_CODES.ALL_HEALTHY);
      });

      test('Case 22: Multiple deploy events, only old failures', () => {
        const signals = createMockSignals({
          deploy_events: [
            {
              id: '1',
              created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
              env: 'prod',
              service: 'api',
              version: 'v1.0.0',
              commit_hash: 'abc123',
              status: 'failed',
              message: null,
            },
          ],
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        expect(result.status).toBe('GREEN');
      });

      test('Case 23: Exactly at staleness threshold', () => {
        const signals: StatusSignals = {
          checked_at: new Date('2024-01-01T11:55:00Z').toISOString(), // Exactly 5 min ago
          health: { status: 200, ok: true, latency_ms: 50 },
          ready: { status: 200, ok: true, ready: true, latency_ms: 50 },
          deploy_events: [],
        };
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
          stalenessThresholdSeconds: 300,
        });

        // At threshold boundary, should not be considered stale
        expect(result.status).toBe('GREEN');
      });

      test('Case 24: Exactly at high latency threshold', () => {
        const signals = createMockSignals({
          health: { status: 200, ok: true, latency_ms: 2000 }, // Exactly at threshold
        });
        const result = determineDeployStatus({
          env: 'prod',
          signals,
          currentTime: fixedTime,
        });

        // At threshold boundary, should not be considered high latency
        expect(result.status).toBe('GREEN');
      });
    });
  });
});
