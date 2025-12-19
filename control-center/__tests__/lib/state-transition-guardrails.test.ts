/**
 * Tests for State Transition Guardrails
 * 
 * Issue A2: Automatische State-Transitions (Guardrails)
 * Validates rule-based state transitions without manual intervention
 */

import {
  validateSpecReadyTransition,
  validateVerifiedTransition,
  validateMergeReadyTransition,
  validateStateTransition,
  attemptAutomaticTransition,
  evaluateNextStateProgression,
  validateWorkflowExecution,
  StateTransitionContext,
} from '../../src/lib/state-transition-guardrails';
import { IssueState } from '../../src/lib/types/issue-state';

describe('State Transition Guardrails', () => {
  describe('validateSpecReadyTransition', () => {
    test('should allow transition when all specification requirements are met', () => {
      const context: StateTransitionContext = {
        specification: {
          exists: true,
          isComplete: true,
          hasRequirements: true,
          hasAcceptanceCriteria: true,
        },
      };

      const result = validateSpecReadyTransition(context);

      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('All specification requirements met');
      expect(result.conditions).toHaveLength(4);
      expect(result.conditions.every(c => c.passed)).toBe(true);
      expect(result.suggestions).toBeUndefined();
    });

    test('should block transition when specification does not exist', () => {
      const context: StateTransitionContext = {
        specification: {
          exists: false,
          isComplete: false,
          hasRequirements: false,
          hasAcceptanceCriteria: false,
        },
      };

      const result = validateSpecReadyTransition(context);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Specification validation failed');
      expect(result.conditions.filter(c => !c.passed).length).toBeGreaterThan(0);
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions).toContain('Create a specification document');
    });

    test('should block transition when specification is incomplete', () => {
      const context: StateTransitionContext = {
        specification: {
          exists: true,
          isComplete: false,
          hasRequirements: true,
          hasAcceptanceCriteria: true,
        },
      };

      const result = validateSpecReadyTransition(context);

      expect(result.allowed).toBe(false);
      expect(result.suggestions).toContain('Complete all sections of the specification');
    });

    test('should block transition when requirements are missing', () => {
      const context: StateTransitionContext = {
        specification: {
          exists: true,
          isComplete: true,
          hasRequirements: false,
          hasAcceptanceCriteria: true,
        },
      };

      const result = validateSpecReadyTransition(context);

      expect(result.allowed).toBe(false);
      expect(result.suggestions).toContain('Define clear requirements in the specification');
    });

    test('should block transition when acceptance criteria are missing', () => {
      const context: StateTransitionContext = {
        specification: {
          exists: true,
          isComplete: true,
          hasRequirements: true,
          hasAcceptanceCriteria: false,
        },
      };

      const result = validateSpecReadyTransition(context);

      expect(result.allowed).toBe(false);
      expect(result.suggestions).toContain('Define acceptance criteria for the implementation');
    });

    test('should handle missing specification context gracefully', () => {
      const context: StateTransitionContext = {};

      const result = validateSpecReadyTransition(context);

      expect(result.allowed).toBe(false);
      expect(result.conditions.every(c => !c.passed)).toBe(true);
    });
  });

  describe('validateVerifiedTransition', () => {
    test('should allow transition when all QA tests pass', () => {
      const context: StateTransitionContext = {
        qaResults: {
          executed: true,
          passed: true,
          testCount: 50,
          passedCount: 50,
          failedCount: 0,
          coveragePercent: 85,
        },
      };

      const result = validateVerifiedTransition(context);

      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('All QA requirements met');
      expect(result.conditions.every(c => c.passed)).toBe(true);
      expect(result.suggestions).toBeUndefined();
    });

    test('should block transition when tests have not been executed', () => {
      const context: StateTransitionContext = {
        qaResults: {
          executed: false,
          passed: false,
        },
      };

      const result = validateVerifiedTransition(context);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('QA validation failed');
      expect(result.suggestions).toContain('Run QA test suite');
    });

    test('should block transition when tests fail', () => {
      const context: StateTransitionContext = {
        qaResults: {
          executed: true,
          passed: false,
          testCount: 50,
          passedCount: 45,
          failedCount: 5,
        },
      };

      const result = validateVerifiedTransition(context);

      expect(result.allowed).toBe(false);
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions?.some(s => s.includes('failing test'))).toBe(true);
    });

    test('should block transition when coverage is too low', () => {
      const context: StateTransitionContext = {
        qaResults: {
          executed: true,
          passed: true,
          coveragePercent: 50, // Below 70% threshold
        },
      };

      const result = validateVerifiedTransition(context);

      expect(result.allowed).toBe(false);
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions?.some(s => s.includes('coverage'))).toBe(true);
    });

    test('should allow transition with sufficient coverage', () => {
      const context: StateTransitionContext = {
        qaResults: {
          executed: true,
          passed: true,
          coveragePercent: 75, // Above 70% threshold
        },
      };

      const result = validateVerifiedTransition(context);

      expect(result.allowed).toBe(true);
    });

    test('should handle missing QA context gracefully', () => {
      const context: StateTransitionContext = {};

      const result = validateVerifiedTransition(context);

      expect(result.allowed).toBe(false);
      expect(result.conditions.some(c => c.name === 'tests_executed' && !c.passed)).toBe(true);
    });
  });

  describe('validateMergeReadyTransition', () => {
    test('should allow transition when all merge requirements are met', () => {
      const context: StateTransitionContext = {
        diffGate: {
          hasChanges: true,
          changeCount: 10,
          conflictsResolved: true,
          reviewsApproved: true,
          ciPassing: true,
          securityChecksPassed: true,
        },
      };

      const result = validateMergeReadyTransition(context);

      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('All merge requirements met');
      expect(result.conditions.every(c => c.passed)).toBe(true);
      expect(result.suggestions).toBeUndefined();
    });

    test('should block transition when there are no changes', () => {
      const context: StateTransitionContext = {
        diffGate: {
          hasChanges: false,
          conflictsResolved: true,
          reviewsApproved: true,
          ciPassing: true,
        },
      };

      const result = validateMergeReadyTransition(context);

      expect(result.allowed).toBe(false);
      expect(result.suggestions).toContain('Commit changes to the branch');
    });

    test('should block transition when conflicts are not resolved', () => {
      const context: StateTransitionContext = {
        diffGate: {
          hasChanges: true,
          conflictsResolved: false,
          reviewsApproved: true,
          ciPassing: true,
        },
      };

      const result = validateMergeReadyTransition(context);

      expect(result.allowed).toBe(false);
      expect(result.suggestions).toContain('Resolve all merge conflicts');
    });

    test('should block transition when reviews are not approved', () => {
      const context: StateTransitionContext = {
        diffGate: {
          hasChanges: true,
          conflictsResolved: true,
          reviewsApproved: false,
          ciPassing: true,
        },
      };

      const result = validateMergeReadyTransition(context);

      expect(result.allowed).toBe(false);
      expect(result.suggestions).toContain('Obtain required code review approvals');
    });

    test('should block transition when CI is not passing', () => {
      const context: StateTransitionContext = {
        diffGate: {
          hasChanges: true,
          conflictsResolved: true,
          reviewsApproved: true,
          ciPassing: false,
        },
      };

      const result = validateMergeReadyTransition(context);

      expect(result.allowed).toBe(false);
      expect(result.suggestions).toContain('Fix CI pipeline failures');
    });

    test('should block transition when security checks fail', () => {
      const context: StateTransitionContext = {
        diffGate: {
          hasChanges: true,
          conflictsResolved: true,
          reviewsApproved: true,
          ciPassing: true,
          securityChecksPassed: false,
        },
      };

      const result = validateMergeReadyTransition(context);

      expect(result.allowed).toBe(false);
      expect(result.suggestions).toContain('Address security vulnerabilities');
    });

    test('should allow transition without security checks if not specified', () => {
      const context: StateTransitionContext = {
        diffGate: {
          hasChanges: true,
          conflictsResolved: true,
          reviewsApproved: true,
          ciPassing: true,
          // securityChecksPassed not specified
        },
      };

      const result = validateMergeReadyTransition(context);

      expect(result.allowed).toBe(true);
    });

    test('should handle missing diff gate context gracefully', () => {
      const context: StateTransitionContext = {};

      const result = validateMergeReadyTransition(context);

      expect(result.allowed).toBe(false);
      expect(result.conditions.every(c => !c.passed)).toBe(true);
    });
  });

  describe('validateStateTransition', () => {
    test('should apply SPEC_READY guardrail for CREATED → SPEC_READY', () => {
      const context: StateTransitionContext = {
        specification: {
          exists: true,
          isComplete: true,
          hasRequirements: true,
          hasAcceptanceCriteria: true,
        },
      };

      const result = validateStateTransition(
        IssueState.CREATED,
        IssueState.SPEC_READY,
        context
      );

      expect(result.allowed).toBe(true);
      expect(result.conditions.some(c => c.name === 'specification_exists')).toBe(true);
    });

    test('should apply VERIFIED guardrail for IMPLEMENTING → VERIFIED', () => {
      const context: StateTransitionContext = {
        qaResults: {
          executed: true,
          passed: true,
        },
      };

      const result = validateStateTransition(
        IssueState.IMPLEMENTING,
        IssueState.VERIFIED,
        context
      );

      expect(result.allowed).toBe(true);
      expect(result.conditions.some(c => c.name === 'tests_executed')).toBe(true);
    });

    test('should apply MERGE_READY guardrail for VERIFIED → MERGE_READY', () => {
      const context: StateTransitionContext = {
        diffGate: {
          hasChanges: true,
          conflictsResolved: true,
          reviewsApproved: true,
          ciPassing: true,
        },
      };

      const result = validateStateTransition(
        IssueState.VERIFIED,
        IssueState.MERGE_READY,
        context
      );

      expect(result.allowed).toBe(true);
      expect(result.conditions.some(c => c.name === 'ci_passing')).toBe(true);
    });

    test('should block invalid state machine transitions', () => {
      const context: StateTransitionContext = {};

      const result = validateStateTransition(
        IssueState.CREATED,
        IssueState.DONE, // Invalid: can't go directly from CREATED to DONE
        context
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Invalid state transition');
      expect(result.conditions.some(c => c.name === 'valid_transition')).toBe(true);
    });

    test('should allow transitions without specific guardrails', () => {
      const context: StateTransitionContext = {};

      const result = validateStateTransition(
        IssueState.SPEC_READY,
        IssueState.IMPLEMENTING,
        context
      );

      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('No specific guardrails');
    });

    test('should allow transition to HOLD from any active state', () => {
      const context: StateTransitionContext = {};

      const result = validateStateTransition(
        IssueState.IMPLEMENTING,
        IssueState.HOLD,
        context
      );

      expect(result.allowed).toBe(true);
    });

    test('should allow transition to KILLED from any active state', () => {
      const context: StateTransitionContext = {};

      const result = validateStateTransition(
        IssueState.VERIFIED,
        IssueState.KILLED,
        context
      );

      expect(result.allowed).toBe(true);
    });

    test('should block transition from KILLED state (Issue A5)', () => {
      const context: StateTransitionContext = {};

      const result = validateStateTransition(
        IssueState.KILLED,
        IssueState.HOLD,
        context
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('terminal state');
      expect(result.reason).toContain('KILLED');
      expect(result.conditions[0].name).toBe('terminal_state_check');
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions?.[0]).toContain('explicit intent');
    });

    test('should block transition from DONE state (Issue A5)', () => {
      const context: StateTransitionContext = {};

      const result = validateStateTransition(
        IssueState.DONE,
        IssueState.IMPLEMENTING,
        context
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('terminal state');
      expect(result.reason).toContain('DONE');
      expect(result.conditions[0].name).toBe('terminal_state_check');
    });

    test('should prevent any transition from KILLED to any state (Issue A5)', () => {
      const context: StateTransitionContext = {};
      const allStates = Object.values(IssueState);

      allStates.forEach(targetState => {
        const result = validateStateTransition(
          IssueState.KILLED,
          targetState,
          context
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('terminal state');
      });
    });
  });

  describe('attemptAutomaticTransition', () => {
    test('should return shouldTransition=true when guardrails pass', () => {
      const context: StateTransitionContext = {
        specification: {
          exists: true,
          isComplete: true,
          hasRequirements: true,
          hasAcceptanceCriteria: true,
        },
      };

      const result = attemptAutomaticTransition(
        IssueState.CREATED,
        IssueState.SPEC_READY,
        context
      );

      expect(result.shouldTransition).toBe(true);
      expect(result.allowed).toBe(true);
    });

    test('should return shouldTransition=false when guardrails fail', () => {
      const context: StateTransitionContext = {
        specification: {
          exists: false,
          isComplete: false,
          hasRequirements: false,
          hasAcceptanceCriteria: false,
        },
      };

      const result = attemptAutomaticTransition(
        IssueState.CREATED,
        IssueState.SPEC_READY,
        context
      );

      expect(result.shouldTransition).toBe(false);
      expect(result.allowed).toBe(false);
    });
  });

  describe('evaluateNextStateProgression', () => {
    test('should suggest SPEC_READY as next state from CREATED', () => {
      const context: StateTransitionContext = {
        specification: {
          exists: true,
          isComplete: true,
          hasRequirements: true,
          hasAcceptanceCriteria: true,
        },
      };

      const result = evaluateNextStateProgression(IssueState.CREATED, context);

      expect(result.canProgress).toBe(true);
      expect(result.nextState).toBe(IssueState.SPEC_READY);
      expect(result.validation?.allowed).toBe(true);
    });

    test('should suggest VERIFIED as next state from IMPLEMENTING', () => {
      const context: StateTransitionContext = {
        qaResults: {
          executed: true,
          passed: true,
        },
      };

      const result = evaluateNextStateProgression(IssueState.IMPLEMENTING, context);

      expect(result.canProgress).toBe(true);
      expect(result.nextState).toBe(IssueState.VERIFIED);
      expect(result.validation?.allowed).toBe(true);
    });

    test('should suggest MERGE_READY as next state from VERIFIED', () => {
      const context: StateTransitionContext = {
        diffGate: {
          hasChanges: true,
          conflictsResolved: true,
          reviewsApproved: true,
          ciPassing: true,
        },
      };

      const result = evaluateNextStateProgression(IssueState.VERIFIED, context);

      expect(result.canProgress).toBe(true);
      expect(result.nextState).toBe(IssueState.MERGE_READY);
      expect(result.validation?.allowed).toBe(true);
    });

    test('should block progression when guardrails fail', () => {
      const context: StateTransitionContext = {
        qaResults: {
          executed: false,
          passed: false,
        },
      };

      const result = evaluateNextStateProgression(IssueState.IMPLEMENTING, context);

      expect(result.canProgress).toBe(false);
      expect(result.nextState).toBeUndefined();
      expect(result.validation?.allowed).toBe(false);
    });

    test('should return no progression for terminal states', () => {
      const context: StateTransitionContext = {};

      const result = evaluateNextStateProgression(IssueState.DONE, context);

      expect(result.canProgress).toBe(false);
      expect(result.nextState).toBeUndefined();
    });

    test('should return no progression for HOLD state', () => {
      const context: StateTransitionContext = {};

      const result = evaluateNextStateProgression(IssueState.HOLD, context);

      expect(result.canProgress).toBe(false);
      expect(result.nextState).toBeUndefined();
    });

    test('should return no progression for KILLED state', () => {
      const context: StateTransitionContext = {};

      const result = evaluateNextStateProgression(IssueState.KILLED, context);

      expect(result.canProgress).toBe(false);
      expect(result.nextState).toBeUndefined();
    });

    test('should follow happy path from CREATED to DONE', () => {
      // Test the full progression path
      const contexts = [
        {
          // CREATED → SPEC_READY
          specification: {
            exists: true,
            isComplete: true,
            hasRequirements: true,
            hasAcceptanceCriteria: true,
          },
        },
        {
          // SPEC_READY → IMPLEMENTING (no guardrails)
        },
        {
          // IMPLEMENTING → VERIFIED
          qaResults: {
            executed: true,
            passed: true,
          },
        },
        {
          // VERIFIED → MERGE_READY
          diffGate: {
            hasChanges: true,
            conflictsResolved: true,
            reviewsApproved: true,
            ciPassing: true,
          },
        },
      ];

      const states = [
        IssueState.CREATED,
        IssueState.SPEC_READY,
        IssueState.IMPLEMENTING,
        IssueState.VERIFIED,
      ];

      for (let i = 0; i < states.length; i++) {
        const result = evaluateNextStateProgression(states[i], contexts[i]);
        expect(result.canProgress).toBe(true);
        expect(result.nextState).toBeDefined();
      }
    });
  });

  describe('validateWorkflowExecution (Issue A5)', () => {
    test('should allow workflow execution for active states', () => {
      const activeStates = [
        IssueState.CREATED,
        IssueState.SPEC_READY,
        IssueState.IMPLEMENTING,
        IssueState.VERIFIED,
        IssueState.MERGE_READY,
      ];

      activeStates.forEach(state => {
        const result = validateWorkflowExecution(state);
        expect(result.allowed).toBe(true);
        expect(result.reason).toContain('allowed');
        expect(result.conditions[0].passed).toBe(true);
      });
    });

    test('should allow workflow execution for HOLD state', () => {
      const result = validateWorkflowExecution(IssueState.HOLD);
      expect(result.allowed).toBe(true);
    });

    test('should block workflow execution for KILLED state (zombie prevention)', () => {
      const result = validateWorkflowExecution(IssueState.KILLED);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('KILLED');
      expect(result.reason).toContain('zombie issues');
      expect(result.conditions[0].name).toBe('issue_not_killed');
      expect(result.conditions[0].passed).toBe(false);
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions?.length).toBeGreaterThan(0);
      expect(result.suggestions?.[0]).toContain('explicit new intent');
    });

    test('should block workflow execution for DONE state', () => {
      const result = validateWorkflowExecution(IssueState.DONE);
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('DONE');
      expect(result.reason).toContain('complete');
      expect(result.conditions[0].name).toBe('issue_not_done');
      expect(result.conditions[0].passed).toBe(false);
      expect(result.suggestions).toBeDefined();
    });

    test('should provide clear error message for KILLED issues', () => {
      const result = validateWorkflowExecution(IssueState.KILLED);
      
      expect(result.reason).toContain('terminated');
      expect(result.reason).toContain('blocked');
      expect(result.suggestions).toContain('Re-activation requires explicit new intent');
    });

    test('should provide clear error message for DONE issues', () => {
      const result = validateWorkflowExecution(IssueState.DONE);
      
      expect(result.reason).toContain('complete');
      expect(result.suggestions?.some(s => s.includes('new issue'))).toBe(true);
    });
  });
});
