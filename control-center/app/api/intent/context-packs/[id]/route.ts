/**
 * API Route: /api/intent/context-packs/[id]
 * 
 * Download context pack JSON
 * Issue E73.3: Context Pack Generator (audit JSON per session) + Export/Download
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getContextPack } from '@/lib/db/contextPacks';
import { getIntentSession } from '@/lib/db/intentSessions';
import { getRequestId, errorResponse } from '@/lib/api/response-helpers';

/**
 * GET /api/intent/context-packs/[id]
 * Download context pack as JSON
 * 
 * Verifies session ownership before allowing download
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    const packId = params.id;
    
    // Get authenticated user ID from middleware
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }
    
    if (!packId) {
      return errorResponse('Pack ID required', {
        status: 400,
        requestId,
      });
    }
    
    // Get the pack
    const packResult = await getContextPack(pool, packId);
    
    if (!packResult.success) {
      return errorResponse('Context pack not found', {
        status: 404,
        requestId,
      });
    }
    
    const pack = packResult.data;
    
    // Verify session ownership
    const sessionResult = await getIntentSession(pool, pack.session_id, userId);
    
    if (!sessionResult.success) {
      return errorResponse('Access denied', {
        status: 403,
        requestId,
        details: 'You do not have access to this context pack',
      });
    }
    
    // Return JSON for download
    const json = JSON.stringify(pack.pack_json, null, 2);
    const filename = `context-pack-${pack.session_id}-${pack.created_at.replace(/[:.]/g, '-')}.json`;
    
    return new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    console.error('[API /api/intent/context-packs/[id]] Error downloading context pack:', error);
    return errorResponse('Failed to download context pack', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
