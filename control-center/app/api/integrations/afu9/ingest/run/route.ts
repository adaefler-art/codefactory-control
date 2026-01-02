/**
 * E72.3: AFU-9 Run Ingestion API Endpoint
 * 
 * Server-side API route for ingesting AFU-9 runs into the Timeline/Linkage Model
 * with idempotent upsert semantics.
 * 
 * POST /api/integrations/afu9/ingest/run
 * 
 * Body (JSON):
 * {
 *   runId: string (required) - AFU-9 run ID
 * }
 * 
 * Returns:
 * - 200: { ok: true, data: { nodesUpserted, edgesUpserted, sourceRefs, ingestedAt } }
 * - 400: { ok: false, error: { code, message, details } } - INVALID_PARAMS
 * - 404: { ok: false, error: { code, message, details } } - RUN_NOT_FOUND
 * - 502: { ok: false, error: { code, message, details } } - DB_ERROR, INGESTION_FAILED
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/lib/db';
import { ingestRun } from '@/lib/afu9-ingestion';
import { RunNotFoundError, AFU9IngestionError } from '@/lib/afu9-ingestion/types';

/**
 * Schema for request body validation
 */
const RequestBodySchema = z.object({
  runId: z.string().min(1, 'runId is required'),
}).strict();

/**
 * POST /api/integrations/afu9/ingest/run
 * Ingest an AFU-9 run into the Timeline/Linkage Model
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

    const { runId } = validation.data;

    // Get database pool
    const pool = getPool();

    // Ingest run
    const result = await ingestRun({ runId }, pool);

    // Count nodes, edges, and sources
    const nodesUpserted = 1 + result.stepNodeIds.length + result.artifactNodeIds.length; // Run + steps + artifacts
    const edgesUpserted = result.edgeIds.length; // RUN_HAS_ARTIFACT edges
    const sourceRefs = 1 + result.stepNodeIds.length + result.artifactNodeIds.length; // One source per node

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
          runId: result.runId,
          stepNodeIds: result.stepNodeIds,
          artifactNodeIds: result.artifactNodeIds,
          edgeIds: result.edgeIds,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    // Handle run not found
    if (error instanceof RunNotFoundError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'RUN_NOT_FOUND',
            message: error.message,
            details: error.details,
          },
        },
        { status: 404 }
      );
    }

    // Handle other AFU-9 ingestion errors
    if (error instanceof AFU9IngestionError) {
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
    console.error('[AFU-9 Ingest Run API] Unexpected error:', error);
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
