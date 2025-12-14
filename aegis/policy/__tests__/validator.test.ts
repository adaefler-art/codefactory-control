import assert from 'node:assert';
import { describe, test } from 'node:test';
import { evaluatePolicy, mapPolicyActionToFactoryAction } from '../evaluator';
import { PolicyDocument, EvaluationInput } from '../types';
import { PolicyValidationError, validatePolicy } from '../validator';

const BASE_POLICY: PolicyDocument = {
  policy_version: 'aegis.policy.v1',
  defaults: { learning_mode: false },
  rules: [
    {
      id: 'R1',
      when: 'ci.status == "success"',
      then: 'ALLOW',
      severity: 'INFO',
      reason: 'Baseline happy path',
    },
  ],
};

describe('policy validation', () => {
  test('accepts a valid policy document', () => {
    assert.doesNotThrow(() => validatePolicy(BASE_POLICY));
  });

  test('rejects additional properties using JSON schema', () => {
    const invalidRule = {
      ...(BASE_POLICY.rules[0] as PolicyDocument['rules'][number]),
      extra: 'nope',
    } as unknown as PolicyDocument['rules'][number];

    const invalid: PolicyDocument = {
      ...BASE_POLICY,
      rules: [invalidRule],
    };

    assert.throws(
      () => validatePolicy(invalid),
      (err: unknown) => {
        assert.ok(err instanceof PolicyValidationError);
        assert.ok(
          err.details.some((d) => d.includes('must NOT have additional properties')),
          `expected additionalProperties failure, got: ${err}`
        );
        return true;
      }
    );
  });

  test('rejects unknown identifiers in when expressions', () => {
    const invalid: PolicyDocument = {
      ...BASE_POLICY,
      rules: [
        {
          ...(BASE_POLICY.rules[0] as PolicyDocument['rules'][number]),
          id: 'R2',
          when: 'foo.bar == true',
        },
      ],
    };

    assert.throws(
      () => validatePolicy(invalid),
      (err: unknown) => {
        assert.ok(err instanceof PolicyValidationError);
        assert.ok(err.details.some((d) => d.includes('unknown identifier in when: foo.bar')));
        return true;
      }
    );
  });
});

