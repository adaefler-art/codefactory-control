/**
 * Database Access Layer: Tool Execution Audit
 * 
 * Functions for logging and querying tool execution audit trail.
 * Issue: V09-I02: Tool Gating: Action-Gated Draft Ops (No Auto-Snap)
 */

import { Pool } from 'pg';

export type TriggerType = 'AUTO_BLOCKED' | 'USER_EXPLICIT' | 'UI_ACTION' | 'AUTO_ALLOWED';

export interface ToolExecutionAudit {
  id: string;
  session_id: string;
  user_id: string;
  tool_name: string;
  trigger_type: TriggerType;
  conversation_mode: 'FREE' | 'DRAFTING';
  success: boolean;
  error_code?: string | null;
  executed_at: string;
}

/**
 * Log a tool execution to the audit trail
 * 
 * @param pool - Database pool
 * @param params - Tool execution details
 * @returns Audit record
 */
export async function logToolExecution(
  pool: Pool,
  params: {
    sessionId: string;
    userId: string;
    toolName: string;
    triggerType: TriggerType;
    conversationMode: 'FREE' | 'DRAFTING';
    success: boolean;
    errorCode?: string;
  }
): Promise<{ success: true; data: ToolExecutionAudit } | { success: false; error: string }> {
  try {
    const { sessionId, userId, toolName, triggerType, conversationMode, success, errorCode } = params;
    
    const result = await pool.query<ToolExecutionAudit>(
      `INSERT INTO tool_execution_audit 
        (session_id, user_id, tool_name, trigger_type, conversation_mode, success, error_code)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING 
        id,
        session_id,
        user_id,
        tool_name,
        trigger_type,
        conversation_mode,
        success,
        error_code,
        executed_at`,
      [sessionId, userId, toolName, triggerType, conversationMode, success, errorCode || null]
    );
    
    return {
      success: true,
      data: {
        ...result.rows[0],
        executed_at: result.rows[0].executed_at.toISOString(),
      },
    };
  } catch (error) {
    console.error('[DB] Error logging tool execution:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get recent tool execution audit logs for a session
 * 
 * @param pool - Database pool
 * @param sessionId - Session ID
 * @param userId - User ID (for ownership check)
 * @param options - Query options
 * @returns Audit records
 */
export async function getToolExecutionAudit(
  pool: Pool,
  sessionId: string,
  userId: string,
  options?: {
    limit?: number;
    toolName?: string;
    triggerType?: TriggerType;
  }
): Promise<{ success: true; data: ToolExecutionAudit[] } | { success: false; error: string }> {
  try {
    const limit = options?.limit || 50;
    const params: any[] = [sessionId, userId];
    
    let query = `
      SELECT 
        id,
        session_id,
        user_id,
        tool_name,
        trigger_type,
        conversation_mode,
        success,
        error_code,
        executed_at
      FROM tool_execution_audit
      WHERE session_id = $1 AND user_id = $2
    `;
    
    if (options?.toolName) {
      query += ` AND tool_name = $${params.length + 1}`;
      params.push(options.toolName);
    }
    
    if (options?.triggerType) {
      query += ` AND trigger_type = $${params.length + 1}`;
      params.push(options.triggerType);
    }
    
    query += ` ORDER BY executed_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    
    const result = await pool.query<ToolExecutionAudit>(query, params);
    
    return {
      success: true,
      data: result.rows.map(row => ({
        ...row,
        executed_at: row.executed_at.toISOString(),
      })),
    };
  } catch (error) {
    console.error('[DB] Error getting tool execution audit:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get tool execution statistics for a session
 * 
 * @param pool - Database pool
 * @param sessionId - Session ID
 * @param userId - User ID (for ownership check)
 * @returns Statistics
 */
export async function getToolExecutionStats(
  pool: Pool,
  sessionId: string,
  userId: string
): Promise<{
  success: true;
  data: {
    total: number;
    autoBlocked: number;
    userExplicit: number;
    uiAction: number;
    autoAllowed: number;
    byTool: Record<string, number>;
  };
} | { success: false; error: string }> {
  try {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE trigger_type = 'AUTO_BLOCKED') as auto_blocked,
        COUNT(*) FILTER (WHERE trigger_type = 'USER_EXPLICIT') as user_explicit,
        COUNT(*) FILTER (WHERE trigger_type = 'UI_ACTION') as ui_action,
        COUNT(*) FILTER (WHERE trigger_type = 'AUTO_ALLOWED') as auto_allowed
      FROM tool_execution_audit
      WHERE session_id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    
    const toolCountsResult = await pool.query(
      `SELECT tool_name, COUNT(*) as count
      FROM tool_execution_audit
      WHERE session_id = $1 AND user_id = $2
      GROUP BY tool_name
      ORDER BY count DESC`,
      [sessionId, userId]
    );
    
    const byTool: Record<string, number> = {};
    for (const row of toolCountsResult.rows) {
      byTool[row.tool_name] = parseInt(row.count, 10);
    }
    
    return {
      success: true,
      data: {
        total: parseInt(result.rows[0].total, 10),
        autoBlocked: parseInt(result.rows[0].auto_blocked, 10),
        userExplicit: parseInt(result.rows[0].user_explicit, 10),
        uiAction: parseInt(result.rows[0].ui_action, 10),
        autoAllowed: parseInt(result.rows[0].auto_allowed, 10),
        byTool,
      },
    };
  } catch (error) {
    console.error('[DB] Error getting tool execution stats:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
