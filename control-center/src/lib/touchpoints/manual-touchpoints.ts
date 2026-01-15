/**
 * Manual Touchpoints Service (E88.1)
 * 
 * Provides centralized service for tracking manual human interventions in AFU-9 cycles.
 * Implements deterministic idempotency key generation to prevent double-counting.
 * 
 * Touchpoint Types:
 * - ASSIGN: Assigning issue to Copilot
 * - REVIEW: Requesting or providing review feedback  
 * - MERGE_APPROVAL: Explicit merge approval
 * - DEBUG_INTERVENTION: Manual debugging or rerun action
 * 
 * Design Principles:
 * - Zero impact on existing automation paths
 * - Idempotent (same action multiple times = 1 touchpoint)
 * - Deterministic aggregation
 */

import { createHash } from 'crypto';
import { Pool } from 'pg';
import {
  TouchpointType,
  TouchpointSource,
  insertTouchpoint,
  InsertTouchpointParams,
  ManualTouchpointRecord,
} from '../db/manualTouchpoints';

// ========================================
// Type Definitions
// ========================================

export interface RecordTouchpointParams {
  // Context identifiers (at least one required for meaningful tracking)
  cycleId?: string;
  issueId?: string;
  ghIssueNumber?: number;
  prNumber?: number;
  sessionId?: string;

  // Touchpoint classification
  type: TouchpointType;
  source: TouchpointSource;

  // Actor and request tracking
  actor: string;
  requestId: string;

  // Optional metadata
  metadata?: Record<string, any>;

  // Optional timestamp for deterministic key generation
  // If not provided, current time is used (may cause duplicates in race conditions)
  timestamp?: Date;
}

// ========================================
// Idempotency Key Generation
// ========================================

/**
 * Generate deterministic idempotency key for touchpoint
 * 
 * Key format: SHA-256 hash of canonical representation
 * Canonical format: type|actor|context|timestamp_window
 * 
 * timestamp_window: Rounds timestamp to 5-minute window to handle
 * rapid successive calls that should be treated as single touchpoint
 * (e.g., multiple clicks on same button within seconds)
 * 
 * @param params - Touchpoint parameters
 * @returns Deterministic idempotency key (64-char hex)
 */
