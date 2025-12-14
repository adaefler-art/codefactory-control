import { VerdictDocument } from '../verdict/types';

export type ActionStatus = 'PROPOSED' | 'APPROVED' | 'EXECUTED' | 'VERIFIED' | 'FAILED';
export type AdapterResultStatus = 'SUCCESS' | 'SKIPPED' | 'FAILED';

export interface PlanOptions {
  autoExecuteMinConfidence: number;
  requestId?: string;
  auditFilePath?: string;
  dryRun?: boolean;
  now?: () => string;
}

export interface ActionPlan {
  schema_version: 'aegis.orchestrator.plan.v1';
  action_request_id: string;
  run_id: string;
  proposed_action: VerdictDocument['verdict']['proposed_action'];
  final_action: VerdictDocument['verdict']['proposed_action'];
  confidence: number;
  learning_mode: boolean;
  approved_for_execution: boolean;
  status: ActionStatus;
  status_transitions: Array<{ from: ActionStatus; to: ActionStatus; timestamp_utc: string; reason?: string }>;
  notes?: string;
}

export interface ExecuteOptions {
  auditFilePath?: string;
  now?: () => string;
  dryRun?: boolean;
  idempotencyStore?: Set<string>;
}

export interface ActionAdapterContext {
  action_request_id: string;
  run_id: string;
  verdict: VerdictDocument;
  plan: ActionPlan;
}

export interface ActionAdapterResult {
  adapter: string;
  status: AdapterResultStatus;
  message?: string;
  timestamp_utc: string;
}

export interface ActionAdapter {
  name: string;
  execute(action: VerdictDocument['verdict']['proposed_action'], ctx: ActionAdapterContext): Promise<ActionAdapterResult> | ActionAdapterResult;
}

export interface AuditRecord {
  schema_version: 'aegis.orchestrator.audit.v1';
  run_id: string;
  action_request_id: string;
  timestamp_utc: string;
  verdict_hash: string;
  plan: Pick<ActionPlan, 'proposed_action' | 'final_action' | 'confidence' | 'learning_mode' | 'approved_for_execution' | 'notes'>;
  status_transitions: ActionPlan['status_transitions'];
  adapter_results: ActionAdapterResult[];
  overrides?: Array<{ actor: string; reason: string; previous_action: string; new_action: string; timestamp_utc: string }>;
}
