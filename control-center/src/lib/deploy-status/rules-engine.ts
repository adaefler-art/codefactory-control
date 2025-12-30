/**
 * Deploy Status Rules Engine (E65.1)
 * 
 * Pure, deterministic functions for deploy status determination.
 * All rules are testable without external dependencies.
 * 
 * Status Rules:
 * - GREEN: /api/ready OK (200) AND no active deployment failures
 * - YELLOW: /api/health ok but /api/ready not ok OR ready ok but warning signals
 * - RED: /api/health not ok OR ready permanently fail OR deploy failed OR signals missing
 */

import {
  DeployStatus,
  StatusReason,
  StatusSignals,
  DeployEnvironment,
} from '../contracts/deployStatus';

/**
 * Reason codes for status determination
 */
export const REASON_CODES = {
  // GREEN reasons
  ALL_HEALTHY: 'ALL_HEALTHY',
  
  // YELLOW reasons
  READY_DEGRADED: 'READY_DEGRADED',
  HEALTH_WARNING: 'HEALTH_WARNING',
  DEPLOY_WARNING: 'DEPLOY_WARNING',
  STALE_DATA: 'STALE_DATA',
  HIGH_LATENCY: 'HIGH_LATENCY',
  
  // RED reasons
  HEALTH_FAIL: 'HEALTH_FAIL',
  READY_FAIL: 'READY_FAIL',
  DEPLOY_FAILED: 'DEPLOY_FAILED',
  SIGNALS_MISSING: 'SIGNALS_MISSING',
  SIGNALS_ERROR: 'SIGNALS_ERROR',
} as const;

/**
 * Status determination input
 */
export interface StatusDeterminationInput {
  env: DeployEnvironment;
  signals: StatusSignals;
  currentTime?: Date;
  stalenessThresholdSeconds?: number;
}

/**
 * Status determination result
 */
export interface StatusDeterminationResult {
  status: DeployStatus;
  reasons: StatusReason[];
  staleness_seconds: number;
}

/**
 * Check if health endpoint is healthy
 */
export function isHealthHealthy(signals: StatusSignals): boolean {
  if (!signals.health) return false;
  return signals.health.ok && signals.health.status === 200;
}

/**
 * Check if ready endpoint is ready
 */
export function isReadyHealthy(signals: StatusSignals): boolean {
  if (!signals.ready) return false;
  return signals.ready.ok && signals.ready.status === 200 && signals.ready.ready === true;
}

/**
 * Check if there are recent deploy failures
 */
export function hasRecentDeployFailure(
  signals: StatusSignals,
  lookbackMinutes: number = 30,
  currentTime: Date = new Date()
): boolean {
  if (!signals.deploy_events || signals.deploy_events.length === 0) {
    return false;
  }

  const lookbackMs = lookbackMinutes * 60 * 1000;

  return signals.deploy_events.some(event => {
    const eventTime = new Date(event.created_at);
    const ageMs = currentTime.getTime() - eventTime.getTime();
    
    if (ageMs > lookbackMs) return false;
    
    // Check for failure status indicators
    const status = event.status.toLowerCase();
    return status.includes('fail') || status.includes('error') || status === 'failed';
  });
}

/**
 * Check if there are recent deploy warnings
 */
export function hasRecentDeployWarning(
  signals: StatusSignals,
  lookbackMinutes: number = 30,
  currentTime: Date = new Date()
): boolean {
  if (!signals.deploy_events || signals.deploy_events.length === 0) {
    return false;
  }

  const lookbackMs = lookbackMinutes * 60 * 1000;

  return signals.deploy_events.some(event => {
    const eventTime = new Date(event.created_at);
    const ageMs = currentTime.getTime() - eventTime.getTime();
    
    if (ageMs > lookbackMs) return false;
    
    // Check for warning status indicators
    const status = event.status.toLowerCase();
    return status.includes('warn') || status.includes('degraded');
  });
}

/**
 * Calculate staleness in seconds
 */
export function calculateStaleness(
  signals: StatusSignals,
  currentTime: Date = new Date()
): number {
  const checkedAt = new Date(signals.checked_at);
  return Math.floor((currentTime.getTime() - checkedAt.getTime()) / 1000);
}

/**
 * Check if signals are too stale
 */
export function isDataStale(
  signals: StatusSignals,
  currentTime: Date = new Date(),
  thresholdSeconds: number = 300 // 5 minutes default
): boolean {
  const staleness = calculateStaleness(signals, currentTime);
  return staleness > thresholdSeconds;
}

/**
 * Check if any critical signals are missing
 */
export function hasMissingSignals(signals: StatusSignals): boolean {
  // At minimum, we need health and ready checks
  return !signals.health || !signals.ready || !signals.checked_at;
}

/**
 * Check if health check has high latency
 */
export function hasHighLatency(signals: StatusSignals, thresholdMs: number = 2000): boolean {
  if (signals.health?.latency_ms && signals.health.latency_ms > thresholdMs) {
    return true;
  }
  if (signals.ready?.latency_ms && signals.ready.latency_ms > thresholdMs) {
    return true;
  }
  return false;
}

