/**
 * Checks Snapshot Contract Schema
 * 
 * E9.3-CTRL-02: Checks Mirror (PR/Commit Checks Snapshot)
 * 
 * Defines contracts for checks_snapshots table operations.
 * Provides deterministic, stable view of GitHub check status for S4/S5 gate decisions.
 * 
 * Purpose:
 * - Snapshot GitHub check status at specific points in time
 * - Provide stable data for Review Gate (S4) and Merge Gate (S5)
 * - Enable reproducible gate decisions
 * - Support Evidence/audit trail
 */

import { z } from 'zod';
import crypto from 'crypto';

// ========================================
// Check Entry Schema
// ========================================

/**
 * GitHub check status
 */
export const CheckStatusSchema = z.enum([
  'queued',
  'in_progress',
  'completed',
]);

export type CheckStatus = z.infer<typeof CheckStatusSchema>;

/**
 * GitHub check conclusion (for completed checks)
 */
export const CheckConclusionSchema = z.enum([
  'success',
  'failure',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
]).nullable();

export type CheckConclusion = z.infer<typeof CheckConclusionSchema>;

/**
 * Single check entry in snapshot
 */
export const CheckEntrySchema = z.object({
  name: z.string().min(1),
  status: CheckStatusSchema,
  conclusion: CheckConclusionSchema,
  details_url: z.string().url().optional(),
  run_id: z.number().optional(),
  job_id: z.number().optional(),
  step_name: z.string().optional(),
}).strict();

export type CheckEntry = z.infer<typeof CheckEntrySchema>;

// ========================================
// Snapshot Schema
// ========================================

/**
 * Checks Snapshot Row
 * Represents a row from the checks_snapshots table
 */
export interface ChecksSnapshotRow {
  id: string;
  run_id: string | null;
  issue_id: string | null;
  repo_owner: string;
  repo_name: string;
  ref: string;
  captured_at: string;
  checks: CheckEntry[];
  total_checks: number;
  failed_checks: number;
  pending_checks: number;
  snapshot_hash: string;
  request_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Input for creating a checks snapshot
 */
export const ChecksSnapshotInputSchema = z.object({
  run_id: z.string().optional(),
  issue_id: z.string().uuid().optional(),
  repo_owner: z.string().min(1),
  repo_name: z.string().min(1),
  ref: z.string().min(1),
  checks: z.array(CheckEntrySchema),
  request_id: z.string().optional(),
}).strict();

export type ChecksSnapshotInput = z.infer<typeof ChecksSnapshotInputSchema>;

/**
 * Query filter for retrieving snapshots
 */
export const ChecksSnapshotQuerySchema = z.object({
  run_id: z.string().optional(),
  issue_id: z.string().uuid().optional(),
  repo_owner: z.string().min(1).optional(),
  repo_name: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  snapshot_hash: z.string().optional(),
  limit: z.number().int().positive().max(100).default(10),
}).strict();

export type ChecksSnapshotQuery = z.infer<typeof ChecksSnapshotQuerySchema>;

// ========================================
// Evidence Integration
// ========================================

/**
 * Checks Snapshot Receipt Evidence Data
 * Structured data for CHECKS_SNAPSHOT_RECEIPT evidence type
 */
export interface ChecksSnapshotReceiptData {
  snapshot_id: string;
  repo_owner: string;
  repo_name: string;
  ref: string;
  snapshot_hash: string;
  total_checks: number;
  failed_checks: number;
  pending_checks: number;
  captured_at: string;
  gate_step?: 'S4' | 'S5';
}

// ========================================
// Validation Utilities
// ========================================

/**
 * Calculate snapshot hash for idempotency
 * Hash input: repo_owner + repo_name + ref + normalized checks JSON
 */
export function calculateSnapshotHash(
  repo_owner: string,
  repo_name: string,
  ref: string,
  checks: CheckEntry[]
): string {
  // Normalize checks: sort by name, then by status, then by conclusion
  const normalized = [...checks].sort((a, b) => {
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    if (a.status !== b.status) return a.status.localeCompare(b.status);
    return (a.conclusion || '').localeCompare(b.conclusion || '');
  });

  const input = JSON.stringify({
    repo_owner,
    repo_name,
    ref,
    checks: normalized.map(c => ({
      name: c.name,
      status: c.status,
      conclusion: c.conclusion,
    })),
  });

  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Calculate summary statistics from checks
 */
export function calculateChecksSummary(checks: CheckEntry[]): {
  total_checks: number;
  failed_checks: number;
  pending_checks: number;
} {
  const total_checks = checks.length;
  const failed_checks = checks.filter(
    c => c.status === 'completed' && 
         c.conclusion !== 'success' && 
         c.conclusion !== 'neutral' && 
         c.conclusion !== 'skipped'
  ).length;
  const pending_checks = checks.filter(
    c => c.status !== 'completed'
  ).length;

  return { total_checks, failed_checks, pending_checks };
}

/**
 * Validate snapshot input
 */
export function validateSnapshotInput(input: unknown): { 
  valid: boolean; 
  error?: string;
  data?: ChecksSnapshotInput;
} {
  try {
    const data = ChecksSnapshotInputSchema.parse(input);
    return { valid: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = Array.isArray((error as z.ZodError).errors) && (error as z.ZodError).errors.length > 0
        ? (error as z.ZodError).errors
        : (error as z.ZodError).issues || [];

      return { 
        valid: false, 
        error: issues.map(e => `${e.path.join('.')}: ${e.message}`).join('; ') || 'Invalid snapshot input',
      };
    }
    return { valid: false, error: String(error) };
  }
}

/**
 * Check if snapshot indicates gate should be blocked (fail-closed)
 * 
 * Block conditions:
 * - Any checks are still pending (not completed)
 * - Any checks failed (non-success conclusion)
 * 
 * @returns true if gate should BLOCK, false if gate can PROCEED
 */
export function shouldBlockGate(snapshot: ChecksSnapshotRow): boolean {
  // Fail-closed: Block if any checks pending
  if (snapshot.pending_checks > 0) {
    return true;
  }

  // Fail-closed: Block if any checks failed
  if (snapshot.failed_checks > 0) {
    return true;
  }

  // All checks completed and successful
  return false;
}

/**
 * Get gate decision from snapshot
 */
export function getGateDecision(snapshot: ChecksSnapshotRow): {
  decision: 'PROCEED' | 'BLOCK';
  reason: string;
} {
  if (snapshot.pending_checks > 0) {
    return {
      decision: 'BLOCK',
      reason: `${snapshot.pending_checks} check(s) still pending`,
    };
  }

  if (snapshot.failed_checks > 0) {
    return {
      decision: 'BLOCK',
      reason: `${snapshot.failed_checks} check(s) failed`,
    };
  }

  if (snapshot.total_checks === 0) {
    return {
      decision: 'BLOCK',
      reason: 'No checks found (fail-closed)',
    };
  }

  return {
    decision: 'PROCEED',
    reason: `All ${snapshot.total_checks} checks passed`,
  };
}
