/**
 * Deploy Event Contract Schema
 * 
 * Defines the contract for deploy_events table writes.
 * Ensures schema ↔ writer ↔ payload synchronization.
 * 
 * MUST be kept in sync with database/migrations/013_deploy_events.sql
 */

/**
 * Deploy Event Input Contract
 * Represents the required and optional fields for creating a deploy event
 */
export interface DeployEventInput {
  env: string;
  service: string;
  version: string;
  commit_hash: string;
  status: string;
  message?: string | null;
}

/**
 * Deploy Event Row Contract
 * Represents a row from the deploy_events table
 */
export interface DeployEventRow {
  id: string;
  created_at: string;
  env: string;
  service: string;
  version: string;
  commit_hash: string;
  status: string;
  message: string | null;
}

/**
 * Field length constraints (matches DB schema)
 */
export const DEPLOY_EVENT_CONSTRAINTS = {
  env: 32,
  service: 64,
  version: 64,
  commit_hash: 64,
  status: 32,
  message: 2000,
} as const;

/**
 * Validation error type
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validates a deploy event input against the contract
 * 
 * @param input - The input to validate
 * @returns ValidationResult with errors if any
 */
export function validateDeployEventInput(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'input', message: 'Input must be an object' }],
    };
  }

  const data = input as Record<string, unknown>;

  // Validate required fields
  const requiredFields: Array<keyof DeployEventInput> = [
    'env',
    'service',
    'version',
    'commit_hash',
    'status',
  ];

  for (const field of requiredFields) {
    const value = data[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push({
        field,
        message: `${field} is required and must be a non-empty string`,
      });
    }
  }

  // If required fields are missing, return early
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Validate field lengths
  const env = data.env as string;
  const service = data.service as string;
  const version = data.version as string;
  const commit_hash = data.commit_hash as string;
  const status = data.status as string;

  if (env.length > DEPLOY_EVENT_CONSTRAINTS.env) {
    errors.push({
      field: 'env',
      message: `env exceeds maximum length of ${DEPLOY_EVENT_CONSTRAINTS.env}`,
    });
  }

  if (service.length > DEPLOY_EVENT_CONSTRAINTS.service) {
    errors.push({
      field: 'service',
      message: `service exceeds maximum length of ${DEPLOY_EVENT_CONSTRAINTS.service}`,
    });
  }

  if (version.length > DEPLOY_EVENT_CONSTRAINTS.version) {
    errors.push({
      field: 'version',
      message: `version exceeds maximum length of ${DEPLOY_EVENT_CONSTRAINTS.version}`,
    });
  }

  if (commit_hash.length > DEPLOY_EVENT_CONSTRAINTS.commit_hash) {
    errors.push({
      field: 'commit_hash',
      message: `commit_hash exceeds maximum length of ${DEPLOY_EVENT_CONSTRAINTS.commit_hash}`,
    });
  }

  if (status.length > DEPLOY_EVENT_CONSTRAINTS.status) {
    errors.push({
      field: 'status',
      message: `status exceeds maximum length of ${DEPLOY_EVENT_CONSTRAINTS.status}`,
    });
  }

  // Validate optional message field
  if (data.message !== undefined && data.message !== null) {
    if (typeof data.message !== 'string') {
      errors.push({
        field: 'message',
        message: 'message must be a string if provided',
      });
    } else if (data.message.length > DEPLOY_EVENT_CONSTRAINTS.message) {
      errors.push({
        field: 'message',
        message: `message exceeds maximum length of ${DEPLOY_EVENT_CONSTRAINTS.message}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Sanitizes and normalizes deploy event input
 * Trims whitespace and clamps to max lengths
 * 
 * @param input - The validated input (must have passed validation)
 * @returns Sanitized DeployEventInput
 * @throws Error if input has not been validated (null/undefined fields)
 */
export function sanitizeDeployEventInput(input: DeployEventInput): DeployEventInput {
  // Ensure required fields are present (should have been validated)
  if (!input.env || !input.service || !input.version || !input.commit_hash || !input.status) {
    throw new Error('Input must be validated before sanitization');
  }

  return {
    env: input.env.trim().slice(0, DEPLOY_EVENT_CONSTRAINTS.env),
    service: input.service.trim().slice(0, DEPLOY_EVENT_CONSTRAINTS.service),
    version: input.version.trim().slice(0, DEPLOY_EVENT_CONSTRAINTS.version),
    commit_hash: input.commit_hash.trim().slice(0, DEPLOY_EVENT_CONSTRAINTS.commit_hash),
    status: input.status.trim().slice(0, DEPLOY_EVENT_CONSTRAINTS.status),
    message:
      input.message === undefined || input.message === null
        ? null
        : input.message.trim().slice(0, DEPLOY_EVENT_CONSTRAINTS.message),
  };
}
