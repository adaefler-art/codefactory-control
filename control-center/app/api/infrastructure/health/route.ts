/**
 * API Route: Infrastructure Health
 * 
 * GET /api/infrastructure/health
 * 
 * Fetches infrastructure health metrics from the observability MCP server.
 */

import { NextResponse } from 'next/server';
import { getMCPClient } from '../../../../src/lib/mcp-client';

export async function GET() {
  try {
    console.log('[API] Fetching infrastructure health metrics');

    const client = getMCPClient();
    
    // Get ECS service health metrics
    // These values should be configurable via environment variables in production
    const cluster = process.env.ECS_CLUSTER_NAME || 'afu9-cluster';
    const service = process.env.ECS_SERVICE_NAME || 'afu9-control-center';
    const loadBalancerName = process.env.ALB_NAME;
    const targetGroupArn = process.env.TARGET_GROUP_ARN;

    try {
      const healthMetrics = await client.callTool(
        'observability',
        'metrics.getServiceHealth',
        {
          cluster,
          service,
          loadBalancerName,
          targetGroupArn,
          period: 300, // 5 minutes
        },
        {
          timeoutMs: 15000, // 15 second timeout for metrics
        }
      );

      console.log('[API] Successfully fetched infrastructure health metrics');

      return NextResponse.json({
        status: 'ok',
        cluster,
        service,
        metrics: healthMetrics,
        timestamp: new Date().toISOString(),
      });
    } catch (mcpError) {
      // If MCP call fails, return a graceful degraded state
      console.warn('[API] MCP call failed, returning degraded state:', mcpError);
      
      return NextResponse.json({
        status: 'unavailable',
        cluster,
        service,
        error: 'Metrics unavailable - MCP server may be unreachable',
        message: mcpError instanceof Error ? mcpError.message : String(mcpError),
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('[API] Error fetching infrastructure health:', error);
    
    return NextResponse.json(
      {
        status: 'error',
        error: 'Failed to fetch infrastructure health',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
