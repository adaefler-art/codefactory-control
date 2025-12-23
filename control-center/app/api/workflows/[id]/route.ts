/**
 * API Route: GET /api/workflows/[id]
 * 
 * Returns details of a specific workflow
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { normalizeOutput } from '@/lib/api/normalize-output';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const pool = getPool();
    
    // Get workflow details
    const query = `
      SELECT 
        id,
        name,
        description,
        definition,
        version,
        enabled,
        created_at,
        updated_at
      FROM workflows
      WHERE id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(normalizeOutput(result.rows[0]));
  } catch (error) {
    console.error('[API /api/workflows/[id]] Error fetching workflow:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workflow' },
      { status: 500 }
    );
  }
}
