/**
 * AFU-9 Canonical Issue State Machine
 * 
 * Defines the official states an issue can be in throughout its lifecycle.
 * See docs/ISSUE_STATE_MACHINE.md for detailed state transitions and descriptions.
 */

/**
 * Canonical issue states for AFU-9 workflow
 */
export enum IssueState {
  /** Issue has been created but specification is not yet complete */
  CREATED = 'CREATED',
  
  /** Specification is complete and ready for implementation */
  SPEC_READY = 'SPEC_READY',
  
  /** Implementation is in progress */
  IMPLEMENTING = 'IMPLEMENTING',
  
  /** Implementation is complete and verified */
  VERIFIED = 'VERIFIED',
  
  /** Ready to be merged to main branch */
  MERGE_READY = 'MERGE_READY',
  
  /** Issue is completed and merged */
  DONE = 'DONE',
  
  /** Issue is on hold (paused, not currently being worked on) */
  HOLD = 'HOLD',
  
  /** Issue has been killed (cancelled, will not be implemented) */
  KILLED = 'KILLED'
}

/**
 * Type guard to check if a string is a valid IssueState
 */
export function isValidIssueState(state: string): state is IssueState {
  return Object.values(IssueState).includes(state as IssueState);
}

/**
 * Valid state transitions for issue lifecycle
 * Maps current state to allowed next states
 */
export const ISSUE_STATE_TRANSITIONS: Record<IssueState, IssueState[]> = {
  [IssueState.CREATED]: [
    IssueState.SPEC_READY,
    IssueState.HOLD,
    IssueState.KILLED
  ],
  [IssueState.SPEC_READY]: [
    IssueState.IMPLEMENTING,
    IssueState.HOLD,
    IssueState.KILLED
  ],
  [IssueState.IMPLEMENTING]: [
    IssueState.VERIFIED,
    IssueState.SPEC_READY, // Can go back if spec needs refinement
    IssueState.HOLD,
    IssueState.KILLED
  ],
  [IssueState.VERIFIED]: [
    IssueState.MERGE_READY,
    IssueState.IMPLEMENTING, // Can go back if verification fails
    IssueState.HOLD,
    IssueState.KILLED
  ],
  [IssueState.MERGE_READY]: [
    IssueState.DONE,
    IssueState.VERIFIED, // Can go back if merge checks fail
    IssueState.HOLD,
    IssueState.KILLED
  ],
  [IssueState.DONE]: [
    // Terminal state - no forward transitions
  ],
  [IssueState.HOLD]: [
    IssueState.CREATED,
    IssueState.SPEC_READY,
    IssueState.IMPLEMENTING,
    IssueState.VERIFIED,
    IssueState.MERGE_READY,
    IssueState.KILLED
  ],
  [IssueState.KILLED]: [
    // Terminal state - no forward transitions
  ]
};

/**
 * Check if a state transition is valid
 */
export function isValidTransition(from: IssueState, to: IssueState): boolean {
  return ISSUE_STATE_TRANSITIONS[from].includes(to);
}

/**
 * Get human-readable description for an issue state
 */
export function getIssueStateDescription(state: IssueState): string {
  const descriptions: Record<IssueState, string> = {
    [IssueState.CREATED]: 'Issue created, specification in progress',
    [IssueState.SPEC_READY]: 'Specification complete, ready for implementation',
    [IssueState.IMPLEMENTING]: 'Implementation in progress',
    [IssueState.VERIFIED]: 'Implementation complete and verified',
    [IssueState.MERGE_READY]: 'Ready to merge to main branch',
    [IssueState.DONE]: 'Completed and merged',
    [IssueState.HOLD]: 'On hold, paused temporarily',
    [IssueState.KILLED]: 'Cancelled, will not be implemented'
  };
  return descriptions[state];
}

/**
 * Determine if a state is a terminal state (no forward transitions)
 */
export function isTerminalState(state: IssueState): boolean {
  return state === IssueState.DONE || state === IssueState.KILLED;
}

/**
 * Determine if a state represents active work
 */
export function isActiveState(state: IssueState): boolean {
  return ![IssueState.DONE, IssueState.KILLED, IssueState.HOLD].includes(state);
}

/**
 * Determine if actions can be performed on an issue in the given state
 * 
 * Terminal states (DONE, KILLED) do not allow any actions.
 * This prevents "zombie issues" - issues that are killed but continue to execute.
 * 
 * @param state - The current issue state
 * @returns true if actions can be performed, false otherwise
 */
export function canPerformAction(state: IssueState): boolean {
  return !isTerminalState(state);
}

/**
 * Validate that an issue is not in KILLED state before performing an action
 * 
 * This is the primary guard against zombie issues. Any action that modifies
 * or executes workflows should call this first.
 * 
 * @param state - The current issue state
 * @throws Error if the issue is in KILLED state
 */
export function ensureNotKilled(state: IssueState): void {
  if (state === IssueState.KILLED) {
    throw new Error(
      'Cannot perform action on KILLED issue. Issue has been terminated and cannot be reactivated. ' +
      'Re-activation requires explicit new intent (e.g., reopening the issue or creating a new one).'
    );
  }
}

/**
 * Validate that an issue is not in a terminal state before performing an action
 * 
 * @param state - The current issue state
 * @throws Error if the issue is in a terminal state (DONE or KILLED)
 */
export function ensureNotTerminal(state: IssueState): void {
  if (isTerminalState(state)) {
    throw new Error(
      `Cannot perform action on issue in terminal state: ${state}. ` +
      'Terminal states do not allow further actions.'
    );
  }
}
