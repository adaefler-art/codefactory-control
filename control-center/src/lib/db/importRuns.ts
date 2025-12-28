/**
 * Import Runs Database Helper
 * 
 * Database operations for import_runs table.
 */

import { Pool } from 'pg';

/**
 * Import run row from database
 */
export interface ImportRunRow {
  id: string;
  source_type: 'github_file' | 'manual' | 'api';
  source_path: string;
  source_ref: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';
  epics_created: number;
  epics_updated: number;
  epics_skipped: number;
  issues_created: number;
  issues_updated: number;
  issues_skipped: number;
  errors_count: number;
  errors: Array<{ line?: number; message: string }>;
  started_at: string;
  completed_at: string | null;
}

/**
 * Import run input for create
 */
export interface ImportRunInput {
  source_type: 'github_file' | 'manual' | 'api';
  source_path: string;
  source_ref?: string;
}

/**
 * Import run update
 */
export interface ImportRunUpdate {
  status?: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';
  epics_created?: number;
  epics_updated?: number;
  epics_skipped?: number;
  issues_created?: number;
  issues_updated?: number;
  issues_skipped?: number;
  errors_count?: number;
  errors?: Array<{ line?: number; message: string }>;
  completed_at?: string;
}

/**
 * Operation result type
 */
export interface OperationResult<T = ImportRunRow> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Create a new import run
 * 
 * @param pool - PostgreSQL connection pool
 * @param input - Import run data
 * @returns Operation result with import run or error
 */
export async function createImportRun(
  pool: Pool,
  input: ImportRunInput
): Promise<OperationResult> {
  try {
    const result = await pool.query<ImportRunRow>(
      `INSERT INTO import_runs (source_type, source_path, source_ref)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.source_type, input.source_path, input.source_ref || 'main']
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'No row returned from insert',
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[importRuns] Create failed:', {
      error: error instanceof Error ? error.message : String(error),
      input,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Update an import run
 * 
 * @param pool - PostgreSQL connection pool
 * @param id - Import run UUID
 * @param updates - Fields to update
 * @returns Operation result with updated import run or error
 */
export async function updateImportRun(
  pool: Pool,
  id: string,
  updates: ImportRunUpdate
): Promise<OperationResult> {
  try {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.status !== undefined) {
      fields.push(`status = $${paramIndex}`);
      values.push(updates.status);
      paramIndex++;
    }

    if (updates.epics_created !== undefined) {
      fields.push(`epics_created = $${paramIndex}`);
      values.push(updates.epics_created);
      paramIndex++;
    }

    if (updates.epics_updated !== undefined) {
      fields.push(`epics_updated = $${paramIndex}`);
      values.push(updates.epics_updated);
      paramIndex++;
    }

    if (updates.epics_skipped !== undefined) {
      fields.push(`epics_skipped = $${paramIndex}`);
      values.push(updates.epics_skipped);
      paramIndex++;
    }

    if (updates.issues_created !== undefined) {
      fields.push(`issues_created = $${paramIndex}`);
      values.push(updates.issues_created);
      paramIndex++;
    }

    if (updates.issues_updated !== undefined) {
      fields.push(`issues_updated = $${paramIndex}`);
      values.push(updates.issues_updated);
      paramIndex++;
    }

    if (updates.issues_skipped !== undefined) {
      fields.push(`issues_skipped = $${paramIndex}`);
      values.push(updates.issues_skipped);
      paramIndex++;
    }

    if (updates.errors_count !== undefined) {
      fields.push(`errors_count = $${paramIndex}`);
      values.push(updates.errors_count);
      paramIndex++;
    }

    if (updates.errors !== undefined) {
      fields.push(`errors = $${paramIndex}`);
      values.push(JSON.stringify(updates.errors));
      paramIndex++;
    }

    if (updates.completed_at !== undefined) {
      fields.push(`completed_at = $${paramIndex}`);
      values.push(updates.completed_at);
      paramIndex++;
    }

    if (fields.length === 0) {
      return {
        success: false,
        error: 'No fields to update',
      };
    }

    values.push(id);

    const query = `
      UPDATE import_runs 
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query<ImportRunRow>(query, values);

    if (result.rows.length === 0) {
      return {
        success: false,
        error: `Import run not found: ${id}`,
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[importRuns] Update failed:', {
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
 * Get an import run by ID
 * 
 * @param pool - PostgreSQL connection pool
 * @param id - Import run UUID
 * @returns Operation result with import run or error
 */
export async function getImportRun(
  pool: Pool,
  id: string
): Promise<OperationResult> {
  try {
    const result = await pool.query<ImportRunRow>(
      'SELECT * FROM import_runs WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: `Import run not found: ${id}`,
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[importRuns] Get failed:', {
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
