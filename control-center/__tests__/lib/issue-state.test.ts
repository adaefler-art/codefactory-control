/**
 * Tests for Issue State Machine
 * 
 * Tests the canonical issue state definitions, transitions, and helper functions.
 * Issue A1: Kanonische Issue-State-Machine definieren
 */

import {
  IssueState,
  isValidIssueState,
  ISSUE_STATE_TRANSITIONS,
  isValidTransition,
  getIssueStateDescription,
  isTerminalState,
  isActiveState,
  canPerformAction,
  ensureNotKilled,
  ensureNotTerminal,
} from '../../src/lib/types/issue-state';

describe('IssueState Enum', () => {
  test('should have all required states', () => {
    expect(IssueState.CREATED).toBe('CREATED');
    expect(IssueState.SPEC_READY).toBe('SPEC_READY');
    expect(IssueState.IMPLEMENTING).toBe('IMPLEMENTING');
    expect(IssueState.VERIFIED).toBe('VERIFIED');
    expect(IssueState.MERGE_READY).toBe('MERGE_READY');
    expect(IssueState.DONE).toBe('DONE');
    expect(IssueState.HOLD).toBe('HOLD');
    expect(IssueState.KILLED).toBe('KILLED');
  });

  test('should have exactly 8 states', () => {
    const stateValues = Object.values(IssueState);
    expect(stateValues).toHaveLength(8);
  });
});

describe('isValidIssueState', () => {
  test('should return true for valid states', () => {
    expect(isValidIssueState('CREATED')).toBe(true);
    expect(isValidIssueState('SPEC_READY')).toBe(true);
    expect(isValidIssueState('IMPLEMENTING')).toBe(true);
    expect(isValidIssueState('VERIFIED')).toBe(true);
    expect(isValidIssueState('MERGE_READY')).toBe(true);
    expect(isValidIssueState('DONE')).toBe(true);
    expect(isValidIssueState('HOLD')).toBe(true);
    expect(isValidIssueState('KILLED')).toBe(true);
  });

  test('should return false for invalid states', () => {
    expect(isValidIssueState('INVALID')).toBe(false);
    expect(isValidIssueState('created')).toBe(false);
    expect(isValidIssueState('IN_PROGRESS')).toBe(false);
    expect(isValidIssueState('')).toBe(false);
  });
});

describe('ISSUE_STATE_TRANSITIONS', () => {
  test('should define transitions for all states', () => {
    const allStates = Object.values(IssueState);
    allStates.forEach(state => {
      expect(ISSUE_STATE_TRANSITIONS).toHaveProperty(state);
      expect(Array.isArray(ISSUE_STATE_TRANSITIONS[state])).toBe(true);
    });
  });

  test('CREATED should transition to SPEC_READY, HOLD, or KILLED', () => {
    const transitions = ISSUE_STATE_TRANSITIONS[IssueState.CREATED];
    expect(transitions).toContain(IssueState.SPEC_READY);
    expect(transitions).toContain(IssueState.HOLD);
    expect(transitions).toContain(IssueState.KILLED);
    expect(transitions).toHaveLength(3);
  });

  test('SPEC_READY should transition to IMPLEMENTING, HOLD, or KILLED', () => {
    const transitions = ISSUE_STATE_TRANSITIONS[IssueState.SPEC_READY];
    expect(transitions).toContain(IssueState.IMPLEMENTING);
    expect(transitions).toContain(IssueState.HOLD);
    expect(transitions).toContain(IssueState.KILLED);
    expect(transitions).toHaveLength(3);
  });

  test('IMPLEMENTING should allow backward transition to SPEC_READY', () => {
    const transitions = ISSUE_STATE_TRANSITIONS[IssueState.IMPLEMENTING];
    expect(transitions).toContain(IssueState.VERIFIED);
    expect(transitions).toContain(IssueState.SPEC_READY);
    expect(transitions).toContain(IssueState.HOLD);
    expect(transitions).toContain(IssueState.KILLED);
    expect(transitions).toHaveLength(4);
  });

  test('VERIFIED should allow backward transition to IMPLEMENTING', () => {
    const transitions = ISSUE_STATE_TRANSITIONS[IssueState.VERIFIED];
    expect(transitions).toContain(IssueState.MERGE_READY);
    expect(transitions).toContain(IssueState.IMPLEMENTING);
    expect(transitions).toContain(IssueState.HOLD);
    expect(transitions).toContain(IssueState.KILLED);
    expect(transitions).toHaveLength(4);
  });

  test('MERGE_READY should allow backward transition to VERIFIED', () => {
    const transitions = ISSUE_STATE_TRANSITIONS[IssueState.MERGE_READY];
    expect(transitions).toContain(IssueState.DONE);
    expect(transitions).toContain(IssueState.VERIFIED);
    expect(transitions).toContain(IssueState.HOLD);
    expect(transitions).toContain(IssueState.KILLED);
    expect(transitions).toHaveLength(4);
  });

  test('DONE should have no forward transitions (terminal state)', () => {
    const transitions = ISSUE_STATE_TRANSITIONS[IssueState.DONE];
    expect(transitions).toHaveLength(0);
  });

  test('KILLED should have no forward transitions (terminal state)', () => {
    const transitions = ISSUE_STATE_TRANSITIONS[IssueState.KILLED];
    expect(transitions).toHaveLength(0);
  });

  test('HOLD should transition back to any non-terminal state or KILLED', () => {
    const transitions = ISSUE_STATE_TRANSITIONS[IssueState.HOLD];
    expect(transitions).toContain(IssueState.CREATED);
    expect(transitions).toContain(IssueState.SPEC_READY);
    expect(transitions).toContain(IssueState.IMPLEMENTING);
    expect(transitions).toContain(IssueState.VERIFIED);
    expect(transitions).toContain(IssueState.MERGE_READY);
    expect(transitions).toContain(IssueState.KILLED);
    expect(transitions).toHaveLength(6);
  });
});

