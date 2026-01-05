/**
 * Lawbook Database Operations (E79.1 / I791)
 * 
 * CRUD operations for lawbook versioning:
 * - Create immutable lawbook versions
 * - Retrieve active lawbook
 * - List versions
 * - Activate versions (update pointer)
 * 
 * Guarantees:
 * - Idempotency: same hash → returns existing version
 * - Immutability: versions never change once created
 * - Deny-by-default: missing active lawbook returns explicit error
 */

import { Pool } from 'pg';
import { getPool } from '../db';
import { 
  LawbookV1, 
  parseLawbook, 
  computeLawbookHash,
  safeParseLawbook 
} from '@/lawbook/schema';

// ========================================
// Types
// ========================================

export interface LawbookVersionRecord {
  id: string;
  lawbook_id: string;
  lawbook_version: string;
  created_at: string;
  created_by: 'admin' | 'system';
  lawbook_json: LawbookV1;
  lawbook_hash: string;
  schema_version: string;
}

export interface LawbookActiveRecord {
  lawbook_id: string;
  active_lawbook_version_id: string;
  updated_at: string;
}

export interface LawbookEventRecord {
  id: string;
  event_type: 'version_created' | 'version_activated' | 'version_deactivated';
  lawbook_id: string;
  lawbook_version_id: string | null;
  event_json: Record<string, unknown>;
  created_at: string;
  created_by: 'admin' | 'system' | 'api';
}

export interface CreateLawbookVersionResult {
  success: boolean;
  data?: LawbookVersionRecord;
  error?: string;
  isExisting?: boolean; // True if hash already exists (idempotent)
}

export interface GetActiveLawbookResult {
  success: boolean;
  data?: LawbookVersionRecord;
  error?: string;
  notConfigured?: boolean; // True if no active lawbook (deny-by-default)
}

export interface ActivateLawbookResult {
  success: boolean;
  data?: LawbookActiveRecord;
  error?: string;
}

// ========================================
// Create Lawbook Version
// ========================================

/**
 * Create a new lawbook version (idempotent by hash)
 * 
 * If a version with the same hash already exists, returns that version.
 * This ensures deterministic behavior: same content → same version.
 */
