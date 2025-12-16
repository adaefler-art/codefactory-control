/**
 * API Route: MCP Health Check
 * 
 * GET /api/mcp/health
 * 
 * Checks the health status of all configured MCP servers.
 * Emits CloudWatch metrics for Factory Uptime tracking.
 */

import { NextResponse } from 'next/server';
import { getMCPClient } from '../../../../src/lib/mcp-client';
import { factoryMetrics } from '../../../../src/lib/factory-metrics';

export async function GET() {
  try {
    console.log('[API] Checking MCP server health');

    const client = getMCPClient();
    const healthChecks = await client.checkAllHealth();

    const healthMap: Record<string, any> = {};
    healthChecks.forEach((health, serverName) => {
      healthMap[serverName] = health;
      
      // Emit individual service health metrics
      factoryMetrics.emitServiceHealth(
        serverName, 
        health.status === 'ok'
      ).catch(err => console.error('[Metrics] Failed to emit service health', err));
    });

    const allHealthy = Array.from(healthChecks.values()).every(
      (h) => h.status === 'ok'
    );

    // Emit factory availability metric
    factoryMetrics.emitAvailability(allHealthy).catch(err => 
      console.error('[Metrics] Failed to emit availability', err)
    );

    console.log('[API] MCP health check completed', {
      serversCount: healthChecks.size,
      allHealthy,
    });

    return NextResponse.json({
      status: allHealthy ? 'healthy' : 'degraded',
      servers: healthMap,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Error checking MCP health:', error);
    
    // Emit failure metric
    factoryMetrics.emitAvailability(false).catch(err => 
      console.error('[Metrics] Failed to emit availability', err)
    );
    
    return NextResponse.json(
      {
        status: 'error',
        error: 'Failed to check MCP server health',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
