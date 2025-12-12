/**
 * API Route: GET /api/workflows/[id]/executions
 * 
 * Returns execution history for a specific workflow
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    
    const pool = getPool();
    
    // Get executions for this workflow
    const query = `
      SELECT 
        we.id,
        we.workflow_id,
        we.status,
        we.input,
        we.output,
        we.started_at,
        we.completed_at,
        we.error,
        we.triggered_by,
        we.github_run_id,
        (
          SELECT COUNT(*)
          FROM workflow_steps ws
          WHERE ws.execution_id = we.id
        ) as total_steps,
        (
          SELECT COUNT(*)
          FROM workflow_steps ws
          WHERE ws.execution_id = we.id AND ws.status = 'completed'
        ) as completed_steps
      FROM workflow_executions we
      WHERE we.workflow_id = $1
      ORDER BY we.started_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    const countQuery = `
      SELECT COUNT(*) as total
      FROM workflow_executions
      WHERE workflow_id = $1
    `;
    
    const [executions, count] = await Promise.all([
      pool.query(query, [id, limit, offset]),
      pool.query(countQuery, [id])
    ]);
    
    return NextResponse.json({
      executions: executions.rows,
      total: parseInt(count.rows[0].total, 10),
      limit,
      offset
    });
  } catch (error) {
    console.error('[API /api/workflows/[id]/executions] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch executions' },
      { status: 500 }
    );
  }
}
