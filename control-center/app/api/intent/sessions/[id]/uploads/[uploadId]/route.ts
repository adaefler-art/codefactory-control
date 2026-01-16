/**
 * API Route: /api/intent/sessions/[id]/uploads/[uploadId]
 * 
 * Delete specific upload from INTENT session
 * Issue V09-I06: Upload + Sources Management (Product Memory Basis)
 * 
 * DELETE: Remove upload and associated file
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { deleteUpload } from '@/lib/upload-storage-service';

/**
 * DELETE /api/intent/sessions/[id]/uploads/[uploadId]
 * 
 * Delete an upload from the session.
 * Removes both database record and stored file.
 * 
 * Response:
 * {
 *   deleted: true,
 *   uploadId: string
 * }
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; uploadId: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    
    // Auth check (401 first)
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }
    
    // Get params
    const { id: rawSessionId, uploadId: rawUploadId } = await context.params;
    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    const uploadId = typeof rawUploadId === 'string' ? rawUploadId.trim() : '';
    
    if (!sessionId || !uploadId) {
      return errorResponse('Invalid parameters', {
        status: 400,
        requestId,
        details: 'Session ID and Upload ID are required',
      });
    }
    
    // Verify session ownership and get upload details
    const uploadCheck = await pool.query(
      `SELECT u.id, u.storage_key
       FROM intent_session_uploads u
       INNER JOIN intent_sessions s ON u.session_id = s.id
       WHERE u.id = $1 AND u.session_id = $2 AND s.user_id = $3`,
      [uploadId, sessionId, userId]
    );
    
    if (uploadCheck.rows.length === 0) {
      return errorResponse('Upload not found', {
        status: 404,
        requestId,
        details: 'Upload not found or access denied',
      });
    }
    
    const upload = uploadCheck.rows[0];
    
    // Delete file from storage
    try {
      await deleteUpload(upload.storage_key);
    } catch (error) {
      console.warn('[API DELETE upload] Failed to delete file from storage:', error);
      // Continue with database deletion even if file deletion fails
    }
    
    // Delete from database
    await pool.query(
      `DELETE FROM intent_session_uploads WHERE id = $1`,
      [uploadId]
    );
    
    return jsonResponse({
      deleted: true,
      uploadId,
    }, { status: 200, requestId });
    
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/uploads/[uploadId] DELETE] Error deleting upload:', error);
    return errorResponse('Failed to delete upload', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
