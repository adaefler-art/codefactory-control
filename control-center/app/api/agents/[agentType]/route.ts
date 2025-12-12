/**
 * API Route: Get Agent Details by Type
 * 
 * GET /api/agents/[agentType]
 * 
 * Returns detailed information about a specific agent type including
 * all runs, statistics, models used, and tools used.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { agentType: string } }
) {
  try {
    const agentType = decodeURIComponent(params.agentType);
    const pool = getPool();

    // Fetch all runs for this agent type
    const runsQuery = `
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
        tool_calls,
        started_at,
        completed_at,
        error,
        created_at
      FROM agent_runs
      WHERE agent_type = $1
      ORDER BY started_at DESC
    `;

    const runsResult = await pool.query(runsQuery, [agentType]);
    const runs = runsResult.rows;

    if (runs.length === 0) {
      return NextResponse.json(
        { error: 'Agent type not found' },
        { status: 404 }
      );
    }

    // Calculate statistics
    const totalRuns = runs.length;
    const successfulRuns = runs.filter((r) => !r.error).length;
    const failedRuns = runs.filter((r) => r.error).length;
    
    const models = [...new Set(runs.map((r) => r.model).filter(Boolean))];
    
    const totalDuration = runs.reduce((sum, r) => sum + (r.duration_ms || 0), 0);
    const avgDurationMs = totalDuration / totalRuns;
    
    const totalTokens = runs.reduce((sum, r) => sum + (r.total_tokens || 0), 0);
    const avgTokens = totalTokens / totalRuns;
    
    const totalCost = runs.reduce((sum, r) => sum + parseFloat(r.cost_usd || 0), 0);

    // Extract unique tools from tool_calls JSONB
    const toolsSet = new Set<string>();
    runs.forEach((run) => {
      if (run.tool_calls && Array.isArray(run.tool_calls)) {
        run.tool_calls.forEach((call: any) => {
          if (call.tool) {
            toolsSet.add(call.tool);
          }
        });
      }
    });
    const tools = Array.from(toolsSet).sort();

    // Format runs for response
    const formattedRuns = runs.map((row) => ({
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
      toolCalls: row.tool_calls,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error,
      createdAt: row.created_at,
    }));

    return NextResponse.json({
      agentType,
      totalRuns,
      successfulRuns,
      failedRuns,
      models,
      tools,
      avgDurationMs,
      avgTokens,
      totalCost,
      runs: formattedRuns,
    });
  } catch (error) {
    console.error('[API] Error fetching agent details:', error);

    return NextResponse.json(
      {
        error: 'Failed to fetch agent details',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
