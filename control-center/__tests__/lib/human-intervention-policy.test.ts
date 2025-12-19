/**
 * Tests for Human Intervention Policy (Issue A3)
 * 
 * Validates that human touchpoints are restricted to:
 * - HOLD state
 * - RED verdict (HUMAN_REQUIRED action)
 * 
 * No informal intervention in intermediate states allowed.
 */

import { IssueState } from '../../src/lib/types/issue-state';
import {
  checkHumanInterventionPolicy,
  checkManualStateTransition,
  validateManualActionContext,
  getHumanInterventionPolicyDescription,
  HumanInterventionContext,
  HUMAN_INTERVENTION_ALLOWED_STATES,
  HUMAN_INTERVENTION_REQUIRED_ACTIONS,
} from '../../src/lib/types/human-intervention-policy';

describe('Human Intervention Policy (Issue A3)', () => {
  describe('Policy Constants', () => {
    test('should define allowed intervention states', () => {
      expect(HUMAN_INTERVENTION_ALLOWED_STATES).toContain(IssueState.HOLD);
      expect(HUMAN_INTERVENTION_ALLOWED_STATES).toContain(IssueState.KILLED);
      expect(HUMAN_INTERVENTION_ALLOWED_STATES).toHaveLength(2);
    });

    test('should define actions requiring human intervention', () => {
      expect(HUMAN_INTERVENTION_REQUIRED_ACTIONS).toContain('HUMAN_REQUIRED');
      expect(HUMAN_INTERVENTION_REQUIRED_ACTIONS).toHaveLength(1);
    });
  });

  describe('checkHumanInterventionPolicy', () => {
    describe('Automatic Actions (Rule 1)', () => {
      test('should allow automatic actions in any state', () => {
        const context: HumanInterventionContext = {
          currentState: IssueState.IMPLEMENTING,
          isManualAction: false,
        };

        const result = checkHumanInterventionPolicy(context);

        expect(result.allowed).toBe(true);
        expect(result.policyRule).toBe('RULE_1_AUTOMATIC_ACTIONS_ALLOWED');
        expect(result.reason).toContain('Automatic action');
      });

      test('should allow automatic transitions between any states', () => {
        const context: HumanInterventionContext = {
          currentState: IssueState.VERIFIED,
          targetState: IssueState.MERGE_READY,
          isManualAction: false,
        };

        const result = checkHumanInterventionPolicy(context);

        expect(result.allowed).toBe(true);
      });
    });

    describe('Manual Actions in Allowed States (Rule 2a)', () => {
      test('should allow manual intervention in HOLD state', () => {
        const context: HumanInterventionContext = {
          currentState: IssueState.HOLD,
          isManualAction: true,
          initiatedBy: 'user@example.com',
          reason: 'Manual review needed',
        };

        const result = checkHumanInterventionPolicy(context);

        expect(result.allowed).toBe(true);
        expect(result.policyRule).toBe('RULE_2A_ALLOWED_STATE');
        expect(result.reason).toContain('HOLD');
      });

      test('should allow manual intervention in KILLED state', () => {
        const context: HumanInterventionContext = {
          currentState: IssueState.KILLED,
          isManualAction: true,
          initiatedBy: 'user@example.com',
          reason: 'Reopen killed issue',
        };

        const result = checkHumanInterventionPolicy(context);

        expect(result.allowed).toBe(true);
        expect(result.policyRule).toBe('RULE_2A_ALLOWED_STATE');
      });
    });

    describe('Manual Actions with Verdict Requirement (Rule 2b)', () => {
      test('should allow manual intervention when verdict requires it', () => {
        const context: HumanInterventionContext = {
          currentState: IssueState.IMPLEMENTING,
          verdictAction: 'HUMAN_REQUIRED',
          isManualAction: true,
          initiatedBy: 'user@example.com',
          reason: 'Verdict requires human intervention',
        };

        const result = checkHumanInterventionPolicy(context);

        expect(result.allowed).toBe(true);
        expect(result.policyRule).toBe('RULE_2B_VERDICT_REQUIRES_HUMAN');
        expect(result.reason).toContain('HUMAN_REQUIRED');
      });

      test('should allow manual intervention in any state when verdict requires human', () => {
        const states = [
          IssueState.CREATED,
          IssueState.SPEC_READY,
          IssueState.IMPLEMENTING,
          IssueState.VERIFIED,
          IssueState.MERGE_READY,
        ];

        for (const state of states) {
          const context: HumanInterventionContext = {
            currentState: state,
            verdictAction: 'HUMAN_REQUIRED',
            isManualAction: true,
            initiatedBy: 'user@example.com',
            reason: 'Verdict requires intervention',
          };

          const result = checkHumanInterventionPolicy(context);

          expect(result.allowed).toBe(true);
          expect(result.policyRule).toBe('RULE_2B_VERDICT_REQUIRES_HUMAN');
        }
      });
    });

    describe('Forbidden Manual Interventions (Rule 3)', () => {
      test('should block manual intervention in CREATED state', () => {
        const context: HumanInterventionContext = {
          currentState: IssueState.CREATED,
          isManualAction: true,
          initiatedBy: 'user@example.com',
          reason: 'Want to advance manually',
        };

        const result = checkHumanInterventionPolicy(context);

        expect(result.allowed).toBe(false);
        expect(result.policyRule).toBe('RULE_3_INTERMEDIATE_STATE_BLOCKED');
        expect(result.violation).toContain('CREATED');
        expect(result.suggestions).toBeDefined();
        expect(result.suggestions!.length).toBeGreaterThan(0);
      });

      test('should block manual intervention in SPEC_READY state', () => {
        const context: HumanInterventionContext = {
          currentState: IssueState.SPEC_READY,
          isManualAction: true,
          initiatedBy: 'user@example.com',
        };

        const result = checkHumanInterventionPolicy(context);

        expect(result.allowed).toBe(false);
        expect(result.violation).toContain('SPEC_READY');
      });

      test('should block manual intervention in IMPLEMENTING state', () => {
        const context: HumanInterventionContext = {
          currentState: IssueState.IMPLEMENTING,
          targetState: IssueState.VERIFIED,
          isManualAction: true,
          initiatedBy: 'user@example.com',
        };

        const result = checkHumanInterventionPolicy(context);

        expect(result.allowed).toBe(false);
        expect(result.violation).toContain('IMPLEMENTING');
      });

      test('should block manual intervention in VERIFIED state', () => {
        const context: HumanInterventionContext = {
          currentState: IssueState.VERIFIED,
          targetState: IssueState.MERGE_READY,
          isManualAction: true,
          initiatedBy: 'user@example.com',
        };

        const result = checkHumanInterventionPolicy(context);

        expect(result.allowed).toBe(false);
        expect(result.violation).toContain('VERIFIED');
      });

      test('should block manual intervention in MERGE_READY state', () => {
        const context: HumanInterventionContext = {
          currentState: IssueState.MERGE_READY,
          targetState: IssueState.DONE,
          isManualAction: true,
          initiatedBy: 'user@example.com',
        };

        const result = checkHumanInterventionPolicy(context);

        expect(result.allowed).toBe(false);
        expect(result.violation).toContain('MERGE_READY');
      });

      test('should provide helpful suggestions when blocking intervention', () => {
        const context: HumanInterventionContext = {
          currentState: IssueState.IMPLEMENTING,
          targetState: IssueState.VERIFIED,
          isManualAction: true,
          initiatedBy: 'user@example.com',
        };

        const result = checkHumanInterventionPolicy(context);

        expect(result.suggestions).toContain('Use automatic state transitions with guardrails');
        expect(result.suggestions).toContain('Put issue on HOLD if manual review is needed');
        expect(result.suggestions).toContain('Wait for verdict to require human intervention');
      });
    });
  });

  describe('checkManualStateTransition', () => {
    describe('Allowed Transitions', () => {
      test('should allow manual transition to HOLD from any state', () => {
        const states = [
          IssueState.CREATED,
          IssueState.SPEC_READY,
          IssueState.IMPLEMENTING,
          IssueState.VERIFIED,
          IssueState.MERGE_READY,
        ];

        for (const fromState of states) {
          const result = checkManualStateTransition(
            fromState,
            IssueState.HOLD,
            'user@example.com',
            'Need to pause work'
          );

          expect(result.allowed).toBe(true);
          expect(result.policyRule).toBe('RULE_TRANSITION_TO_HOLD_OR_KILLED');
          expect(result.reason).toContain('HOLD');
        }
      });

      test('should allow manual transition to KILLED from any state', () => {
        const states = [
          IssueState.CREATED,
          IssueState.SPEC_READY,
          IssueState.IMPLEMENTING,
          IssueState.VERIFIED,
          IssueState.MERGE_READY,
        ];

        for (const fromState of states) {
          const result = checkManualStateTransition(
            fromState,
            IssueState.KILLED,
            'user@example.com',
            'Cancelling work'
          );

          expect(result.allowed).toBe(true);
          expect(result.policyRule).toBe('RULE_TRANSITION_TO_HOLD_OR_KILLED');
          expect(result.reason).toContain('KILLED');
        }
      });

      test('should allow manual transition from HOLD to any state', () => {
        const toStates = [
          IssueState.CREATED,
          IssueState.SPEC_READY,
          IssueState.IMPLEMENTING,
          IssueState.VERIFIED,
          IssueState.MERGE_READY,
          IssueState.DONE,
          IssueState.KILLED,
        ];

        for (const toState of toStates) {
          const result = checkManualStateTransition(
            IssueState.HOLD,
            toState,
            'user@example.com',
            'Resuming work'
          );

          expect(result.allowed).toBe(true);
          expect(result.policyRule).toBe('RULE_TRANSITION_FROM_HOLD');
          expect(result.reason).toContain('from HOLD');
        }
      });
    });

    describe('Forbidden Transitions', () => {
      test('should block manual transition from CREATED to SPEC_READY', () => {
        const result = checkManualStateTransition(
          IssueState.CREATED,
          IssueState.SPEC_READY,
          'user@example.com'
        );

        expect(result.allowed).toBe(false);
        expect(result.policyRule).toBe('RULE_INTERMEDIATE_TRANSITION_BLOCKED');
        expect(result.violation).toContain('CREATED → SPEC_READY');
      });

      test('should block manual transition from IMPLEMENTING to VERIFIED', () => {
        const result = checkManualStateTransition(
          IssueState.IMPLEMENTING,
          IssueState.VERIFIED,
          'user@example.com'
        );

        expect(result.allowed).toBe(false);
        expect(result.violation).toContain('IMPLEMENTING → VERIFIED');
      });

      test('should block manual transition from VERIFIED to MERGE_READY', () => {
        const result = checkManualStateTransition(
          IssueState.VERIFIED,
          IssueState.MERGE_READY,
          'user@example.com'
        );

        expect(result.allowed).toBe(false);
        expect(result.violation).toContain('VERIFIED → MERGE_READY');
      });

      test('should block manual transition from MERGE_READY to DONE', () => {
        const result = checkManualStateTransition(
          IssueState.MERGE_READY,
          IssueState.DONE,
          'user@example.com'
        );

        expect(result.allowed).toBe(false);
        expect(result.violation).toContain('MERGE_READY → DONE');
      });

      test('should provide helpful suggestions for blocked transitions', () => {
        const result = checkManualStateTransition(
          IssueState.IMPLEMENTING,
          IssueState.VERIFIED,
          'user@example.com'
        );

        expect(result.suggestions).toBeDefined();
        expect(result.suggestions).toContain('Transition to VERIFIED must be automatic based on guardrails');
        expect(result.suggestions).toContain('Put issue on HOLD if manual intervention is needed');
      });
    });
  });

  describe('validateManualActionContext', () => {
    test('should not validate automatic actions', () => {
      const context: HumanInterventionContext = {
        isManualAction: false,
      };

      const errors = validateManualActionContext(context);

      expect(errors).toHaveLength(0);
    });

    test('should require initiatedBy for manual actions', () => {
      const context: HumanInterventionContext = {
        isManualAction: true,
        reason: 'Some reason',
      };

      const errors = validateManualActionContext(context);

      expect(errors).toContain('Manual action must include initiatedBy (user identification)');
    });

    test('should require reason for manual actions', () => {
      const context: HumanInterventionContext = {
        isManualAction: true,
        initiatedBy: 'user@example.com',
      };

      const errors = validateManualActionContext(context);

      expect(errors).toContain('Manual action must include reason for intervention');
    });

    test('should require currentState for state transitions', () => {
      const context: HumanInterventionContext = {
        isManualAction: true,
        initiatedBy: 'user@example.com',
        reason: 'Transition state',
        targetState: IssueState.VERIFIED,
      };

      const errors = validateManualActionContext(context);

      expect(errors).toContain('Manual state transition must include currentState');
    });

    test('should pass validation when all required fields present', () => {
      const context: HumanInterventionContext = {
        isManualAction: true,
        initiatedBy: 'user@example.com',
        reason: 'Valid reason',
        currentState: IssueState.HOLD,
        targetState: IssueState.IMPLEMENTING,
      };

      const errors = validateManualActionContext(context);

      expect(errors).toHaveLength(0);
    });
  });

  describe('getHumanInterventionPolicyDescription', () => {
    test('should return policy description', () => {
      const description = getHumanInterventionPolicyDescription();

      expect(description).toContain('Human Intervention Policy');
      expect(description).toContain('Issue A3');
      expect(description).toContain('HOLD');
      expect(description).toContain('HUMAN_REQUIRED');
      expect(description).toContain('FORBIDDEN');
    });

    test('should mention allowed circumstances', () => {
      const description = getHumanInterventionPolicyDescription();

      expect(description).toContain('Issue State = HOLD');
      expect(description).toContain('Issue State = KILLED');
      expect(description).toContain('Verdict Action = HUMAN_REQUIRED');
    });

    test('should provide examples of forbidden actions', () => {
      const description = getHumanInterventionPolicyDescription();

      expect(description).toContain('IMPLEMENTING to VERIFIED');
      expect(description).toContain('VERIFIED to MERGE_READY');
    });
  });

  describe('Integration Scenarios', () => {
    test('Scenario: User tries to manually advance from IMPLEMENTING to VERIFIED', () => {
      // This should be blocked
      const result = checkManualStateTransition(
        IssueState.IMPLEMENTING,
        IssueState.VERIFIED,
        'developer@example.com',
        'I think the tests will pass'
      );

      expect(result.allowed).toBe(false);
      expect(result.suggestions).toContain('Transition to VERIFIED must be automatic based on guardrails');
    });

    test('Scenario: User puts issue on HOLD for manual review', () => {
      // This should be allowed
      const result = checkManualStateTransition(
        IssueState.IMPLEMENTING,
        IssueState.HOLD,
        'developer@example.com',
        'Need to review architecture decisions'
      );

      expect(result.allowed).toBe(true);
    });

    test('Scenario: User resumes issue from HOLD', () => {
      // This should be allowed
      const result = checkManualStateTransition(
        IssueState.HOLD,
        IssueState.IMPLEMENTING,
        'developer@example.com',
        'Architecture review complete, resuming work'
      );

      expect(result.allowed).toBe(true);
    });

    test('Scenario: Verdict requires human intervention', () => {
      // This should be allowed even in intermediate state
      const context: HumanInterventionContext = {
        currentState: IssueState.IMPLEMENTING,
        verdictAction: 'HUMAN_REQUIRED',
        isManualAction: true,
        initiatedBy: 'operator@example.com',
        reason: 'DNS delegation requires manual configuration',
      };

      const result = checkHumanInterventionPolicy(context);

      expect(result.allowed).toBe(true);
    });

    test('Scenario: Automatic transition proceeds without restrictions', () => {
      // All automatic transitions should be allowed
      const context: HumanInterventionContext = {
        currentState: IssueState.IMPLEMENTING,
        targetState: IssueState.VERIFIED,
        isManualAction: false,
      };

      const result = checkHumanInterventionPolicy(context);

      expect(result.allowed).toBe(true);
    });

    test('Scenario: User kills an issue', () => {
      // Should be allowed from any state
      const result = checkManualStateTransition(
        IssueState.IMPLEMENTING,
        IssueState.KILLED,
        'manager@example.com',
        'Requirements changed, no longer needed'
      );

      expect(result.allowed).toBe(true);
    });
  });
});