export function generateIdempotencyKey(params: RecordTouchpointParams): string {
  const timestamp = params.timestamp || new Date();
  
  // Round timestamp to 5-minute window (300 seconds)
  const timestampWindow = Math.floor(timestamp.getTime() / 300000) * 300000;
  
  // Build context string (stable order)
  const contextParts: string[] = [];
  if (params.cycleId) contextParts.push(`cycle:${params.cycleId}`);
  if (params.issueId) contextParts.push(`issue:${params.issueId}`);
  if (params.ghIssueNumber) contextParts.push(`gh_issue:${params.ghIssueNumber}`);
  if (params.prNumber) contextParts.push(`pr:${params.prNumber}`);
  if (params.sessionId) contextParts.push(`session:${params.sessionId}`);
  
  const contextStr = contextParts.sort().join('|') || 'no_context';
  
  // Canonical format
  const canonical = `${params.type}|${params.actor}|${contextStr}|${timestampWindow}`;
  
  // SHA-256 hash
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ========================================
// Touchpoint Recording
// ========================================

/**
 * Record a manual touchpoint
 * 
 * IDEMPOTENT: Multiple calls with same parameters = single record
 * SAFE: Never throws, logs errors instead
 * 
 * @param pool - PostgreSQL connection pool
 * @param params - Touchpoint parameters
 * @returns Recorded touchpoint or null on error
 */
export async function recordTouchpoint(
  pool: Pool,
  params: RecordTouchpointParams
): Promise<ManualTouchpointRecord | null> {
  try {
    // Generate idempotency key
    const idempotencyKey = generateIdempotencyKey(params);
    
    // Prepare insert parameters
    const insertParams: InsertTouchpointParams = {
      idempotencyKey,
      cycleId: params.cycleId || null,
      issueId: params.issueId || null,
      ghIssueNumber: params.ghIssueNumber || null,
      prNumber: params.prNumber || null,
      sessionId: params.sessionId || null,
      type: params.type,
      source: params.source,
      actor: params.actor,
      requestId: params.requestId,
      metadata: params.metadata || {},
    };
    
    // Insert touchpoint (idempotent)
    const record = await insertTouchpoint(pool, insertParams);
    
    console.log('[ManualTouchpoints] Recorded touchpoint', {
      type: params.type,
      source: params.source,
      actor: params.actor,
      idempotencyKey,
      recordId: record.id,
      requestId: params.requestId,
    });
    
    return record;
  } catch (error) {
    console.error('[ManualTouchpoints] Failed to record touchpoint', {
      error: error instanceof Error ? error.message : String(error),
      type: params.type,
      source: params.source,
      actor: params.actor,
      requestId: params.requestId,
    });
    
    // Don't throw - touchpoint tracking should never break main flow
    return null;
  }
}

/**
 * Record ASSIGN touchpoint (issue assigned to Copilot)
 * 
 * @param pool - PostgreSQL connection pool
 * @param params - Assignment context
 * @returns Recorded touchpoint or null on error
 */
export async function recordAssignTouchpoint(
  pool: Pool,
  params: {
    cycleId?: string;
    issueId?: string;
    ghIssueNumber?: number;
    actor: string;
    requestId: string;
    source?: TouchpointSource;
    metadata?: Record<string, any>;
  }
): Promise<ManualTouchpointRecord | null> {
  return recordTouchpoint(pool, {
    type: 'ASSIGN',
    source: params.source || 'API',
    actor: params.actor,
    requestId: params.requestId,
    cycleId: params.cycleId,
    issueId: params.issueId,
    ghIssueNumber: params.ghIssueNumber,
    metadata: params.metadata,
  });
}

/**
 * Record REVIEW touchpoint (review requested or provided)
 * 
 * @param pool - PostgreSQL connection pool
 * @param params - Review context
 * @returns Recorded touchpoint or null on error
 */
export async function recordReviewTouchpoint(
  pool: Pool,
  params: {
    cycleId?: string;
    issueId?: string;
    ghIssueNumber?: number;
    prNumber?: number;
    actor: string;
    requestId: string;
    source?: TouchpointSource;
    metadata?: Record<string, any>;
  }
): Promise<ManualTouchpointRecord | null> {
  return recordTouchpoint(pool, {
    type: 'REVIEW',
    source: params.source || 'API',
    actor: params.actor,
    requestId: params.requestId,
    cycleId: params.cycleId,
    issueId: params.issueId,
    ghIssueNumber: params.ghIssueNumber,
    prNumber: params.prNumber,
    metadata: params.metadata,
  });
}

/**
 * Record MERGE_APPROVAL touchpoint (explicit merge approval)
 * 
 * @param pool - PostgreSQL connection pool
 * @param params - Approval context
 * @returns Recorded touchpoint or null on error
 */
export async function recordMergeApprovalTouchpoint(
  pool: Pool,
  params: {
    cycleId?: string;
    issueId?: string;
    ghIssueNumber?: number;
    prNumber?: number;
    actor: string;
    requestId: string;
    source?: TouchpointSource;
    metadata?: Record<string, any>;
  }
): Promise<ManualTouchpointRecord | null> {
  return recordTouchpoint(pool, {
    type: 'MERGE_APPROVAL',
    source: params.source || 'API',
    actor: params.actor,
    requestId: params.requestId,
    cycleId: params.cycleId,
    issueId: params.issueId,
    ghIssueNumber: params.ghIssueNumber,
    prNumber: params.prNumber,
    metadata: params.metadata,
  });
}

/**
 * Record DEBUG_INTERVENTION touchpoint (manual debug/rerun)
 * 
 * @param pool - PostgreSQL connection pool
 * @param params - Debug context
 * @returns Recorded touchpoint or null on error
 */
export async function recordDebugInterventionTouchpoint(
  pool: Pool,
  params: {
    cycleId?: string;
    issueId?: string;
    ghIssueNumber?: number;
    prNumber?: number;
    sessionId?: string;
    actor: string;
    requestId: string;
    source?: TouchpointSource;
    metadata?: Record<string, any>;
  }
): Promise<ManualTouchpointRecord | null> {
  return recordTouchpoint(pool, {
    type: 'DEBUG_INTERVENTION',
    source: params.source || 'API',
    actor: params.actor,
    requestId: params.requestId,
    cycleId: params.cycleId,
    issueId: params.issueId,
    ghIssueNumber: params.ghIssueNumber,
    prNumber: params.prNumber,
    sessionId: params.sessionId,
    metadata: params.metadata,
  });
}

// ========================================
// Exports
// ========================================

export type { RecordTouchpointParams };
export {
  type TouchpointType,
  type TouchpointSource,
} from '../db/manualTouchpoints';
