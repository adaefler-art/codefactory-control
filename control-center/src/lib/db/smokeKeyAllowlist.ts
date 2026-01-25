/**
 * Smoke Key Allowlist Database Operations (I906)
 * 
 * Runtime-configurable allowlist for smoke-key authenticated endpoints.
 * Enables smoke testing without redeployment.
 * 
 * Security Guarantees:
 * - Admin-only modifications (enforced at API layer)
 * - Full audit trail (soft deletes, timestamps, actor tracking)
 * - Hard limits (max 100 active routes)
 * - Fail-closed (DB error = deny access)
 */

import { Pool } from 'pg';
import { getPool } from '../db';

// ========================================
// Types
// ========================================

export interface SmokeKeyAllowlistEntry {
  id: number;
  route_pattern: string;
  method: string;
  is_regex: boolean;
  description: string | null;
  added_by: string;
  added_at: string;
  removed_by: string | null;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AddRouteInput {
  routePattern: string;
  method?: string;
  isRegex?: boolean;
  description?: string;
  addedBy: string;
}

export interface RemoveRouteInput {
  routePattern: string;
  method?: string;
  removedBy: string;
}

export interface GetAllowlistResult {
  success: boolean;
  data?: SmokeKeyAllowlistEntry[];
  error?: string;
}

export interface AddRouteResult {
  success: boolean;
  data?: SmokeKeyAllowlistEntry;
  error?: string;
  code?: 'LIMIT_EXCEEDED' | 'DUPLICATE' | 'INVALID_INPUT' | 'DB_ERROR';
}

export interface RemoveRouteResult {
  success: boolean;
  removed: boolean;
  error?: string;
}

// ========================================
// Constants
// ========================================

const MAX_ACTIVE_ROUTES = 100;

// ========================================
// Get Active Allowlist
// ========================================

/**
 * Get all active (non-removed) allowlist entries
 * 
 * Used by middleware to check if a route is allowed for smoke-key bypass.
 */
export async function getActiveAllowlist(
  pool?: Pool
): Promise<GetAllowlistResult> {
  const db = pool || getPool();

  try {
    const query = `
      SELECT 
        id, route_pattern, method, is_regex, description,
        added_by, added_at, removed_by, removed_at,
        created_at, updated_at
      FROM smoke_key_allowlist
      WHERE removed_at IS NULL
      ORDER BY added_at DESC
    `;

    const result = await db.query<SmokeKeyAllowlistEntry>(query);

    return {
      success: true,
      data: result.rows,
    };
  } catch (error) {
    console.error('[DB] Failed to get active allowlist:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get all allowlist entries including removed (for audit purposes)
 */
export async function getAllowlistHistory(
  limit = 100,
  pool?: Pool
): Promise<GetAllowlistResult> {
  const db = pool || getPool();

  try {
    const query = `
      SELECT 
        id, route_pattern, method, is_regex, description,
        added_by, added_at, removed_by, removed_at,
        created_at, updated_at
      FROM smoke_key_allowlist
      ORDER BY added_at DESC
      LIMIT $1
    `;

    const result = await db.query<SmokeKeyAllowlistEntry>(query, [limit]);

    return {
      success: true,
      data: result.rows,
    };
  } catch (error) {
    console.error('[DB] Failed to get allowlist history:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ========================================
// Add Route
// ========================================

/**
 * Add a route pattern to the allowlist
 * 
 * Security:
 * - Enforces max active routes limit
 * - Prevents duplicate active entries
 * - Full audit trail
 */
export async function addRouteToAllowlist(
  input: AddRouteInput,
  pool?: Pool
): Promise<AddRouteResult> {
  const db = pool || getPool();

  // Validate input
  const routePattern = input.routePattern.trim();
  if (!routePattern) {
    return {
      success: false,
      error: 'Route pattern cannot be empty',
      code: 'INVALID_INPUT',
    };
  }

  const method = (input.method || '*').toUpperCase();
  const validMethods = ['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  if (!validMethods.includes(method)) {
    return {
      success: false,
      error: `Invalid method: ${method}. Must be one of: ${validMethods.join(', ')}`,
      code: 'INVALID_INPUT',
    };
  }

  const isRegex = input.isRegex ?? false;

  // Validate regex pattern if applicable
  if (isRegex) {
    try {
      new RegExp(routePattern);
    } catch (err) {
      return {
        success: false,
        error: `Invalid regex pattern: ${err instanceof Error ? err.message : 'unknown error'}`,
        code: 'INVALID_INPUT',
      };
    }
  }

  try {
    // Check current count
    const countResult = await db.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM smoke_key_allowlist WHERE removed_at IS NULL'
    );
    const currentCount = parseInt(countResult.rows[0]?.count || '0', 10);

    if (currentCount >= MAX_ACTIVE_ROUTES) {
      return {
        success: false,
        error: `Maximum active routes limit reached (${MAX_ACTIVE_ROUTES})`,
        code: 'LIMIT_EXCEEDED',
      };
    }

    // Check for duplicate active entry
    const duplicateCheck = await db.query<{ id: number }>(
      `SELECT id FROM smoke_key_allowlist 
       WHERE route_pattern = $1 AND method = $2 AND removed_at IS NULL`,
      [routePattern, method]
    );

    if (duplicateCheck.rows.length > 0) {
      return {
        success: false,
        error: `Route already exists in allowlist: ${method} ${routePattern}`,
        code: 'DUPLICATE',
      };
    }

    // Insert new entry
    const query = `
      INSERT INTO smoke_key_allowlist (
        route_pattern, method, is_regex, description, added_by
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING 
        id, route_pattern, method, is_regex, description,
        added_by, added_at, removed_by, removed_at,
        created_at, updated_at
    `;

    const result = await db.query<SmokeKeyAllowlistEntry>(query, [
      routePattern,
      method,
      isRegex,
      input.description || null,
      input.addedBy,
    ]);

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[DB] Failed to add route to allowlist:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'DB_ERROR',
    };
  }
}

// ========================================
// Remove Route
// ========================================

/**
 * Remove a route pattern from the allowlist (soft delete)
 * 
 * Security:
 * - Soft delete preserves audit trail
 * - Records who removed it and when
 */
export async function removeRouteFromAllowlist(
  input: RemoveRouteInput,
  pool?: Pool
): Promise<RemoveRouteResult> {
  const db = pool || getPool();

  const routePattern = input.routePattern.trim();
  const method = (input.method || '*').toUpperCase();

  if (!routePattern) {
    return {
      success: false,
      removed: false,
      error: 'Route pattern cannot be empty',
    };
  }

  try {
    const query = `
      UPDATE smoke_key_allowlist
      SET removed_by = $1, removed_at = NOW()
      WHERE route_pattern = $2 
        AND method = $3
        AND removed_at IS NULL
      RETURNING id
    `;

    const result = await db.query(query, [input.removedBy, routePattern, method]);

    if (result.rows.length === 0) {
      return {
        success: true,
        removed: false,
        error: 'Route not found in active allowlist',
      };
    }

    return {
      success: true,
      removed: true,
    };
  } catch (error) {
    console.error('[DB] Failed to remove route from allowlist:', error);
    return {
      success: false,
      removed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ========================================
// Route Matching
// ========================================

// Cache for compiled regex patterns to avoid recompilation
const regexCache = new Map<string, RegExp>();

/**
 * Get or compile a regex pattern with caching
 */
function getOrCompileRegex(pattern: string): RegExp | null {
  try {
    if (regexCache.has(pattern)) {
      return regexCache.get(pattern)!;
    }
    
    const regex = new RegExp(pattern);
    regexCache.set(pattern, regex);
    return regex;
  } catch (err) {
    console.error('[ALLOWLIST] Invalid regex pattern:', pattern, err);
    return null;
  }
}

/**
 * Check if a route matches any pattern in the allowlist
 * 
 * Used by middleware for access control decisions.
 * 
 * Security: Fail-closed on any error.
 */
export function isRouteAllowed(
  pathname: string,
  method: string,
  allowlist: SmokeKeyAllowlistEntry[]
): boolean {
  try {
    const normalizedMethod = method.toUpperCase();

    for (const entry of allowlist) {
      // Check method match (wildcard or exact)
      const entryMethod = (entry.method || '*').toUpperCase();
      const methodMatches = entryMethod === '*' || entryMethod === normalizedMethod;
      if (!methodMatches) continue;

      // Check route match
      if (entry.is_regex) {
        const regex = getOrCompileRegex(entry.route_pattern);
        if (regex && regex.test(pathname)) {
          return true;
        }
      } else {
        // Exact match
        if (pathname === entry.route_pattern) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    console.error('[ALLOWLIST] Error checking route:', error);
    // Fail closed
    return false;
  }
}

// ========================================
// Statistics
// ========================================

/**
 * Get allowlist statistics for monitoring
 */
export async function getAllowlistStats(
  pool?: Pool
): Promise<{
  activeCount: number;
  totalCount: number;
  limitRemaining: number;
  maxLimit: number;
}> {
  const db = pool || getPool();

  try {
    const result = await db.query<{ active: string; total: string }>(`
      SELECT 
        COUNT(*) FILTER (WHERE removed_at IS NULL) as active,
        COUNT(*) as total
      FROM smoke_key_allowlist
    `);

    const activeCount = parseInt(result.rows[0]?.active || '0', 10);
    const totalCount = parseInt(result.rows[0]?.total || '0', 10);

    return {
      activeCount,
      totalCount,
      limitRemaining: MAX_ACTIVE_ROUTES - activeCount,
      maxLimit: MAX_ACTIVE_ROUTES,
    };
  } catch (error) {
    console.error('[DB] Failed to get allowlist stats:', error);
    return {
      activeCount: 0,
      totalCount: 0,
      limitRemaining: 0,
      maxLimit: MAX_ACTIVE_ROUTES,
    };
  }
}
