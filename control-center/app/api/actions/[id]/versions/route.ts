/**
 * API Route: Action Version Management
 * 
 * GET /api/actions/[id]/versions - List all versions of an action
 * POST /api/actions/[id]/versions - Create a new version
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActionRegistryService } from '../../../../../src/lib/action-registry-service';
import { CreateActionVersionRequest } from '../../../../../src/lib/types/prompt-library';
import { validateChangeType } from '../../../../../src/lib/prompt-library-validation';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/actions/[id]/versions
 * List all versions of an action
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const version = searchParams.get('version');

    const service = getActionRegistryService();

    // Get specific version
    if (version) {
      const actionVersion = await service.getActionVersion(id, version);
      if (!actionVersion) {
        return NextResponse.json(
          { error: 'Action version not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({ version: actionVersion });
    }

    // List all versions
    const versions = await service.listActionVersions(id);

    return NextResponse.json({ versions, total: versions.length });
  } catch (error) {
    console.error('[API] Error listing action versions:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to list action versions',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/actions/[id]/versions
 * Create a new version of an action
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    // Validate required fields
    if (!body.toolReference || !body.inputSchema || !body.changeType || !body.changeDescription) {
      return NextResponse.json(
        { error: 'Missing required fields: toolReference, inputSchema, changeType, changeDescription' },
        { status: 400 }
      );
    }

    // Validate change type
    try {
      validateChangeType(body.changeType);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid changeType' },
        { status: 400 }
      );
    }

    const versionRequest: CreateActionVersionRequest = {
      actionId: id,
      version: body.version,
      toolReference: body.toolReference,
      inputSchema: body.inputSchema,
      outputSchema: body.outputSchema,
      changeType: body.changeType,
      changeDescription: body.changeDescription,
      breakingChanges: body.breakingChanges,
      migrationGuide: body.migrationGuide,
      createdBy: body.createdBy,
    };

    const service = getActionRegistryService();
    const version = await service.createActionVersion(versionRequest);

    return NextResponse.json({ version }, { status: 201 });
  } catch (error) {
    console.error('[API] Error creating action version:', error);
    
    // Check for version conflict
    if (error instanceof Error && error.message.includes('duplicate key')) {
      return NextResponse.json(
        { error: 'A version with this number already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to create action version',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
