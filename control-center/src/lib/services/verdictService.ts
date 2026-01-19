/**
 * Verdict Service
 * 
 * I201.7: Verdict Endpoint + State Mapping (GREEN/HOLD/RED)
 * 
 * Implements the state machine logic for verdict-driven state transitions.
 */

import { Pool } from 'pg';
import { Verdict } from '../contracts/verdict';
import { Afu9IssueStatus, Afu9IssueRow } from '../contracts/afu9Issue';
import { updateAfu9Issue } from '../db/afu9Issues';
import { logTimelineEvent } from '../db/issueTimeline';
import { IssueTimelineEventType, ActorType } from '../contracts/issueTimeline';

/**
 * Verdict result containing new status and whether state changed
 */
export interface VerdictResult {
  success: boolean;
  newStatus: Afu9IssueStatus;
  stateChanged: boolean;
  error?: string;
}

/**
 * Determine the next state based on current status and verdict
 * 
 * Mapping rules:
 * - GREEN: Advance to next state (IMPLEMENTING → VERIFIED or DONE)
 * - RED: Transition to HOLD
 * - HOLD: Transition to HOLD
 */
export function determineNextState(
  currentStatus: Afu9IssueStatus,
  verdict: Verdict
): Afu9IssueStatus {
  if (verdict === Verdict.RED || verdict === Verdict.HOLD) {
    return Afu9IssueStatus.HOLD;
  }

  // GREEN verdict: advance state
  if (verdict === Verdict.GREEN) {
    switch (currentStatus) {
      case Afu9IssueStatus.IMPLEMENTING:
        return Afu9IssueStatus.VERIFIED;
      case Afu9IssueStatus.VERIFIED:
        return Afu9IssueStatus.DONE;
      // For other states, stay in current state
      default:
        return currentStatus;
    }
  }

  return currentStatus;
}

/**
 * Apply verdict to an issue and update state
 * 
 * @param pool - Database connection pool
 * @param issueId - Issue UUID
 * @param issue - Current issue data
 * @param verdict - Verdict (GREEN, RED, HOLD)
 * @returns Verdict result with success status and new state
 */
export async function applyVerdict(
  pool: Pool,
  issueId: string,
  issue: Afu9IssueRow,
  verdict: Verdict
): Promise<VerdictResult> {
  const currentStatus = issue.status;
  const newStatus = determineNextState(currentStatus, verdict);
  const stateChanged = currentStatus !== newStatus;

  try {
    // Log VERDICT_SET event (always, even if state doesn't change)
    await logTimelineEvent(pool, {
      issue_id: issueId,
      event_type: IssueTimelineEventType.VERDICT_SET,
      event_data: {
        verdict,
        oldStatus: currentStatus,
        newStatus,
        stateChanged,
      },
      actor: ActorType.SYSTEM,
      actor_type: ActorType.SYSTEM,
    });

    // Update issue status if it changed
    if (stateChanged) {
      const updateResult = await updateAfu9Issue(pool, issueId, {
        status: newStatus,
      });

      if (!updateResult.success) {
        return {
          success: false,
          newStatus: currentStatus,
          stateChanged: false,
          error: updateResult.error || 'Failed to update issue status',
        };
      }

      // Log STATE_CHANGED event
      await logTimelineEvent(pool, {
        issue_id: issueId,
        event_type: IssueTimelineEventType.STATE_CHANGED,
        event_data: {
          oldStatus: currentStatus,
          newStatus,
          reason: `verdict:${verdict}`,
        },
        actor: ActorType.SYSTEM,
        actor_type: ActorType.SYSTEM,
      });
    }

    return {
      success: true,
      newStatus,
      stateChanged,
    };
  } catch (error) {
    console.error('[VerdictService] Apply verdict failed:', {
      error: error instanceof Error ? error.message : String(error),
      issueId,
      verdict,
      currentStatus,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      newStatus: currentStatus,
      stateChanged: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
