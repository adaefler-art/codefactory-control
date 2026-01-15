/**
 * Lawbook Version Helper (E79.3 / I793)
 * 
 * Server-side helper for systematic lawbookVersion enforcement across all
 * operational artifacts (verdicts, reports, incidents, remediation runs, outcomes).
 * 
 * Key Features:
 * - getActiveLawbookVersion(): Returns active lawbook version or null (cached)
 * - requireActiveLawbookVersion(): Returns active version or throws LAWBOOK_NOT_CONFIGURED
 * - attachLawbookVersion(obj): Returns copy with lawbookVersion field added
 * 
 * Enforcement Rules:
 * - Gating/automated actions: MUST use requireActiveLawbookVersion() (fail-closed)
 * - Passive ingestion/records: SHOULD use getActiveLawbookVersion() (null + warning if missing)
 * - All new artifacts MUST include lawbookVersion field
 */

import { Pool } from 'pg';
import { getActiveLawbook } from './db/lawbook';
import { logger } from './logger';
import { LawbookV1, LawbookStopRules } from '../lawbook/schema';

// Cache duration: 60 seconds (short TTL to ensure fresh data)
const CACHE_TTL_MS = 60 * 1000;

// Error code for missing lawbook
export const LAWBOOK_NOT_CONFIGURED_ERROR = 'LAWBOOK_NOT_CONFIGURED';

// Cache state - keyed by lawbook_id to prevent cross-contamination
interface CacheEntry {
  version: string | null;
  timestamp: number;
  lawbookId: string;
}

let cache: CacheEntry | null = null;

/**
 * Get active lawbook version (cached for short TTL)
 * 
 * Returns:
 * - string: Active lawbook version if configured
 * - null: No active lawbook configured
 * 
 * Use this for passive/ingestion operations where null is acceptable.
 * 
 * @param pool - Optional database pool
 * @param lawbookId - Lawbook ID to fetch (defaults to 'AFU9-LAWBOOK')
 * @param forceRefresh - Force cache refresh (e.g., after activation)
 */
export async function getActiveLawbookVersion(
  pool?: Pool,
  lawbookId: string = 'AFU9-LAWBOOK',
  forceRefresh: boolean = false
): Promise<string | null> {
  // Check cache (keyed by lawbookId)
  const now = Date.now();
  if (!forceRefresh && cache && cache.lawbookId === lawbookId && (now - cache.timestamp) < CACHE_TTL_MS) {
    logger.debug('Lawbook version cache hit', {
      version: cache.version,
      lawbookId: cache.lawbookId,
      age: now - cache.timestamp,
    }, 'LawbookVersionHelper');
    return cache.version;
  }

  // Fetch from database
  try {
    const result = await getActiveLawbook(lawbookId, pool);
    
    if (result.success && result.data) {
      const version = result.data.lawbook_version;
      
      // Update cache with lawbookId
      cache = {
        version,
        timestamp: now,
        lawbookId,
      };
      
      logger.debug('Fetched active lawbook version', {
        version,
        lawbookId,
        forceRefresh,
      }, 'LawbookVersionHelper');
      
      return version;
    } else if (result.notConfigured) {
      // No active lawbook configured - cache null
      cache = {
        version: null,
        timestamp: now,
        lawbookId,
      };
      
      logger.warn('No active lawbook configured', {
        error: result.error,
        lawbookId,
      }, 'LawbookVersionHelper');
      
      return null;
    } else {
      // Error fetching lawbook
      logger.error('Failed to fetch active lawbook', {
        error: result.error,
        lawbookId,
      }, 'LawbookVersionHelper');
      
      // Don't cache errors
      return null;
    }
  } catch (error) {
    logger.error('Exception fetching active lawbook version', {
      error: error instanceof Error ? error.message : String(error),
      lawbookId,
    }, 'LawbookVersionHelper');
    
    // Don't cache errors
    return null;
  }
}

/**
 * Active Lawbook Data - Contains version and parsed lawbook content
 * 
 * Used by services that need the full lawbook content (e.g., stop-decision-service)
 */
export interface ActiveLawbookData {
  lawbookVersion: string;
  stopRules?: LawbookStopRules;
  lawbook: LawbookV1;
}

/**
 * Get active lawbook data including stopRules
 * 
 * Returns:
 * - ActiveLawbookData: Active lawbook with version and content
 * - null: No active lawbook configured
 * 
 * Use this when you need the full lawbook content (e.g., for stopRules).
 * 
 * @param pool - Optional database pool
 * @param lawbookId - Lawbook ID to fetch (defaults to 'AFU9-LAWBOOK')
 */