export async function createLawbookVersion(
  lawbook: LawbookV1,
  createdBy: 'admin' | 'system' = 'system',
  pool?: Pool
): Promise<CreateLawbookVersionResult> {
  const db = pool || getPool();

  try {
    // Validate lawbook schema
    const parseResult = safeParseLawbook(lawbook);
    if (!parseResult.success) {
      return {
        success: false,
        error: `Invalid lawbook schema: ${parseResult.error.message}`,
      };
    }

    const validatedLawbook = parseResult.data;
    const lawbookHash = computeLawbookHash(validatedLawbook);

    // Check if version with this hash already exists (idempotency)
    const existingQuery = `
      SELECT 
        id, lawbook_id, lawbook_version, created_at, created_by,
        lawbook_json, lawbook_hash, schema_version
      FROM lawbook_versions
      WHERE lawbook_hash = $1
      LIMIT 1
    `;

    const existingResult = await db.query<LawbookVersionRecord>(existingQuery, [lawbookHash]);

    if (existingResult.rows.length > 0) {
      // Hash already exists - return existing version (idempotent)
      return {
        success: true,
        data: existingResult.rows[0],
        isExisting: true,
      };
    }

    // Create new version
    const insertQuery = `
      INSERT INTO lawbook_versions (
        lawbook_id, lawbook_version, created_by,
        lawbook_json, lawbook_hash, schema_version
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING 
        id, lawbook_id, lawbook_version, created_at, created_by,
        lawbook_json, lawbook_hash, schema_version
    `;

    const insertResult = await db.query<LawbookVersionRecord>(insertQuery, [
      validatedLawbook.lawbookId,
      validatedLawbook.lawbookVersion,
      createdBy,
      JSON.stringify(validatedLawbook),
      lawbookHash,
      validatedLawbook.version,
    ]);

    const newVersion = insertResult.rows[0];

    // Record creation event
    await recordLawbookEvent(
      'version_created',
      newVersion.lawbook_id,
      newVersion.id,
      {
        lawbookVersion: newVersion.lawbook_version,
        lawbookHash: newVersion.lawbook_hash,
        schemaVersion: newVersion.schema_version,
      },
      createdBy,
      db
    );

    return {
      success: true,
      data: newVersion,
      isExisting: false,
    };
  } catch (error) {
    console.error('[DB] Failed to create lawbook version:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ========================================
// Get Active Lawbook
// ========================================

/**
 * Get the currently active lawbook version
 * 
 * Returns notConfigured=true if no active lawbook exists.
 * Callers should implement deny-by-default behavior in this case.
 */
export async function getActiveLawbook(
  lawbookId: string = 'AFU9-LAWBOOK',
  pool?: Pool
): Promise<GetActiveLawbookResult> {
  const db = pool || getPool();

  try {
    const query = `
      SELECT 
        v.id, v.lawbook_id, v.lawbook_version, v.created_at, v.created_by,
        v.lawbook_json, v.lawbook_hash, v.schema_version
      FROM lawbook_active a
      JOIN lawbook_versions v ON v.id = a.active_lawbook_version_id
      WHERE a.lawbook_id = $1
      LIMIT 1
    `;

    const result = await db.query<LawbookVersionRecord>(query, [lawbookId]);

    if (result.rows.length === 0) {
      // No active lawbook configured - deny by default
      return {
        success: false,
        error: `No active lawbook configured for '${lawbookId}'. Deny by default.`,
        notConfigured: true,
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[DB] Failed to get active lawbook:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ========================================
// List Lawbook Versions
// ========================================

/**
 * List all lawbook versions (newest first)
 * 
 * Bounded pagination with deterministic ordering (created_at DESC, id DESC).
 */
export async function listLawbookVersions(
  lawbookId: string = 'AFU9-LAWBOOK',
  limit: number = 50,
  offset: number = 0,
  pool?: Pool
): Promise<LawbookVersionRecord[]> {
  const db = pool || getPool();

  try {
    const query = `
      SELECT 
        id, lawbook_id, lawbook_version, created_at, created_by,
        lawbook_json, lawbook_hash, schema_version
      FROM lawbook_versions
      WHERE lawbook_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await db.query<LawbookVersionRecord>(query, [lawbookId, limit, offset]);
    return result.rows;
  } catch (error) {
    console.error('[DB] Failed to list lawbook versions:', error);
    throw error;
  }
}

// ========================================
// Activate Lawbook Version
// ========================================

/**
 * Activate a lawbook version (update active pointer)
 * 
 * Records activation event for audit trail.
 */
export async function activateLawbookVersion(
  lawbookVersionId: string,
  activatedBy: 'admin' | 'system' = 'admin',
  pool?: Pool
): Promise<ActivateLawbookResult> {
  const db = pool || getPool();

  try {
    // Verify version exists
    const versionQuery = `
      SELECT id, lawbook_id, lawbook_version, lawbook_hash
      FROM lawbook_versions
      WHERE id = $1
      LIMIT 1
    `;

    const versionResult = await db.query(versionQuery, [lawbookVersionId]);

    if (versionResult.rows.length === 0) {
      return {
        success: false,
        error: `Lawbook version not found: ${lawbookVersionId}`,
      };
    }

    const version = versionResult.rows[0];
    const lawbookId = version.lawbook_id;

    // Upsert active pointer
    const upsertQuery = `
      INSERT INTO lawbook_active (lawbook_id, active_lawbook_version_id, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (lawbook_id)
      DO UPDATE SET
        active_lawbook_version_id = EXCLUDED.active_lawbook_version_id,
        updated_at = NOW()
      RETURNING lawbook_id, active_lawbook_version_id, updated_at
    `;

    const upsertResult = await db.query<LawbookActiveRecord>(upsertQuery, [
      lawbookId,
      lawbookVersionId,
    ]);

    // Record activation event
    await recordLawbookEvent(
      'version_activated',
      lawbookId,
      lawbookVersionId,
      {
        lawbookVersion: version.lawbook_version,
        lawbookHash: version.lawbook_hash,
      },
      activatedBy,
      db
    );

    return {
      success: true,
      data: upsertResult.rows[0],
    };
  } catch (error) {
    console.error('[DB] Failed to activate lawbook version:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ========================================
// Internal: Record Event
// ========================================

async function recordLawbookEvent(
  eventType: 'version_created' | 'version_activated' | 'version_deactivated',
  lawbookId: string,
  lawbookVersionId: string | null,
  eventJson: Record<string, unknown>,
  createdBy: 'admin' | 'system' | 'api',
  pool: Pool
): Promise<void> {
  const query = `
    INSERT INTO lawbook_events (
      event_type, lawbook_id, lawbook_version_id, event_json, created_by
    )
    VALUES ($1, $2, $3, $4, $5)
  `;

  await pool.query(query, [
    eventType,
    lawbookId,
    lawbookVersionId,
    JSON.stringify(eventJson),
    createdBy,
  ]);
}

// ========================================
// Get Lawbook Version by ID
// ========================================

/**
 * Get a specific lawbook version by ID
 */
export async function getLawbookVersionById(
  versionId: string,
  pool?: Pool
): Promise<LawbookVersionRecord | null> {
  const db = pool || getPool();

  try {
    const query = `
      SELECT 
        id, lawbook_id, lawbook_version, created_at, created_by,
        lawbook_json, lawbook_hash, schema_version
      FROM lawbook_versions
      WHERE id = $1
      LIMIT 1
    `;

    const result = await db.query<LawbookVersionRecord>(query, [versionId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('[DB] Failed to get lawbook version by ID:', error);
    throw error;
  }
}
