/**
 * Deploy Status Signal Collector (E65.1)
 * 
 * Collects health signals from various sources:
 * - HTTP health checks (/api/health, /api/ready)
 * - Database deploy events
 * - (Future: ECS/ALB status from AWS APIs)
 */

import { Pool } from 'pg';
import { StatusSignals, DeployEnvironment } from '../contracts/deployStatus';
import { getLatestDeployEvents } from '../db/deployStatusSnapshots';

/**
 * Signal collection options
 */
export interface SignalCollectorOptions {
  env: DeployEnvironment;
  baseUrl?: string;
  timeout?: number;
  includeDeployEvents?: boolean;
}

/**
 * Fetch with timeout helper
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number = 5000
): Promise<{ status: number; ok: boolean; response?: any; error?: string; latency_ms: number }> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'AFU9-DeployStatusMonitor/1.0',
      },
    });
    
    const latency_ms = Date.now() - startTime;
    
    let responseData;
    try {
      responseData = await response.json();
    } catch {
      // Response is not JSON, that's okay
      responseData = undefined;
    }
    
    return {
      status: response.status,
      ok: response.ok,
      response: responseData,
      latency_ms,
    };
  } catch (error) {
    const latency_ms = Date.now() - startTime;
    return {
      status: 0,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      latency_ms,
    };
  }
}

/**
 * Collect signals for deploy status determination
 * 
 * @param pool - Database connection pool (optional, for deploy events)
 * @param options - Collection options
 * @returns StatusSignals with all collected data
 */
export async function collectStatusSignals(
  pool: Pool | null,
  options: SignalCollectorOptions
): Promise<StatusSignals> {
  const {
    env,
    baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    timeout = 5000,
    includeDeployEvents = true,
  } = options;

  const signals: StatusSignals = {
    checked_at: new Date().toISOString(),
  };

  // Collect health check signal
  try {
    const healthResult = await fetchWithTimeout(`${baseUrl}/api/health`, timeout);
    signals.health = healthResult;
  } catch (error) {
    signals.health = {
      status: 0,
      ok: false,
      error: error instanceof Error ? error.message : 'Health check failed',
      latency_ms: 0,
    };
  }

  // Collect ready check signal
  try {
    const readyResult = await fetchWithTimeout(`${baseUrl}/api/ready`, timeout);
    signals.ready = {
      ...readyResult,
      ready: readyResult.ok && readyResult.response?.ready === true,
    };
  } catch (error) {
    signals.ready = {
      status: 0,
      ok: false,
      ready: false,
      error: error instanceof Error ? error.message : 'Ready check failed',
      latency_ms: 0,
    };
  }

  // Collect deploy events from database if enabled and pool available
  if (includeDeployEvents && pool) {
    try {
      const eventsResult = await getLatestDeployEvents(pool, env, 5);
      if (eventsResult.success && eventsResult.events) {
        signals.deploy_events = eventsResult.events;
      } else {
        signals.deploy_events = [];
      }
    } catch (error) {
      console.error('[SignalCollector] Failed to fetch deploy events:', error);
      signals.deploy_events = [];
    }
  } else {
    signals.deploy_events = [];
  }

  return signals;
}

/**
 * Create mock signals for testing (injectable dependency)
 */
export function createMockSignals(overrides?: Partial<StatusSignals>): StatusSignals {
  return {
    checked_at: new Date().toISOString(),
    health: {
      status: 200,
      ok: true,
      response: { status: 'ok' },
      latency_ms: 50,
    },
    ready: {
      status: 200,
      ok: true,
      ready: true,
      response: { ready: true },
      latency_ms: 100,
    },
    deploy_events: [],
    ...overrides,
  };
}
