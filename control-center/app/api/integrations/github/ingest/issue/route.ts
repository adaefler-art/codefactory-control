/**
 * E72.2: GitHub Issue Ingestion API Endpoint
 * 
 * Server-side API route for ingesting GitHub issues into the Timeline/Linkage Model
 * with idempotent upsert semantics and I711 policy enforcement.
 * 
 * POST /api/integrations/github/ingest/issue
 * 
 * Body (JSON):
 * {
 *   owner: string (required) - Repository owner
 *   repo: string (required) - Repository name
 *   issueNumber: number (required) - Issue number
 * }
 * 
 * Returns:
 * - 200: { ok: true, data: { nodesUpserted, edgesUpserted, sourceRefs, ingestedAt } }
 * - 400: { ok: false, error: { code, message, details } } - INVALID_PARAMS
 * - 403: { ok: false, error: { code, message, details } } - REPO_NOT_ALLOWED
 * - 502: { ok: false, error: { code, message, details } } - GITHUB_API_ERROR, ISSUE_NOT_FOUND
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/lib/db';
import {
  ingestIssue,
  IssueNotFoundError,
  GitHubIngestionError,
  RepoAccessDeniedError,
} from '@/lib/github-ingestion';

/**
 * Schema for request body validation
 */
const RequestBodySchema = z.object({
  owner: z.string().min(1, 'owner is required'),
  repo: z.string().min(1, 'repo is required'),
  issueNumber: z.number().int().positive('issueNumber must be a positive integer'),
}).strict();

/**
 * POST /api/integrations/github/ingest/issue
 * Ingest a GitHub issue into the Timeline/Linkage Model
 */
export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();
    const validation = RequestBodySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'Invalid request parameters',
            details: validation.error.errors,
          },
        },
        { status: 400 }
      );
    }

    const { owner, repo, issueNumber } = validation.data;

    // Get database pool
    const pool = getPool();

    // Ingest issue (enforces I711 policy via createAuthenticatedClient)
    const result = await ingestIssue({ owner, repo, issueNumber }, pool);

    // Count nodes, edges, and sources
    const nodesUpserted = 1; // The issue node itself
    const edgesUpserted = 0; // No edges created by ingestIssue
    const sourceRefs = 1; // One source reference created

    return NextResponse.json(
      {
        ok: true,
        data: {
          nodesUpserted,
          edgesUpserted,
          sourceRefs,
          ingestedAt: new Date().toISOString(),
          nodeId: result.nodeId,
          naturalKey: result.naturalKey,
          isNew: result.isNew,
          source_system: result.source_system,
          source_type: result.source_type,
          source_id: result.source_id,
          issueNumber: result.issueNumber,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    // Handle repo access denied (I711 policy)
    if (error instanceof RepoAccessDeniedError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'REPO_NOT_ALLOWED',
            message: error.message,
            details: {
              owner: error.details?.owner,
              repo: error.details?.repo,
            },
          },
        },
        { status: 403 }
      );
    }

    // Handle issue not found
    if (error instanceof IssueNotFoundError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'ISSUE_NOT_FOUND',
            message: error.message,
            details: error.details,
          },
        },
        { status: 502 }
      );
    }

    // Handle other GitHub ingestion errors
    if (error instanceof GitHubIngestionError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        },
        { status: 502 }
      );
    }

    // Handle validation errors from Zod
    if (error.name === 'ZodError') {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'Invalid request parameters',
            details: error.errors,
          },
        },
        { status: 400 }
      );
    }

    // Handle unexpected errors
    console.error('[GitHub Ingest Issue API] Unexpected error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'An unexpected error occurred',
          details: {},
        },
      },
      { status: 500 }
    );
  }
}
