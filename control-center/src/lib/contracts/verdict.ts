/**
 * Verdict Contract
 * 
 * I201.7: Verdict Endpoint + State Mapping (GREEN/HOLD/RED)
 * 
 * Defines verdict types and validation for the self-propelling state machine.
 */

/**
 * Verdict enum for issue state transitions
 */
export enum Verdict {
  GREEN = 'GREEN',
  RED = 'RED',
  HOLD = 'HOLD',
}

/**
 * Type guard for Verdict
 */
export function isValidVerdict(verdict: string): verdict is Verdict {
  return Object.values(Verdict).includes(verdict as Verdict);
}

/**
 * Verdict input for API requests
 */
export interface VerdictInput {
  verdict: Verdict;
}

/**
 * Validate verdict input
 */
export function validateVerdictInput(input: unknown): { valid: boolean; error?: string } {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Input must be an object' };
  }

  const data = input as Record<string, unknown>;

  if (!data.verdict || typeof data.verdict !== 'string') {
    return { valid: false, error: 'verdict is required and must be a string' };
  }

  if (!isValidVerdict(data.verdict)) {
    return {
      valid: false,
      error: `verdict must be one of: ${Object.values(Verdict).join(', ')}`,
    };
  }

  return { valid: true };
}
