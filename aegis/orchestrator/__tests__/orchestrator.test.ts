import assert from 'node:assert';
import { describe, test } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import { buildVerdict } from '../../verdict/engine';
import { PolicyEvaluationSnapshot, VerdictDocument } from '../../verdict/types';
import { execute, plan } from '../orchestrator';
import { ActionAdapter, ActionAdapterResult, PlanOptions } from '../types';

const baseVerdict: VerdictDocument = buildVerdict({
  run: {
    run_id: 'run-1',
    timestamp_utc: '2024-01-01T00:00:00Z',
    repo: 'owner/repo',
    pr_number: 1,
    head_sha: 'abcdef',
  },
  inputs: {
    learning_mode: false,
    change_summary: {
      files_changed: 1,
      change_flags: {
        infra_change: false,
        db_migration: false,
        auth_change: false,
        secrets_change: false,
        dependency_change: false,
      },
    },
    signals: {
      ci: { status: 'success' },
      security: { critical_count: 0, high_count: 0 },
    },
  },
  policyEvaluation: {
    matched_rules: [],
    policy_action: 'ALLOW',
    proposed_factory_action: 'APPROVE_AUTOMERGE_DEPLOY',
  } as PolicyEvaluationSnapshot,
});

function makePlanOptions(): PlanOptions {
  return {
    autoExecuteMinConfidence: 0.85,
    now: () => '2025-01-01T00:00:00.000Z',
  };
}

describe('orchestrator planning', () => {
  test('deterministic plan output for same verdict', () => {
    const p1 = plan(baseVerdict, makePlanOptions());
    const p2 = plan(baseVerdict, makePlanOptions());
    assert.strictEqual(JSON.stringify(p1), JSON.stringify(p2));
  });

  test('confidence gate forces hold when below threshold', () => {
    const lowConfVerdict: VerdictDocument = {
      ...baseVerdict,
      verdict: { ...baseVerdict.verdict, confidence: 0.5 },
    };
    const p = plan(lowConfVerdict, makePlanOptions());
    assert.strictEqual(p.final_action, 'HOLD_FOR_HUMAN');
    assert.strictEqual(p.approved_for_execution, false);
  });

  test('learning mode forces hold even with approve', () => {
    const learnVerdict: VerdictDocument = {
      ...baseVerdict,
      inputs: { ...baseVerdict.inputs, learning_mode: true },
    };
    const p = plan(learnVerdict, makePlanOptions());
    assert.strictEqual(p.final_action, 'HOLD_FOR_HUMAN');
  });
});

describe('orchestrator execution', () => {
  test('idempotency prevents double adapter execution', async () => {
    const idempotencyStore = new Set<string>();
    let calls = 0;
    const adapter: ActionAdapter = {
      name: 'test',
      execute: () => {
        calls++;
        return { adapter: 'test', status: 'SUCCESS', timestamp_utc: '2024-01-01T00:00:00Z' } as ActionAdapterResult;
      },
    };

    const p = plan(baseVerdict, makePlanOptions());
    const res1 = await execute(baseVerdict, p, [adapter], { idempotencyStore });
    const res2 = await execute(baseVerdict, p, [adapter], { idempotencyStore });

    assert.strictEqual(calls, 1);
    assert.strictEqual(res1.plan.status, 'VERIFIED');
    assert.strictEqual(res2.plan.status, 'VERIFIED');
    assert.strictEqual(res2.adapter_results[0]?.status, 'SKIPPED');
  });

  test('audit record is written', async () => {
    const tmp = fs.mkdtempSync(path.join(process.cwd(), 'audit-test-'));
    const auditPath = path.join(tmp, 'audit.jsonl');
    let called = false;
    const adapter: ActionAdapter = {
      name: 'test',
      execute: () => {
        called = true;
        return { adapter: 'test', status: 'SUCCESS', timestamp_utc: '2024-01-01T00:00:00Z' } as ActionAdapterResult;
      },
    };

    const p = plan(baseVerdict, makePlanOptions());
    await execute(baseVerdict, p, [adapter], { auditFilePath: auditPath });

    assert.ok(called);
    const lines = fs.readFileSync(auditPath, 'utf8').trim().split(/\r?\n/);
    assert.strictEqual(lines.length, 1);
    const rec = JSON.parse(lines[0]);
    assert.strictEqual(rec.plan.final_action, p.final_action);
  });
});