describe('isValidTransition', () => {
  test('should return true for valid forward transitions', () => {
    expect(isValidTransition(IssueState.CREATED, IssueState.SPEC_READY)).toBe(true);
    expect(isValidTransition(IssueState.SPEC_READY, IssueState.IMPLEMENTING)).toBe(true);
    expect(isValidTransition(IssueState.IMPLEMENTING, IssueState.VERIFIED)).toBe(true);
    expect(isValidTransition(IssueState.VERIFIED, IssueState.MERGE_READY)).toBe(true);
    expect(isValidTransition(IssueState.MERGE_READY, IssueState.DONE)).toBe(true);
  });

  test('should return true for valid backward transitions', () => {
    expect(isValidTransition(IssueState.IMPLEMENTING, IssueState.SPEC_READY)).toBe(true);
    expect(isValidTransition(IssueState.VERIFIED, IssueState.IMPLEMENTING)).toBe(true);
    expect(isValidTransition(IssueState.MERGE_READY, IssueState.VERIFIED)).toBe(true);
  });

  test('should return true for transitions to HOLD', () => {
    expect(isValidTransition(IssueState.CREATED, IssueState.HOLD)).toBe(true);
    expect(isValidTransition(IssueState.SPEC_READY, IssueState.HOLD)).toBe(true);
    expect(isValidTransition(IssueState.IMPLEMENTING, IssueState.HOLD)).toBe(true);
    expect(isValidTransition(IssueState.VERIFIED, IssueState.HOLD)).toBe(true);
    expect(isValidTransition(IssueState.MERGE_READY, IssueState.HOLD)).toBe(true);
  });

  test('should return true for transitions to KILLED', () => {
    expect(isValidTransition(IssueState.CREATED, IssueState.KILLED)).toBe(true);
    expect(isValidTransition(IssueState.SPEC_READY, IssueState.KILLED)).toBe(true);
    expect(isValidTransition(IssueState.IMPLEMENTING, IssueState.KILLED)).toBe(true);
    expect(isValidTransition(IssueState.VERIFIED, IssueState.KILLED)).toBe(true);
    expect(isValidTransition(IssueState.MERGE_READY, IssueState.KILLED)).toBe(true);
    expect(isValidTransition(IssueState.HOLD, IssueState.KILLED)).toBe(true);
  });

  test('should return true for transitions from HOLD back to active states', () => {
    expect(isValidTransition(IssueState.HOLD, IssueState.CREATED)).toBe(true);
    expect(isValidTransition(IssueState.HOLD, IssueState.SPEC_READY)).toBe(true);
    expect(isValidTransition(IssueState.HOLD, IssueState.IMPLEMENTING)).toBe(true);
    expect(isValidTransition(IssueState.HOLD, IssueState.VERIFIED)).toBe(true);
    expect(isValidTransition(IssueState.HOLD, IssueState.MERGE_READY)).toBe(true);
  });

  test('should return false for invalid transitions', () => {
    expect(isValidTransition(IssueState.CREATED, IssueState.IMPLEMENTING)).toBe(false);
    expect(isValidTransition(IssueState.CREATED, IssueState.DONE)).toBe(false);
    expect(isValidTransition(IssueState.SPEC_READY, IssueState.VERIFIED)).toBe(false);
    expect(isValidTransition(IssueState.IMPLEMENTING, IssueState.MERGE_READY)).toBe(false);
    expect(isValidTransition(IssueState.VERIFIED, IssueState.DONE)).toBe(false);
  });

  test('should return false for transitions from terminal states', () => {
    expect(isValidTransition(IssueState.DONE, IssueState.VERIFIED)).toBe(false);
    expect(isValidTransition(IssueState.DONE, IssueState.HOLD)).toBe(false);
    expect(isValidTransition(IssueState.KILLED, IssueState.CREATED)).toBe(false);
    expect(isValidTransition(IssueState.KILLED, IssueState.HOLD)).toBe(false);
  });
});

