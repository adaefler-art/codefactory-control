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

// Cache duration: 60 seconds (short TTL to ensure fresh data)
const CACHE_TTL_MS = 60 * 1000;

// Error code for missing lawbook
export const LAWBOOK_NOT_CONFIGURED_ERROR = 'LAWBOOK_NOT_CONFIGURED';

// Cache state
interface CacheEntry {
  version: string | null;
  timestamp: number;
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
 */
export async function getActiveLawbookVersion(
  pool?: Pool
): Promise<string | null> {
  // Check cache
  const now = Date.now();
  if (cache && (now - cache.timestamp) < CACHE_TTL_MS) {
    logger.debug('Lawbook version cache hit', {
      version: cache.version,
      age: now - cache.timestamp,
    }, 'LawbookVersionHelper');
    return cache.version;
  }

  // Fetch from database
  try {
    const result = await getActiveLawbook('AFU9-LAWBOOK', pool);
    
    if (result.success && result.data) {
      const version = result.data.lawbook_version;
      
      // Update cache
      cache = {
        version,
        timestamp: now,
      };
      
      logger.debug('Fetched active lawbook version', {
        version,
      }, 'LawbookVersionHelper');
      
      return version;
    } else if (result.notConfigured) {
      // No active lawbook configured - cache null
      cache = {
        version: null,
        timestamp: now,
      };
      
      logger.warn('No active lawbook configured', {
        error: result.error,
      }, 'LawbookVersionHelper');
      
      return null;
    } else {
      // Error fetching lawbook
      logger.error('Failed to fetch active lawbook', {
        error: result.error,
      }, 'LawbookVersionHelper');
      
      // Don't cache errors
      return null;
    }
  } catch (error) {
    logger.error('Exception fetching active lawbook version', {
      error: error instanceof Error ? error.message : String(error),
    }, 'LawbookVersionHelper');
    
    // Don't cache errors
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
 */
export async function requireActiveLawbookVersion(
  pool?: Pool
): Promise<string> {
  const version = await getActiveLawbookVersion(pool);
  
  if (version === null) {
    const error = new Error(
      'No active lawbook configured. Cannot proceed with gated operation. Configure an active lawbook to continue.'
    );
    (error as any).code = LAWBOOK_NOT_CONFIGURED_ERROR;
    
    logger.error('Lawbook required but not configured - failing closed', {
      errorCode: LAWBOOK_NOT_CONFIGURED_ERROR,
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
 * @returns Copy of object with lawbookVersion field
 */
export async function attachLawbookVersion<T extends Record<string, any>>(
  obj: T,
  pool?: Pool
): Promise<T & { lawbookVersion: string | null }> {
  // If already has lawbookVersion, return as-is
  if ('lawbookVersion' in obj) {
    return obj as T & { lawbookVersion: string | null };
  }
  
  // Fetch active lawbook version
  const version = await getActiveLawbookVersion(pool);
  
  // Return copy with lawbookVersion
  return {
    ...obj,
    lawbookVersion: version,
  };
}

/**
 * Clear the cache (useful for testing)
 */
export function clearLawbookVersionCache(): void {
  cache = null;
  logger.debug('Lawbook version cache cleared', {}, 'LawbookVersionHelper');
}

/**
 * Get cache statistics (useful for monitoring)
 */
export function getLawbookVersionCacheStats(): {
  cached: boolean;
  version: string | null;
  age: number | null;
} {
  if (!cache) {
    return {
      cached: false,
      version: null,
      age: null,
    };
  }
  
  return {
    cached: true,
    version: cache.version,
    age: Date.now() - cache.timestamp,
  };
}
