/**
 * API Route: Individual Action Management
 * 
 * GET /api/actions/[id] - Get action by ID
 * PATCH /api/actions/[id] - Update action (deprecate, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionRegistryService } from '../../../../src/lib/action-registry-service';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/actions/[id]
 * Get action by ID with current version
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const byName = searchParams.get('byName') === 'true';
    const byToolRef = searchParams.get('byToolRef') === 'true';

    const service = getActionRegistryService();
    let action;
    
    if (byName) {
      action = await service.getActionByName(id);
    } else if (byToolRef) {
      action = await service.getActionByToolReference(id);
    } else {
      action = await service.getActionById(id);
    }

    if (!action) {
      return NextResponse.json(
        { error: 'Action not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ action });
  } catch (error) {
    console.error('[API] Error getting action:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to get action',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/actions/[id]
 * Update action (deprecate)
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    const service = getActionRegistryService();

    // Handle deprecation
    if (body.deprecate === true) {
      if (!body.reason) {
        return NextResponse.json(
          { error: 'Deprecation reason is required' },
          { status: 400 }
        );
      }

      await service.deprecateAction(id, body.reason, body.replacementActionId);

      return NextResponse.json({
        message: 'Action deprecated successfully',
        actionId: id,
      });
    }

    return NextResponse.json(
      { error: 'No valid update operation specified' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[API] Error updating action:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to update action',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
