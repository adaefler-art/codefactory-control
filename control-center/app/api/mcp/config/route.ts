/**
 * API Route: MCP Effective Configuration
 * 
 * GET /api/mcp/config
 * 
 * Returns the effective MCP configuration showing which endpoints and ports
 * are actually being used by the Control Center at runtime.
 * This allows detection of catalog drift vs. reality.
 */

import { NextResponse } from 'next/server';
import { getMCPClient } from '../../../../src/lib/mcp-client';
import { loadMCPCatalog, getMCPServersFromCatalog } from '../../../../src/lib/mcp-catalog';

export async function GET() {
  try {
    console.log('[API] Retrieving effective MCP configuration');

    const client = getMCPClient();
    const runtimeServers = client.getServers();
    
    // Load catalog for comparison
    const catalog = loadMCPCatalog();
    const catalogServers = getMCPServersFromCatalog();

    // Build effective configuration map showing what's actually configured
    const effectiveConfig = runtimeServers.map((server) => {
      const catalogServer = catalogServers.find(cs => cs.name === server.name);
      
      return {
        name: server.name,
        endpoint: server.endpoint,
        enabled: server.enabled,
        healthCheckUrl: server.healthCheckUrl,
        timeoutMs: server.timeoutMs,
        maxRetries: server.maxRetries,
        retryDelayMs: server.retryDelayMs,
        backoffMultiplier: server.backoffMultiplier,
        // Include catalog info for comparison
        catalogEndpoint: catalogServer?.endpoint,
        catalogPort: catalogServer?.port,
        catalogContractVersion: catalogServer?.contractVersion,
        // Drift detection flags
        endpointMismatch: catalogServer ? (server.endpoint !== catalogServer.endpoint) : null,
        missingInCatalog: !catalogServer,
      };
    });

    // Check for servers in catalog but not in runtime config
    const runtimeServerNames = new Set(runtimeServers.map(s => s.name));
    const catalogOnlyServers = catalogServers
      .filter(cs => !runtimeServerNames.has(cs.name))
      .map(cs => ({
        name: cs.name,
        catalogEndpoint: cs.endpoint,
        catalogPort: cs.port,
        catalogContractVersion: cs.contractVersion,
        missingInRuntime: true,
      }));

    // Detect drift
    const hasDrift = effectiveConfig.some(s => s.endpointMismatch || s.missingInCatalog) ||
                     catalogOnlyServers.length > 0;

    console.log('[API] Effective MCP config retrieved', {
      serverCount: effectiveConfig.length,
      catalogOnlyCount: catalogOnlyServers.length,
      hasDrift,
    });

    return NextResponse.json({
      ok: true,
      effectiveConfig,
      catalogOnlyServers,
      hasDrift,
      catalogVersion: catalog?.catalogVersion || 'unknown',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Error retrieving effective MCP config:', error);
    
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to retrieve effective MCP configuration',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
