/**
 * API Route: /api/intent/context-packs/by-hash/[hash]
 * 
 * Get context pack by hash (for lookup/deduplication)
 * Issue E73.4: Context Pack Storage/Retrieval - optional hash-based retrieval
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getContextPackByHash } from '@/lib/db/contextPacks';
import { getRequestId, errorResponse } from '@/lib/api/response-helpers';

/**
 * Validate SHA256 hash format (64 hexadecimal characters)
 * 
 * @param hash Hash string to validate
 * @returns true if valid SHA256 hex, false otherwise
 */
function isValidSHA256Hash(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash);
}

/**
 * GET /api/intent/context-packs/by-hash/[hash]
 * Download context pack by hash as JSON
 * 
 * Verifies session ownership before allowing download
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { hash: string } }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    const packHash = params.hash;
    
    // Get authenticated user ID from middleware
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }
    
    if (!packHash) {
      return errorResponse('Pack hash required', {
        status: 400,
        requestId,
      });
    }
    
    // Validate hash format (SHA256 = 64 hex characters)
    if (!isValidSHA256Hash(packHash)) {
      return errorResponse('Invalid hash format', {
        status: 400,
        requestId,
        details: 'Hash must be a valid SHA256 hex string (64 characters)',
        code: 'INVALID_HASH_FORMAT',
      });
    }
    
    // Get the pack by hash (includes ownership check via session)
    const packResult = await getContextPackByHash(pool, packHash, userId);
    
    if (!packResult.success) {
      return errorResponse('Context pack not found', {
        status: 404,
        requestId,
      });
    }
    
    const pack = packResult.data;
    
    // Return JSON for download
    const json = JSON.stringify(pack.pack_json, null, 2);
    const hash12 = pack.pack_hash.substring(0, 12);
    const filename = `context-pack-${pack.session_id}-${hash12}.json`;
    
    return new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'ETag': `"${pack.pack_hash}"`,
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    console.error('[API /api/intent/context-packs/by-hash/[hash]] Error downloading context pack:', error);
    return errorResponse('Failed to download context pack', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
