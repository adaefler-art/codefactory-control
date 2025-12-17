/**
 * API Route: Prompt Library Management
 * 
 * GET /api/prompts - List all prompts
 * POST /api/prompts - Create a new prompt
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPromptLibraryService } from '../../../src/lib/prompt-library-service';
import { CreatePromptRequest } from '../../../src/lib/types/prompt-library';

/**
 * GET /api/prompts
 * List all prompts with optional filters
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || undefined;
    const deprecated = searchParams.get('deprecated') === 'true' ? true : 
                       searchParams.get('deprecated') === 'false' ? false : undefined;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const service = getPromptLibraryService();
    const prompts = await service.listPrompts({ category, deprecated, limit, offset });

    return NextResponse.json({ prompts, total: prompts.length });
  } catch (error) {
    console.error('[API] Error listing prompts:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to list prompts',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/prompts
 * Create a new prompt with its first version
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as CreatePromptRequest;

    // Validate required fields
    if (!body.name || !body.category || !body.description) {
      return NextResponse.json(
        { error: 'Missing required fields: name, category, description' },
        { status: 400 }
      );
    }

    const service = getPromptLibraryService();
    const prompt = await service.createPrompt(body);

    return NextResponse.json({ prompt }, { status: 201 });
  } catch (error) {
    console.error('[API] Error creating prompt:', error);
    
    // Check for unique constraint violation
    if (error instanceof Error && error.message.includes('duplicate key')) {
      return NextResponse.json(
        { error: 'A prompt with this name already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to create prompt',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
