/**
 * API Route: GET /api/intent/capabilities
 * 
 * E86.2 - Capability Manifest Endpoint
 * 
 * Returns machine-readable truth about what INTENT can currently do.
 * Capabilities are derived from:
 * - Tool Registry (intent-tool-registry.ts)
 * - MCP Catalog (docs/mcp/catalog.json)
 * - Feature Flags (flags-env-catalog.ts)
 * - Lawbook Constraints (active lawbook)
 * 
 * Response is deterministic and cacheable via ETag.
 * 
 * SECURITY:
 * - Requires x-afu9-sub header (auth-protected)
 * - Read-only endpoint (no mutations)
 * - Returns capability metadata only (no secrets)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { buildCapabilityManifest } from '@/lib/capability-manifest-service';

/**
 * GET /api/intent/capabilities
 * 
 * Returns current capability manifest
 * 
 * Response:
 * {
 *   version: "2026-01-14",
 *   hash: "sha256:...",
 *   capabilities: [
 *     {
 *       id: "create_issue_draft",
 *       kind: "tool",
 *       source: "intent_registry",
 *       constraints: ["prod_blocked"]
 *     },
 *     ...
 *   ],
 *   sources: {
 *     intentTools: 10,
 *     mcpTools: 25,
 *     featureFlags: 30,
 *     lawbookConstraints: 3
 *   }
 * }
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  // AUTH CHECK: Require x-afu9-sub header (set by middleware after JWT verification)
  const userId = request.headers.get('x-afu9-sub');
  if (!userId) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      details: 'Authentication required to access capability manifest',
    });
  }

  try {
    // Build capability manifest with user context
    // Note: sessionId is not available here, so we use a placeholder
    // The manifest is user-agnostic anyway (gates evaluated per-user basis)
    const manifest = await buildCapabilityManifest({
      userId,
      sessionId: 'manifest-request', // Placeholder - not used for manifest generation
    });

    // Check If-None-Match header for ETag caching
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch === manifest.hash) {
      // Client already has current version
      return new NextResponse(null, {
        status: 304, // Not Modified
        headers: {
          'ETag': manifest.hash,
          'Cache-Control': 'public, max-age=300', // 5 minutes
        },
      });
    }

    // Return manifest with ETag
    return jsonResponse(manifest, {
      requestId,
      headers: {
        'ETag': manifest.hash,
        'Cache-Control': 'public, max-age=300', // 5 minutes (manifest is stable)
      },
    });
  } catch (error) {
    console.error('[API /api/intent/capabilities] Error building manifest:', error);
    return errorResponse('Failed to build capability manifest', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