/**
 * Determine deploy status based on signals
 * 
 * This is the core rules engine - pure and deterministic.
 */
export function determineDeployStatus(
  input: StatusDeterminationInput
): StatusDeterminationResult {
  const { signals, currentTime = new Date(), stalenessThresholdSeconds = 300 } = input;
  const reasons: StatusReason[] = [];

  // Calculate staleness
  const staleness_seconds = calculateStaleness(signals, currentTime);

  // Rule 1: Check for missing signals (RED)
  if (hasMissingSignals(signals)) {
    reasons.push({
      code: REASON_CODES.SIGNALS_MISSING,
      severity: 'error',
      message: 'Critical health signals are missing',
      evidence: {
        has_health: !!signals.health,
        has_ready: !!signals.ready,
        has_checked_at: !!signals.checked_at,
      },
    });
    return { status: 'RED', reasons, staleness_seconds };
  }

  // Rule 2: Check for health endpoint failure (RED)
  if (!isHealthHealthy(signals)) {
    reasons.push({
      code: REASON_CODES.HEALTH_FAIL,
      severity: 'error',
      message: 'Health check endpoint is not responding correctly',
      evidence: {
        status: signals.health?.status,
        ok: signals.health?.ok,
        error: signals.health?.error,
        url: signals.health?.url,
        base_url: signals.health?.base_url,
        timeout_ms: signals.health?.timeout_ms,
        error_name: signals.health?.error_name,
        error_code: signals.health?.error_code,
        attempted_urls: signals.health?.attempted_urls,
      },
    });
    return { status: 'RED', reasons, staleness_seconds };
  }

  // Rule 3: Check for ready endpoint failure (RED)
  if (!isReadyHealthy(signals)) {
    reasons.push({
      code: REASON_CODES.READY_FAIL,
      severity: 'error',
      message: 'Ready check endpoint indicates service is not ready',
      evidence: {
        status: signals.ready?.status,
        ok: signals.ready?.ok,
        ready: signals.ready?.ready,
        error: signals.ready?.error,
        url: signals.ready?.url,
        base_url: signals.ready?.base_url,
        timeout_ms: signals.ready?.timeout_ms,
        error_name: signals.ready?.error_name,
        error_code: signals.ready?.error_code,
        attempted_urls: signals.ready?.attempted_urls,
      },
    });
    return { status: 'RED', reasons, staleness_seconds };
  }

  // Rule 4: Check for recent deploy failures (RED)
  if (hasRecentDeployFailure(signals, 30, currentTime)) {
    reasons.push({
      code: REASON_CODES.DEPLOY_FAILED,
      severity: 'error',
      message: 'Recent deployment failure detected',
      evidence: {
        recent_events: signals.deploy_events?.slice(0, 3).map(e => ({
          status: e.status,
          created_at: e.created_at,
          service: e.service,
        })),
      },
    });
    return { status: 'RED', reasons, staleness_seconds };
  }

  // Rule 5: Check for stale data (YELLOW)
  if (isDataStale(signals, currentTime, stalenessThresholdSeconds)) {
    reasons.push({
      code: REASON_CODES.STALE_DATA,
      severity: 'warning',
      message: `Signal data is stale (${staleness_seconds}s old)`,
      evidence: {
        staleness_seconds,
        threshold_seconds: stalenessThresholdSeconds,
        checked_at: signals.checked_at,
      },
    });
    return { status: 'YELLOW', reasons, staleness_seconds };
  }

  // Rule 6: Check for deploy warnings (YELLOW)
  if (hasRecentDeployWarning(signals, 30, currentTime)) {
    reasons.push({
      code: REASON_CODES.DEPLOY_WARNING,
      severity: 'warning',
      message: 'Recent deployment completed with warnings',
      evidence: {
        recent_events: signals.deploy_events?.slice(0, 3).map(e => ({
          status: e.status,
          created_at: e.created_at,
          service: e.service,
        })),
      },
    });
    return { status: 'YELLOW', reasons, staleness_seconds };
  }

  // Rule 7: Check for high latency (YELLOW)
  if (hasHighLatency(signals)) {
    reasons.push({
      code: REASON_CODES.HIGH_LATENCY,
      severity: 'warning',
      message: 'Health check endpoints have high latency',
      evidence: {
        health_latency_ms: signals.health?.latency_ms,
        ready_latency_ms: signals.ready?.latency_ms,
      },
    });
    return { status: 'YELLOW', reasons, staleness_seconds };
  }

  // All checks passed - GREEN
  reasons.push({
    code: REASON_CODES.ALL_HEALTHY,
    severity: 'info',
    message: 'All health checks passing',
    evidence: {
      health_ok: true,
      ready_ok: true,
      no_recent_failures: true,
    },
  });

  return { status: 'GREEN', reasons, staleness_seconds };
}
