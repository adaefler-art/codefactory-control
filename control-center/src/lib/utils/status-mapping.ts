/**
 * Status Mapping Utility
 * Maps legacy issue states to canonical states for display purposes.
 * 
 * Issue: E62.1 - Issue Liste: Filter, Sort, Labels, Status
 * Issue: E62.1 (Fix) - Status dropdown with transition-aware filtering
 */

import { Afu9IssueStatus } from '../contracts/afu9Issue';
import { IssueState, ISSUE_STATE_TRANSITIONS } from '../types/issue-state';

/**
 * Legacy states that may exist in the database but should not be used in UI
 */
export enum LegacyStatus {
  ACTIVE = 'ACTIVE',
  BLOCKED = 'BLOCKED',
  FAILED = 'FAILED',
}

/**
 * All possible status values (canonical + legacy)
 */
export type AnyStatus = Afu9IssueStatus | LegacyStatus;

/**
 * Maps legacy status to canonical status for display
 * 
 * Mapping rules:
 * - ACTIVE -> SPEC_READY
 * - BLOCKED -> HOLD
 * - FAILED -> HOLD
 * 
 * @param status - The status to map (can be legacy or canonical)
 * @returns The canonical status for display
 */
export function mapToCanonicalStatus(status: string): Afu9IssueStatus {
  switch (status) {
    case LegacyStatus.ACTIVE:
      return Afu9IssueStatus.SPEC_READY;
    case LegacyStatus.BLOCKED:
      return Afu9IssueStatus.HOLD;
    case LegacyStatus.FAILED:
      return Afu9IssueStatus.HOLD;
    default:
      // If it's already a canonical status, return as-is
      if (Object.values(Afu9IssueStatus).includes(status as Afu9IssueStatus)) {
        return status as Afu9IssueStatus;
      }
      // Unknown status - default to CREATED
      console.warn(`Unknown status "${status}", defaulting to CREATED`);
      return Afu9IssueStatus.CREATED;
  }
}

/**
 * Check if a status is a legacy status
 * 
 * @param status - The status to check
 * @returns true if the status is a legacy status
 */
export function isLegacyStatus(status: string): boolean {
  return Object.values(LegacyStatus).includes(status as LegacyStatus);
}

/**
 * Get all canonical statuses (for filter dropdowns, etc.)
 * 
 * @returns Array of canonical status values
 */
export function getCanonicalStatuses(): Afu9IssueStatus[] {
  return Object.values(Afu9IssueStatus);
}

/**
 * Get allowed next states for a given current state
 * Uses the canonical state machine transition map
 * 
 * MUST MATCH BACKEND: This uses the same ISSUE_STATE_TRANSITIONS from issue-state.ts
 * that the backend validation uses. Keep in sync with backend state machine.
 * 
 * @param currentStatus - The current status (can be legacy or canonical)
 * @returns Array of allowed next canonical statuses
 */
export function getAllowedNextStates(currentStatus: string): Afu9IssueStatus[] {
  // First, map the current status to canonical if it's legacy
  const canonicalCurrent = mapToCanonicalStatus(currentStatus);
  
  // Get allowed transitions from the state machine
  // Note: IssueState and Afu9IssueStatus have the same values
  const allowed = ISSUE_STATE_TRANSITIONS[canonicalCurrent as IssueState] || [];
  
  // Return as Afu9IssueStatus array
  return allowed as Afu9IssueStatus[];
}

/**
 * Get all selectable states for a status dropdown
 * Includes the current state plus all allowed next states
 * 
 * @param currentStatus - The current status (can be legacy or canonical)
 * @returns Array of selectable canonical statuses (current + allowed next)
 */
export function getSelectableStates(currentStatus: string): Afu9IssueStatus[] {
  const canonicalCurrent = mapToCanonicalStatus(currentStatus);
  const allowedNext = getAllowedNextStates(currentStatus);
  
  // Return current state + allowed next states (deduplicated)
  const selectable = new Set([canonicalCurrent, ...allowedNext]);
  return Array.from(selectable);
}
