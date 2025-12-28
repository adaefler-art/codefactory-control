/**
 * AFU9 Epics Database Helper
 * 
 * Database operations for afu9_epics table.
 * Provides type-safe CRUD operations with proper error handling.
 */

import { Pool } from 'pg';

/**
 * Epic row from database
 */
export interface Afu9EpicRow {
  id: string;
  external_id: string;
  title: string;
  description: string | null;
  labels: string[];
  created_at: string;
  updated_at: string;
}

/**
 * Epic input for create/update
 */
export interface Afu9EpicInput {
  external_id: string;
  title: string;
  description?: string | null;
  labels?: string[];
}

/**
 * Operation result type
 */
export interface OperationResult<T = Afu9EpicRow> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Upsert an AFU9 epic (insert or update based on external_id)
 * 
 * @param pool - PostgreSQL connection pool
 * @param input - Epic data
 * @returns Operation result with epic or error
 */
export async function upsertAfu9Epic(
  pool: Pool,
  input: Afu9EpicInput
): Promise<OperationResult> {
  try {
    const result = await pool.query<Afu9EpicRow>(
      `INSERT INTO afu9_epics (external_id, title, description, labels)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (external_id) 
       DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         labels = EXCLUDED.labels,
         updated_at = NOW()
       RETURNING *`,
      [
        input.external_id,
        input.title,
        input.description || null,
        input.labels || [],
      ]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'No row returned from upsert',
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[afu9Epics] Upsert failed:', {
      error: error instanceof Error ? error.message : String(error),
      external_id: input.external_id,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get an AFU9 epic by external ID
 * 
 * @param pool - PostgreSQL connection pool
 * @param externalId - Epic external ID
 * @returns Operation result with epic or error
 */
export async function getAfu9EpicByExternalId(
  pool: Pool,
  externalId: string
): Promise<OperationResult> {
  try {
    const result = await pool.query<Afu9EpicRow>(
      'SELECT * FROM afu9_epics WHERE external_id = $1',
      [externalId]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: `Epic not found: ${externalId}`,
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[afu9Epics] Get by external ID failed:', {
      error: error instanceof Error ? error.message : String(error),
      externalId,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get an AFU9 epic by UUID
 * 
 * @param pool - PostgreSQL connection pool
 * @param id - Epic UUID
 * @returns Operation result with epic or error
 */
export async function getAfu9EpicById(
  pool: Pool,
  id: string
): Promise<OperationResult> {
  try {
    const result = await pool.query<Afu9EpicRow>(
      'SELECT * FROM afu9_epics WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: `Epic not found: ${id}`,
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[afu9Epics] Get by ID failed:', {
      error: error instanceof Error ? error.message : String(error),
      id,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * List all AFU9 epics
 * 
 * @param pool - PostgreSQL connection pool
 * @returns Operation result with list of epics or error
 */
export async function listAfu9Epics(
  pool: Pool
): Promise<OperationResult<Afu9EpicRow[]>> {
  try {
    const result = await pool.query<Afu9EpicRow>(
      'SELECT * FROM afu9_epics ORDER BY created_at DESC'
    );

    return {
      success: true,
      data: result.rows,
    };
  } catch (error) {
    console.error('[afu9Epics] List failed:', {
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}
