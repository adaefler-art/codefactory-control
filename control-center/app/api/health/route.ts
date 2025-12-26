import { NextRequest, NextResponse } from 'next/server';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';

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
  
  try {
    // Simple liveness check - if we can execute this code, the process is alive
    return jsonResponse(
      {
        status: 'ok',
        service: 'afu9-control-center',
        version: '0.2.5',
        database_enabled: process.env.DATABASE_ENABLED === 'true',
        timestamp: new Date().toISOString(),
      },
      { status: 200, requestId }
    );
  } catch (error) {
    // Even in case of unexpected errors, return 200 to prevent deployment blocking
    // Log the error but keep the service running
    console.error('Health check encountered error (still returning 200):', error);
    return jsonResponse(
      {
        status: 'ok',
        service: 'afu9-control-center',
        version: '0.2.5',
        database_enabled: process.env.DATABASE_ENABLED === 'true',
        timestamp: new Date().toISOString(),
        warning: 'Health check executed with degraded performance',
      },
      { status: 200, requestId }
    );
  }
}
