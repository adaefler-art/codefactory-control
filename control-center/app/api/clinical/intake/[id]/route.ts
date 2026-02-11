/**
 * API Route: /api/clinical/intake/[id]
 * 
 * Get or update a specific clinical intake
 * Issue #10: Clinical Intake Synthesis (CRE-konform)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { 
  getClinicalIntakeById, 
  updateClinicalIntake,
  archiveClinicalIntake 
} from '@/lib/db/clinicalIntakes';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { validateClinicalIntakeWithRules } from '@/lib/validators/clinicalIntakeValidator';

/**
 * GET /api/clinical/intake/[id]
 * Get a specific clinical intake by ID
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    
    // Get authenticated user ID
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }
    
    // Await params (Next.js 13.4+)
    const { id } = await context.params;
    
    if (!id) {
      return errorResponse('Intake ID required', {
        status: 400,
        requestId,
      });
    }
    
    const result = await getClinicalIntakeById(pool, id);
    
    if (!result.success) {
      if (result.error === 'Clinical intake not found') {
        return errorResponse('Clinical intake not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to get clinical intake', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse(result.data, { requestId });
    
  } catch (error) {
    console.error('[API /api/clinical/intake/[id]] Error getting intake:', error);
    return errorResponse('Failed to get clinical intake', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * PATCH /api/clinical/intake/[id]
 * Update a clinical intake (creates new version)
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    
    // Get authenticated user ID
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }
    
    // Await params
    const { id } = await context.params;
    
    if (!id) {
      return errorResponse('Intake ID required', {
        status: 400,
        requestId,
      });
    }
    
    // Parse request body
    const body = await request.json();
    
    // Validate with rules
    const validationResult = validateClinicalIntakeWithRules({
      ...body,
      id: undefined, // New version will get new ID
    });
    
    if (!validationResult.isValid) {
      return errorResponse('Clinical intake validation failed', {
        status: 422,
        requestId,
        details: {
          errors: validationResult.errors,
          warnings: validationResult.warnings,
        },
      });
    }
    
    // Update intake
    const result = await updateClinicalIntake(pool, id, body, userId);
    
    if (!result.success) {
      if (result.error === 'Clinical intake not found') {
        return errorResponse('Clinical intake not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to update clinical intake', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse(result.data, { requestId });
    
  } catch (error) {
    console.error('[API /api/clinical/intake/[id]] Error updating intake:', error);
    return errorResponse('Failed to update clinical intake', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * DELETE /api/clinical/intake/[id]
 * Archive a clinical intake (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    
    // Get authenticated user ID
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }
    
    // Await params
    const { id } = await context.params;
    
    if (!id) {
      return errorResponse('Intake ID required', {
        status: 400,
        requestId,
      });
    }
    
    const result = await archiveClinicalIntake(pool, id);
    
    if (!result.success) {
      if (result.error === 'Clinical intake not found') {
        return errorResponse('Clinical intake not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to archive clinical intake', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse({ success: true }, { requestId });
    
  } catch (error) {
    console.error('[API /api/clinical/intake/[id]] Error archiving intake:', error);
    return errorResponse('Failed to archive clinical intake', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
