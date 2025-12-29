/**
 * AFU9 Issue Contract Schema
 * 
 * Defines the contract for afu9_issues table operations.
 * Ensures schema <-> service <-> payload synchronization.
 * 
 * MUST be kept in sync with database/migrations/014_afu9_issues.sql
 */

/**
 * AFU9 Issue Status enum
 * Updated for E61.1: Canonical Issue State Machine
 */
export enum Afu9IssueStatus {
  CREATED = 'CREATED',
  SPEC_READY = 'SPEC_READY',
  IMPLEMENTING = 'IMPLEMENTING',
  VERIFIED = 'VERIFIED',
  MERGE_READY = 'MERGE_READY',
  DONE = 'DONE',
  HOLD = 'HOLD',
  KILLED = 'KILLED',
}

/**
 * AFU9 Issue Handoff State enum
 */
export enum Afu9HandoffState {
  NOT_SENT = 'NOT_SENT',
  SENT = 'SENT',
  SYNCED = 'SYNCED',
  FAILED = 'FAILED',
}

/**
 * AFU9 Issue Priority enum
 */
export enum Afu9IssuePriority {
  P0 = 'P0',
  P1 = 'P1',
  P2 = 'P2',
}

/**
 * AFU9 Issue Execution State enum
 */
export enum Afu9ExecutionState {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

/**
 * AFU9 Issue Input Contract
 * Represents the required and optional fields for creating/updating an issue
 */
export interface Afu9IssueInput {
  title: string;
  body?: string | null;
  status?: Afu9IssueStatus;
  labels?: string[];
  priority?: Afu9IssuePriority | null;
  assignee?: string | null;
  source?: string;
  handoff_state?: Afu9HandoffState;
  github_issue_number?: number | null;
  github_url?: string | null;
  last_error?: string | null;
  activated_at?: string | null;
  activated_by?: string | null;
  execution_state?: Afu9ExecutionState;
  execution_started_at?: string | null;
  execution_completed_at?: string | null;
  execution_output?: Record<string, unknown> | null;
  deleted_at?: string | null;
}

/**
 * AFU9 Issue Row Contract
 * Represents a row from the afu9_issues table
 */
export interface Afu9IssueRow {
  id: string;
  title: string;
  body: string | null;
  status: Afu9IssueStatus;
  labels: string[];
  priority: Afu9IssuePriority | null;
  assignee: string | null;
  source: string;
  handoff_state: Afu9HandoffState;
  github_issue_number: number | null;
  github_url: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
  activated_by: string | null;
  execution_state: Afu9ExecutionState;
  execution_started_at: string | null;
  execution_completed_at: string | null;
  execution_output: Record<string, unknown> | null;
  deleted_at: string | null;
}

/**
 * Field length constraints (matches DB schema)
 */
export const AFU9_ISSUE_CONSTRAINTS = {
  title: 500,
  assignee: 255,
  activated_by: 255,
  source: 50,
  github_url: 500,
  status: 50,
  handoff_state: 50,
  priority: 10,
  execution_state: 50,
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
 * Type guard for Afu9IssueStatus
 */
export function isValidStatus(status: string): status is Afu9IssueStatus {
  return Object.values(Afu9IssueStatus).includes(status as Afu9IssueStatus);
}

/**
 * Type guard for Afu9HandoffState
 */
export function isValidHandoffState(state: string): state is Afu9HandoffState {
  return Object.values(Afu9HandoffState).includes(state as Afu9HandoffState);
}

/**
 * Type guard for Afu9IssuePriority
 */
export function isValidPriority(priority: string): priority is Afu9IssuePriority {
  return Object.values(Afu9IssuePriority).includes(priority as Afu9IssuePriority);
}

/**
 * Type guard for Afu9ExecutionState
 */
export function isValidExecutionState(state: string): state is Afu9ExecutionState {
  return Object.values(Afu9ExecutionState).includes(state as Afu9ExecutionState);
}

/**
 * Validates an AFU9 issue input against the contract
 * 
 * @param input - The input to validate
 * @returns ValidationResult with errors if any
 */
export function validateAfu9IssueInput(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'input', message: 'Input must be an object' }],
    };
  }

  const data = input as Record<string, unknown>;

  // Validate required field: title
  if (typeof data.title !== 'string' || data.title.trim().length === 0) {
    errors.push({
      field: 'title',
      message: 'title is required and must be a non-empty string',
    });
  } else if (data.title.length > AFU9_ISSUE_CONSTRAINTS.title) {
    errors.push({
      field: 'title',
      message: `title exceeds maximum length of ${AFU9_ISSUE_CONSTRAINTS.title}`,
    });
  }

  // Validate optional field: body
  if (data.body !== undefined && data.body !== null) {
    if (typeof data.body !== 'string') {
      errors.push({
        field: 'body',
        message: 'body must be a string if provided',
      });
    }
  }

  // Validate optional field: status
  if (data.status !== undefined) {
    if (typeof data.status !== 'string' || !isValidStatus(data.status)) {
      errors.push({
        field: 'status',
        message: `status must be one of: ${Object.values(Afu9IssueStatus).join(', ')}`,
      });
    }
  }

  // Validate optional field: labels
  if (data.labels !== undefined) {
    if (!Array.isArray(data.labels)) {
      errors.push({
        field: 'labels',
        message: 'labels must be an array of strings',
      });
    } else if (!data.labels.every((label) => typeof label === 'string')) {
      errors.push({
        field: 'labels',
        message: 'all labels must be strings',
      });
    }
  }

  // Validate optional field: priority
  if (data.priority !== undefined && data.priority !== null) {
    if (typeof data.priority !== 'string' || !isValidPriority(data.priority)) {
      errors.push({
        field: 'priority',
        message: `priority must be one of: ${Object.values(Afu9IssuePriority).join(', ')}`,
      });
    }
  }

  // Validate optional field: assignee
  if (data.assignee !== undefined && data.assignee !== null) {
    if (typeof data.assignee !== 'string') {
      errors.push({
        field: 'assignee',
        message: 'assignee must be a string if provided',
      });
    } else if (data.assignee.length > AFU9_ISSUE_CONSTRAINTS.assignee) {
      errors.push({
        field: 'assignee',
        message: `assignee exceeds maximum length of ${AFU9_ISSUE_CONSTRAINTS.assignee}`,
      });
    }
  }

  // Validate optional field: source (should always be 'afu9' but validate if provided)
  if (data.source !== undefined) {
    if (typeof data.source !== 'string' || data.source !== 'afu9') {
      errors.push({
        field: 'source',
        message: 'source must be "afu9"',
      });
    }
  }

  // Validate optional field: handoff_state
  if (data.handoff_state !== undefined) {
    if (typeof data.handoff_state !== 'string' || !isValidHandoffState(data.handoff_state)) {
      errors.push({
        field: 'handoff_state',
        message: `handoff_state must be one of: ${Object.values(Afu9HandoffState).join(', ')}`,
      });
    }
  }

  // Validate optional field: github_issue_number
  if (data.github_issue_number !== undefined && data.github_issue_number !== null) {
    if (typeof data.github_issue_number !== 'number' || data.github_issue_number <= 0) {
      errors.push({
        field: 'github_issue_number',
        message: 'github_issue_number must be a positive number if provided',
      });
    }
  }

  // Validate optional field: github_url
  if (data.github_url !== undefined && data.github_url !== null) {
    if (typeof data.github_url !== 'string') {
      errors.push({
        field: 'github_url',
        message: 'github_url must be a string if provided',
      });
    } else if (data.github_url.length > AFU9_ISSUE_CONSTRAINTS.github_url) {
      errors.push({
        field: 'github_url',
        message: `github_url exceeds maximum length of ${AFU9_ISSUE_CONSTRAINTS.github_url}`,
      });
    }
  }

  // Validate optional field: last_error
  if (data.last_error !== undefined && data.last_error !== null) {
    if (typeof data.last_error !== 'string') {
      errors.push({
        field: 'last_error',
        message: 'last_error must be a string if provided',
      });
    }
  }

  // Validate optional field: execution_state
  if (data.execution_state !== undefined) {
    if (typeof data.execution_state !== 'string' || !isValidExecutionState(data.execution_state)) {
      errors.push({
        field: 'execution_state',
        message: `execution_state must be one of: ${Object.values(Afu9ExecutionState).join(', ')}`,
      });
    }
  }

  // Validate optional field: execution_started_at
  if (data.execution_started_at !== undefined && data.execution_started_at !== null) {
    if (typeof data.execution_started_at !== 'string') {
      errors.push({
        field: 'execution_started_at',
        message: 'execution_started_at must be a string (ISO 8601) if provided',
      });
    }
  }

  // Validate optional field: execution_completed_at
  if (data.execution_completed_at !== undefined && data.execution_completed_at !== null) {
    if (typeof data.execution_completed_at !== 'string') {
      errors.push({
        field: 'execution_completed_at',
        message: 'execution_completed_at must be a string (ISO 8601) if provided',
      });
    }
  }

  // Validate optional field: execution_output
  if (data.execution_output !== undefined && data.execution_output !== null) {
    if (typeof data.execution_output !== 'object' || Array.isArray(data.execution_output)) {
      errors.push({
        field: 'execution_output',
        message: 'execution_output must be an object (not an array) if provided',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Sanitizes and normalizes AFU9 issue input
 * Trims whitespace and clamps to max lengths
 * 
 * @param input - The validated input (must have passed validation)
 * @returns Sanitized Afu9IssueInput
 * @throws Error if input has not been validated (missing required fields)
 */
export function sanitizeAfu9IssueInput(input: Afu9IssueInput): Afu9IssueInput {
  // Ensure required fields are present (should have been validated)
  if (!input.title) {
    throw new Error('Title is required. Input must be validated before sanitization');
  }

  return {
    title: input.title.trim().slice(0, AFU9_ISSUE_CONSTRAINTS.title),
    body: input.body === undefined || input.body === null ? null : input.body.trim(),
    status: input.status || Afu9IssueStatus.CREATED,
    labels: input.labels || [],
    priority: input.priority === undefined ? null : input.priority,
    assignee:
      input.assignee === undefined || input.assignee === null
        ? null
        : input.assignee.trim().slice(0, AFU9_ISSUE_CONSTRAINTS.assignee),
    source: 'afu9', // Always afu9 regardless of input
    handoff_state: input.handoff_state || Afu9HandoffState.NOT_SENT,
    github_issue_number: input.github_issue_number === undefined ? null : input.github_issue_number,
    github_url:
      input.github_url === undefined || input.github_url === null
        ? null
        : input.github_url.trim().slice(0, AFU9_ISSUE_CONSTRAINTS.github_url),
    last_error:
      input.last_error === undefined || input.last_error === null ? null : input.last_error.trim(),
    activated_at: input.activated_at === undefined ? null : input.activated_at,
    execution_state: input.execution_state || Afu9ExecutionState.IDLE,
    execution_started_at: input.execution_started_at === undefined ? null : input.execution_started_at,
    execution_completed_at: input.execution_completed_at === undefined ? null : input.execution_completed_at,
    execution_output: input.execution_output === undefined ? null : input.execution_output,
  };
}
