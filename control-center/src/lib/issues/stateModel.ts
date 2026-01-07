/**
 * AFU9 Issue State Model - Mapping and Precedence Logic
 * 
 * Implements the precedence rules and mapping functions for computing effective status
 * from the state model dimensions.
 * 
 * Canonical Documentation: docs/state/STATE_MODEL_V1.md
 * 
 * @module stateModel
 */

import {
  LocalStatus,
  GithubMirrorStatus,
  ExecutionState,
  IssueStateModel,
} from '../schemas/issueStateModel';

/**
 * Map GitHub Mirror Status to Effective Status (LocalStatus)
 * 
 * Mapping Table (from STATE_MODEL_V1.md):
 * - TODO → SPEC_READY
 * - IN_PROGRESS → IMPLEMENTING
 * - IN_REVIEW → MERGE_READY
 * - DONE → DONE
 * - BLOCKED → HOLD
 * - UNKNOWN → null (no mapping, use fallback)
 * 
 * @param githubMirrorStatus - GitHub mirror status to map
 * @returns Mapped LocalStatus or null if unmapped (UNKNOWN)
 */
export function mapGithubMirrorStatusToEffective(
  githubMirrorStatus: GithubMirrorStatus
): LocalStatus | null {
  switch (githubMirrorStatus) {
    case 'TODO':
      return 'SPEC_READY';
    case 'IN_PROGRESS':
      return 'IMPLEMENTING';
    case 'IN_REVIEW':
      return 'MERGE_READY';
    case 'DONE':
      return 'DONE';
    case 'BLOCKED':
      return 'HOLD';
    case 'OPEN':
    case 'CLOSED':
    case 'ERROR':
      return null;
    case 'UNKNOWN':
      return null;
    default:
      // TypeScript exhaustiveness check - should never reach here
      const _exhaustive: never = githubMirrorStatus;
      return _exhaustive;
  }
}

/**
 * Check if GitHub status data is available
 * 
 * GitHub is considered "present" if:
 * - Mirror status is not UNKNOWN, OR
 * - Raw snapshot exists (github_status_raw field)
 * 
 * This helper is used to determine if we have ANY GitHub data,
 * regardless of whether it maps to a LocalStatus.
 * 
 * @param state - Issue state model (may include github_status_raw)
 * @returns true if GitHub data is available
 */
export function hasGithubStatus(state: IssueStateModel & { github_status_raw?: string | null }): boolean {
  return (
    state.githubMirrorStatus !== 'UNKNOWN' ||
    (state.github_status_raw != null && state.github_status_raw.trim() !== '')
  );
}

/**
 * State Model v1.4: Compute Effective Status using Precedence Rules
 * 
 * POLICY (Established - DO NOT CHANGE without issue discussion):
 * 
 * 1. **Execution State** (RUNNING)
 *    → Execution takes precedence (active work state)
 *    → Shows AFU9 is actively working on this issue
 * 
 * 2. **GitHub Mirror Status** (OPEN/CLOSED/ERROR/IN_PROGRESS/etc.)
 *    → GitHub is source of truth for external state
 *    → Present if: githubMirrorStatus != UNKNOWN OR github_status_raw exists
 *    → Only some values map to LocalStatus (IN_PROGRESS→IMPLEMENTING, etc.)
 *    → Others (OPEN/CLOSED/ERROR) are informational only
 * 
 * 3. **Local Status** (CREATED/SPEC_READY/IMPLEMENTING/etc.)
 *    → Fallback when no execution/GitHub state available
 *    → AFU9's internal tracking state
 * 
 * DRIFT DETECTION:
 * - Occurs when: githubMirrorStatus=CLOSED AND localStatus in [CREATED, SPEC_READY, IMPLEMENTING]
 * - Visual indicator only, NO automatic state mutation
 * - See: detectStateDrift() helper
 * 
 * Precedence Rules (from STATE_MODEL_V1.md):
 * 1. If ExecutionState == RUNNING → use localStatus (AFU9 actively executing)
 * 2. Else if githubMirrorStatus != UNKNOWN → use mapped GitHub status
 * 3. Else → use localStatus (fallback)
 * 
 * This function is:
 * - Deterministic: Same inputs always produce same output
 * - Idempotent: Can be called multiple times safely
 * - Total: Always returns a valid LocalStatus
 * - Side-effect free: Pure function
 * 
 * @param state - Complete issue state model
 * @returns Computed effective status
 * @see docs/issues/STATE_MODEL_V1.md
 */
