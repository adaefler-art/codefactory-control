/**
 * API Route: List Workflows
 * 
 * GET /api/workflows
 * 
 * Lists all workflow definitions from the database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../src/lib/db';

export async function GET(request: NextRequest) {
  try {
    const pool = getPool();
    
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
      ORDER BY name ASC
    `;

    const result = await pool.query(query);

    const workflows = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      definition: row.definition,
      version: row.version,
      enabled: row.enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return NextResponse.json({ workflows, total: workflows.length });
  } catch (error) {
    console.error('[API] Error listing workflows:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to list workflows',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
