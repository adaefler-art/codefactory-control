/**
 * API Route: Prompt Version Management
 * 
 * GET /api/prompts/[id]/versions - List all versions of a prompt
 * POST /api/prompts/[id]/versions - Create a new version
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPromptLibraryService } from '../../../../../src/lib/prompt-library-service';
import { CreatePromptVersionRequest } from '../../../../../src/lib/types/prompt-library';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/prompts/[id]/versions
 * List all versions of a prompt
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const version = searchParams.get('version');

    const service = getPromptLibraryService();

    // Get specific version
    if (version) {
      const promptVersion = await service.getPromptVersion(id, version);
      if (!promptVersion) {
        return NextResponse.json(
          { error: 'Prompt version not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({ version: promptVersion });
    }

    // List all versions
    const versions = await service.listPromptVersions(id);

    return NextResponse.json({ versions, total: versions.length });
  } catch (error) {
    console.error('[API] Error listing prompt versions:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to list prompt versions',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/prompts/[id]/versions
 * Create a new version of a prompt
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    // Validate required fields
    if (!body.content || !body.changeType || !body.changeDescription) {
      return NextResponse.json(
        { error: 'Missing required fields: content, changeType, changeDescription' },
        { status: 400 }
      );
    }

    // Validate change type
    if (!['major', 'minor', 'patch'].includes(body.changeType)) {
      return NextResponse.json(
        { error: 'Invalid changeType. Must be: major, minor, or patch' },
        { status: 400 }
      );
    }

    const versionRequest: CreatePromptVersionRequest = {
      promptId: id,
      version: body.version,
      content: body.content,
      systemPrompt: body.systemPrompt,
      userPromptTemplate: body.userPromptTemplate,
      variables: body.variables,
      modelConfig: body.modelConfig,
      changeType: body.changeType,
      changeDescription: body.changeDescription,
      breakingChanges: body.breakingChanges,
      migrationGuide: body.migrationGuide,
      createdBy: body.createdBy,
    };

    const service = getPromptLibraryService();
    const version = await service.createPromptVersion(versionRequest);

    return NextResponse.json({ version }, { status: 201 });
  } catch (error) {
    console.error('[API] Error creating prompt version:', error);
    
    // Check for version conflict
    if (error instanceof Error && error.message.includes('duplicate key')) {
      return NextResponse.json(
        { error: 'A version with this number already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to create prompt version',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
