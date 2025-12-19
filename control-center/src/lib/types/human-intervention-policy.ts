/**
 * Human Intervention Policy
 * 
 * Issue A3: Formal constraints on human touchpoints
 * 
 * This module defines and enforces the policy that humans may only
 * intervene in specific, controlled circumstances:
 * - HOLD state (issue is paused, can be resumed manually)
 * - KILLED state (issue is cancelled, terminal state)
 * - HUMAN_REQUIRED verdict (specific action from verdict engine)
 * 
 * No informal intervention in intermediate states is allowed.
 */

import { IssueState } from './issue-state';
import { FactoryAction } from '@codefactory/deploy-memory';

/**
 * States where human intervention is explicitly allowed
 */
export const HUMAN_INTERVENTION_ALLOWED_STATES: readonly IssueState[] = [
  IssueState.HOLD,
  IssueState.KILLED, // Terminal state, can intervene if issue was killed
] as const;

/**
 * Verdict actions that require/allow human intervention
 */
export const HUMAN_INTERVENTION_REQUIRED_ACTIONS: readonly FactoryAction[] = [
  'HUMAN_REQUIRED',
] as const;

/**
 * Context for evaluating human intervention
 */
export interface HumanInterventionContext {
  /** Current issue state */
  currentState?: IssueState;
  
  /** Target state for manual transition */
  targetState?: IssueState;
  
  /** Verdict action if available */
  verdictAction?: FactoryAction;
  
  /** Whether this is a manual action initiated by a human */
  isManualAction: boolean;
  
  /** User initiating the action */
  initiatedBy?: string;
  
  /** Reason for intervention (required for manual actions) */
  reason?: string;
}

/**
 * Result of human intervention policy check
 */
export interface HumanInterventionPolicyResult {
  /** Whether human intervention is allowed */
  allowed: boolean;
  
  /** Reason for the decision */
  reason: string;
  
  /** Policy rule that applies */
  policyRule: string;
  
  /** Specific violation if not allowed */
  violation?: string;
  
  /** Suggested alternatives if intervention is blocked */
  suggestions?: string[];
}

/**
 * Check if human intervention is allowed in current state
 * 
 * Policy rules:
 * 1. Automatic actions (isManualAction=false) are always allowed
 * 2. Manual actions are only allowed when:
 *    a) Current state is HOLD or KILLED, OR
 *    b) Verdict action is HUMAN_REQUIRED
 * 3. Manual transitions between intermediate states are forbidden
 * 
 * @param context - Context for the intervention check
 * @returns Policy check result
 */
export function checkHumanInterventionPolicy(
  context: HumanInterventionContext
): HumanInterventionPolicyResult {
  // Rule 1: Automatic actions are always allowed
  if (!context.isManualAction) {
    return {
      allowed: true,
      reason: 'Automatic action - no human intervention restrictions apply',
      policyRule: 'RULE_1_AUTOMATIC_ACTIONS_ALLOWED',
    };
  }
  
  // For manual actions, check if intervention is allowed
  const { currentState, verdictAction } = context;
  
  // Rule 2a: Manual intervention allowed in HOLD or KILLED states
  if (currentState && HUMAN_INTERVENTION_ALLOWED_STATES.includes(currentState)) {
    return {
      allowed: true,
      reason: `Manual intervention allowed - current state is ${currentState}`,
      policyRule: 'RULE_2A_ALLOWED_STATE',
    };
  }
  
  // Rule 2b: Manual intervention allowed when verdict requires it
  if (verdictAction && HUMAN_INTERVENTION_REQUIRED_ACTIONS.includes(verdictAction)) {
    return {
      allowed: true,
      reason: `Manual intervention required - verdict action is ${verdictAction}`,
      policyRule: 'RULE_2B_VERDICT_REQUIRES_HUMAN',
    };
  }
  
  // Rule 3: Manual intervention in intermediate states is forbidden
  const violation = currentState
    ? `Manual intervention not allowed in state ${currentState}`
    : 'Manual intervention not allowed without explicit authorization';
  
  const suggestions = [
    'Use automatic state transitions with guardrails',
    'Put issue on HOLD if manual review is needed',
    'Wait for verdict to require human intervention',
  ];
  
  if (context.targetState) {
    suggestions.push(`Transition to ${context.targetState} can only be automatic`);
  }
  
  return {
    allowed: false,
    reason: 'Manual intervention policy violation - not in authorized state',
    policyRule: 'RULE_3_INTERMEDIATE_STATE_BLOCKED',
    violation,
    suggestions,
  };
}

