/**
 * API Route: MCP Health Check
 * 
 * GET /api/mcp/health
 * 
 * Checks the health status of all configured MCP servers.
 * Emits CloudWatch metrics for Factory Uptime tracking.
 * Returns catalog-driven server list with health status.
 */

import { NextResponse } from 'next/server';
import { getMCPClient } from '../../../../src/lib/mcp-client';
import { factoryMetrics } from '../../../../src/lib/factory-metrics';
import { getMCPServersFromCatalog, loadMCPCatalog } from '../../../../src/lib/mcp-catalog';

export async function GET() {
  try {
    console.log('[API] Checking MCP server health');

    const client = getMCPClient();
    const healthChecks = await client.checkAllHealth();
    
    // Load server definitions from catalog
    const catalogServers = getMCPServersFromCatalog();
    const catalog = loadMCPCatalog();

    const healthMap: Record<string, any> = {};
    
    // Build health map with catalog information
    catalogServers.forEach((server) => {
      const health = healthChecks.get(server.name);
      
      healthMap[server.name] = {
        status: health?.status || 'unknown',
        endpoint: server.endpoint,
        displayName: server.displayName,
        port: server.port,
        toolCount: server.tools?.length || 0,
        timestamp: health?.timestamp || new Date().toISOString(),
        error: health?.error,
      };
      
      // Emit individual service health metrics
      if (health) {
        factoryMetrics.emitServiceHealth(
          server.name, 
          health.status === 'ok'
        ).catch(err => console.error('[Metrics] Failed to emit service health', err));
      }
    });

    const allHealthy = Array.from(healthChecks.values()).every(
      (h) => h.status === 'ok'
    );

    // Emit factory availability metric
    factoryMetrics.emitAvailability(allHealthy).catch(err => 
      console.error('[Metrics] Failed to emit availability', err)
    );

    console.log('[API] MCP health check completed', {
      serversCount: catalogServers.length,
      allHealthy,
    });

    return NextResponse.json({
      status: allHealthy ? 'healthy' : 'degraded',
      servers: healthMap,
      catalogVersion: catalog?.catalogVersion || 'unknown',
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
