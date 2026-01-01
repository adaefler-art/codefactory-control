/**
 * Context Pack Generator
 * 
 * Generates auditable JSON snapshots of INTENT sessions.
 * Issue E73.3: Context Pack Generator (audit JSON per session) + Export/Download
 * 
 * GUARANTEES:
 * - Deterministic output: same DB state → identical JSON
 * - Evidence-friendly: include used_sources hashes
 * - No secrets/tokens in output
 * - Idempotent: same pack_hash → return existing record
 */

import { Pool } from 'pg';
import { createHash } from 'crypto';
import type { ContextPack, ContextPackRecord, ContextPackMetadata } from '../schemas/contextPack';
import { CONTEXT_PACK_VERSION } from '../schemas/contextPack';
import type { IntentSessionWithMessages } from './intentSessions';
import { getIntentSession } from './intentSessions';

/**
 * Maximum size for context pack JSON (2 MB)
 * Prevents excessive memory usage and storage bloat
 */
const MAX_PACK_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Stable JSON serialization with sorted keys
 * 
 * Ensures deterministic output regardless of key insertion order
 */
function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj);
  }
  
  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => stableStringify(item)).join(',') + ']';
  }
  
  // Sort object keys alphabetically
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(key => {
    const value = stableStringify(obj[key]);
    return JSON.stringify(key) + ':' + value;
  });
  
  return '{' + pairs.join(',') + '}';
}

/**
 * Canonicalize a context pack for deterministic hashing
 * 
 * Removes generatedAt and created_at fields, ensures stable key ordering
 */
function canonicalizeContextPack(pack: ContextPack): string {
  // Create a copy without generatedAt for hashing
  const { generatedAt, ...canonicalPack } = pack;
  
  // Sort messages by seq (should already be sorted, but ensure it)
  const sortedMessages = [...canonicalPack.messages].sort((a, b) => a.seq - b.seq);
  
  // Remove created_at from session to avoid timestamp drift in hash
  const { createdAt, updatedAt, ...sessionWithoutTimestamps } = canonicalPack.session;
  
  const canonical = {
    ...canonicalPack,
    session: {
      ...sessionWithoutTimestamps,
      // Keep only stable identifiers
    },
    messages: sortedMessages.map(msg => {
      // Remove createdAt from messages for hash stability
      const { createdAt: msgCreatedAt, ...msgWithoutTimestamp } = msg;
      return msgWithoutTimestamp;
    }),
  };
  
  // Use stable stringify for deterministic serialization
  return stableStringify(canonical);
}

/**
 * Compute SHA256 hash of canonical context pack
 */
function hashContextPack(pack: ContextPack): string {
  const canonical = canonicalizeContextPack(pack);
  const hash = createHash('sha256');
  hash.update(canonical, 'utf8');
  return hash.digest('hex');
}

/**
 * Build context pack from session data
 */
function buildContextPack(session: IntentSessionWithMessages): ContextPack {
  const now = new Date().toISOString();
  
  // Count unique sources across all messages
  const allSourcesHashes = new Set<string>();
  session.messages.forEach(msg => {
    if (msg.used_sources_hash) {
      allSourcesHashes.add(msg.used_sources_hash);
    }
  });
  
  const pack: ContextPack = {
    contextPackVersion: CONTEXT_PACK_VERSION,
    generatedAt: now,
    session: {
      id: session.id,
      title: session.title,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    },
    messages: session.messages.map(msg => ({
      seq: msg.seq,
      role: msg.role,
      content: msg.content,
      createdAt: msg.created_at,
      used_sources: msg.used_sources || null,
      used_sources_hash: msg.used_sources_hash || null,
    })),
    derived: {
      sessionHash: '', // Will be computed below
      messageCount: session.messages.length,
      sourcesCount: allSourcesHashes.size,
    },
    warnings: [],
  };
  
  // Compute session hash
  pack.derived.sessionHash = hashContextPack(pack);
  
  return pack;
}

/**
 * Generate or return existing context pack for a session
 * 
 * Implements idempotency:
 * - If pack with same pack_hash exists, return existing record
 * - Otherwise, create new pack record
 * 
 * @param pool Database pool
 * @param sessionId Session UUID
 * @param userId User ID for ownership check
 * @returns Context pack record or error
 */
