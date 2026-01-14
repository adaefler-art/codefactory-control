/**
 * API Route: Admin Tools Catalog
 *
 * GET /api/admin/tools/catalog
 *
 * Returns comprehensive, deterministic overview of all MCP servers & tools.
 * Data sourced from catalog.json (registry) with health status from cached checks.
 * Read-only, admin-only, no external calls on page load.
 */

import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { loadMCPCatalog, getMCPServersFromCatalog } from '@/lib/mcp-catalog';
import { getMCPClient } from '@/lib/mcp-client';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Check if user is admin based on AFU9_ADMIN_SUBS env var
 */
function isAdminUser(userId: string): boolean {
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) return false;
  const allowed = adminSubs.split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(userId);
}

/**
 * Generate a deterministic hash for schema objects
 */
function hashSchema(schema: Record<string, unknown> | undefined | null): string {
  if (!schema || typeof schema !== 'object') return 'none';
  const normalized = JSON.stringify(schema, Object.keys(schema).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

/**
 * Convert health check status to catalog health status
 */
function mapHealthStatus(status?: string): 'OK' | 'DEGRADED' | 'UNREACHABLE' {
  if (!status) return 'UNREACHABLE';
  if (status === 'ok') return 'OK';
  if (status === 'error') return 'UNREACHABLE';
  return 'DEGRADED';
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  // Admin-only guard
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      code: 'UNAUTHORIZED',
      details: 'Authentication required - no verified user context',
    });
  }

  if (!isAdminUser(userId)) {
    return errorResponse('Forbidden', {
      status: 403,
      requestId,
      code: 'FORBIDDEN',
      details: 'Admin privileges required',
    });
  }

  try {
    // Load catalog (deterministic source)
    const catalog = loadMCPCatalog();
    if (!catalog) {
      return errorResponse('Catalog Not Found', {
        status: 500,
        requestId,
        code: 'CATALOG_NOT_FOUND',
        details: 'MCP catalog.json not found or invalid',
      });
    }

    const catalogServers = getMCPServersFromCatalog();

    // Get health status (cached, no external calls on demand)
    const client = getMCPClient();
    let healthChecks: Map<string, { status: string; timestamp?: string; error?: string }>;
    try {
      healthChecks = await client.checkAllHealth();
    } catch (error) {
      console.warn('[Tools Catalog] Health check failed, using fallback', error);
      healthChecks = new Map();
    }

    // Build deterministic server list
    const servers = catalogServers
      .map((server) => {
        const health = healthChecks.get(server.name);
        const healthStatus = mapHealthStatus(health?.status);

        // Build tool list with hashes
        const tools = (server.tools || []).map((tool) => ({
          toolId: tool.name,
          description: tool.description || '',
          inputSchemaHash: hashSchema(tool.inputSchema),
          outputSchemaHash: hashSchema(tool.outputSchema),
          lastUsedAt: null, // Not tracked in Phase 1
          contractVersion: tool.contractVersion,
        }));

        // Sort tools alphabetically by toolId
        tools.sort((a, b) => a.toolId.localeCompare(b.toolId));

        return {
          name: server.name,
          displayName: server.displayName,
          kind: 'mcp-server' as const,
          version: server.contractVersion,
          env: server.endpoint,
          port: server.port,
          health: healthStatus,
          source: 'Registry' as const,
          tools,
          toolCount: tools.length,
        };
      })
      // Sort servers alphabetically by name
      .sort((a, b) => a.name.localeCompare(b.name));

    return jsonResponse(
      {
        ok: true,
        catalogVersion: catalog.catalogVersion,
        generatedAt: catalog.generatedAt,
        servers,
        serverCount: servers.length,
        totalToolCount: servers.reduce((sum, s) => sum + s.toolCount, 0),
        timestamp: new Date().toISOString(),
      },
      {
        requestId,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('[Tools Catalog] Error loading catalog:', error);
    return errorResponse('Internal Server Error', {
      status: 500,
      requestId,
      code: 'CATALOG_ERROR',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
