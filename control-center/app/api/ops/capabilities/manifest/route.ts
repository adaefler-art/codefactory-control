/**
 * API Route: GET /api/ops/capabilities/manifest
 * 
 * E89.8 - Capabilities Registry Manifest Endpoint
 * 
 * Returns deterministic, versioned manifest of all capabilities with latest probe status.
 * Combines data from:
 * - Capability Manifest Service (buildCapabilityManifest)
 * - Capability Probe Results (getLatestProbeResults)
 * 
 * Response includes:
 * - version: ISO date (YYYY-MM-DD)
 * - hash: SHA256 of sorted capabilities
 * - capabilities: List of all capabilities with probe status
 * - sources: Count by source type
 * 
 * SECURITY:
 * - Requires x-afu9-sub header (auth-protected)
 * - Read-only endpoint (no mutations)
 * - Returns capability metadata only (no secrets)
 * - Cacheable with ETag
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { buildCapabilityManifest } from '@/lib/capability-manifest-service';
import { getLatestProbeResults } from '@/lib/capability-probe-service';
import { getPool } from '@/lib/db';
import * as crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Capability entry with probe status
 */
interface CapabilityWithProbe {
  id: string;
  kind: string;
  source: string;
  description?: string;
  constraints?: string[];
  metadata?: Record<string, unknown>;
  // Probe status
  lastProbeAt?: string;
  lastProbeStatus?: string;
  lastProbeLatencyMs?: number;
  lastProbeError?: string;
  enabled: boolean;
  requiresApproval?: boolean;
  version?: string;
}

/**
 * GET /api/ops/capabilities/manifest
 * 
 * Returns versioned capability manifest with probe status
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
    // Build base capability manifest
    const manifest = await buildCapabilityManifest({
      userId,
      sessionId: 'manifest-request',
    });

    // Get latest probe results from database
    const pool = getPool();
    let probeResults: Awaited<ReturnType<typeof getLatestProbeResults>> = [];
    
    try {
      probeResults = await getLatestProbeResults(pool);
    } catch (error) {
      console.warn('[Capabilities Manifest] Failed to load probe results:', error);
      // Continue without probe results - manifest is still valid
    }

    // Create probe lookup map
    const probeMap = new Map(
      probeResults.map(probe => [probe.capabilityName, probe])
    );

    // Merge manifest with probe data
    const capabilitiesWithProbes: CapabilityWithProbe[] = manifest.capabilities.map(cap => {
      const probe = probeMap.get(cap.id);
      
      return {
        ...cap,
        enabled: probe?.enabled ?? (cap.constraints?.includes('disabled') ? false : true),
        requiresApproval: probe?.requiresApproval ?? cap.constraints?.includes('auth_required'),
        version: probe?.version ?? cap.metadata?.contractVersion as string | undefined,
        lastProbeAt: probe?.lastProbeAt?.toISOString(),
        lastProbeStatus: probe?.lastProbeStatus ?? undefined,
        lastProbeLatencyMs: probe?.lastProbeLatencyMs ?? undefined,
        lastProbeError: probe?.lastProbeError ?? undefined,
      };
    });

    // Sort capabilities deterministically by id
    capabilitiesWithProbes.sort((a, b) => a.id.localeCompare(b.id));

    // Compute hash over entire sorted capability list
    const hash = computeManifestHash(capabilitiesWithProbes);

    // Build response
    const response = {
      version: manifest.version,
      hash,
      capabilities: capabilitiesWithProbes,
      sources: manifest.sources,
      timestamp: new Date().toISOString(),
    };

    // Check If-None-Match header for ETag caching
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch === hash) {
      // Client already has current version
      return new NextResponse(null, {
        status: 304, // Not Modified
        headers: {
          'ETag': hash,
          'Cache-Control': 'public, max-age=300', // 5 minutes
        },
      });
    }

    // Return manifest with ETag
    return jsonResponse(response, {
      requestId,
      headers: {
        'ETag': hash,
        'Cache-Control': 'public, max-age=300', // 5 minutes
      },
    });
  } catch (error) {
    console.error('[API /api/ops/capabilities/manifest] Error building manifest:', error);
    return errorResponse('Failed to build capability manifest', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Compute deterministic SHA256 hash of manifest
 */
function computeManifestHash(capabilities: CapabilityWithProbe[]): string {
  const normalized = JSON.stringify(capabilities, null);
  const hash = crypto.createHash('sha256');
  hash.update(normalized);
  return `sha256:${hash.digest('hex')}`;
}