export async function generateContextPack(
  pool: Pool,
  sessionId: string,
  userId: string
): Promise<{ success: true; data: ContextPackRecord } | { success: false; error: string; code?: string }> {
  try {
    // Fetch session with messages (includes ownership check)
    const sessionResult = await getIntentSession(pool, sessionId, userId);
    
    if (!sessionResult.success) {
      return {
        success: false,
        error: sessionResult.error,
      };
    }
    
    const session = sessionResult.data;
    
    // Build context pack
    const pack = buildContextPack(session);
    const packHash = pack.derived.sessionHash;
    
    // Validate size before storage
    const packJson = JSON.stringify(pack);
    const packSizeBytes = Buffer.byteLength(packJson, 'utf8');
    
    if (packSizeBytes > MAX_PACK_SIZE_BYTES) {
      return {
        success: false,
        error: `Context pack exceeds maximum size of ${MAX_PACK_SIZE_BYTES / (1024 * 1024)} MB (current: ${(packSizeBytes / (1024 * 1024)).toFixed(2)} MB)`,
        code: 'CONTEXT_PACK_TOO_LARGE',
      };
    }
    
    // Insert new pack using INSERT...ON CONFLICT DO NOTHING pattern
    // This ensures immutability: no UPDATE operations, only INSERT
    // Issue E73.4: Immutability enforcement
    const insertResult = await pool.query(
      `INSERT INTO intent_context_packs (session_id, pack_json, pack_hash, version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (pack_hash, session_id) DO NOTHING
       RETURNING id, session_id, created_at, pack_json, pack_hash, version`,
      [sessionId, packJson, packHash, CONTEXT_PACK_VERSION]
    );
    
    // If ON CONFLICT triggered (no rows returned), fetch existing pack
    if (insertResult.rows.length === 0) {
      const existingResult = await pool.query(
        `SELECT id, session_id, created_at, pack_json, pack_hash, version
         FROM intent_context_packs
         WHERE session_id = $1 AND pack_hash = $2
         LIMIT 1`,
        [sessionId, packHash]
      );
      
      if (existingResult.rows.length > 0) {
        const row = existingResult.rows[0];
        return {
          success: true,
          data: {
            id: row.id,
            session_id: row.session_id,
            created_at: row.created_at.toISOString(),
            pack_json: row.pack_json,
            pack_hash: row.pack_hash,
            version: row.version,
          },
        };
      }
    }
    
    // Return newly inserted pack
    const row = insertResult.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at.toISOString(),
        pack_json: row.pack_json,
        pack_hash: row.pack_hash,
        version: row.version,
      },
    };
  } catch (error) {
    console.error('[DB] Error generating context pack:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get a context pack by ID
 * 
 * @param pool Database pool
 * @param packId Context pack UUID
 * @returns Context pack record or error
 */
export async function getContextPack(
  pool: Pool,
  packId: string
): Promise<{ success: true; data: ContextPackRecord } | { success: false; error: string }> {
  try {
    const result = await pool.query(
      `SELECT id, session_id, created_at, pack_json, pack_hash, version
       FROM intent_context_packs
       WHERE id = $1`,
      [packId]
    );
    
    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'Context pack not found',
      };
    }
    
    const row = result.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at.toISOString(),
        pack_json: row.pack_json,
        pack_hash: row.pack_hash,
        version: row.version,
      },
    };
  } catch (error) {
    console.error('[DB] Error getting context pack:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * List context packs for a session
 * 
 * @param pool Database pool
 * @param sessionId Session UUID
 * @param userId User ID for ownership check (via session)
 * @returns List of context pack records or error
 */
export async function listContextPacks(
  pool: Pool,
  sessionId: string,
  userId: string
): Promise<{ success: true; data: ContextPackRecord[] } | { success: false; error: string }> {
  try {
    // First verify session ownership
    const sessionResult = await getIntentSession(pool, sessionId, userId);
    
    if (!sessionResult.success) {
      return {
        success: false,
        error: sessionResult.error,
      };
    }
    
    // Get all packs for this session
    const result = await pool.query(
      `SELECT id, session_id, created_at, pack_json, pack_hash, version
       FROM intent_context_packs
       WHERE session_id = $1
       ORDER BY created_at DESC`,
      [sessionId]
    );
    
    return {
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at.toISOString(),
        pack_json: row.pack_json,
        pack_hash: row.pack_hash,
        version: row.version,
      })),
    };
  } catch (error) {
    console.error('[DB] Error listing context packs:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * List context packs metadata for a session (without full pack_json)
 * 
 * Returns metadata only to avoid large payloads in list responses.
 * Issue E73.4: Retrieval UX - metadata-only responses
 * 
 * @param pool Database pool
 * @param sessionId Session UUID
 * @param userId User ID for ownership check (via session)
 * @param limit Maximum number of packs to return (default: 50)
 * @returns List of context pack metadata or error
 */
export async function listContextPacksMetadata(
  pool: Pool,
  sessionId: string,
  userId: string,
  limit: number = 50
): Promise<{ success: true; data: ContextPackMetadata[] } | { success: false; error: string }> {
  try {
    // First verify session ownership
    const sessionResult = await getIntentSession(pool, sessionId, userId);
    
    if (!sessionResult.success) {
      return {
        success: false,
        error: sessionResult.error,
      };
    }
    
    // Get metadata only (extract counts from pack_json without returning full JSON)
    // IMPORTANT: Do not select pack_json column to ensure metadata-only response
    const result = await pool.query(
      `SELECT id, session_id, created_at, pack_hash, version,
              (pack_json->'derived'->>'messageCount')::int as message_count,
              (pack_json->'derived'->>'sourcesCount')::int as sources_count
       FROM intent_context_packs
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit]
    );
    
    return {
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at.toISOString(),
        pack_hash: row.pack_hash,
        version: row.version,
        message_count: row.message_count,
        sources_count: row.sources_count,
      })),
    };
  } catch (error) {
    console.error('[DB] Error listing context packs metadata:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get a context pack by hash
 * 
 * Optional: lookup by hash for deduplication/verification purposes
 * Issue E73.4: Optional retrieval by hash
 * 
 * @param pool Database pool
 * @param packHash Context pack hash (SHA256)
 * @param userId User ID for ownership check (via session)
 * @returns Context pack record or error
 */
export async function getContextPackByHash(
  pool: Pool,
  packHash: string,
  userId: string
): Promise<{ success: true; data: ContextPackRecord } | { success: false; error: string }> {
  try {
    const result = await pool.query(
      `SELECT icp.id, icp.session_id, icp.created_at, icp.pack_json, icp.pack_hash, icp.version
       FROM intent_context_packs icp
       JOIN intent_sessions s ON s.id = icp.session_id
       WHERE icp.pack_hash = $1 AND s.user_id = $2
       LIMIT 1`,
      [packHash, userId]
    );
    
    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'Context pack not found',
      };
    }
    
    const row = result.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at.toISOString(),
        pack_json: row.pack_json,
        pack_hash: row.pack_hash,
        version: row.version,
      },
    };
  } catch (error) {
    console.error('[DB] Error getting context pack by hash:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
