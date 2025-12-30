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

const DEFAULT_TIMEOUT_MS = 5000;

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
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<{
  status: number;
  ok: boolean;
  response?: any;
  error?: string;
  error_name?: string;
  error_code?: string;
  latency_ms: number;
  url?: string;
  timeout_ms?: number;
}> {
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
      url,
      timeout_ms: timeoutMs,
    };
  } catch (error) {
    const latency_ms = Date.now() - startTime;

    const anyError = error as any;
    const anyCause = anyError?.cause as any;
    const error_name: string | undefined = anyError?.name;
    const error_code: string | undefined = anyCause?.code ?? anyError?.code;
    const error_message = error instanceof Error ? error.message : 'Unknown error';

    return {
      status: 0,
      ok: false,
      error: error_code ? `${error_message} (code=${error_code})` : error_message,
      error_name,
      error_code,
      latency_ms,
      url,
      timeout_ms: timeoutMs,
    };
  }
}

function getDeployStatusBaseUrlCandidates(explicitBaseUrl?: string): string[] {
  if (explicitBaseUrl) {
    return [explicitBaseUrl];
  }

  const candidates: string[] = [];

  // Highest precedence: explicit override for the deploy status monitor.
  const overrideBaseUrl = process.env.AFU9_DEPLOY_STATUS_BASE_URL;
  if (overrideBaseUrl) {
    candidates.push(overrideBaseUrl);
  }

  // Prefer loopback to avoid requiring VPC egress/NAT just to self-check.
  const port = process.env.PORT || '3000';
  candidates.push(`http://127.0.0.1:${port}`);

  // Fallback: public URL (may require egress in some ECS/VPC setups).
  const publicBaseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (publicBaseUrl) {
    candidates.push(publicBaseUrl);
  }

  // De-dup while preserving order.
  return Array.from(new Set(candidates));
}

async function fetchFromCandidates(
  path: string,
  baseUrls: string[],
  timeoutMs: number
): Promise<{ result: any; attempted_urls: string[]; base_url?: string }> {
  const attempted_urls: string[] = [];
  let lastResult: any;

  for (const baseUrl of baseUrls) {
    const url = `${baseUrl}${path}`;
    attempted_urls.push(url);
    const result = await fetchWithTimeout(url, timeoutMs);
    lastResult = { ...result, base_url: baseUrl, attempted_urls };

    // If we got an HTTP response, keep it (even if it is non-2xx).
    if (result.status !== 0) {
      return { result: lastResult, attempted_urls, base_url: baseUrl };
    }
  }

  return { result: lastResult, attempted_urls, base_url: lastResult?.base_url };
}

/**
 * Collect signals for deploy status determination
 * 
 * @param pool - Database connection pool (optional, for deploy events)
 * @param options - Collection options
 * @returns StatusSignals with all collected data
 * 
 * Base URL selection (in order):
 * 1) options.baseUrl (explicit)
 * 2) AFU9_DEPLOY_STATUS_BASE_URL (explicit override for the monitor)
 * 3) http://127.0.0.1:${PORT||3000} (preferred: avoids requiring egress/NAT)
 * 4) NEXT_PUBLIC_APP_URL (fallback: may require egress in some VPC setups)
 *
 * If a candidate fails with a network error (status=0), the collector will try the next candidate.
 */
export async function collectStatusSignals(
  pool: Pool | null,
  options: SignalCollectorOptions
): Promise<StatusSignals> {
  const {
    env,
    baseUrl,
    timeout = DEFAULT_TIMEOUT_MS,
    includeDeployEvents = true,
  } = options;

  const baseUrlCandidates = getDeployStatusBaseUrlCandidates(baseUrl);
  const debugEnabled = process.env.AFU9_DEBUG_DEPLOY_STATUS === 'true';

  if (debugEnabled) {
    console.log(
      JSON.stringify({
        level: 'debug',
        component: 'deploy-status.signal-collector',
        message: 'Resolved baseUrl candidates for health checks',
        env,
        candidates: baseUrlCandidates,
        timeout_ms: timeout,
        timestamp: new Date().toISOString(),
      })
    );
  }

  const signals: StatusSignals = {
    checked_at: new Date().toISOString(),
  };

  // Collect health check signal
  try {
    const { result } = await fetchFromCandidates('/api/health', baseUrlCandidates, timeout);
    signals.health = result;
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
    const { result } = await fetchFromCandidates('/api/ready', baseUrlCandidates, timeout);
    signals.ready = {
      ...result,
      ready: result.ok && result.response?.ready === true,
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
