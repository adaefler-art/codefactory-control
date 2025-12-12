/**
 * API Route: List Repositories
 * 
 * GET /api/repositories - Lists all configured GitHub repositories
 * POST /api/repositories - Add a new repository
 * 
 * Lists all configured GitHub repositories from the database.
 */

import { NextResponse } from 'next/server';
import { getPool } from '../../../src/lib/db';

export async function GET() {
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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { owner, name, defaultBranch = 'main', enabled = true, config = {} } = body;

    // Validate required fields
    if (!owner || !name) {
      return NextResponse.json(
        { error: 'Owner and name are required' },
        { status: 400 }
      );
    }

    const pool = getPool();
    
    // Check if repository already exists
    const checkQuery = `
      SELECT id FROM repositories
      WHERE owner = $1 AND name = $2
    `;
    const checkResult = await pool.query(checkQuery, [owner, name]);
    
    if (checkResult.rows.length > 0) {
      return NextResponse.json(
        { error: 'Repository already exists' },
        { status: 409 }
      );
    }

    // Insert new repository
    // Note: full_name is a generated column (owner || '/' || name)
    const insertQuery = `
      INSERT INTO repositories (owner, name, default_branch, enabled, config)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const result = await pool.query(insertQuery, [
      owner,
      name,
      defaultBranch,
      enabled,
      JSON.stringify(config),
    ]);

    const repo = result.rows[0];

    return NextResponse.json({
      repository: {
        id: repo.id,
        owner: repo.owner,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
        enabled: repo.enabled,
        config: repo.config,
        createdAt: repo.created_at,
        updatedAt: repo.updated_at,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[API] Error creating repository:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to create repository',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
