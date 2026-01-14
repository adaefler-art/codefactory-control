/**
 * DB Repair Contracts - Type definitions for staging-only DB repair mechanism
 * 
 * Issue: E86.5 - Staging DB Repair Mechanism
 * 
 * Provides evidence-first, deterministic, idempotent repair playbooks for schema drift
 * without DB reset. Stage-only, fully audited, fail-closed.
 */

/**
 * DB Repair Playbook
 * 
 * Immutable, versioned repair action with deterministic hash
 */
export interface DbRepairPlaybook {
  /** Canonical repair ID (e.g., R-DB-INTENT-AUTH-EVENTS-001) */
  repairId: string;
  
  /** Human-readable description */
  description: string;
  
  /** Stage-only flag */
  stageOnly: boolean;
  
  /** Requires admin privileges */
  requiresAdmin: boolean;
  
  /** SQL statements to execute (idempotent, no DROP) */
  sql: string[];
  
  /** Required tables before repair (for validation) */
  requiredTablesBefore?: string[];
  
  /** Required tables after repair (for validation) */
  requiredTablesAfter?: string[];
  
  /** SHA-256 hash of canonical SQL */
  hash: string;
  
  /** Lawbook version when playbook was created */
  lawbookHash?: string;
  
  /** Version of the playbook */
  version: string;
}

/**
 * DB Repair Run Status
 */
export type DbRepairRunStatus = 'SUCCESS' | 'FAILED';

/**
 * DB Repair Run Record (append-only)
 */
export interface DbRepairRun {
  id: string;
  repair_id: string;
  expected_hash: string;
  actual_hash: string;
  executed_at: Date;
  executed_by: string;
  deployment_env: string;
  lawbook_hash: string | null;
  request_id: string;
  status: DbRepairRunStatus;
  error_code: string | null;
  error_message: string | null;
  pre_missing_tables: string[];
  post_missing_tables: string[];
}

/**
 * DB Repair Run Input
 */
export interface DbRepairRunInput {
  repair_id: string;
  expected_hash: string;
  actual_hash: string;
  executed_by: string;
  deployment_env: string;
  lawbook_hash: string | null;
  request_id: string;
  status: DbRepairRunStatus;
  error_code: string | null;
  error_message: string | null;
  pre_missing_tables: string[];
  post_missing_tables: string[];
}

/**
 * Preview result (no DB writes)
 */
export interface DbRepairPreview {
  repairId: string;
  description: string;
  hash: string;
  requiredTablesCheck: {
    required: string[];
    missing: string[];
    allPresent: boolean;
  };
  wouldApply: boolean;
  plan: string[];
  requestId: string;
  deploymentEnv: string;
  lawbookHash: string | null;
}

/**
 * Execute result
 */
export interface DbRepairExecuteResult {
  repairId: string;
  repairRunId: string;
  requestId: string;
  status: DbRepairRunStatus;
  summary: {
    preMissingTables: string[];
    postMissingTables: string[];
    statementsExecuted: number;
    errorCode?: string;
    errorMessage?: string;
  };
}
