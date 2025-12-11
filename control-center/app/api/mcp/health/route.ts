/**
 * API Route: MCP Health Check
 * 
 * GET /api/mcp/health
 * 
 * Checks the health status of all configured MCP servers.
 */

import { NextResponse } from 'next/server';
import { getMCPClient } from '../../../../src/lib/mcp-client';

export async function GET() {
  try {
    console.log('[API] Checking MCP server health');

    const client = getMCPClient();
    const healthChecks = await client.checkAllHealth();

    const healthMap: Record<string, any> = {};
    healthChecks.forEach((health, serverName) => {
      healthMap[serverName] = health;
    });

    const allHealthy = Array.from(healthChecks.values()).every(
      (h) => h.status === 'ok'
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
