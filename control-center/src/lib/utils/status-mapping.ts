/**
 * Status Mapping Utility
 * Maps legacy issue states to canonical states for display purposes.
 * 
 * Issue: E62.1 - Issue Liste: Filter, Sort, Labels, Status
 */

import { Afu9IssueStatus } from '../contracts/afu9Issue';

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
