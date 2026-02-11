/**
 * API Route: /api/clinical/intake
 * 
 * Manage clinical intake records
 * Issue #10: Clinical Intake Synthesis (CRE-konform)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { createClinicalIntake, getClinicalIntakesBySession } from '@/lib/db/clinicalIntakes';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { validateClinicalIntakeWithRules } from '@/lib/validators/clinicalIntakeValidator';
import { ClinicalIntakeInputSchema } from '@/lib/schemas/clinicalIntake';

/**
 * POST /api/clinical/intake
 * Create a new clinical intake record
 */
export async function POST(request: NextRequest) {
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
    
    // Parse request body
    const body = await request.json();
    
    // Validate schema
    const schemaResult = ClinicalIntakeInputSchema.safeParse(body);
    if (!schemaResult.success) {
      return errorResponse('Invalid clinical intake data', {
        status: 400,
        requestId,
        details: schemaResult.error.issues,
      });
    }
    
    const input = schemaResult.data;
    
    // Validate with rules before creating
    const validationResult = validateClinicalIntakeWithRules({
      ...input,
      id: undefined, // Will be generated
      created_at: undefined,
      updated_at: undefined,
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
    
    // Create intake
    const result = await createClinicalIntake(pool, input, userId);
    
    if (!result.success) {
      return errorResponse('Failed to create clinical intake', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse(result.data, { 
      status: 201,
      requestId,
    });
    
  } catch (error) {
    console.error('[API /api/clinical/intake] Error creating intake:', error);
    return errorResponse('Failed to create clinical intake', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * GET /api/clinical/intake?session_id=...
 * Get all clinical intakes for a session
 */
export async function GET(request: NextRequest) {
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
    
    // Get session_id from query params
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('session_id');
    
    if (!sessionId) {
      return errorResponse('session_id query parameter required', {
        status: 400,
        requestId,
      });
    }
    
    const result = await getClinicalIntakesBySession(pool, sessionId);
    
    if (!result.success) {
      return errorResponse('Failed to get clinical intakes', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse(result.data, { requestId });
    
  } catch (error) {
    console.error('[API /api/clinical/intake] Error getting intakes:', error);
    return errorResponse('Failed to get clinical intakes', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
