/**
 * Status Mapping Utility
 * Maps legacy issue states to canonical states for display purposes.
 * E7_extra: Extended to map GitHub statuses to AFU9 canonical statuses
 * 
 * Issue: E62.1 - Issue Liste: Filter, Sort, Labels, Status
 * Issue: E62.1 (Fix) - Status dropdown with transition-aware filtering
 * Issue: E7_extra - GitHub Status Parity
 */

import { Afu9IssueStatus, Afu9StatusSource } from '../contracts/afu9Issue';
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

/**
 * E7_extra: GitHub Status Mapping
 * Maps GitHub Project v2 status values, labels, or issue state to AFU9 canonical status
 * 
 * Mapping rules (deterministic, fail-closed):
 * - "Implementing" / "In Progress" / "implementing" → IMPLEMENTING
 * - "In Review" / "PR" / "Review" → MERGE_READY
 * - "Done" / "Completed" / "done" → DONE
 * - "Blocked" / "Hold" / "Waiting" → HOLD
 * - "Closed" (issue.state) → DONE (fallback)
 * - Unknown/missing → null (no status change)
 * 
 * @param githubStatus - Raw GitHub status from Project v2 field, label, or state
 * @returns AFU9 canonical status or null if mapping is unknown
 */
export function mapGitHubStatusToAfu9(githubStatus: string | null | undefined): Afu9IssueStatus | null {
  if (!githubStatus || typeof githubStatus !== 'string') {
    return null;
  }

  // Normalize: trim and lowercase for case-insensitive matching
  const normalized = githubStatus.trim().toLowerCase();

  // Map GitHub statuses to AFU9 canonical statuses
  switch (normalized) {
    // Implementing states
    case 'implementing':
    case 'in progress':
    case 'in_progress':
    case 'progress':
      return Afu9IssueStatus.IMPLEMENTING;

    // Merge/Review states
    case 'in review':
    case 'in_review':
    case 'review':
    case 'pr':
    case 'pull request':
    case 'merge ready':
    case 'merge_ready':
      return Afu9IssueStatus.MERGE_READY;

    // Done/Completed states
    case 'done':
    case 'completed':
    case 'closed':
    case 'complete':
      return Afu9IssueStatus.DONE;

    // Hold/Blocked states
    case 'blocked':
    case 'hold':
    case 'waiting':
    case 'on hold':
    case 'on_hold':
      return Afu9IssueStatus.HOLD;

    // Verified state (if GitHub uses this)
    case 'verified':
    case 'verify':
      return Afu9IssueStatus.VERIFIED;

    // Spec Ready state (if GitHub uses this)
    case 'spec ready':
    case 'spec_ready':
    case 'ready':
    case 'to do':
    case 'todo':
      return Afu9IssueStatus.SPEC_READY;

    // Unknown status - fail closed (return null, don't guess)
    default:
      console.warn(`[status-mapping] Unknown GitHub status "${githubStatus}", no mapping applied`);
      return null;
  }
}

/**
 * E7_extra: Extract GitHub status from various sources
 * Determines status from Project v2 field, labels, or issue state in priority order
 * 
 * Priority:
 * 1. Project v2 "Status" field (if available)
 * 2. Labels with "status:" prefix
 * 3. Issue state (open/closed) as fallback
 * 
 * @param projectStatus - Status from GitHub Project v2 field
 * @param labels - Array of GitHub issue labels
 * @param issueState - GitHub issue state (open/closed)
 * @returns Object with raw status string and source type
 */
export function extractGitHubStatus(
  projectStatus: string | null | undefined,
  labels: Array<{ name: string }> | null | undefined,
  issueState: 'open' | 'closed' | null | undefined
): { raw: string | null; source: Afu9StatusSource | null } {
  // Priority 1: Project v2 Status field
  if (projectStatus && projectStatus.trim()) {
    return {
      raw: projectStatus.trim(),
      source: Afu9StatusSource.GITHUB_PROJECT,
    };
  }

  // Priority 2: Labels with "status:" prefix
  if (labels && Array.isArray(labels)) {
    for (const label of labels) {
      const name = label.name?.toLowerCase() || '';
      if (name.startsWith('status:')) {
        const statusValue = name.replace('status:', '').trim();
        if (statusValue) {
          return {
            raw: statusValue,
            source: Afu9StatusSource.GITHUB_LABEL,
          };
        }
      }
    }
  }

  // Priority 3: Issue state (open/closed)
  if (issueState === 'closed') {
    return {
      raw: 'closed',
      source: Afu9StatusSource.GITHUB_STATE,
    };
  }

  // No status found
  return {
    raw: null,
    source: null,
  };
}
