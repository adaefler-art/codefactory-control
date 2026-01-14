/**
 * State Flow Computation
 * E85.3: UI: State Flow Viewer
 * 
 * Computes state flow data for an issue:
 * - Current state
 * - Valid next states (based on E85.1 spec)
 * - Blocking reasons (missing checks, reviews, guardrails)
 */

import { loadStateMachineSpec, getTransition, checkPreconditions } from './state-machine/loader';
import type { StateMachineSpec } from './state-machine/loader';

export interface BlockingReason {
  type: 'missing_check' | 'missing_review' | 'guardrail' | 'precondition';
  description: string;
  details?: string;
}

export interface NextState {
  state: string;
  enabled: boolean;
  transitionType: string;
  description: string;
  blockingReasons: BlockingReason[];
}

export interface StateFlowData {
  currentState: string;
  isTerminal: boolean;
  nextStates: NextState[];
  canTransition: boolean;
}

/**
 * Compute state flow data for an issue
 * 
 * @param currentStatus - Current AFU-9 status
 * @param evidence - Evidence data (CI status, reviews, etc.)
 * @returns State flow data
 */
export function computeStateFlow(
  currentStatus: string,
  evidence: {
    hasCode?: boolean;
    testsPass?: boolean;
    reviewApproved?: boolean;
    ciChecksPass?: boolean;
    noMergeConflicts?: boolean;
    prMerged?: boolean;
    specificationComplete?: boolean;
    reasonProvided?: boolean;
  } = {}
): StateFlowData {
  let spec: StateMachineSpec;
  
  try {
    spec = loadStateMachineSpec();
  } catch (error) {
    console.error('[computeStateFlow] Failed to load state machine spec:', error);
    // Fallback to minimal state flow
    return {
      currentState: currentStatus,
      isTerminal: ['DONE', 'KILLED'].includes(currentStatus),
      nextStates: [],
      canTransition: false,
    };
  }

  const currentState = spec.states.get(currentStatus);
  if (!currentState) {
    return {
      currentState: currentStatus,
      isTerminal: false,
      nextStates: [],
      canTransition: false,
    };
  }

  // Check if current state is terminal
  const isTerminal = currentState.terminal;

  // Get valid next states
  const successors = currentState.successors || [];
  const nextStates: NextState[] = [];

  for (const nextState of successors) {
    const transition = getTransition(spec, currentStatus, nextState);
    if (!transition) {
      // No specific transition defined, but it's in successors
      nextStates.push({
        state: nextState,
        enabled: true,
        transitionType: 'FORWARD',
        description: `Transition to ${nextState}`,
        blockingReasons: [],
      });
      continue;
    }

    // Check preconditions
    const evidenceMap: Record<string, boolean> = {
      code_committed: evidence.hasCode || false,
      tests_pass: evidence.testsPass || false,
      code_review_approved: evidence.reviewApproved || false,
      ci_checks_pass: evidence.ciChecksPass || false,
      no_merge_conflicts: evidence.noMergeConflicts || false,
      pr_merged: evidence.prMerged || false,
      specification_exists: evidence.specificationComplete || false,
      reason_provided: evidence.reasonProvided || false,
    };

    const preconditionCheck = checkPreconditions(transition, evidenceMap);
    const blockingReasons: BlockingReason[] = [];

    // Convert missing preconditions to blocking reasons
    for (const missing of preconditionCheck.missing) {
      let description = '';
      let type: BlockingReason['type'] = 'precondition';

      switch (missing) {
        case 'tests_pass':
          description = 'Tests must pass';
          type = 'missing_check';
          break;
        case 'ci_checks_pass':
          description = 'CI checks must pass';
          type = 'missing_check';
          break;
        case 'code_review_approved':
          description = 'Code review must be approved';
          type = 'missing_review';
          break;
        case 'pr_merged':
          description = 'PR must be merged';
          type = 'guardrail';
          break;
        case 'specification_exists':
          description = 'Specification must be complete';
          type = 'precondition';
          break;
        case 'no_merge_conflicts':
          description = 'No merge conflicts allowed';
          type = 'guardrail';
          break;
        default:
          description = `Missing: ${missing.replace(/_/g, ' ')}`;
          type = 'precondition';
      }

      blockingReasons.push({ type, description });
    }

    nextStates.push({
      state: nextState,
      enabled: preconditionCheck.met,
      transitionType: transition.type,
      description: transition.description,
      blockingReasons,
    });
  }

  return {
    currentState: currentStatus,
    isTerminal,
    nextStates,
    canTransition: nextStates.some(ns => ns.enabled),
  };
}

/**
 * Get blocking reasons for why an issue is not DONE
 * 
 * @param currentStatus - Current AFU-9 status
 * @param evidence - Evidence data
 * @returns List of reasons why issue is not DONE
 */
export function getBlockersForDone(
  currentStatus: string,
  evidence: {
    hasCode?: boolean;
    testsPass?: boolean;
    reviewApproved?: boolean;
    ciChecksPass?: boolean;
    noMergeConflicts?: boolean;
    prMerged?: boolean;
  } = {}
): BlockingReason[] {
  if (currentStatus === 'DONE') {
    return [];
  }

  const blockers: BlockingReason[] = [];

  // Based on E85.1 spec, to reach DONE:
  // MERGE_READY → DONE requires PR merged + CI green
  
  if (currentStatus !== 'MERGE_READY') {
    blockers.push({
      type: 'precondition',
      description: `Issue must reach MERGE_READY state (currently ${currentStatus})`,
    });
  }

  if (!evidence.prMerged) {
    blockers.push({
      type: 'guardrail',
      description: 'PR must be merged',
    });
  }

  if (!evidence.ciChecksPass) {
    blockers.push({
      type: 'missing_check',
      description: 'CI checks must pass on main branch',
    });
  }

  return blockers;
}
