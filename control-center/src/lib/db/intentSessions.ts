/**
 * Database Access Layer: INTENT Sessions
 * 
 * Provides functions for managing INTENT sessions and messages.
 * Issue E73.1: INTENT Console UI Shell
 * Issue E73.2: Sources Panel + used_sources Contract
 */

import { Pool } from 'pg';
import type { UsedSources } from '../schemas/usedSources';
import { prepareUsedSourcesForStorage } from '../utils/sourceCanonicalizer';

export interface IntentSession {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  status: 'active' | 'archived';
  conversation_mode: 'DISCUSS' | 'DRAFTING' | 'ACT';
}

export interface IntentMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  seq: number;
  used_sources?: UsedSources | null;
  used_sources_hash?: string | null;
}

export interface IntentSessionWithMessages extends IntentSession {
  messages: IntentMessage[];
}

/**
 * List recent INTENT sessions for a specific user
 */
export async function listIntentSessions(
  pool: Pool,
  userId: string,
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
      SELECT id, user_id, title, created_at, updated_at, status, conversation_mode
      FROM intent_sessions
      WHERE user_id = $1
    `;
    const params: any[] = [userId];
    
    if (options?.status) {
      query += ` AND status = $2`;
      params.push(options.status);
    }
    
    query += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    return {
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        user_id: row.user_id,
        title: row.title,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
        status: row.status,
        conversation_mode: row.conversation_mode,
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
 * Create a new INTENT session for a user
 */
export async function createIntentSession(
  pool: Pool,
  userId: string,
  data: {
    title?: string;
    status?: 'active' | 'archived';
  }
): Promise<{ success: true; data: IntentSession } | { success: false; error: string }> {
  try {
    const result = await pool.query(
      `INSERT INTO intent_sessions (user_id, title, status)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, title, created_at, updated_at, status, conversation_mode`,
      [userId, data.title || null, data.status || 'active']
    );
    
    const row = result.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        user_id: row.user_id,
        title: row.title,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
        status: row.status,
        conversation_mode: row.conversation_mode,
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
 * Only returns session if it belongs to the specified user
 */
export async function getIntentSession(
  pool: Pool,
  sessionId: string,
  userId: string
): Promise<{ success: true; data: IntentSessionWithMessages } | { success: false; error: string }> {
  try {
    // Get session with user ownership check
    const sessionResult = await pool.query(
      `SELECT id, user_id, title, created_at, updated_at, status, conversation_mode
       FROM intent_sessions
       WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
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
      `SELECT id, session_id, role, content, created_at, seq, 
              used_sources_json, used_sources_hash
       FROM intent_messages
       WHERE session_id = $1
       ORDER BY seq ASC`,
      [sessionId]
    );
    
    const session: IntentSessionWithMessages = {
      id: sessionRow.id,
      user_id: sessionRow.user_id,
      title: sessionRow.title,
      created_at: sessionRow.created_at.toISOString(),
      updated_at: sessionRow.updated_at.toISOString(),
      status: sessionRow.status,
      conversation_mode: sessionRow.conversation_mode,
      messages: messagesResult.rows.map(row => ({
        id: row.id,
        session_id: row.session_id,
        role: row.role,
        content: row.content,
        created_at: row.created_at.toISOString(),
        seq: row.seq,
        used_sources: row.used_sources_json || null,
        used_sources_hash: row.used_sources_hash || null,
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
 * 
 * Uses atomic counter pattern for race-safe seq increment:
 * - Updates intent_sessions.next_seq atomically via UPDATE ... RETURNING
 * - Prevents concurrent requests from getting duplicate seq values
 * - Row-level lock ensures serialized access to the counter
 * 
 * Issue E73.2: Supports optional used_sources for assistant messages only
 */
export async function appendIntentMessage(
  pool: Pool,
  sessionId: string,
  userId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  usedSources?: UsedSources | null
): Promise<{ success: true; data: IntentMessage } | { success: false; error: string }> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Enforce: only assistant messages can have used_sources
    if (usedSources && role !== 'assistant') {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'used_sources can only be provided for assistant messages',
      };
    }
    
    // Prepare used_sources for storage (canonicalize + hash)
    const { canonical, hash } = prepareUsedSourcesForStorage(
      role === 'assistant' ? usedSources : null
    );
    
    // Atomic counter: get next seq and increment in one operation
    // FOR UPDATE locks the session row, preventing concurrent seq assignment
    const seqResult = await client.query(
      `UPDATE intent_sessions
       SET next_seq = next_seq + 1, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING next_seq - 1 AS seq`,
      [sessionId, userId]
    );
    
    if (seqResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Session not found or access denied',
      };
    }
    
    const nextSeq = seqResult.rows[0].seq;
    
    // Insert message with atomic seq and used_sources
    const result = await client.query(
      `INSERT INTO intent_messages (session_id, role, content, seq, used_sources_json, used_sources_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, session_id, role, content, created_at, seq, used_sources_json, used_sources_hash`,
      [sessionId, role, content, nextSeq, canonical ? JSON.stringify(canonical) : null, hash]
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
        used_sources: row.used_sources_json || null,
        used_sources_hash: row.used_sources_hash || null,
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

/**
 * Update conversation mode for a session
 * 
 * I903: Session Conversation Mode (DISCUSS/DRAFTING/ACT) + Persistenz
 * Only session owner can update mode
 */
export async function updateSessionMode(
  pool: Pool,
  sessionId: string,
  userId: string,
  mode: 'DISCUSS' | 'DRAFTING' | 'ACT'
): Promise<{ success: true; data: { mode: 'DISCUSS' | 'DRAFTING' | 'ACT'; updated_at: string } } | { success: false; error: string }> {
  try {
    // Validate mode (defense in depth, schema validates at API layer)
    if (mode !== 'DISCUSS' && mode !== 'DRAFTING' && mode !== 'ACT') {
      return {
        success: false,
        error: 'Invalid conversation mode. Must be DISCUSS, DRAFTING, or ACT.',
      };
    }
    
    // Update mode with user ownership check
    const result = await pool.query(
      `UPDATE intent_sessions
       SET conversation_mode = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING conversation_mode, updated_at`,
      [mode, sessionId, userId]
    );
    
    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'Session not found or access denied',
      };
    }
    
    const row = result.rows[0];
    return {
      success: true,
      data: {
        mode: row.conversation_mode,
        updated_at: row.updated_at.toISOString(),
      },
    };
  } catch (error) {
    console.error('[DB] Error updating session mode:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
