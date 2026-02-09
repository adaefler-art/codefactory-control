import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';
import { getBuildInfo } from '@/lib/build/build-info';

const HEALTH_CONTRACT_VERSION = '2026-01-26';

/**
 * Health check endpoint for ALB health checks and ECS container health checks
 * 
 * **LIVENESS PROBE** - This endpoint checks if the service process is running.
 * 
 * CRITICAL: This endpoint MUST NEVER return non-200 status codes.
 * - Used by ECS health checks - failure causes container replacement
 * - Used by ALB target group health checks - failure removes instance from load balancer
 * - Failing this check blocks deployments and triggers rollbacks
 * 
 * This endpoint is intentionally simple and has NO dependency checks:
 * - No database connectivity checks
 * - No external API calls
 * - No MCP server checks
 * - No configuration validation
 * 
 * For dependency validation, use /api/ready instead.
 * 
 * Response time target: < 100ms
 * @see /api/ready for readiness checks with dependency validation
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const startedAt = Date.now();

  const stage = process.env.AFU9_STAGE || process.env.NODE_ENV || 'unknown';
  const intentEnabled = process.env.AFU9_INTENT_ENABLED === 'true';

  try {
    const buildInfo = getBuildInfo();

    return jsonResponse(
      {
        ok: true,
        service: 'afu9-control-center',
        healthContractVersion: HEALTH_CONTRACT_VERSION,
        stage,
        commitSha: buildInfo.gitSha,
        buildTime: buildInfo.buildTime,
        version: buildInfo.appVersion,
        intentEnabled,
        timestamp: new Date().toISOString(),
      },
      { status: 200, requestId }
    );
  } catch (error) {
    console.error('Health check encountered error (still returning 200):', error);

    return jsonResponse(
      {
        ok: true,
        service: 'afu9-control-center',
        healthContractVersion: HEALTH_CONTRACT_VERSION,
        stage,
        commitSha: 'unknown',
        buildTime: 'unknown',
        version: 'unknown',
        intentEnabled,
        timestamp: new Date().toISOString(),
      },
      { status: 200, requestId }
    );
  } finally {
    const durationMs = Date.now() - startedAt;
    console.debug('[API] /api/health accessed', {
      requestId,
      durationMs,
    });
  }
}