export async function getActiveLawbookData(
  pool?: Pool,
  lawbookId: string = 'AFU9-LAWBOOK'
): Promise<ActiveLawbookData | null> {
  try {
    const result = await getActiveLawbook(lawbookId, pool);
    
    if (result.success && result.data) {
      const version = result.data.lawbook_version;
      const lawbook = result.data.lawbook_json;
      
      return {
        lawbookVersion: version,
        stopRules: lawbook.stopRules,
        lawbook,
      };
    } else if (result.notConfigured) {
      logger.warn('No active lawbook configured', {
        error: result.error,
        lawbookId,
      }, 'LawbookVersionHelper');
      return null;
    } else {
      logger.error('Failed to fetch active lawbook data', {
        error: result.error,
        lawbookId,
      }, 'LawbookVersionHelper');
      return null;
    }
  } catch (error) {
    logger.error('Exception fetching active lawbook data', {
      error: error instanceof Error ? error.message : String(error),
      lawbookId,
    }, 'LawbookVersionHelper');
    return null;
  }
}

/**
 * Require active lawbook version (fail-closed)
 * 
 * Returns active lawbook version if configured.
 * Throws error with code LAWBOOK_NOT_CONFIGURED if not configured.
 * 
 * Use this for gating/automated operations where lawbook is REQUIRED.
 * 
 * @throws Error with code LAWBOOK_NOT_CONFIGURED if no active lawbook
 * @param pool - Optional database pool
 * @param lawbookId - Lawbook ID to fetch (defaults to 'AFU9-LAWBOOK')
 */
export async function requireActiveLawbookVersion(
  pool?: Pool,
  lawbookId: string = 'AFU9-LAWBOOK'
): Promise<string> {
  const version = await getActiveLawbookVersion(pool, lawbookId);
  
  if (version === null) {
    const error = new Error(
      'No active lawbook configured. Cannot proceed with gated operation. Configure an active lawbook to continue.'
    );
    (error as any).code = LAWBOOK_NOT_CONFIGURED_ERROR;
    
    logger.error('Lawbook required but not configured - failing closed', {
      errorCode: LAWBOOK_NOT_CONFIGURED_ERROR,
      lawbookId,
    }, 'LawbookVersionHelper');
    
    throw error;
  }
  
  return version;
}

/**
 * Attach lawbookVersion to an object (returns copy)
 * 
 * If lawbookVersion is already present, returns original object unchanged.
 * If no active lawbook, sets lawbookVersion to null.
 * 
 * @param obj Object to attach lawbookVersion to
 * @param pool Optional database pool
 * @param lawbookId Lawbook ID to fetch (defaults to 'AFU9-LAWBOOK')
 * @returns Copy of object with lawbookVersion field
 */
export async function attachLawbookVersion<T extends Record<string, any>>(
  obj: T,
  pool?: Pool,
  lawbookId: string = 'AFU9-LAWBOOK'
): Promise<T & { lawbookVersion: string | null }> {
  // If already has lawbookVersion, return as-is
  if ('lawbookVersion' in obj) {
    return obj as T & { lawbookVersion: string | null };
  }
  
  // Fetch active lawbook version
  const version = await getActiveLawbookVersion(pool, lawbookId);
  
  // Return copy with lawbookVersion
  return {
    ...obj,
    lawbookVersion: version,
  };
}

/**
 * Clear the cache (useful for testing and after lawbook activation)
 * 
 * @param lawbookId - Optional lawbook ID to clear (clears all if not specified)
 */
export function clearLawbookVersionCache(lawbookId?: string): void {
  if (!lawbookId || (cache && cache.lawbookId === lawbookId)) {
    cache = null;
    logger.debug('Lawbook version cache cleared', { lawbookId }, 'LawbookVersionHelper');
  }
}

/**
 * Get cache statistics (useful for monitoring)
 */
export function getLawbookVersionCacheStats(): {
  cached: boolean;
  version: string | null;
  age: number | null;
  lawbookId: string | null;
} {
  if (!cache) {
    return {
      cached: false,
      version: null,
      age: null,
      lawbookId: null,
    };
  }
  
  return {
    cached: true,
    version: cache.version,
    age: Date.now() - cache.timestamp,
    lawbookId: cache.lawbookId,
  };
}
