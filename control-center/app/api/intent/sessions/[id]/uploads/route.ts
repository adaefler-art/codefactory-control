/**
 * API Route: /api/intent/sessions/[id]/uploads
 * 
 * Upload and manage files for INTENT sessions
 * Issue V09-I06: Upload + Sources Management (Product Memory Basis)
 * 
 * POST: Upload file(s) to session
 * GET: List all uploads for session
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { 
  validateUpload, 
  storeUpload,
  type UploadResult 
} from '@/lib/upload-storage-service';
import { randomUUID } from 'crypto';

/**
 * POST /api/intent/sessions/[id]/uploads
 * 
 * Upload one or more files to a session.
 * Supports multipart/form-data with file field(s).
 * 
 * Request:
 * - Content-Type: multipart/form-data
 * - Body: FormData with 'file' or 'files' field
 * 
 * Response:
 * {
 *   uploads: [{
 *     id: string,
 *     filename: string,
 *     contentType: string,
 *     sizeBytes: number,
 *     contentSha256: string,
 *     createdAt: string
 *   }],
 *   count: number
 * }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
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
    
    // Get session ID
    const { id: rawId } = await context.params;
    const sessionId = typeof rawId === 'string' ? rawId.trim() : '';
    
    if (!sessionId) {
      return errorResponse('Session ID required', {
        status: 400,
        requestId,
        details: 'Invalid session ID',
      });
    }
    
    // Verify session ownership (403)
    const sessionCheck = await pool.query(
      `SELECT id FROM intent_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    
    if (sessionCheck.rows.length === 0) {
      return errorResponse('Session not found', {
        status: 403,
        requestId,
        details: 'Session not found or access denied',
      });
    }
    
    // Parse form data
    const formData = await request.formData();
    const files: File[] = [];
    
    // Collect all file entries
    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        files.push(value);
      }
    }
    
    if (files.length === 0) {
      return errorResponse('No files provided', {
        status: 400,
        requestId,
        details: 'Request must include at least one file in FormData',
      });
    }
    
    // Process each file
    const uploads: Array<{
      id: string;
      filename: string;
      contentType: string;
      sizeBytes: number;
      contentSha256: string;
      createdAt: string;
    }> = [];
    
    for (const file of files) {
      // Validate upload
      const validation = validateUpload(file.name, file.size, file.type);
      
      if (!validation.valid) {
        return errorResponse(`Invalid file: ${file.name}`, {
          status: 400,
          requestId,
          details: validation.error,
        });
      }
      
      // Ensure contentType is present (should be guaranteed by validation)
      if (!validation.contentType) {
        return errorResponse(`Invalid file: ${file.name}`, {
          status: 400,
          requestId,
          details: 'Content type validation failed',
        });
      }
      
      // Read file content
      const arrayBuffer = await file.arrayBuffer();
      const content = Buffer.from(arrayBuffer);
      
      // Generate upload ID
      const uploadId = randomUUID();
      
      // Store file
      const uploadResult: UploadResult = await storeUpload(
        sessionId,
        uploadId,
        file.name,
        content,
        validation.contentType
      );
      
      // Insert into database with ON CONFLICT DO NOTHING to handle race conditions
      // If duplicate hash exists, the insert will be ignored and we'll fetch the existing record
      const insertResult = await pool.query(
        `INSERT INTO intent_session_uploads 
         (id, session_id, filename, content_type, size_bytes, storage_key, content_sha256, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (session_id, content_sha256) DO NOTHING
         RETURNING id, filename, content_type, size_bytes, content_sha256, created_at`,
        [
          uploadId,
          sessionId,
          file.name,
          uploadResult.contentType,
          uploadResult.sizeBytes,
          uploadResult.storageKey,
          uploadResult.contentSha256,
          null, // metadata_json (future: image dimensions, etc.)
        ]
      );
      
      // If insert was skipped (conflict), fetch existing upload
      if (insertResult.rows.length === 0) {
        const existingUpload = await pool.query(
          `SELECT id, filename, content_type, size_bytes, content_sha256, created_at
           FROM intent_session_uploads 
           WHERE session_id = $1 AND content_sha256 = $2`,
          [sessionId, uploadResult.contentSha256]
        );
        
        if (existingUpload.rows.length > 0) {
          const existing = existingUpload.rows[0];
          uploads.push({
            id: existing.id,
            filename: existing.filename,
            contentType: existing.content_type,
            sizeBytes: existing.size_bytes,
            contentSha256: existing.content_sha256,
            createdAt: new Date(existing.created_at).toISOString(),
          });
          continue;
        }
      } else {
        const row = insertResult.rows[0];
        uploads.push({
          id: row.id,
          filename: row.filename,
          contentType: row.content_type,
          sizeBytes: row.size_bytes,
          contentSha256: row.content_sha256,
          createdAt: new Date(row.created_at).toISOString(),
        });
      }
    }
    
    return jsonResponse({
      uploads,
      count: uploads.length,
    }, { status: 201, requestId });
    
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/uploads POST] Error uploading files:', error);
    return errorResponse('Failed to upload files', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * GET /api/intent/sessions/[id]/uploads
 * 
 * List all uploads for a session.
 * 
 * Response:
 * {
 *   uploads: [{
 *     id: string,
 *     filename: string,
 *     contentType: string,
 *     sizeBytes: number,
 *     contentSha256: string,
 *     createdAt: string
 *   }],
 *   count: number,
 *   sessionId: string
 * }
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
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
    
    // Get session ID
    const { id: rawId } = await context.params;
    const sessionId = typeof rawId === 'string' ? rawId.trim() : '';
    
    if (!sessionId) {
      return errorResponse('Session ID required', {
        status: 400,
        requestId,
        details: 'Invalid session ID',
      });
    }
    
    // Verify session ownership (403)
    const sessionCheck = await pool.query(
      `SELECT id FROM intent_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    
    if (sessionCheck.rows.length === 0) {
      return errorResponse('Session not found', {
        status: 403,
        requestId,
        details: 'Session not found or access denied',
      });
    }
    
    // Fetch all uploads for session
    const uploadsResult = await pool.query(
      `SELECT id, filename, content_type, size_bytes, content_sha256, created_at
       FROM intent_session_uploads
       WHERE session_id = $1
       ORDER BY created_at DESC`,
      [sessionId]
    );
    
    const uploads = uploadsResult.rows.map(row => ({
      id: row.id,
      filename: row.filename,
      contentType: row.content_type,
      sizeBytes: row.size_bytes,
      contentSha256: row.content_sha256,
      createdAt: new Date(row.created_at).toISOString(),
    }));
    
    return jsonResponse({
      uploads,
      count: uploads.length,
      sessionId,
    }, { status: 200, requestId });
    
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/uploads GET] Error fetching uploads:', error);
    return errorResponse('Failed to fetch uploads', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
