/**
 * AFU-9 Loop State Machine v1 (E9.1-CTRL-4, E9.3-CTRL-01)
 * 
 * Pure deterministic resolver for S1-S4 step transitions with explicit blocker codes.
 * 
 * States: CREATED, SPEC_READY, IMPLEMENTING_PREP, REVIEW_READY, HOLD, DONE
 * Steps: S1 (Pick Issue), S2 (Spec Ready), S3 (Implement Prep), S4 (Review Gate)
 * 
 * This module implements a fail-closed, no-ambiguity state machine that returns
 * precise blocker codes instead of generic "unknown" errors.
 */

/**
 * Blocker codes for state machine transitions
 * Each code represents a specific reason why progression is blocked
 */
export enum BlockerCode {
  NO_GITHUB_LINK = 'NO_GITHUB_LINK',
  NO_DRAFT = 'NO_DRAFT',
  NO_COMMITTED_DRAFT = 'NO_COMMITTED_DRAFT',
  DRAFT_INVALID = 'DRAFT_INVALID',
  LOCKED = 'LOCKED',
  UNKNOWN_STATE = 'UNKNOWN_STATE',
  INVARIANT_VIOLATION = 'INVARIANT_VIOLATION',
}

/**
 * State machine steps (S1-S4)
 */
export enum LoopStep {
  S1_PICK_ISSUE = 'S1_PICK_ISSUE',
  S2_SPEC_READY = 'S2_SPEC_READY',
  S3_IMPLEMENT_PREP = 'S3_IMPLEMENT_PREP',
  S4_REVIEW = 'S4_REVIEW',
}

/**
 * Issue states in the AFU-9 lifecycle
 */
export enum IssueState {
  CREATED = 'CREATED',
  SPEC_READY = 'SPEC_READY',
  IMPLEMENTING_PREP = 'IMPLEMENTING_PREP',
  REVIEW_READY = 'REVIEW_READY',
  HOLD = 'HOLD',
  DONE = 'DONE',
}

/**
 * Issue data required for state machine resolution
 */
export interface IssueData {
  id: string;
  status: string;
  github_url?: string | null;
  current_draft_id?: string | null;
  handoff_state?: string | null;
}

/**
 * Draft data for spec validation
 */
export interface DraftData {
  id: string;
  last_validation_status?: string | null;
  issue_json?: unknown;
}

/**
 * Result of state machine resolution
 */
export interface StepResolution {
  step: LoopStep | null;
  blocked: boolean;
  blockerCode?: BlockerCode;
  blockerMessage?: string;
}

/**
 * Pure resolver: Determine next step for an issue
 * 
 * Returns deterministic result based on issue state, with explicit blocker codes.
 * 
 * Rules:
 * - S1 (Pick Issue): Always available for CREATED state with GitHub link
 * - S2 (Spec Ready): Available when draft is valid and committed
 * - S3 (Implement Prep): Available when in SPEC_READY state
 * - HOLD/DONE: Terminal states, no next step
 * 
 * @param issue - Issue data from database
 * @param draft - Optional draft data for validation
 * @returns Step resolution with blocker information
 */
