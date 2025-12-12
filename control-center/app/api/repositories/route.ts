/**
 * API Route: List Repositories
 * 
 * GET /api/repositories
 * 
 * Lists all configured GitHub repositories from the database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../src/lib/db';

export async function GET(request: NextRequest) {
  try {
    const pool = getPool();
    
    const query = `
      SELECT 
        id,
        owner,
        name,
        full_name,
        default_branch,
        enabled,
        config,
        created_at,
        updated_at
      FROM repositories
      ORDER BY full_name ASC
    `;

    const result = await pool.query(query);

    const repositories = result.rows.map((row) => ({
      id: row.id,
      owner: row.owner,
      name: row.name,
      fullName: row.full_name,
      defaultBranch: row.default_branch,
      enabled: row.enabled,
      config: row.config,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return NextResponse.json({ repositories, total: repositories.length });
  } catch (error) {
    console.error('[API] Error listing repositories:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to list repositories',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
