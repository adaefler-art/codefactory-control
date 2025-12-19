/**
 * State Transition Guardrails
 * 
 * Implements automatic, rule-based state transitions with validation guards.
 * Issue A2: Automatische State-Transitions (Guardrails)
 * 
 * Key Principles:
 * - No manual "Continue" button clicks
 * - State transitions only occur when validation rules pass
 * - Each critical state has specific entry criteria
 * 
 * Guarded Transitions:
 * - CREATED → SPEC_READY: Only when specification is valid and complete
 * - IMPLEMENTING → VERIFIED: Only when QA tests pass (green)
 * - VERIFIED → MERGE_READY: Only when diff-gate criteria are met
 */

import { IssueState, isValidTransition } from './types/issue-state';
import { logger } from './logger';

/**
 * Context for state transition validation
 */
export interface StateTransitionContext {
  /** Issue metadata */
  issue?: {
    number: number;
    title?: string;
    body?: string;
    labels?: string[];
  };
  
  /** Specification data */
  specification?: {
    exists: boolean;
    isComplete: boolean;
    hasRequirements: boolean;
    hasAcceptanceCriteria: boolean;
    validated?: boolean;
  };
  
  /** QA test results */
  qaResults?: {
    executed: boolean;
    passed: boolean;
    testCount?: number;
    passedCount?: number;
    failedCount?: number;
    coveragePercent?: number;
  };
  
  /** Diff/merge criteria */
  diffGate?: {
    hasChanges: boolean;
    changeCount?: number;
    conflictsResolved: boolean;
    reviewsApproved: boolean;
    ciPassing: boolean;
    securityChecksPassed?: boolean;
  };
  
  /** Pull request information */
  pullRequest?: {
    number: number;
    state: string;
    mergeable: boolean;
    reviewsCount?: number;
    approvalsCount?: number;
  };
  
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Result of a guardrail validation
 */
export interface GuardrailValidationResult {
  /** Whether the transition is allowed */
  allowed: boolean;
  
  /** Human-readable reason for the decision */
  reason: string;
  
  /** List of conditions checked */
  conditions: {
    name: string;
    passed: boolean;
    message: string;
  }[];
  