describe('policy evaluation', () => {
  test('BLOCK match short-circuits and wins severity/action', () => {
    const policy: PolicyDocument = {
      policy_version: 'aegis.policy.v1',
      rules: [
        { id: 'H1', when: 'ci.status == "failure"', then: 'REQUIRE_APPROVAL', severity: 'HIGH', reason: 'CI failed' },
        { id: 'B1', when: 'security.critical_count > 0', then: 'KILL_AND_ROLLBACK', severity: 'BLOCK', reason: 'Critical findings' },
        { id: 'I1', when: 'canary.error_rate < 0.01', then: 'ALLOW', severity: 'INFO', reason: 'Healthy canary' },
      ],
    };

    const input: EvaluationInput = {
      ci: { status: 'failure' },
      security: { critical_count: 1, high_count: 0 },
      change_flags: {
        infra_change: false,
        db_migration: false,
        auth_change: false,
        secrets_change: false,
        dependency_change: false,
      },
      canary: { error_rate: 0.0, latency_delta: 0 },
    };

    const result = evaluatePolicy(policy, input);

    assert.strictEqual(result.highestSeverity, 'BLOCK');
    assert.strictEqual(result.proposedAction, 'KILL_AND_ROLLBACK');
    assert.strictEqual(result.matched.length, 2); // HIGH then BLOCK (short-circuit)
    assert.strictEqual(result.matched[1]?.id, 'B1');
  });

  test('action mapping honors learning_mode for ALLOW and normalizes REQUIRE_APPROVAL', () => {
    const baseInput: EvaluationInput = {
      ci: { status: 'success' },
      security: { critical_count: 0, high_count: 0 },
      change_flags: {
        infra_change: false,
        db_migration: false,
        auth_change: false,
        secrets_change: false,
        dependency_change: false,
      },
      canary: { error_rate: 0, latency_delta: 0 },
    };

    const allowPolicy: PolicyDocument = {
      policy_version: 'aegis.policy.v1',
      defaults: { learning_mode: true },
      rules: [
        { id: 'A1', when: 'ci.status == "success"', then: 'ALLOW', severity: 'INFO', reason: 'happy' },
      ],
    };

    const allowResult = evaluatePolicy(allowPolicy, baseInput);
    assert.strictEqual(allowResult.proposedAction, 'ALLOW');
    assert.strictEqual(allowResult.proposedFactoryAction, 'HOLD_FOR_HUMAN');

    const prodAllowPolicy: PolicyDocument = { ...allowPolicy, defaults: { learning_mode: false } };
    const prodAllowResult = evaluatePolicy(prodAllowPolicy, baseInput);
    assert.strictEqual(prodAllowResult.proposedAction, 'ALLOW');
    assert.strictEqual(prodAllowResult.proposedFactoryAction, 'APPROVE_AUTOMERGE_DEPLOY');

    const requireApprovalPolicy: PolicyDocument = {
      policy_version: 'aegis.policy.v1',
      rules: [
        { id: 'R1', when: 'ci.status == "success"', then: 'REQUIRE_APPROVAL', severity: 'HIGH', reason: 'needs approval' },
      ],
    };
    const requireApprovalResult = evaluatePolicy(requireApprovalPolicy, baseInput);
    assert.strictEqual(requireApprovalResult.proposedFactoryAction, 'HOLD_FOR_HUMAN');

    const holdPolicy: PolicyDocument = {
      policy_version: 'aegis.policy.v1',
      rules: [
        { id: 'H1', when: 'ci.status == "success"', then: 'HOLD_FOR_HUMAN', severity: 'HIGH', reason: 'manual check' },
      ],
    };
    const holdResult = evaluatePolicy(holdPolicy, baseInput);
    assert.strictEqual(holdResult.proposedFactoryAction, 'HOLD_FOR_HUMAN');

    const killPolicy: PolicyDocument = {
      policy_version: 'aegis.policy.v1',
      rules: [
        { id: 'K1', when: 'ci.status == "success"', then: 'KILL_AND_ROLLBACK', severity: 'BLOCK', reason: 'rollback' },
      ],
    };
    const killResult = evaluatePolicy(killPolicy, baseInput);
    assert.strictEqual(killResult.proposedFactoryAction, 'KILL_AND_ROLLBACK');
  });

  test('mapPolicyActionToFactoryAction helper provides deterministic mapping', () => {
    assert.strictEqual(mapPolicyActionToFactoryAction('KILL_AND_ROLLBACK', false), 'KILL_AND_ROLLBACK');
    assert.strictEqual(mapPolicyActionToFactoryAction('HOLD_FOR_HUMAN', false), 'HOLD_FOR_HUMAN');
    assert.strictEqual(mapPolicyActionToFactoryAction('REQUIRE_APPROVAL', false), 'HOLD_FOR_HUMAN');
    assert.strictEqual(mapPolicyActionToFactoryAction('ALLOW', true), 'HOLD_FOR_HUMAN');
    assert.strictEqual(mapPolicyActionToFactoryAction('ALLOW', false), 'APPROVE_AUTOMERGE_DEPLOY');
    assert.strictEqual(mapPolicyActionToFactoryAction('NONE', false), 'NONE');
  });

  test('quoted string literals evaluate, bare words fail fast', () => {
    const policy: PolicyDocument = {
      policy_version: 'aegis.policy.v1',
      rules: [
        { id: 'Q1', when: 'ci.status == "success"', then: 'ALLOW', severity: 'INFO', reason: 'quoted' },
      ],
    };

    const input: EvaluationInput = {
      ci: { status: 'success' },
      security: { critical_count: 0, high_count: 0 },
      change_flags: {
        infra_change: false,
        db_migration: false,
        auth_change: false,
        secrets_change: false,
        dependency_change: false,
      },
      canary: { error_rate: 0, latency_delta: 0 },
    };

    const quotedResult = evaluatePolicy(policy, input);
    assert.strictEqual(quotedResult.proposedAction, 'ALLOW');

    const badPolicy: PolicyDocument = {
      policy_version: 'aegis.policy.v1',
      rules: [
        { id: 'Q2', when: 'ci.status == success', then: 'ALLOW', severity: 'INFO', reason: 'unquoted' },
      ],
    };

    assert.throws(() => evaluatePolicy(badPolicy, input), /Expected literal/);
  });
});