export function computeEffectiveStatus(state: IssueStateModel): LocalStatus {
  const { localStatus, githubMirrorStatus, executionState } = state;

  // Rule 1: If execution is actively running, show local AFU9 status
  // Rationale: AFU9 is actively working, local state is most accurate
  if (executionState === 'RUNNING') {
    return localStatus;
  }

  // Rule 2: If GitHub has known status, attempt to map and use it.
  // Some mirror values (e.g., OPEN/CLOSED/ERROR) are informational and do not map to a LocalStatus.
  if (githubMirrorStatus !== 'UNKNOWN') {
    const mapped = mapGithubMirrorStatusToEffective(githubMirrorStatus);
    if (mapped !== null) {
      return mapped;
    }
  }

  // Rule 3: Fall back to local AFU9 status
  // Rationale: No GitHub status available, use AFU9's internal state
  return localStatus;
}

/**
 * Map raw GitHub status string to GithubMirrorStatus enum
 * 
 * Supports multiple GitHub status sources:
 * - Project v2 status fields
 * - Issue labels
 * - Issue state (with semantic protection)
 * 
 * Mapping Table (from STATE_MODEL_V1.md):
 * - "To Do", "Backlog", "todo" → TODO
 * - "In Progress", "Implementing", "implementing" → IN_PROGRESS
 * - "In Review", "Review", "PR" → IN_REVIEW
 * - "Done", "Completed", "done" → DONE
 * - "Blocked", "Hold", "Waiting" → BLOCKED
 * - Unknown/unmapped → UNKNOWN
 * 
 * SEMANTIC PROTECTION: "closed" from GitHub issue state does NOT map to DONE
 * unless there's an explicit completion signal (prevents false positives).
 * 
 * @param rawGithubStatus - Raw status string from GitHub
 * @param isFromIssueState - True if status comes from issue.state (not Project/label)
 * @returns Mapped GithubMirrorStatus
 */
export function mapRawGithubStatus(
  rawGithubStatus: string | null | undefined,
  isFromIssueState: boolean = false
): GithubMirrorStatus {
  if (!rawGithubStatus || typeof rawGithubStatus !== 'string') {
    return 'UNKNOWN';
  }

  // Normalize: trim and lowercase for case-insensitive matching
  const normalized = rawGithubStatus.trim().toLowerCase();

  // SEMANTIC PROTECTION: Do NOT map "closed" from issue.state to DONE
  // Only map explicit "done" signals from Project fields or labels
  if (isFromIssueState && normalized === 'closed') {
    return 'UNKNOWN';
  }

  // Map based on normalized value
  switch (normalized) {
    // TODO mappings
    case 'to do':
    case 'todo':
    case 'backlog':
      return 'TODO';

    // IN_PROGRESS mappings
    case 'in progress':
    case 'implementing':
    case 'in-progress':
    case 'inprogress':
      return 'IN_PROGRESS';

    // IN_REVIEW mappings
    case 'in review':
    case 'review':
    case 'pr':
    case 'in-review':
    case 'inreview':
      return 'IN_REVIEW';

    // DONE mappings
    case 'done':
    case 'completed':
    case 'complete':
      return 'DONE';

    // BLOCKED mappings
    case 'blocked':
    case 'hold':
    case 'waiting':
    case 'on hold':
      return 'BLOCKED';

    default:
      return 'UNKNOWN';
  }
}

/**
 * Extract GitHub status from multiple sources with precedence
 * 
 * Source precedence:
 * 1. Project v2 status field (most explicit)
 * 2. Issue labels (explicit status labels)
 * 3. Issue state (least specific, with semantic protection)
 * 
 * @param projectStatus - Status from GitHub Project v2 field
 * @param labels - Array of label names
 * @param issueState - GitHub issue state ('open' or 'closed')
 * @returns Best available GithubMirrorStatus
 */
export function extractGithubMirrorStatus(
  projectStatus: string | null | undefined,
  labels: string[],
  issueState: 'open' | 'closed'
): GithubMirrorStatus {
  // Precedence 1: Project v2 status field
  if (projectStatus) {
    const mapped = mapRawGithubStatus(projectStatus, false);
    if (mapped !== 'UNKNOWN') {
      return mapped;
    }
  }

  // Precedence 2: Issue labels (look for status: prefix)
  for (const label of labels) {
    const normalized = label.toLowerCase().trim();
    if (normalized.startsWith('status:')) {
      const statusPart = normalized.replace('status:', '').trim();
      const mapped = mapRawGithubStatus(statusPart, false);
      if (mapped !== 'UNKNOWN') {
        return mapped;
      }
    }
  }

  // Precedence 3: Issue state (with semantic protection)
  const stateMapping = mapRawGithubStatus(issueState, true);
  if (stateMapping !== 'UNKNOWN') {
    return stateMapping;
  }

  // No status found
  return 'UNKNOWN';
}

