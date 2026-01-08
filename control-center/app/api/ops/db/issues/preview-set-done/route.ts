/**
 * Package 1: Backend API - Preview Issues Set Done
 * GET /api/ops/db/issues/preview-set-done
 * 
 * Purpose: Preview which issues would be set to DONE status
 * Auth: 401-first, then ENV guard (409), then ADMIN guard (403)
 * Stage-only: production/unknown -> 409 BEFORE any DB call
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/lib/db';
import { getDeploymentEnvironment, isWriteAllowedInProd } from '@/lib/utils/deployment-env';

// Zod schema for query params (strict validation)
const PreviewQuerySchema = z.object({
  statuses: z.array(z.enum(['CREATED', 'SPEC_READY'])).optional().default(['CREATED', 'SPEC_READY']),
  githubIssueMin: z.coerce.number().int().positive().optional(),
  githubIssueMax: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    // GUARD 1: AUTH (401-first)
    const sub = request.headers.get('x-afu9-sub');
    if (!sub) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          code: 'MISSING_AUTH',
          details: 'x-afu9-sub header required',
          requestId,
        },
        { status: 401 }
      );
    }

    // GUARD 2: ENV (409 for production/unknown) - BEFORE any DB call
    const env = getDeploymentEnvironment();
    const isProdEnabled = isWriteAllowedInProd();

    if (env === 'production' && !isProdEnabled) {
      return NextResponse.json(
        {
          error: 'Production Disabled',
          code: 'PROD_DISABLED',
          details: 'Administrative DB operations not allowed in production',
          environment: env,
          requestId,
        },
        { status: 409 }
      );
    }

    if (!['staging', 'development', 'production'].includes(env)) {
      return NextResponse.json(
        {
          error: 'Environment Disabled',
          code: 'ENV_DISABLED',
          details: 'Administrative DB operations only allowed in staging/development',
          environment: env,
          requestId,
        },
        { status: 409 }
      );
    }

    // GUARD 3: ADMIN (403) - BEFORE any DB call
    const adminSubs = process.env.AFU9_ADMIN_SUBS?.split(',').map(s => s.trim()) || [];
    if (!adminSubs.includes(sub)) {
      return NextResponse.json(
        {
          error: 'Forbidden',
          code: 'NOT_ADMIN',
          details: 'Administrative operations require admin privileges',
          requestId,
        },
        { status: 403 }
      );
    }

    // Parse and validate query params
    const searchParams = request.nextUrl.searchParams;
    const statusesRaw = searchParams.get('statuses')?.split(',') || undefined;
    
    const params = PreviewQuerySchema.parse({
      statuses: statusesRaw,
      githubIssueMin: searchParams.get('githubIssueMin') ?? undefined,
      githubIssueMax: searchParams.get('githubIssueMax') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    });

    // Validate range if both provided
    if (params.githubIssueMin !== undefined && params.githubIssueMax !== undefined) {
      if (params.githubIssueMin > params.githubIssueMax) {
        return NextResponse.json(
          {
            error: 'Invalid Range',
            code: 'INVALID_RANGE',
            details: 'githubIssueMin cannot be greater than githubIssueMax',
            requestId,
          },
          { status: 400 }
        );
      }
    }

    // DB OPERATIONS START HERE (after all guards passed)
    const pool = getPool();

    // Build WHERE clause for status filter
    const statusPlaceholders = params.statuses.map((_, i) => `$${i + 1}`).join(', ');
    let whereClause = `status IN (${statusPlaceholders})`;
    const queryParams: any[] = [...params.statuses];
    let paramIndex = params.statuses.length + 1;

    // Add range filters
    if (params.githubIssueMin !== undefined) {
      whereClause += ` AND github_issue_number >= $${paramIndex}`;
      queryParams.push(params.githubIssueMin);
      paramIndex++;
    }
    if (params.githubIssueMax !== undefined) {
      whereClause += ` AND github_issue_number <= $${paramIndex}`;
      queryParams.push(params.githubIssueMax);
      paramIndex++;
    }

    // Query 1: Count by status (overall distribution)
    const countQuery = `
      SELECT status, COUNT(*) as count
      FROM afu9_issues
      GROUP BY status
      ORDER BY status ASC;
    `;
    const countResult = await pool.query(countQuery);

    // Query 2: Count affected issues
    const affectedCountQuery = `
      SELECT COUNT(*) as affected_count
      FROM afu9_issues
      WHERE ${whereClause};
    `;
    const affectedCountResult = await pool.query(affectedCountQuery, queryParams);
    const affectedCount = parseInt(affectedCountResult.rows[0]?.affected_count || '0');

    // Query 3: Sample rows (bounded, deterministic order)
    const sampleQuery = `
      SELECT id, github_issue_number, title, status
      FROM afu9_issues
      WHERE ${whereClause}
      ORDER BY github_issue_number ASC
      LIMIT $${paramIndex};
    `;
    const sampleResult = await pool.query(sampleQuery, [...queryParams, params.limit]);

    // Response (bounded, no secrets)
    return NextResponse.json({
      ok: true,
      requestId,
      environment: env,
      params: {
        statuses: params.statuses,
        githubIssueMin: params.githubIssueMin,
        githubIssueMax: params.githubIssueMax,
        limit: params.limit,
      },
      statusDistribution: countResult.rows.map(row => ({
        status: row.status,
        count: parseInt(row.count),
      })),
      affectedCount,
      sampleRows: sampleResult.rows.map(row => ({
        id: row.id,
        githubIssueNumber: row.github_issue_number,
        title: row.title,
        status: row.status,
      })),
    });

  } catch (error: any) {
    console.error('[API /api/ops/db/issues/preview-set-done] Error:', {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          code: 'VALIDATION_ERROR',
          details: error.errors,
          requestId,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        requestId,
      },
      { status: 500 }
    );
  }
}