/**
 * Check if a manual state transition is allowed
 * 
 * This is a specialized check for manual state transitions.
 * 
 * @param fromState - Current state
 * @param toState - Target state
 * @param initiatedBy - User initiating the transition
 * @param reason - Reason for manual transition
 * @returns Policy check result
 */
export function checkManualStateTransition(
  fromState: IssueState,
  toState: IssueState,
  initiatedBy: string,
  reason?: string
): HumanInterventionPolicyResult {
  // Transitioning FROM HOLD is allowed (resuming work)
  if (fromState === IssueState.HOLD) {
    return {
      allowed: true,
      reason: 'Manual transition from HOLD is allowed to resume work',
      policyRule: 'RULE_TRANSITION_FROM_HOLD',
    };
  }
  
  // Transitioning TO HOLD or KILLED is always allowed (putting issue on hold/killing it)
  if (toState === IssueState.HOLD || toState === IssueState.KILLED) {
    return {
      allowed: true,
      reason: `Manual transition to ${toState} is always allowed`,
      policyRule: 'RULE_TRANSITION_TO_HOLD_OR_KILLED',
    };
  }
  
  // All other manual transitions are forbidden
  return {
    allowed: false,
    reason: `Manual transition from ${fromState} to ${toState} is not allowed`,
    policyRule: 'RULE_INTERMEDIATE_TRANSITION_BLOCKED',
    violation: `Manual transition between intermediate states (${fromState} → ${toState}) violates policy`,
    suggestions: [
      `Transition to ${toState} must be automatic based on guardrails`,
      'Put issue on HOLD if manual intervention is needed',
      'Use automatic state transitions with validation rules',
    ],
  };
}

/**
 * Validate that a manual action includes required context
 * 
 * @param context - Human intervention context
 * @returns Validation errors, empty array if valid
 */
export function validateManualActionContext(
  context: HumanInterventionContext
): string[] {
  const errors: string[] = [];
  
  if (!context.isManualAction) {
    return errors; // Only validate manual actions
  }
  
  if (!context.initiatedBy) {
    errors.push('Manual action must include initiatedBy (user identification)');
  }
  
  if (!context.reason) {
    errors.push('Manual action must include reason for intervention');
  }
  
  if (context.targetState && !context.currentState) {
    errors.push('Manual state transition must include currentState');
  }
  
  return errors;
}

/**
 * Get human-readable description of the policy
 */
export function getHumanInterventionPolicyDescription(): string {
  return `
Human Intervention Policy (Issue A3):

Humans may ONLY intervene in the following circumstances:

1. Issue State = HOLD
   - Can manually resume, modify, or transition out of HOLD
   - HOLD is the designated state for human review/intervention

2. Issue State = KILLED  
   - Can manually kill an issue at any time
   - Terminal state requiring human decision

3. Verdict Action = HUMAN_REQUIRED
   - System explicitly requires human intervention
   - Triggered by verdict engine for specific error classes

All other manual interventions in intermediate states are FORBIDDEN.
State transitions must occur automatically based on validation rules (guardrails).

Examples of FORBIDDEN actions:
- Manually advancing from IMPLEMENTING to VERIFIED (must pass QA automatically)
- Manually advancing from VERIFIED to MERGE_READY (must pass merge checks automatically)
- Manually modifying state without proper authorization

To intervene in an intermediate state, first transition to HOLD.
`.trim();
}
