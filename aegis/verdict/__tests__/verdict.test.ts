import assert from 'node:assert';
import { describe, test } from 'node:test';
import { buildVerdict } from '../engine';
import { PolicyEvaluationSnapshot, VerdictEngineInput } from '../types';

const baseRun = {
  run_id: 'run-1',
  timestamp_utc: '2024-01-01T00:00:00Z',
  repo: 'owner/repo',
  pr_number: 123,
  head_sha: 'abcdef123',
};

const basePolicyEval: PolicyEvaluationSnapshot = {
  matched_rules: [
    { rule_id: 'P1', severity: 'INFO', then: 'ALLOW', reason: 'baseline' },
  ],
  policy_action: 'ALLOW',
  proposed_factory_action: 'APPROVE_AUTOMERGE_DEPLOY',
};

function makeBaseInput(): VerdictEngineInput {
  return {
    run: { ...baseRun },
    policyEvaluation: JSON.parse(JSON.stringify(basePolicyEval)),
    inputs: {
      learning_mode: false,
      change_summary: {
        files_changed: 10,
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
        canary: { passed: true, error_rate: 0.0, latency_delta: 0 },
      },
    },
  };
}

describe('AEGIS verdict engine', () => {
  test('CI failure forces KILL_AND_ROLLBACK', () => {
    const input = makeBaseInput();
    input.inputs.signals.ci.status = 'failure';

    const verdict = buildVerdict(input);
    assert.strictEqual(verdict.verdict.proposed_action, 'KILL_AND_ROLLBACK');
  });

  test('Canary failure forces KILL_AND_ROLLBACK', () => {
    const input = makeBaseInput();
    input.inputs.signals.canary = { passed: false, error_rate: 0.1, latency_delta: 200 };

    const verdict = buildVerdict(input);
    assert.strictEqual(verdict.verdict.proposed_action, 'KILL_AND_ROLLBACK');
  });

  test('Learning mode converts APPROVE_AUTOMERGE_DEPLOY to HOLD_FOR_HUMAN', () => {
    const input = makeBaseInput();
    input.inputs.learning_mode = true;

    const verdict = buildVerdict(input);
    assert.strictEqual(verdict.policy_evaluation.proposed_factory_action, 'APPROVE_AUTOMERGE_DEPLOY');
    assert.strictEqual(verdict.verdict.proposed_action, 'HOLD_FOR_HUMAN');
  });

  test('High-risk flags lower risk score and set HIGH risk level', () => {
    const input = makeBaseInput();
    input.inputs.change_summary.change_flags.infra_change = true;
    input.inputs.change_summary.change_flags.db_migration = true;
    input.inputs.change_summary.files_changed = 250;

    const verdict = buildVerdict(input);
    assert.strictEqual(verdict.scorecard.risk_level, 'HIGH');
    assert.ok(verdict.scorecard.dimensions.risk <= 50);
  });

  test('Deterministic output for identical inputs', () => {
    const input = makeBaseInput();
    const v1 = buildVerdict(input);
    const v2 = buildVerdict(input);

    assert.strictEqual(JSON.stringify(v1), JSON.stringify(v2));
  });
});
