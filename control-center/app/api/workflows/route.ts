/**
 * API Route: GET /api/workflows
 * 
 * Returns a list of all available workflows
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../src/lib/db';

export async function GET(request: NextRequest) {
  try {
    const pool = getPool();
    
    // Get all workflows with their latest execution info
    const query = `
      SELECT 
        w.id,
        w.name,
        w.description,
        w.definition,
        w.version,
        w.enabled,
        w.created_at,
        w.updated_at,
        (
          SELECT json_build_object(
            'id', we.id,
            'status', we.status,
            'started_at', we.started_at,
            'completed_at', we.completed_at,
            'triggered_by', we.triggered_by
          )
          FROM workflow_executions we
          WHERE we.workflow_id = w.id
          ORDER BY we.started_at DESC
          LIMIT 1
        ) as last_run
      FROM workflows w
      ORDER BY w.name ASC
    `;
    
    const result = await pool.query(query);
    
    return NextResponse.json({
      workflows: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('[API /api/workflows] Error fetching workflows:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workflows' },
      { status: 500 }
    );
  }
}
