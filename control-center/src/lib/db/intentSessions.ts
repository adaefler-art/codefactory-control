/**
 * Database Access Layer: INTENT Sessions
 * 
 * Provides functions for managing INTENT sessions and messages.
 * Issue E73.1: INTENT Console UI Shell
 */

import { Pool } from 'pg';

export interface IntentSession {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  status: 'active' | 'archived';
}

export interface IntentMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  seq: number;
}

export interface IntentSessionWithMessages extends IntentSession {
  messages: IntentMessage[];
}

/**
 * List recent INTENT sessions
 */
export async function listIntentSessions(
  pool: Pool,
  options?: {
    limit?: number;
    offset?: number;
    status?: 'active' | 'archived';
  }
): Promise<{ success: true; data: IntentSession[] } | { success: false; error: string }> {
  try {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    
    let query = `
      SELECT id, title, created_at, updated_at, status
      FROM intent_sessions
    `;
    const params: any[] = [];
    
    if (options?.status) {
      query += ` WHERE status = $1`;
      params.push(options.status);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    return {
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        title: row.title,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
        status: row.status,
      })),
    };
  } catch (error) {
    console.error('[DB] Error listing INTENT sessions:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Create a new INTENT session
 */
export async function createIntentSession(
  pool: Pool,
  data: {
    title?: string;
    status?: 'active' | 'archived';
  }
): Promise<{ success: true; data: IntentSession } | { success: false; error: string }> {
  try {
    const result = await pool.query(
      `INSERT INTO intent_sessions (title, status)
       VALUES ($1, $2)
       RETURNING id, title, created_at, updated_at, status`,
      [data.title || null, data.status || 'active']
    );
    
    const row = result.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        title: row.title,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
        status: row.status,
      },
    };
  } catch (error) {
    console.error('[DB] Error creating INTENT session:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get a session with all messages ordered by seq
 */
export async function getIntentSession(
  pool: Pool,
  sessionId: string
): Promise<{ success: true; data: IntentSessionWithMessages } | { success: false; error: string }> {
  try {
    // Get session
    const sessionResult = await pool.query(
      `SELECT id, title, created_at, updated_at, status
       FROM intent_sessions
       WHERE id = $1`,
      [sessionId]
    );
    
    if (sessionResult.rows.length === 0) {
      return {
        success: false,
        error: 'Session not found',
      };
    }
    
    const sessionRow = sessionResult.rows[0];
    
    // Get messages ordered by seq
    const messagesResult = await pool.query(
      `SELECT id, session_id, role, content, created_at, seq
       FROM intent_messages
       WHERE session_id = $1
       ORDER BY seq ASC`,
      [sessionId]
    );
    
    const session: IntentSessionWithMessages = {
      id: sessionRow.id,
      title: sessionRow.title,
      created_at: sessionRow.created_at.toISOString(),
      updated_at: sessionRow.updated_at.toISOString(),
      status: sessionRow.status,
      messages: messagesResult.rows.map(row => ({
        id: row.id,
        session_id: row.session_id,
        role: row.role,
        content: row.content,
        created_at: row.created_at.toISOString(),
        seq: row.seq,
      })),
    };
    
    return {
      success: true,
      data: session,
    };
  } catch (error) {
    console.error('[DB] Error getting INTENT session:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Append a message to a session with deterministic seq
 */
export async function appendIntentMessage(
  pool: Pool,
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): Promise<{ success: true; data: IntentMessage } | { success: false; error: string }> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get next seq number for this session (using transaction for atomicity)
    const seqResult = await client.query(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
       FROM intent_messages
       WHERE session_id = $1
       FOR UPDATE`,
      [sessionId]
    );
    
    const nextSeq = seqResult.rows[0].next_seq;
    
    // Insert message
    const result = await client.query(
      `INSERT INTO intent_messages (session_id, role, content, seq)
       VALUES ($1, $2, $3, $4)
       RETURNING id, session_id, role, content, created_at, seq`,
      [sessionId, role, content, nextSeq]
    );
    
    // Update session updated_at
    await client.query(
      `UPDATE intent_sessions
       SET updated_at = NOW()
       WHERE id = $1`,
      [sessionId]
    );
    
    // Update title if first user message and no title set
    if (role === 'user' && nextSeq === 1) {
      await client.query(
        `UPDATE intent_sessions
         SET title = $1
         WHERE id = $2 AND title IS NULL`,
        [content.substring(0, 100), sessionId]
      );
    }
    
    await client.query('COMMIT');
    
    const row = result.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        session_id: row.session_id,
        role: row.role,
        content: row.content,
        created_at: row.created_at.toISOString(),
        seq: row.seq,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DB] Error appending INTENT message:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    client.release();
  }
}
