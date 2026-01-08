/**
 * Package 1: Backend API - Execute Issues Set Done
 * POST /api/ops/db/issues/set-done
 * 
 * Purpose: Execute bulk update to set issues to DONE status
 * Auth: 401-first, then ENV guard (409), then ADMIN guard (403)
 * Stage-only: production/unknown -> 409 BEFORE any DB call
 * Audit: Inserts to ops_admin_actions table
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/lib/db';
import { getDeploymentEnv, isProduction } from '@/lib/utils/deployment-env';

// Zod schema for request body (strict validation)
const ExecuteBodySchema = z.object({
  confirm: z.literal('CONFIRM'),
  statuses: z.array(z.enum(['CREATED', 'SPEC_READY'])).optional().default(['CREATED', 'SPEC_READY']),
  githubIssueMin: z.number().int().positive().optional(),
  githubIssueMax: z.number().int().positive().optional(),
});

const MAX_RETURNING_ROWS = 200; // Bounded output

export async function POST(request: NextRequest) {
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
    const env = getDeploymentEnv();

    if (env === 'production') {
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

    // Parse and validate request body
    const body = await request.json();
    const params = ExecuteBodySchema.parse(body);

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

    // Execute UPDATE (bounded RETURNING)
    const updateQuery = `
      WITH updated AS (
        UPDATE afu9_issues
        SET status = 'DONE', updated_at = NOW()
        WHERE ${whereClause}
        RETURNING id, github_issue_number, title, status
      )
      SELECT * FROM updated
      ORDER BY github_issue_number ASC
      LIMIT ${MAX_RETURNING_ROWS};
    `;
    const updateResult = await pool.query(updateQuery, queryParams);

    // Get total count of updated rows
    const countQuery = `
      SELECT COUNT(*) as total_updated
      FROM afu9_issues
      WHERE status = 'DONE'
        ${params.githubIssueMin !== undefined ? `AND github_issue_number >= ${params.githubIssueMin}` : ''}
        ${params.githubIssueMax !== undefined ? `AND github_issue_number <= ${params.githubIssueMax}` : ''};
    `;
    const countResult = await pool.query(countQuery);
    const totalUpdated = parseInt(countResult.rows[0]?.total_updated || '0');

    // Prepare bounded result (no secrets)
    const updatedRows = updateResult.rows.map(row => ({
      id: row.id,
      githubIssueNumber: row.github_issue_number,
      title: row.title,
      status: row.status,
    }));

    const resultJson = {
      updatedCount: totalUpdated,
      returnedSampleCount: updatedRows.length,
      maxReturningRows: MAX_RETURNING_ROWS,
    };

    // Audit: Insert to ops_admin_actions (bounded params/result, no secrets)
    const auditQuery = `
      INSERT INTO ops_admin_actions (request_id, sub, action, params_json, result_json)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id;
    `;
    await pool.query(auditQuery, [
      requestId,
      sub,
      'ISSUES_SET_DONE',
      JSON.stringify({
        statuses: params.statuses,
        githubIssueMin: params.githubIssueMin,
        githubIssueMax: params.githubIssueMax,
      }),
      JSON.stringify(resultJson),
    ]);

    // Response (bounded, no secrets)
    return NextResponse.json({
      ok: true,
      requestId,
      environment: env,
      params: {
        statuses: params.statuses,
        githubIssueMin: params.githubIssueMin,
        githubIssueMax: params.githubIssueMax,
      },
      result: {
        updatedCount: totalUpdated,
        sampleRows: updatedRows,
        returnedSampleCount: updatedRows.length,
        maxReturningRows: MAX_RETURNING_ROWS,
        truncated: totalUpdated > MAX_RETURNING_ROWS,
      },
    });

  } catch (error: any) {
    console.error('[API /api/ops/db/issues/set-done] Error:', {
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
