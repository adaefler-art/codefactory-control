/**
 * Example: Using Checks Mirror in S4/S5 Gates
 * 
 * E9.3-CTRL-02: Checks Mirror Integration
 * 
 * This file demonstrates how to use the Checks Mirror service
 * in S4 (Review Gate) and S5 (Merge Gate) implementations.
 */

import { Pool } from 'pg';
import {
  captureChecksSnapshot,
  captureSnapshotForPR,
} from '@/lib/github/checks-mirror-service';
import {
  getSnapshotById,
  getLatestSnapshot,
} from '@/lib/db/checksSnapshots';
import {
  getGateDecision,
} from '@/lib/contracts/checksSnapshot';
import {
  recordEvidence,
} from '@/lib/db/issueEvidence';
import { IssueEvidenceType } from '@/lib/contracts/issueEvidence';

/**
 * Example 1: S4 (Review Gate) Entry
 * 
 * When entering S4, capture a snapshot of PR check status.
 * This snapshot will be used for all subsequent gate decisions.
 */
export async function executeS4Entry(
  pool: Pool,
  params: {
    owner: string;
    repo: string;
    pr_number: number;
    run_id: string;
    issue_id: string;
    request_id: string;
  }
): Promise<{
  success: boolean;
  snapshot_id?: string;
  error?: string;
}> {
  const { owner, repo, pr_number, run_id, issue_id, request_id } = params;

  try {
    // Step 1: Capture checks snapshot
    console.log('[S4-Entry] Capturing checks snapshot for PR', pr_number);
    
    const result = await captureSnapshotForPR(pool, owner, repo, pr_number, {
      run_id,
      issue_id,
      request_id,
    });

    if (!result.success || !result.snapshot) {
      return {
        success: false,
        error: result.error || 'Failed to capture snapshot',
      };
    }

    const snapshot = result.snapshot;

    // Step 2: Record evidence
    console.log('[S4-Entry] Recording snapshot evidence');
    
    const evidenceResult = await recordEvidence(pool, {
      issue_id,
      evidence_type: IssueEvidenceType.CHECKS_SNAPSHOT_RECEIPT,
      evidence_data: {
        snapshot_id: snapshot.id,
        repo_owner: snapshot.repo_owner,
        repo_name: snapshot.repo_name,
        ref: snapshot.ref,
        snapshot_hash: snapshot.snapshot_hash,
        total_checks: snapshot.total_checks,
        failed_checks: snapshot.failed_checks,
        pending_checks: snapshot.pending_checks,
        captured_at: snapshot.captured_at,
        gate_step: 'S4',
      },
      request_id,
    });

    if (!evidenceResult.success) {
      console.warn('[S4-Entry] Failed to record evidence:', evidenceResult.error);
      // Non-fatal: Snapshot is captured, evidence recording can be retried
    }

    // Step 3: Check gate decision
    const decision = getGateDecision(snapshot);
    
    console.log('[S4-Entry] Gate decision:', decision);

    return {
      success: true,
      snapshot_id: snapshot.id,
    };
  } catch (error) {
    console.error('[S4-Entry] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Example 2: S4 Gate Decision
 * 
 * Use the stored snapshot (not live GitHub data) to make gate decision.
 */
export async function evaluateS4Gate(
  pool: Pool,
  params: {
    snapshot_id: string;
  }
): Promise<{
  can_proceed: boolean;
  reason: string;
  snapshot_summary: {
    total_checks: number;
    failed_checks: number;
    pending_checks: number;
  };
}> {
  const { snapshot_id } = params;

  // Step 1: Retrieve snapshot (no live GitHub query!)
  const result = await getSnapshotById(pool, snapshot_id);

  if (!result.success || !result.data) {
    // Fail-closed: If snapshot not found, block gate
    return {
      can_proceed: false,
      reason: 'Snapshot not found (fail-closed)',
      snapshot_summary: {
        total_checks: 0,
        failed_checks: 0,
        pending_checks: 0,
      },
    };
  }

  const snapshot = result.data;

  // Step 2: Make gate decision based on snapshot
  const decision = getGateDecision(snapshot);

  return {
    can_proceed: decision.decision === 'PROCEED',
    reason: decision.reason,
    snapshot_summary: {
      total_checks: snapshot.total_checks,
      failed_checks: snapshot.failed_checks,
      pending_checks: snapshot.pending_checks,
    },
  };
}

/**
 * Example 3: S5 (Merge Gate) with Fresh Snapshot
 * 
 * Before merging, optionally capture a fresh snapshot to ensure
 * checks haven't regressed since S4.
 */
export async function executeS5Entry(
  pool: Pool,
  params: {
    owner: string;
    repo: string;
    pr_number: number;
    run_id: string;
    issue_id: string;
    request_id: string;
    force_fresh?: boolean; // If true, always capture fresh snapshot
  }
): Promise<{
  success: boolean;
  can_merge: boolean;
  reason: string;
  snapshot_id?: string;
}> {
  const { owner, repo, pr_number, run_id, issue_id, request_id, force_fresh } = params;

  try {
    let snapshot;

    if (force_fresh) {
      // Capture fresh snapshot
      console.log('[S5-Entry] Capturing fresh snapshot before merge');
      
      const captureResult = await captureSnapshotForPR(pool, owner, repo, pr_number, {
        run_id,
        issue_id,
        request_id,
      });

      if (!captureResult.success || !captureResult.snapshot) {
        return {
          success: false,
          can_merge: false,
          reason: captureResult.error || 'Failed to capture snapshot',
        };
      }

      snapshot = captureResult.snapshot;

      // Record evidence
      await recordEvidence(pool, {
        issue_id,
        evidence_type: IssueEvidenceType.CHECKS_SNAPSHOT_RECEIPT,
        evidence_data: {
          snapshot_id: snapshot.id,
          repo_owner: snapshot.repo_owner,
          repo_name: snapshot.repo_name,
          ref: snapshot.ref,
          snapshot_hash: snapshot.snapshot_hash,
          total_checks: snapshot.total_checks,
          failed_checks: snapshot.failed_checks,
          pending_checks: snapshot.pending_checks,
          captured_at: snapshot.captured_at,
          gate_step: 'S5',
        },
        request_id,
      });
    } else {
      // Use latest snapshot (from S4 or previous S5)
      console.log('[S5-Entry] Using latest snapshot');
      
      const latestResult = await getLatestSnapshot(pool, owner, repo, `refs/pull/${pr_number}/head`);
      
      if (!latestResult.success || !latestResult.data) {
        // Fail-closed: No snapshot available
        return {
          success: false,
          can_merge: false,
          reason: 'No snapshot available (fail-closed)',
        };
      }

      snapshot = latestResult.data;
    }

    // Make merge decision
    const decision = getGateDecision(snapshot);

    console.log('[S5-Entry] Merge decision:', decision);

    return {
      success: true,
      can_merge: decision.decision === 'PROCEED',
      reason: decision.reason,
      snapshot_id: snapshot.id,
    };
  } catch (error) {
    console.error('[S5-Entry] Error:', error);
    return {
      success: false,
      can_merge: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Example 4: Idempotent Snapshot Capture
 * 
 * Demonstrates that capturing the same snapshot multiple times
 * returns the same result.
 */
export async function demonstrateIdempotency(
  pool: Pool,
  owner: string,
  repo: string,
  ref: string
): Promise<void> {
  console.log('=== Idempotency Demo ===');
  
  // Capture snapshot #1
  const result1 = await captureChecksSnapshot(pool, {
    repo_owner: owner,
    repo_name: repo,
    ref,
  });

  console.log('Capture #1:', {
    snapshot_id: result1.snapshot?.id,
    snapshot_hash: result1.snapshot?.snapshot_hash,
    is_existing: result1.is_existing,
  });

  // Capture snapshot #2 (same ref, should return existing)
  const result2 = await captureChecksSnapshot(pool, {
    repo_owner: owner,
    repo_name: repo,
    ref,
  });

  console.log('Capture #2:', {
    snapshot_id: result2.snapshot?.id,
    snapshot_hash: result2.snapshot?.snapshot_hash,
    is_existing: result2.is_existing,
  });

  // Verify same snapshot
  if (result1.snapshot?.id === result2.snapshot?.id) {
    console.log('✓ Idempotency verified: Same snapshot returned');
  } else {
    console.log('✗ Idempotency failed: Different snapshots');
  }
}

/**
 * Example 5: Fail-Closed Behavior
 * 
 * Demonstrates that missing/failing checks block gates.
 */
export async function demonstrateFailClosed(pool: Pool): Promise<void> {
  console.log('=== Fail-Closed Demo ===');

  const testCases = [
    {
      name: 'All checks passed',
      snapshot: {
        total_checks: 3,
        failed_checks: 0,
        pending_checks: 0,
      },
      expected: 'PROCEED',
    },
    {
      name: 'One check failed',
      snapshot: {
        total_checks: 3,
        failed_checks: 1,
        pending_checks: 0,
      },
      expected: 'BLOCK',
    },
    {
      name: 'One check pending',
      snapshot: {
        total_checks: 3,
        failed_checks: 0,
        pending_checks: 1,
      },
      expected: 'BLOCK',
    },
    {
      name: 'No checks (fail-closed)',
      snapshot: {
        total_checks: 0,
        failed_checks: 0,
        pending_checks: 0,
      },
      expected: 'BLOCK',
    },
  ];

  for (const testCase of testCases) {
    const now = new Date().toISOString();
    const mockSnapshot = {
      id: '00000000-0000-0000-0000-000000000000',
      run_id: null,
      issue_id: null,
      repo_owner: 'test',
      repo_name: 'test',
      ref: 'test',
      captured_at: now,
      checks: [],
      snapshot_hash: 'test',
      request_id: null,
      created_at: now,
      updated_at: now,
      ...testCase.snapshot,
    };

    const decision = getGateDecision(mockSnapshot);
    const pass = decision.decision === testCase.expected ? '✓' : '✗';
    
    console.log(`${pass} ${testCase.name}: ${decision.decision} - ${decision.reason}`);
  }
}