  /** Suggested actions if not allowed */
  suggestions?: string[];
}

/**
 * Validate transition to SPEC_READY state
 * 
 * Requirements:
 * - Specification must exist
 * - Specification must be complete
 * - Must have requirements defined
 * - Must have acceptance criteria defined
 */
export function validateSpecReadyTransition(
  context: StateTransitionContext
): GuardrailValidationResult {
  const conditions: GuardrailValidationResult['conditions'] = [];
  const suggestions: string[] = [];
  
  // Check if specification exists
  const specExists = context.specification?.exists ?? false;
  conditions.push({
    name: 'specification_exists',
    passed: specExists,
    message: specExists 
      ? 'Specification document exists'
      : 'Specification document is missing',
  });
  
  if (!specExists) {
    suggestions.push('Create a specification document');
  }
  
  // Check if specification is complete
  const specComplete = context.specification?.isComplete ?? false;
  conditions.push({
    name: 'specification_complete',
    passed: specComplete,
    message: specComplete
      ? 'Specification is marked as complete'
      : 'Specification is incomplete',
  });
  
  if (!specComplete) {
    suggestions.push('Complete all sections of the specification');
  }
  
  // Check if requirements are defined
  const hasRequirements = context.specification?.hasRequirements ?? false;
  conditions.push({
    name: 'has_requirements',
    passed: hasRequirements,
    message: hasRequirements
      ? 'Requirements are defined'
      : 'Requirements are not defined',
  });
  
  if (!hasRequirements) {
    suggestions.push('Define clear requirements in the specification');
  }
  
  // Check if acceptance criteria are defined
  const hasAcceptanceCriteria = context.specification?.hasAcceptanceCriteria ?? false;
  conditions.push({
    name: 'has_acceptance_criteria',
    passed: hasAcceptanceCriteria,
    message: hasAcceptanceCriteria
      ? 'Acceptance criteria are defined'
      : 'Acceptance criteria are not defined',
  });
  
  if (!hasAcceptanceCriteria) {
    suggestions.push('Define acceptance criteria for the implementation');
  }
  
  // All conditions must pass
  const allPassed = conditions.every(c => c.passed);
  
  return {
    allowed: allPassed,
    reason: allPassed
      ? 'All specification requirements met'
      : 'Specification validation failed: missing required elements',
    conditions,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

/**
 * Validate transition to VERIFIED state
 * 
 * Requirements:
 * - QA tests must have been executed
 * - All QA tests must pass (green)
 * - Minimum test coverage should be met (if specified)
 */
export function validateVerifiedTransition(
  context: StateTransitionContext
): GuardrailValidationResult {
  const conditions: GuardrailValidationResult['conditions'] = [];
  const suggestions: string[] = [];
  
  // Check if QA tests were executed
  const testsExecuted = context.qaResults?.executed ?? false;
  conditions.push({
    name: 'tests_executed',
    passed: testsExecuted,
    message: testsExecuted
      ? 'QA tests have been executed'
      : 'QA tests have not been executed',
  });
  
  if (!testsExecuted) {
    suggestions.push('Run QA test suite');
  }
  
  // Check if all tests passed
  const testsPassed = context.qaResults?.passed ?? false;
  conditions.push({
    name: 'tests_passed',
    passed: testsPassed,
    message: testsPassed
      ? 'All QA tests passed (green)'
      : 'Some QA tests failed (red)',
  });
  
  if (!testsPassed) {
    const failed = context.qaResults?.failedCount ?? 0;
    suggestions.push(`Fix ${failed} failing test${failed !== 1 ? 's' : ''}`);
  }
  
  // Check test coverage if available
  const coveragePercent = context.qaResults?.coveragePercent;
  if (coveragePercent !== undefined) {
    const minCoverage = 70; // Minimum 70% coverage
    const coverageMet = coveragePercent >= minCoverage;
    conditions.push({
      name: 'test_coverage',
      passed: coverageMet,
      message: coverageMet
        ? `Test coverage is ${coveragePercent}% (>= ${minCoverage}%)`
        : `Test coverage is ${coveragePercent}% (< ${minCoverage}%)`,
    });
    
    if (!coverageMet) {
      suggestions.push(`Increase test coverage to at least ${minCoverage}%`);
    }
  }
  
  // All conditions must pass
  const allPassed = conditions.every(c => c.passed);
  
  return {
    allowed: allPassed,
    reason: allPassed
      ? 'All QA requirements met'
      : 'QA validation failed: tests not passing',
    conditions,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

/**
 * Validate transition to MERGE_READY state
 * 
 * Requirements:
 * - Must have changes to merge
 * - No unresolved merge conflicts
 * - Required reviews must be approved
 * - CI pipeline must be passing
 * - Security checks must pass
 */
export function validateMergeReadyTransition(
  context: StateTransitionContext
): GuardrailValidationResult {
  const conditions: GuardrailValidationResult['conditions'] = [];
  const suggestions: string[] = [];
  
  // Check if there are changes to merge
  const hasChanges = context.diffGate?.hasChanges ?? false;
  conditions.push({
    name: 'has_changes',
    passed: hasChanges,
    message: hasChanges
      ? 'Changes are present for merge'
      : 'No changes to merge',
  });
  
  if (!hasChanges) {
    suggestions.push('Commit changes to the branch');
  }
  
  // Check if merge conflicts are resolved
  const conflictsResolved = context.diffGate?.conflictsResolved ?? false;
  conditions.push({
    name: 'conflicts_resolved',
    passed: conflictsResolved,
    message: conflictsResolved
      ? 'No merge conflicts'
      : 'Merge conflicts must be resolved',
  });
  
  if (!conflictsResolved) {
    suggestions.push('Resolve all merge conflicts');
  }
  
  // Check if reviews are approved
  const reviewsApproved = context.diffGate?.reviewsApproved ?? false;
  conditions.push({
    name: 'reviews_approved',
    passed: reviewsApproved,
    message: reviewsApproved
      ? 'Required reviews approved'
      : 'Awaiting review approvals',
  });
  
  if (!reviewsApproved) {
    suggestions.push('Obtain required code review approvals');
  }
  
  // Check if CI is passing
  const ciPassing = context.diffGate?.ciPassing ?? false;
  conditions.push({
    name: 'ci_passing',
    passed: ciPassing,
    message: ciPassing
      ? 'CI pipeline is passing'
      : 'CI pipeline has failures',
  });
  
  if (!ciPassing) {
    suggestions.push('Fix CI pipeline failures');
  }
  
  // Check security checks if available
  const securityPassed = context.diffGate?.securityChecksPassed;
  if (securityPassed !== undefined) {
    conditions.push({
      name: 'security_checks',
      passed: securityPassed,
      message: securityPassed
        ? 'Security checks passed'
        : 'Security checks failed',
    });
    
    if (!securityPassed) {
      suggestions.push('Address security vulnerabilities');
    }
  }
  
  // All conditions must pass
  const allPassed = conditions.every(c => c.passed);
  
  return {
    allowed: allPassed,
    reason: allPassed
      ? 'All merge requirements met'
      : 'Merge gate validation failed: requirements not met',
    conditions,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

/**
 * Validate any state transition with appropriate guardrails
 * 
 * Returns validation result based on target state and context
 */
export function validateStateTransition(
  fromState: IssueState,
  toState: IssueState,
  context: StateTransitionContext
): GuardrailValidationResult {
  // First check if the transition is valid in the state machine
  if (!isValidTransition(fromState, toState)) {
    return {
      allowed: false,
      reason: `Invalid state transition: ${fromState} → ${toState} is not allowed by the state machine`,
      conditions: [{
        name: 'valid_transition',
        passed: false,
        message: `Transition from ${fromState} to ${toState} is not defined`,
      }],
      suggestions: [`Check valid transitions from ${fromState} state`],
    };
  }
  
  // Apply guardrails based on target state
  let validationResult: GuardrailValidationResult;
  
  switch (toState) {
    case IssueState.SPEC_READY:
      validationResult = validateSpecReadyTransition(context);
      break;
      
    case IssueState.VERIFIED:
      validationResult = validateVerifiedTransition(context);
      break;
      
    case IssueState.MERGE_READY:
      validationResult = validateMergeReadyTransition(context);
      break;
      
    default:
      // No specific guardrails for other states
      validationResult = {
        allowed: true,
        reason: `No specific guardrails for transition to ${toState}`,
        conditions: [{
          name: 'state_machine_valid',
          passed: true,
          message: 'Transition is valid in state machine',
        }],
      };
  }
  
  // Log validation attempt
  logger.debug('State transition validation', {
    fromState,
    toState,
    allowed: validationResult.allowed,
    reason: validationResult.reason,
    conditionsPassed: validationResult.conditions.filter(c => c.passed).length,
    conditionsTotal: validationResult.conditions.length,
  }, 'StateTransitionGuardrails');
  
  return validationResult;
}

/**
 * Attempt to automatically transition state if guardrails pass
 * 
 * This function evaluates guardrails and returns whether the transition
 * should be performed. The actual state update must be done by the caller.
 * 
 * @returns Object with allowed flag and validation details
 */
export function attemptAutomaticTransition(
  fromState: IssueState,
  toState: IssueState,
  context: StateTransitionContext
): GuardrailValidationResult & { shouldTransition: boolean } {
  const validation = validateStateTransition(fromState, toState, context);
  
  logger.info('Automatic state transition attempt', {
    fromState,
    toState,
    allowed: validation.allowed,
    reason: validation.reason,
  }, 'StateTransitionGuardrails');
  
  return {
    ...validation,
    shouldTransition: validation.allowed,
  };
}

/**
 * Check if issue can automatically progress to next state
 * 
 * Evaluates the current state and context to determine if automatic
 * progression is possible and what the next state should be.
 */
export function evaluateNextStateProgression(
  currentState: IssueState,
  context: StateTransitionContext
): {
  canProgress: boolean;
  nextState?: IssueState;
  validation?: GuardrailValidationResult;
} {
  // Define natural progression path
  const progressionMap: Record<IssueState, IssueState | undefined> = {
    [IssueState.CREATED]: IssueState.SPEC_READY,
    [IssueState.SPEC_READY]: IssueState.IMPLEMENTING,
    [IssueState.IMPLEMENTING]: IssueState.VERIFIED,
    [IssueState.VERIFIED]: IssueState.MERGE_READY,
    [IssueState.MERGE_READY]: IssueState.DONE,
    [IssueState.DONE]: undefined,
    [IssueState.HOLD]: undefined,
    [IssueState.KILLED]: undefined,
  };
  
  const nextState = progressionMap[currentState];
  
  if (!nextState) {
    return {
      canProgress: false,
    };
  }
  
  // Validate if we can progress to the next state
  const validation = validateStateTransition(currentState, nextState, context);
  
  return {
    canProgress: validation.allowed,
    nextState: validation.allowed ? nextState : undefined,
    validation,
  };
}
