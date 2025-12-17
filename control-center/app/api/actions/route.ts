/**
 * API Route: Action Registry Management
 * 
 * GET /api/actions - List all actions
 * POST /api/actions - Create a new action
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionRegistryService } from '../../../src/lib/action-registry-service';
import { CreateActionRequest } from '../../../src/lib/types/prompt-library';

/**
 * GET /api/actions
 * List all actions with optional filters
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || undefined;
    const deprecated = searchParams.get('deprecated') === 'true' ? true :
                       searchParams.get('deprecated') === 'false' ? false : undefined;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const service = getActionRegistryService();
    const actions = await service.listActions({ category, deprecated, limit, offset });

    return NextResponse.json({ actions, total: actions.length });
  } catch (error) {
    console.error('[API] Error listing actions:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to list actions',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/actions
 * Create a new action with its first version
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as CreateActionRequest;

    // Validate required fields
    if (!body.name || !body.category || !body.description || !body.toolReference || !body.inputSchema) {
      return NextResponse.json(
        { error: 'Missing required fields: name, category, description, toolReference, inputSchema' },
        { status: 400 }
      );
    }

    const service = getActionRegistryService();
    const action = await service.createAction(body);

    return NextResponse.json({ action }, { status: 201 });
  } catch (error) {
    console.error('[API] Error creating action:', error);
    
    // Check for unique constraint violation
    if (error instanceof Error && error.message.includes('duplicate key')) {
      return NextResponse.json(
        { error: 'An action with this name already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to create action',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