/**
 * Determine if the effective status would differ from local status
 * 
 * Useful for UI indicators or logging when GitHub status overrides local.
 * 
 * @param state - Complete issue state model
 * @returns True if effective status differs from local status
 */
export function isEffectiveStatusOverridden(state: IssueStateModel): boolean {
  const effectiveStatus = computeEffectiveStatus(state);
  return effectiveStatus !== state.localStatus;
}

/**
 * Get the reason why a particular effective status was chosen
 * 
 * Useful for debugging and UI tooltips.
 * 
 * @param state - Complete issue state model (with optional github_status_raw)
 * @returns Explanation string
 */
export function getEffectiveStatusReason(state: IssueStateModel & { github_status_raw?: string | null; github_status_updated_at?: string | null }): string {
  const { localStatus, githubMirrorStatus, executionState } = state;

  if (executionState === 'RUNNING') {
    return `Execution in progress: using AFU9 local status (${localStatus})`;
  }

  if (githubMirrorStatus !== 'UNKNOWN') {
    const mappedStatus = mapGithubMirrorStatusToEffective(githubMirrorStatus);
    if (mappedStatus !== null) {
      return `GitHub status available: using mapped status (${githubMirrorStatus} → ${mappedStatus})`;
    }
    // GitHub status exists but doesn't map to LocalStatus (e.g., OPEN, CLOSED, ERROR)
    const syncDate = state.github_status_updated_at 
      ? ` (synced: ${new Date(state.github_status_updated_at).toLocaleDateString()})`
      : '';
    return `GitHub mirror: ${githubMirrorStatus}${syncDate}, using AFU9 local status (${localStatus})`;
  }

  // Check if we have raw GitHub data even though mirror is UNKNOWN
  if (hasGithubStatus(state)) {
    return `GitHub data available but not yet mapped, using AFU9 local status (${localStatus})`;
  }

  return `AFU9 local status (no GitHub sync yet): ${localStatus}`;
}

/**
 * Detect drift between local AFU9 status and GitHub mirror state
 * 
 * Drift occurs when GitHub and AFU9 disagree on issue state:
 * - **Warning**: GitHub=CLOSED but AFU9 is in active work state (CREATED/IMPLEMENTING/etc.)
 * - **Info**: AFU9=DONE/KILLED but GitHub=OPEN
 * 
 * This is informational only - NO automatic state mutation occurs.
 * User must manually reconcile the drift.
 * 
 * @param state - Complete issue state model (with optional github_status_raw)
 * @returns Drift detection result with severity and message
 */
export function detectStateDrift(state: IssueStateModel & { github_status_raw?: string | null }): {
  hasDrift: boolean;
  severity: 'warning' | 'info' | null;
  message: string | null;
} {
  // No drift if no GitHub status available
  if (!hasGithubStatus(state)) {
    return { hasDrift: false, severity: null, message: null };
  }

  const { localStatus, githubMirrorStatus } = state;

  // Case 1: GitHub shows CLOSED, but AFU9 is in active work state
  const githubClosed = githubMirrorStatus === 'CLOSED';
  const localActive = ['CREATED', 'SPEC_READY', 'IMPLEMENTING', 'VERIFIED', 'MERGE_READY'].includes(localStatus);
  
  if (githubClosed && localActive) {
    return {
      hasDrift: true,
      severity: 'warning',
      message: `GitHub issue is CLOSED, but local status is still ${localStatus}. Consider updating local status to DONE or KILLED.`,
    };
  }

  // Case 2: AFU9 shows DONE/KILLED, but GitHub is OPEN
  const githubOpen = githubMirrorStatus === 'OPEN';
  const localDone = ['DONE', 'KILLED'].includes(localStatus);
  
  if (githubOpen && localDone) {
    return {
      hasDrift: true,
      severity: 'info',
      message: `Local status is ${localStatus}, but GitHub issue is still OPEN.`,
    };
  }

  return { hasDrift: false, severity: null, message: null };
}