describe('getIssueStateDescription', () => {
  test('should return descriptions for all states', () => {
    expect(getIssueStateDescription(IssueState.CREATED)).toContain('created');
    expect(getIssueStateDescription(IssueState.SPEC_READY)).toContain('Specification');
    expect(getIssueStateDescription(IssueState.IMPLEMENTING)).toContain('Implementation');
    expect(getIssueStateDescription(IssueState.VERIFIED)).toContain('verified');
    expect(getIssueStateDescription(IssueState.MERGE_READY)).toContain('merge');
    expect(getIssueStateDescription(IssueState.DONE)).toContain('Completed');
    expect(getIssueStateDescription(IssueState.HOLD)).toContain('hold');
    expect(getIssueStateDescription(IssueState.KILLED)).toContain('Cancelled');
  });

  test('should return non-empty descriptions', () => {
    Object.values(IssueState).forEach(state => {
      const description = getIssueStateDescription(state);
      expect(description.length).toBeGreaterThan(0);
    });
  });
});

describe('isTerminalState', () => {
  test('should return true for DONE and KILLED', () => {
    expect(isTerminalState(IssueState.DONE)).toBe(true);
    expect(isTerminalState(IssueState.KILLED)).toBe(true);
  });

  test('should return false for non-terminal states', () => {
    expect(isTerminalState(IssueState.CREATED)).toBe(false);
    expect(isTerminalState(IssueState.SPEC_READY)).toBe(false);
    expect(isTerminalState(IssueState.IMPLEMENTING)).toBe(false);
    expect(isTerminalState(IssueState.VERIFIED)).toBe(false);
    expect(isTerminalState(IssueState.MERGE_READY)).toBe(false);
    expect(isTerminalState(IssueState.HOLD)).toBe(false);
  });
});

describe('isActiveState', () => {
  test('should return true for active work states', () => {
    expect(isActiveState(IssueState.CREATED)).toBe(true);
    expect(isActiveState(IssueState.SPEC_READY)).toBe(true);
    expect(isActiveState(IssueState.IMPLEMENTING)).toBe(true);
    expect(isActiveState(IssueState.VERIFIED)).toBe(true);
    expect(isActiveState(IssueState.MERGE_READY)).toBe(true);
  });

  test('should return false for non-active states', () => {
    expect(isActiveState(IssueState.DONE)).toBe(false);
    expect(isActiveState(IssueState.KILLED)).toBe(false);
    expect(isActiveState(IssueState.HOLD)).toBe(false);
  });
});

describe('canPerformAction', () => {
  test('should return true for non-terminal states', () => {
    expect(canPerformAction(IssueState.CREATED)).toBe(true);
    expect(canPerformAction(IssueState.SPEC_READY)).toBe(true);
    expect(canPerformAction(IssueState.IMPLEMENTING)).toBe(true);
    expect(canPerformAction(IssueState.VERIFIED)).toBe(true);
    expect(canPerformAction(IssueState.MERGE_READY)).toBe(true);
    expect(canPerformAction(IssueState.HOLD)).toBe(true);
  });

  test('should return false for terminal states (Issue A5)', () => {
    expect(canPerformAction(IssueState.DONE)).toBe(false);
    expect(canPerformAction(IssueState.KILLED)).toBe(false);
  });
});

