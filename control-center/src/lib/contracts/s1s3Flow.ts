/**
 * S1-S3 Flow Contract Schema
 * 
 * Defines the contract for S1-S3 flow operations:
 * S1: GitHub Issue Pick
 * S2: Spec Ready
 * S3: Implement (Branch + PR)
 * 
 * Reference: E9.1_F1 - S1-S3 Live Flow MVP
 * MUST be kept in sync with database/migrations/086_s1s3_flow_persistence.sql
 */

/**
 * S1-S3 Issue Status enum
 */
export enum S1S3IssueStatus {
  CREATED = 'CREATED',
  SPEC_READY = 'SPEC_READY',
  IMPLEMENTING = 'IMPLEMENTING',
  PR_CREATED = 'PR_CREATED',
  CHECKS_PASSING = 'CHECKS_PASSING',
  CHECKS_FAILING = 'CHECKS_FAILING',
  DONE = 'DONE',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * S1-S3 Run Type enum
 */
export enum S1S3RunType {
  S1_PICK_ISSUE = 'S1_PICK_ISSUE',
  S2_SPEC_READY = 'S2_SPEC_READY',
  S3_IMPLEMENT = 'S3_IMPLEMENT',
  S1S3_FLOW = 'S1S3_FLOW',
}

/**
 * S1-S3 Run Status enum
 */
export enum S1S3RunStatus {
  CREATED = 'CREATED',
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

/**
 * S1-S3 Step Status enum
 */
export enum S1S3StepStatus {
  STARTED = 'STARTED',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

/**
 * S1-S3 Issue Record (Database Row)
 */
export interface S1S3IssueRow {
  id: string;
  public_id: string;
  canonical_id: string | null;
  repo_full_name: string;
  github_issue_number: number;
  github_issue_url: string;
  owner: string;
  status: S1S3IssueStatus;
  problem: string | null;
  scope: string | null;
  acceptance_criteria: string | any[]; // JSONB - may be string from DB
  notes: string | null;
  pr_number: number | null;
  pr_url: string | null;
  branch_name: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  spec_ready_at: Date | string | null;
  pr_created_at: Date | string | null;
}

/**
 * S1-S3 Issue Input (Create/Update)
 */
export interface S1S3IssueInput {
  repo_full_name: string;
  github_issue_number: number;
  github_issue_url: string;
  owner?: string;
  canonical_id?: string;
  status?: S1S3IssueStatus;
  problem?: string | null;
  scope?: string | null;
  acceptance_criteria?: string[];
  notes?: string | null;
  pr_number?: number | null;
  pr_url?: string | null;
  branch_name?: string | null;
}

/**
 * S1-S3 Run Record (Database Row)
 */
export interface S1S3RunRow {
  id: string;
  type: S1S3RunType;
  issue_id: string;
  request_id: string;
  actor: string;
  status: S1S3RunStatus;
  error_message: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

/**
 * S1-S3 Run Input (Create)
 */
export interface S1S3RunInput {
  type: S1S3RunType;
  issue_id: string;
  request_id: string;
  actor?: string;
  status?: S1S3RunStatus;
}

/**
 * S1-S3 Run Step Record (Database Row)
 */
export interface S1S3RunStepRow {
  id: string;
  run_id: string;
  step_id: string;
  step_name: string;
  status: S1S3StepStatus;
  evidence_refs: string | Record<string, any>; // JSONB - may be string from DB
  error_message: string | null;
  created_at: Date | string;
}

/**
 * S1-S3 Run Step Input (Create)
 */
export interface S1S3RunStepInput {
  run_id: string;
  step_id: string;
  step_name: string;
  status: S1S3StepStatus;
  evidence_refs?: Record<string, any>;
  error_message?: string | null;
}

/**
 * Evidence Refs - structured data for step evidence
 */
export interface S1S3EvidenceRefs {
  issue_url?: string;
  issue_number?: number;
  repo_full_name?: string;
  pr_url?: string;
  pr_number?: number;
  branch_name?: string;
  checks_url?: string;
  request_id?: string;
  [key: string]: any;
}

/**
 * Sanitize S1-S3 Issue Input
 * Validates and normalizes input data
 */
export function sanitizeS1S3IssueInput(input: S1S3IssueInput): S1S3IssueInput {
  return {
    repo_full_name: input.repo_full_name.trim(),
    github_issue_number: input.github_issue_number,
    github_issue_url: input.github_issue_url.trim(),
    owner: input.owner?.trim() || 'afu9',
    canonical_id: input.canonical_id?.trim() || undefined,
    status: input.status || S1S3IssueStatus.CREATED,
    problem: input.problem?.trim() || null,
    scope: input.scope?.trim() || null,
    acceptance_criteria: input.acceptance_criteria || [],
    notes: input.notes?.trim() || null,
    pr_number: input.pr_number || null,
    pr_url: input.pr_url?.trim() || null,
    branch_name: input.branch_name?.trim() || null,
  };
}

/**
 * Validate S1-S3 Issue Status
 */
export function isValidS1S3Status(status: string): status is S1S3IssueStatus {
  return Object.values(S1S3IssueStatus).includes(status as S1S3IssueStatus);
}

/**
 * Validate S1-S3 Run Type
 */
export function isValidS1S3RunType(type: string): type is S1S3RunType {
  return Object.values(S1S3RunType).includes(type as S1S3RunType);
}

/**
 * Normalize acceptance criteria from DB
 * Handles JSONB string or array
 */
export function normalizeAcceptanceCriteria(ac: string | any[]): string[] {
  if (typeof ac === 'string') {
    try {
      const parsed = JSON.parse(ac);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(ac) ? ac : [];
}

/**
 * Normalize evidence refs from DB
 * Handles JSONB string or object
 */
export function normalizeEvidenceRefs(refs: string | Record<string, any>): Record<string, any> {
  if (typeof refs === 'string') {
    try {
      return JSON.parse(refs);
    } catch {
      return {};
    }
  }
  return refs || {};
}
