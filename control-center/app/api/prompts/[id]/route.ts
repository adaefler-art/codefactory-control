/**
 * API Route: Individual Prompt Management
 * 
 * GET /api/prompts/[id] - Get prompt by ID
 * PATCH /api/prompts/[id] - Update prompt (deprecate, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPromptLibraryService } from '../../../../src/lib/prompt-library-service';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/prompts/[id]
 * Get prompt by ID with current version
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const byName = searchParams.get('byName') === 'true';

    const service = getPromptLibraryService();
    const prompt = byName 
      ? await service.getPromptByName(id)
      : await service.getPromptById(id);

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ prompt });
  } catch (error) {
    console.error('[API] Error getting prompt:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to get prompt',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/prompts/[id]
 * Update prompt (deprecate)
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    const service = getPromptLibraryService();

    // Handle deprecation
    if (body.deprecate === true) {
      if (!body.reason) {
        return NextResponse.json(
          { error: 'Deprecation reason is required' },
          { status: 400 }
        );
      }

      await service.deprecatePrompt(id, body.reason, body.replacementPromptId);

      return NextResponse.json({ 
        message: 'Prompt deprecated successfully',
        promptId: id,
      });
    }

    return NextResponse.json(
      { error: 'No valid update operation specified' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[API] Error updating prompt:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to update prompt',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
