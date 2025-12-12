/**
 * API Route: List Agent Runs
 * 
 * GET /api/agents?limit=50
 * 
 * Lists recent agent runs with their statistics.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../src/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const pool = getPool();
    
    const query = `
      SELECT 
        id,
        execution_id,
        step_id,
        agent_type,
        model,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        duration_ms,
        cost_usd,
        started_at,
        completed_at,
        error,
        created_at
      FROM agent_runs
      ORDER BY started_at DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [limit]);

    const agents = result.rows.map((row) => ({
      id: row.id,
      executionId: row.execution_id,
      stepId: row.step_id,
      agentType: row.agent_type,
      model: row.model,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      durationMs: row.duration_ms,
      costUsd: row.cost_usd,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ agents, total: agents.length });
  } catch (error) {
    console.error('[API] Error listing agent runs:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to list agent runs',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
