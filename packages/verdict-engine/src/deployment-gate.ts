/**
 * AFU-9 Deployment Gate
 * 
 * Issue B3: Verdict als Gate vor Deploy
 * 
 * Implements deployment gating logic to ensure:
 * - No deployment without GREEN verdict
 * - ECS/Diff/Health provide inputs but don't decide
 * - Manual deploy without GREEN is impossible
 */

import { VerdictType, SimpleVerdict, Verdict } from './types';
import { toSimpleVerdict, getSimpleAction } from './engine';
import { SimpleAction } from './types';

/**
 * Result of a deployment gate check
 */
export interface DeploymentGateResult {
  /**
   * Whether the deployment should be allowed to proceed
   */
  allowed: boolean;
  
  /**
   * Verdict that was evaluated
   */
  verdict: SimpleVerdict;
  
  /**
   * Action that corresponds to the verdict
   */
  action: SimpleAction;
  
  /**
   * Human-readable reason for the decision
   */
  reason: string;
  
  /**
   * Original verdict type (before conversion to SimpleVerdict)
   */
  originalVerdictType?: VerdictType;
}

/**
 * Check if a deployment should be allowed based on the verdict
 * 
 * Issue B3: Deployment Gate
 * - Only GREEN verdicts allow deployment
 * - RED, HOLD, RETRY verdicts block deployment
 * - Clear error messages explain why deployment is blocked
 * 
 * @param verdict The verdict to check (can be VerdictType, SimpleVerdict, or full Verdict object)
 * @returns DeploymentGateResult indicating whether deployment is allowed
 * 
 * @example
 * // With SimpleVerdict
 * const result = checkDeploymentGate(SimpleVerdict.GREEN);
 * if (result.allowed) {
 *   await deployToProduction();
 * }
 * 
 * @example
 * // With VerdictType
 * const result = checkDeploymentGate(VerdictType.APPROVED);
 * if (!result.allowed) {
 *   console.error(result.reason);
 * }
 * 
 * @example
 * // With full Verdict object
 * const verdict = generateVerdict({ ... });
 * const result = checkDeploymentGate(verdict);
 */
export function checkDeploymentGate(
  verdict: SimpleVerdict | VerdictType | Verdict
): DeploymentGateResult {
  let simpleVerdict: SimpleVerdict;
  let originalVerdictType: VerdictType | undefined;
  
  // Convert input to SimpleVerdict
  if (typeof verdict === 'string') {
    // Check if it's a SimpleVerdict
    if (Object.values(SimpleVerdict).includes(verdict as SimpleVerdict)) {
      simpleVerdict = verdict as SimpleVerdict;
    } else {
      // It's a VerdictType
      originalVerdictType = verdict as VerdictType;
      simpleVerdict = toSimpleVerdict(originalVerdictType);
    }
  } else {
    // It's a full Verdict object
    originalVerdictType = verdict.verdict_type;
    simpleVerdict = toSimpleVerdict(verdict.verdict_type);
  }
  
  // Get the action for this verdict
  const action = getSimpleAction(simpleVerdict);
  
  // Only GREEN verdicts allow deployment
  const allowed = simpleVerdict === SimpleVerdict.GREEN;
  
  // Generate reason based on verdict
  let reason: string;
  if (allowed) {
    reason = 'Deployment allowed: Verdict is GREEN (all checks passed)';
  } else {
    switch (simpleVerdict) {
      case SimpleVerdict.RED:
        reason = 'Deployment BLOCKED: Verdict is RED (critical failure detected). ' +
                 'Fix the issues and retry. Action required: ABORT';
        break;
      case SimpleVerdict.HOLD:
        reason = 'Deployment BLOCKED: Verdict is HOLD (requires human review). ' +
                 'Manual intervention needed before deployment can proceed. Action required: FREEZE';
        break;
      case SimpleVerdict.RETRY:
        reason = 'Deployment BLOCKED: Verdict is RETRY (transient condition detected). ' +
                 'Wait for conditions to stabilize and retry. Action required: RETRY_OPERATION';
        break;
      default:
        reason = `Deployment BLOCKED: Verdict is ${simpleVerdict} (not GREEN). ` +
                 'Only GREEN verdicts allow deployment.';
    }
  }
  
  return {
    allowed,
    verdict: simpleVerdict,
    action,
    reason,
    originalVerdictType,
  };
}

/**
 * Validate that a deployment can proceed, throwing an error if not
 * 
 * This is a convenience function that calls checkDeploymentGate and throws
 * an error if deployment is not allowed.
 * 
 * @param verdict The verdict to check
 * @throws Error if deployment is not allowed
 * 
 * @example
 * try {
 *   validateDeploymentGate(verdict);
 *   await deployToProduction();
 * } catch (error) {
 *   console.error('Deployment blocked:', error.message);
 * }
 */
export function validateDeploymentGate(
  verdict: SimpleVerdict | VerdictType | Verdict
): void {
  const result = checkDeploymentGate(verdict);
  
  if (!result.allowed) {
    throw new Error(
      `Deployment gate check failed: ${result.reason}\n` +
      `Verdict: ${result.verdict}\n` +
      `Action: ${result.action}`
    );
  }
}

/**
 * Check if a verdict allows deployment (convenience function)
 * 
 * Returns a simple boolean indicating whether deployment is allowed.
 * Use checkDeploymentGate() for detailed information about why deployment is blocked.
 * 
 * @param verdict The verdict to check
 * @returns true if deployment is allowed (verdict is GREEN), false otherwise
 * 
 * @example
 * if (isDeploymentAllowed(SimpleVerdict.GREEN)) {
 *   console.log('Deploying...');
 * }
 */
export function isDeploymentAllowed(
  verdict: SimpleVerdict | VerdictType | Verdict
): boolean {
  const result = checkDeploymentGate(verdict);
  return result.allowed;
}

/**
 * Get a human-readable deployment status message
 * 
 * @param verdict The verdict to check
 * @returns Status message suitable for logging or user display
 * 
 * @example
 * const status = getDeploymentStatus(verdict);
 * console.log(status);
 * // Output: "✅ Deployment allowed: Verdict is GREEN (all checks passed)"
 */
export function getDeploymentStatus(
  verdict: SimpleVerdict | VerdictType | Verdict
): string {
  const result = checkDeploymentGate(verdict);
  const icon = result.allowed ? '✅' : '❌';
  return `${icon} ${result.reason}`;
}
