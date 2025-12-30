/**
 * Deploy Status Contract Schema
 * 
 * Defines types and contracts for the deploy status monitor (E65.1).
 * Ensures schema ↔ API ↔ UI synchronization.
 * 
 * MUST be kept in sync with database/migrations/027_deploy_status_snapshots.sql
 */

/**
 * Deploy status values
 */
export type DeployStatus = 'GREEN' | 'YELLOW' | 'RED';

/**
 * Environment identifier
 */
export type DeployEnvironment = 'prod' | 'stage' | string;

/**
 * Reason severity levels
 */
export type ReasonSeverity = 'error' | 'warning' | 'info';

/**
 * Reason code explaining status determination
 */
export interface StatusReason {
  code: string;
  severity: ReasonSeverity;
  message: string;
  evidence?: Record<string, unknown>;
}

/**
 * Signal data collected from various sources
 */
export interface StatusSignals {
  health?: {
    status: number;
    ok: boolean;
    response?: Record<string, unknown>;
    error?: string;
    error_name?: string;
    error_code?: string;
    latency_ms?: number;
    url?: string;
    base_url?: string;
    timeout_ms?: number;
    attempted_urls?: string[];
  };
  ready?: {
    status: number;
    ok: boolean;
    ready?: boolean;
    response?: Record<string, unknown>;
    error?: string;
    error_name?: string;
    error_code?: string;
    latency_ms?: number;
    url?: string;
    base_url?: string;
    timeout_ms?: number;
    attempted_urls?: string[];
  };
  deploy_events?: Array<{
    id: string;
    created_at: string;
    env: string;
    service: string;
    version: string;
    commit_hash: string;
    status: string;
    message: string | null;
  }>;
  checked_at: string;
}

/**
 * Deploy Status Snapshot Row (from database)
 */
export interface DeployStatusSnapshot {
  id: string;
  created_at: string;
  updated_at: string;
  env: string;
  status: DeployStatus;
  observed_at: string;
  reasons: StatusReason[];
  signals: StatusSignals;
  related_deploy_event_id: string | null;
  staleness_seconds: number | null;
}

/**
 * Input for creating a deploy status snapshot
 */
export interface CreateDeployStatusInput {
  env: DeployEnvironment;
  status: DeployStatus;
  observed_at?: string;
  reasons: StatusReason[];
  signals: StatusSignals;
  related_deploy_event_id?: string | null;
  staleness_seconds?: number | null;
}

/**
 * API response for deploy status query
 */
export interface DeployStatusResponse {
  env: DeployEnvironment;
  status: DeployStatus;
  observed_at: string;
  reasons: StatusReason[];
  signals: StatusSignals;
  staleness_seconds: number;
  snapshot_id?: string;
}

/**
 * Validation result for deploy status input
 */
export interface DeployStatusValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
}

/**
 * Validate deploy status value
 */
export function isValidDeployStatus(status: unknown): status is DeployStatus {
  return status === 'GREEN' || status === 'YELLOW' || status === 'RED';
}

/**
 * Validate environment identifier
 */
export function isValidEnvironment(env: unknown): boolean {
  if (typeof env !== 'string' || env.length === 0) {
    return false;
  }
  // Must be lowercase alphanumeric with hyphens/underscores
  return /^[a-z0-9_-]+$/.test(env);
}

/**
 * Validate reason severity
 */
export function isValidSeverity(severity: unknown): severity is ReasonSeverity {
  return severity === 'error' || severity === 'warning' || severity === 'info';
}

/**
 * Validate a single status reason
 */
export function validateStatusReason(reason: unknown): DeployStatusValidationResult {
  const errors: Array<{ field: string; message: string }> = [];

  if (!reason || typeof reason !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'reason', message: 'Reason must be an object' }],
    };
  }

  const r = reason as Record<string, unknown>;

  if (typeof r.code !== 'string' || r.code.length === 0) {
    errors.push({ field: 'code', message: 'Code must be a non-empty string' });
  }

  if (!isValidSeverity(r.severity)) {
    errors.push({ field: 'severity', message: 'Severity must be error, warning, or info' });
  }

  if (typeof r.message !== 'string' || r.message.length === 0) {
    errors.push({ field: 'message', message: 'Message must be a non-empty string' });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate deploy status input
 */
export function validateDeployStatusInput(
  input: unknown
): DeployStatusValidationResult {
  const errors: Array<{ field: string; message: string }> = [];

  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'input', message: 'Input must be an object' }],
    };
  }

  const data = input as Record<string, unknown>;

  // Validate env
  if (!isValidEnvironment(data.env)) {
    errors.push({
      field: 'env',
      message: 'env must be a valid environment identifier (lowercase alphanumeric with hyphens/underscores)',
    });
  }

  // Validate status
  if (!isValidDeployStatus(data.status)) {
    errors.push({
      field: 'status',
      message: 'status must be GREEN, YELLOW, or RED',
    });
  }

  // Validate reasons array
  if (!Array.isArray(data.reasons)) {
    errors.push({
      field: 'reasons',
      message: 'reasons must be an array',
    });
  } else {
    data.reasons.forEach((reason, index) => {
      const validation = validateStatusReason(reason);
      if (!validation.valid) {
        validation.errors.forEach(error => {
          errors.push({
            field: `reasons[${index}].${error.field}`,
            message: error.message,
          });
        });
      }
    });
  }

  // Validate signals
  if (!data.signals || typeof data.signals !== 'object') {
    errors.push({
      field: 'signals',
      message: 'signals must be an object',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
