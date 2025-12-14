import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';
import { VerdictDocument } from '../verdict/types';
import { writeAuditRecord } from './audit';
import {
  ActionAdapter,
  ActionAdapterContext,
  ActionAdapterResult,
  ActionPlan,
  ActionStatus,
  ExecuteOptions,
  PlanOptions,
} from './types';

const DEFAULT_AUDIT_PATH = path.join(process.cwd(), 'aegis_audit.log.jsonl');
const verdictSchemaPath = path.join(__dirname, '..', 'verdict', 'schema.json');
const verdictSchema = JSON.parse(fs.readFileSync(verdictSchemaPath, 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validateVerdict = ajv.compile(verdictSchema);

export function plan(verdict: VerdictDocument, opts: PlanOptions): ActionPlan {
  validateVerdictOrThrow(verdict);
  if (!opts || typeof opts.autoExecuteMinConfidence !== 'number') {
    throw new Error('Missing autoExecuteMinConfidence');
  }
  const now = opts.now ?? (() => new Date().toISOString());
  const id = opts.requestId ?? `${verdict.run.run_id}-action`; // deterministic default

  const proposed = verdict.verdict.proposed_action;
  let finalAction = proposed;
  let approved = false;
  const learning = verdict.inputs.learning_mode;

  if (learning && finalAction === 'APPROVE_AUTOMERGE_DEPLOY') {
    finalAction = 'HOLD_FOR_HUMAN';
  }

  if (finalAction === 'APPROVE_AUTOMERGE_DEPLOY') {
    if (verdict.verdict.confidence < opts.autoExecuteMinConfidence) {
      finalAction = 'HOLD_FOR_HUMAN';
    } else {
      approved = true;
    }
  }

  const transitions: ActionPlan['status_transitions'] = [
    { from: 'PROPOSED', to: approved ? 'APPROVED' : 'PROPOSED', timestamp_utc: now(), reason: approved ? 'confidence gate passed' : 'awaiting approval/hold' },
  ];

  const plan: ActionPlan = {
    schema_version: 'aegis.orchestrator.plan.v1',
    action_request_id: id,
    run_id: verdict.run.run_id,
    proposed_action: proposed,
    final_action: finalAction,
    confidence: verdict.verdict.confidence,
    learning_mode: learning,
    approved_for_execution: approved,
    status: approved ? 'APPROVED' : 'PROPOSED',
    status_transitions: transitions,
  };

  return plan;
}

export async function execute(
  verdict: VerdictDocument,
  planResult: ActionPlan,
  adapters: ActionAdapter[],
  opts: ExecuteOptions = {}
): Promise<{ plan: ActionPlan; adapter_results: ActionAdapterResult[] }> {
  validateVerdictOrThrow(verdict);
  const now = opts.now ?? (() => new Date().toISOString());
  const auditPath = opts.auditFilePath ?? DEFAULT_AUDIT_PATH;
  const idempotency = opts.idempotencyStore ?? new Set<string>();
  const adapterResults: ActionAdapterResult[] = [];

  const ctx: ActionAdapterContext = {
    action_request_id: planResult.action_request_id,
    run_id: planResult.run_id,
    verdict,
    plan: planResult,
  };

  let currentStatus: ActionStatus = planResult.status;
  const transitions = [...planResult.status_transitions];

  const pushStatus = (to: ActionStatus, reason?: string) => {
    transitions.push({ from: currentStatus, to, timestamp_utc: now(), reason });
    currentStatus = to;
  };

  if (planResult.final_action === 'HOLD_FOR_HUMAN' || !planResult.approved_for_execution || opts.dryRun) {
    pushStatus('VERIFIED', opts.dryRun ? 'dry-run' : 'no auto-exec');
    persistAudit(verdict, { ...planResult, status_transitions: transitions, status: currentStatus }, adapterResults, auditPath, now);
    return { plan: { ...planResult, status: currentStatus, status_transitions: transitions }, adapter_results: adapterResults };
  }

  if (idempotency.has(planResult.action_request_id)) {
    adapterResults.push({ adapter: 'action', status: 'SKIPPED', message: 'idempotent skip', timestamp_utc: now() });
    pushStatus('VERIFIED', 'idempotent skip');
    persistAudit(verdict, { ...planResult, status_transitions: transitions, status: currentStatus }, adapterResults, auditPath, now);
    return { plan: { ...planResult, status: currentStatus, status_transitions: transitions }, adapter_results: adapterResults };
  }

  idempotency.add(planResult.action_request_id);
  pushStatus('EXECUTED', 'execution started');

  for (const adapter of adapters) {
    try {
      const result = await adapter.execute(planResult.final_action, ctx);
      adapterResults.push(result);
      if (result.status === 'FAILED') {
        pushStatus('FAILED', result.message ?? 'adapter failed');
        persistAudit(verdict, { ...planResult, status_transitions: transitions, status: currentStatus }, adapterResults, auditPath, now);
        return { plan: { ...planResult, status: currentStatus, status_transitions: transitions }, adapter_results: adapterResults };
      }
    } catch (err) {
      adapterResults.push({ adapter: adapter.name, status: 'FAILED', message: (err as Error).message, timestamp_utc: now() });
      pushStatus('FAILED', (err as Error).message);
      persistAudit(verdict, { ...planResult, status_transitions: transitions, status: currentStatus }, adapterResults, auditPath, now);
      return { plan: { ...planResult, status: currentStatus, status_transitions: transitions }, adapter_results: adapterResults };
    }
  }

  pushStatus('VERIFIED', 'execution complete');
  const finalPlan = { ...planResult, status: currentStatus, status_transitions: transitions };
  persistAudit(verdict, finalPlan, adapterResults, auditPath, now);
  return { plan: finalPlan, adapter_results: adapterResults };
}

function persistAudit(
  verdict: VerdictDocument,
  planResult: ActionPlan,
  adapterResults: ActionAdapterResult[],
  auditPath: string,
  now: () => string
) {
  const record = {
    schema_version: 'aegis.orchestrator.audit.v1' as const,
    run_id: verdict.run.run_id,
    action_request_id: planResult.action_request_id,
    timestamp_utc: now(),
    verdict_hash: hashVerdict(verdict),
    plan: {
      proposed_action: planResult.proposed_action,
      final_action: planResult.final_action,
      confidence: planResult.confidence,
      learning_mode: planResult.learning_mode,
      approved_for_execution: planResult.approved_for_execution,
      notes: planResult.notes,
    },
    status_transitions: planResult.status_transitions,
    adapter_results: adapterResults,
  };
  writeAuditRecord(record, auditPath);
}

function hashVerdict(verdict: VerdictDocument): string {
  const json = JSON.stringify(verdict);
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    hash = (hash * 31 + json.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function validateVerdictOrThrow(doc: VerdictDocument): void {
  const ok = validateVerdict(doc);
  if (!ok && validateVerdict.errors) {
    const message = validateVerdict.errors.map(formatAjvError).join('; ');
    throw new Error(`Verdict schema validation failed: ${message}`);
  }
}

function formatAjvError(err: ErrorObject<string, Record<string, unknown>, unknown>): string {
  const instancePath = err.instancePath || '(root)';
  const schemaPath = err.schemaPath || '';
  const message = err.message || 'validation error';
  return `${instancePath} ${message} [${schemaPath}]`.trim();
}