describe('ensureNotKilled (Issue A5)', () => {
  test('should not throw for non-KILLED states', () => {
    expect(() => ensureNotKilled(IssueState.CREATED)).not.toThrow();
    expect(() => ensureNotKilled(IssueState.SPEC_READY)).not.toThrow();
    expect(() => ensureNotKilled(IssueState.IMPLEMENTING)).not.toThrow();
    expect(() => ensureNotKilled(IssueState.VERIFIED)).not.toThrow();
    expect(() => ensureNotKilled(IssueState.MERGE_READY)).not.toThrow();
    expect(() => ensureNotKilled(IssueState.DONE)).not.toThrow();
    expect(() => ensureNotKilled(IssueState.HOLD)).not.toThrow();
  });

  test('should throw for KILLED state', () => {
    expect(() => ensureNotKilled(IssueState.KILLED)).toThrow();
    expect(() => ensureNotKilled(IssueState.KILLED)).toThrow(/Cannot perform action on KILLED issue/);
    expect(() => ensureNotKilled(IssueState.KILLED)).toThrow(/Re-activation requires explicit new intent/);
  });
});

describe('ensureNotTerminal (Issue A5)', () => {
  test('should not throw for non-terminal states', () => {
    expect(() => ensureNotTerminal(IssueState.CREATED)).not.toThrow();
    expect(() => ensureNotTerminal(IssueState.SPEC_READY)).not.toThrow();
    expect(() => ensureNotTerminal(IssueState.IMPLEMENTING)).not.toThrow();
    expect(() => ensureNotTerminal(IssueState.VERIFIED)).not.toThrow();
    expect(() => ensureNotTerminal(IssueState.MERGE_READY)).not.toThrow();
    expect(() => ensureNotTerminal(IssueState.HOLD)).not.toThrow();
  });

  test('should throw for DONE state', () => {
    expect(() => ensureNotTerminal(IssueState.DONE)).toThrow();
    expect(() => ensureNotTerminal(IssueState.DONE)).toThrow(/terminal state/);
  });

  test('should throw for KILLED state', () => {
    expect(() => ensureNotTerminal(IssueState.KILLED)).toThrow();
    expect(() => ensureNotTerminal(IssueState.KILLED)).toThrow(/terminal state/);
  });
});

describe('State Machine Integrity', () => {
  test('HOLD and KILLED states should be technically possible from all non-terminal states', () => {
    const nonTerminalStates = [
      IssueState.CREATED,
      IssueState.SPEC_READY,
      IssueState.IMPLEMENTING,
      IssueState.VERIFIED,
      IssueState.MERGE_READY,
      IssueState.HOLD,
    ];

    nonTerminalStates.forEach(state => {
      if (state !== IssueState.HOLD) {
        expect(isValidTransition(state, IssueState.HOLD)).toBe(true);
      }
      expect(isValidTransition(state, IssueState.KILLED)).toBe(true);
    });
  });

  test('All transitions should be symmetric in the transition map', () => {
    // Every state referenced in a transition must exist in the map
    Object.values(ISSUE_STATE_TRANSITIONS).forEach(transitions => {
      transitions.forEach(targetState => {
        expect(ISSUE_STATE_TRANSITIONS).toHaveProperty(targetState);
      });
    });
  });

  test('Terminal states should not allow any transitions', () => {
    const terminalStates = [IssueState.DONE, IssueState.KILLED];
    
    terminalStates.forEach(terminalState => {
      const transitions = ISSUE_STATE_TRANSITIONS[terminalState];
      expect(transitions).toHaveLength(0);
      
      // Verify no state can transition from a terminal state
      Object.values(IssueState).forEach(targetState => {
        expect(isValidTransition(terminalState, targetState)).toBe(false);
      });
    });
  });

  test('Every non-terminal state should have at least one forward transition', () => {
    const nonTerminalStates = Object.values(IssueState).filter(
      state => !isTerminalState(state)
    );

    nonTerminalStates.forEach(state => {
      const transitions = ISSUE_STATE_TRANSITIONS[state];
      expect(transitions.length).toBeGreaterThan(0);
    });
  });
});