export function resolveNextStep(
  issue: IssueData,
  draft?: DraftData | null
): StepResolution {
  // Validate input state
  if (!issue.status || typeof issue.status !== 'string') {
    return {
      step: null,
      blocked: true,
      blockerCode: BlockerCode.UNKNOWN_STATE,
      blockerMessage: 'Issue status is missing or invalid',
    };
  }

  const status = issue.status as IssueState;

  // Terminal states - no next step available
  if (status === IssueState.DONE || status === IssueState.HOLD) {
    return {
      step: null,
      blocked: false,
      blockerMessage: `Issue is in terminal state: ${status}`,
    };
  }

  // State: CREATED → Determine next step (S1 or S2)
  if (status === IssueState.CREATED) {
    // First check if S1 can be executed
    if (!issue.github_url || issue.github_url.trim() === '') {
      return {
        step: null,
        blocked: true,
        blockerCode: BlockerCode.NO_GITHUB_LINK,
        blockerMessage: 'S1 (Pick Issue) requires GitHub issue link',
      };
    }

    // If we have a draft, we might be ready for S2
    if (issue.current_draft_id || draft) {
      // Check if draft is committed (has version)
      const hasCommittedDraft =
        issue.handoff_state === 'SYNCED' ||
        issue.handoff_state === 'SYNCHRONIZED' ||
        draft?.last_validation_status === 'valid';

      if (!hasCommittedDraft) {
        return {
          step: null,
          blocked: true,
          blockerCode: BlockerCode.NO_COMMITTED_DRAFT,
          blockerMessage: 'S2 (Spec Ready) requires draft to be committed and validated',
        };
      }

      // Check draft validity
      if (draft?.last_validation_status === 'invalid') {
        return {
          step: null,
          blocked: true,
          blockerCode: BlockerCode.DRAFT_INVALID,
          blockerMessage: 'Draft validation failed, cannot proceed to S2',
        };
      }

      // S2 available
      return {
        step: LoopStep.S2_SPEC_READY,
        blocked: false,
      };
    }

    // No draft exists - check if we're looking for S2 or S1
    // If current_draft_id is explicitly null/missing and no draft passed, we need a draft for S2
    // But S1 is available
    return {
      step: LoopStep.S1_PICK_ISSUE,
      blocked: false,
    };
  }

  // For other states that might transition to S2
  if (
    (status as string) === 'DRAFT_READY' || 
    (status as string) === 'VERSION_COMMITTED'
  ) {
    // Check if draft exists
    if (!issue.current_draft_id && !draft) {
      return {
        step: null,
        blocked: true,
        blockerCode: BlockerCode.NO_DRAFT,
        blockerMessage: 'S2 (Spec Ready) requires a draft to be created',
      };
    }

    // Check if draft is committed (has version)
    const hasCommittedDraft =
      issue.handoff_state === 'SYNCED' ||
      issue.handoff_state === 'SYNCHRONIZED' ||
      draft?.last_validation_status === 'valid';

    if (!hasCommittedDraft) {
      return {
        step: null,
        blocked: true,
        blockerCode: BlockerCode.NO_COMMITTED_DRAFT,
        blockerMessage: 'S2 (Spec Ready) requires draft to be committed and validated',
      };
    }

    // Check draft validity
    if (draft?.last_validation_status === 'invalid') {
      return {
        step: null,
        blocked: true,
        blockerCode: BlockerCode.DRAFT_INVALID,
        blockerMessage: 'Draft validation failed, cannot proceed to S2',
      };
    }

    // S2 available
    return {
      step: LoopStep.S2_SPEC_READY,
      blocked: false,
    };
  }

  // State: SPEC_READY → Check for S3 (Implement Prep)
  if (status === IssueState.SPEC_READY) {
    // S3 can proceed directly from SPEC_READY
    return {
      step: LoopStep.S3_IMPLEMENT_PREP,
      blocked: false,
    };
  }

  // State: IMPLEMENTING_PREP → Check for S4 (Review Gate)
  if (status === IssueState.IMPLEMENTING_PREP) {
    // S4 can proceed directly from IMPLEMENTING_PREP
    return {
      step: LoopStep.S4_REVIEW,
      blocked: false,
    };
  }

  // State: REVIEW_READY → Already in review, no next loop step
  if (status === IssueState.REVIEW_READY) {
    return {
      step: null,
      blocked: false,
      blockerMessage: 'Issue is already in review ready state',
    };
  }

  // Unknown state - fail closed
  return {
    step: null,
    blocked: true,
    blockerCode: BlockerCode.UNKNOWN_STATE,
    blockerMessage: `Unknown issue status: ${status}`,
  };
}

/**
 * Check if a state transition is valid according to state machine rules
 * 
 * @param fromState - Current state
 * @param toState - Target state
 * @returns True if transition is valid
 */
export function isValidTransition(fromState: IssueState, toState: IssueState): boolean {
  // Self-transitions are not valid (no-op)
  if (fromState === toState) {
    return false;
  }

  // Terminal states cannot transition out
  if (fromState === IssueState.DONE || fromState === IssueState.HOLD) {
    return false;
  }

  // Valid forward transitions
  const validTransitions: Record<IssueState, IssueState[]> = {
    [IssueState.CREATED]: [IssueState.SPEC_READY, IssueState.HOLD],
    [IssueState.SPEC_READY]: [IssueState.IMPLEMENTING_PREP, IssueState.HOLD],
    [IssueState.IMPLEMENTING_PREP]: [IssueState.REVIEW_READY, IssueState.HOLD],
    [IssueState.REVIEW_READY]: [IssueState.DONE, IssueState.HOLD],
    [IssueState.HOLD]: [], // Terminal
    [IssueState.DONE]: [], // Terminal
  };

  return validTransitions[fromState]?.includes(toState) || false;
}

/**
 * Get human-readable description of a blocker code
 * 
 * @param code - Blocker code
 * @returns Description string
 */
export function getBlockerDescription(code: BlockerCode): string {
  switch (code) {
    case BlockerCode.NO_GITHUB_LINK:
      return 'Issue must be linked to a GitHub issue before proceeding';
    case BlockerCode.NO_DRAFT:
      return 'A specification draft must be created before proceeding';
    case BlockerCode.NO_COMMITTED_DRAFT:
      return 'Draft must be committed and versioned before proceeding';
    case BlockerCode.DRAFT_INVALID:
      return 'Draft validation failed, must be corrected before proceeding';
    case BlockerCode.LOCKED:
      return 'Issue is locked by another process';
    case BlockerCode.UNKNOWN_STATE:
      return 'Issue is in an unknown or invalid state';
    case BlockerCode.INVARIANT_VIOLATION:
      return 'State machine invariant violated';
    default:
      return 'Unknown blocker';
  }
}
