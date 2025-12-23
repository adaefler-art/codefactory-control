/**
 * DB Read / API Output Contracts (AFU-9)
 * 
 * Defines explicit output contracts for all DB read paths.
 * Ensures no silent field loss between DB ↔ API ↔ UI.
 * 
 * MUST be kept in sync with database schema migrations.
 */

/**
 * Workflow Output Contract
 * Source: database/migrations/001_initial_schema.sql
 * Table: workflows
 */
export interface WorkflowOutput {
  id: string;
  name: string;
  description: string | null;
  definition: Record<string, unknown>;
  version: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Workflow Execution Output Contract
 * Source: database/migrations/001_initial_schema.sql
 * Table: workflow_executions
 */
export interface WorkflowExecutionOutput {
  id: string;
  workflow_id: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  triggered_by: string | null;
  github_run_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Workflow Step Output Contract
 * Source: database/migrations/001_initial_schema.sql
 * Table: workflow_steps
 */
export interface WorkflowStepOutput {
  id: string;
  execution_id: string | null;
  step_name: string;
  step_index: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Repository Output Contract
 * Source: database/migrations/001_initial_schema.sql
 * Table: repositories
 */
export interface RepositoryOutput {
  id: string;
  owner: string;
  name: string;
  full_name: string;
  default_branch: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/**
 * Agent Run Output Contract
 * Source: database/migrations/001_initial_schema.sql
 * Table: agent_runs
 */
export interface AgentRunOutput {
  id: string;
  execution_id: string | null;
  step_id: string | null;
  agent_type: string;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number | null;
  cost_usd: string | null; // DECIMAL stored as string
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  tool_calls: Record<string, unknown> | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  created_at: string;
}

/**
 * MCP Server Output Contract
 * Source: database/migrations/001_initial_schema.sql
 * Table: mcp_servers
 */
export interface McpServerOutput {
  id: string;
  name: string;
  description: string | null;
  endpoint: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
  health_check_url: string | null;
  last_health_check: string | null;
  health_status: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * MCP Tool Call Output Contract
 * Source: database/migrations/001_initial_schema.sql
 * Table: mcp_tool_calls
 */
export interface McpToolCallOutput {
  id: string;
  execution_id: string | null;
  agent_run_id: string | null;
  server_name: string;
  tool_name: string;
  params: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

/**
 * Webhook Event Output Contract
 * Source: database/migrations/003_webhook_events.sql
 * Table: webhook_events
 */
export interface WebhookEventOutput {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  source: string | null;
  processed: boolean;
  processed_at: string | null;
  error: string | null;
  created_at: string;
}

/**
 * Product Output Contract
 * Source: database/migrations/007_product_registry.sql
 * Table: products
 */
export interface ProductOutput {
  id: string;
  repository_id: string;
  product_key: string;
  display_name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  tags: string[] | null;
  constraints: Record<string, unknown>;
  kpi_targets: Record<string, unknown>;
  template_id: string | null;
  template_config: Record<string, unknown> | null;
  enabled: boolean;
  archived: boolean;
  archived_at: string | null;
  archived_reason: string | null;
  isolation_level: string;
  owner_team: string | null;
  contact_email: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

/**
 * Product Template Output Contract
 * Source: database/migrations/007_product_registry.sql
 * Table: product_templates
 */
export interface ProductTemplateOutput {
  id: string;
  name: string;
  description: string | null;
  default_metadata: Record<string, unknown>;
  default_constraints: Record<string, unknown>;
  default_kpi_targets: Record<string, unknown>;
  config_schema: Record<string, unknown> | null;
  enabled: boolean;
  version: string;
  created_at: string;
  updated_at: string;
}

/**
 * Deploy Event Output Contract
 * Source: database/migrations/013_deploy_events.sql
 * Table: deploy_events
 */
export interface DeployEventOutput {
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
 * Policy Snapshot Output Contract
 * Source: database/migrations/004_verdict_engine.sql
 * Table: policy_snapshots
 */
export interface PolicySnapshotOutput {
  id: string;
  version: string;
  policies: Record<string, unknown>;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

/**
 * Verdict Output Contract
 * Source: database/migrations/004_verdict_engine.sql
 * Table: verdicts
 */
export interface VerdictOutput {
  id: string;
  execution_id: string | null;
  policy_snapshot_id: string | null;
  fingerprint_id: string;
  error_class: string;
  service: string;
  confidence_score: number;
  proposed_action: 'WAIT_AND_RETRY' | 'OPEN_ISSUE' | 'HUMAN_REQUIRED';
  tokens: string[];
  signals: Record<string, unknown>;
  playbook_id: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

/**
 * Verdict Audit Log Output Contract
 * Source: database/migrations/004_verdict_engine.sql
 * Table: verdict_audit_log
 */
export interface VerdictAuditLogOutput {
  id: string;
  verdict_id: string | null;
  event_type: string;
  event_data: Record<string, unknown> | null;
  created_at: string;
  created_by: string | null;
}

/**
 * Issue Tracking Output Contract
 * Source: database/migrations/010_issue_state_tracking.sql
 * Table: issue_tracking
 */
export interface IssueTrackingOutput {
  id: string;
  github_issue_number: number;
  repository: string;
  state: 'CREATED' | 'SPEC_READY' | 'IMPLEMENTING' | 'VERIFIED' | 'MERGE_READY' | 'DONE' | 'HOLD' | 'KILLED';
  previous_state: string | null;
  state_changed_at: string;
  state_changed_by: string | null;
  state_change_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Issue State History Output Contract
 * Source: database/migrations/010_issue_state_tracking.sql
 * Table: issue_state_history
 */
export interface IssueStateHistoryOutput {
  id: string;
  issue_tracking_id: string | null;
  from_state: string | null;
  to_state: string;
  transition_at: string;
  transition_by: string | null;
  transition_reason: string | null;
  context: Record<string, unknown>;
  created_at: string;
}

/**
 * Contract Validation Error
 */
export interface ContractValidationError {
  field: string;
  expected: string;
  actual: string;
}

/**
 * Contract Validation Result
 */
export interface ContractValidationResult {
  valid: boolean;
  errors: ContractValidationError[];
  missingFields: string[];
}

/**
 * Validates that a database row matches the expected output contract
 * 
 * @param row - The database row to validate
 * @param contract - The expected field names
 * @param contractName - Name of the contract for error messages
 * @returns Validation result with any errors or missing fields
 */
export function validateOutputContract(
  row: Record<string, unknown>,
  contract: Record<string, unknown>,
  contractName: string
): ContractValidationResult {
  const errors: ContractValidationError[] = [];
  const missingFields: string[] = [];
  const expectedFields = Object.keys(contract);
  const actualFields = Object.keys(row);

  // Check for missing fields in the row
  for (const field of expectedFields) {
    if (!(field in row)) {
      missingFields.push(field);
    }
  }

  // Check for type mismatches (basic type checking)
  for (const field of expectedFields) {
    if (field in row) {
      const expectedType = typeof contract[field];
      const actualType = typeof row[field];
      
      // Allow null values
      if (row[field] === null) {
        continue;
      }

      // Basic type checking
      if (expectedType !== actualType && expectedType !== 'object') {
        errors.push({
          field,
          expected: expectedType,
          actual: actualType,
        });
      }
    }
  }

  return {
    valid: errors.length === 0 && missingFields.length === 0,
    errors,
    missingFields,
  };
}

/**
 * Type guard to ensure a row matches WorkflowOutput contract
 */
export function isWorkflowOutput(row: unknown): row is WorkflowOutput {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    (r.description === null || typeof r.description === 'string') &&
    typeof r.definition === 'object' &&
    typeof r.version === 'number' &&
    typeof r.enabled === 'boolean' &&
    typeof r.created_at === 'string' &&
    typeof r.updated_at === 'string'
  );
}

/**
 * Type guard to ensure a row matches WorkflowExecutionOutput contract
 */
export function isWorkflowExecutionOutput(row: unknown): row is WorkflowExecutionOutput {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  
  const validStatuses = ['pending', 'running', 'completed', 'failed', 'cancelled'];
  
  return (
    typeof r.id === 'string' &&
    (r.workflow_id === null || typeof r.workflow_id === 'string') &&
    typeof r.status === 'string' &&
    validStatuses.includes(r.status as string) &&
    typeof r.started_at === 'string' &&
    typeof r.created_at === 'string' &&
    typeof r.updated_at === 'string'
  );
}

/**
 * Type guard to ensure a row matches DeployEventOutput contract
 */
export function isDeployEventOutput(row: unknown): row is DeployEventOutput {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  
  return (
    typeof r.id === 'string' &&
    typeof r.created_at === 'string' &&
    typeof r.env === 'string' &&
    typeof r.service === 'string' &&
    typeof r.version === 'string' &&
    typeof r.commit_hash === 'string' &&
    typeof r.status === 'string' &&
    (r.message === null || typeof r.message === 'string')
  );
}

/**
 * Type guard to ensure a row matches ProductOutput contract
 */
export function isProductOutput(row: unknown): row is ProductOutput {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  
  return (
    typeof r.id === 'string' &&
    typeof r.repository_id === 'string' &&
    typeof r.product_key === 'string' &&
    typeof r.display_name === 'string' &&
    typeof r.metadata === 'object' &&
    typeof r.constraints === 'object' &&
    typeof r.kpi_targets === 'object' &&
    typeof r.enabled === 'boolean' &&
    typeof r.archived === 'boolean' &&
    typeof r.isolation_level === 'string' &&
    typeof r.created_at === 'string' &&
    typeof r.updated_at === 'string'
  );
}
