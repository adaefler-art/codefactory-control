import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';
import { EvaluationResult } from '../policy/types';
import {
  CanarySignal,
  ChangeSummary,
  CiSignal,
  PolicyEvaluationSnapshot,
  RationaleSection,
  Scorecard,
  VerdictDocument,
  VerdictEngineInput,
} from './types';

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const schemaPath = path.join(__dirname, 'schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validateVerdict = ajv.compile(schema);

const WEIGHTS = {
  tests: 0.25,
  security: 0.25,
  ops: 0.2,
  risk: 0.15,
  policy: 0.15,
};

const RISK_LEVEL_FROM_OVERALL = {
  LOW: { min: 75, max: 100 },
  MEDIUM: { min: 40, max: 74 },
  HIGH: { min: 0, max: 39 },
} as const;

export function buildPolicySnapshot(evalResult: EvaluationResult): PolicyEvaluationSnapshot {
  return {
    matched_rules: evalResult.matched.map((m) => ({
      rule_id: m.id,
      severity: m.severity,
      then: m.action,
      reason: m.reason,
    })),
    policy_action: evalResult.proposedAction,
    proposed_factory_action: evalResult.proposedFactoryAction,
  };
}

export function buildVerdict(input: VerdictEngineInput): VerdictDocument {
  assertInputs(input);

  const { run, inputs, policyEvaluation } = input;
  const scorecard = computeScorecard(inputs, policyEvaluation);
  const action = computeProposedAction(policyEvaluation, inputs, scorecard);
  const confidence = computeConfidence(scorecard.overall, scorecard.risk_level);
  const rationale = buildRationale(inputs, policyEvaluation, scorecard, action);

  const verdict: VerdictDocument = {
    schema_version: 'aegis.verdict.v1',
    policy_version: 'aegis.policy.v1',
    run,
    inputs,
    policy_evaluation: policyEvaluation,
    scorecard,
    verdict: {
      proposed_action: action,
      confidence,
      recommended_next_steps: rationale.recommended_next_steps,
    },
    rationale: {
      summary: rationale.summary,
      key_evidence_refs: rationale.key_evidence_refs,
    },
  };

  validateOrThrow(verdict);
  return verdict;
}

function assertInputs(input: VerdictEngineInput): void {
  if (!input) throw new Error('Missing verdict input');
  const { run, inputs, policyEvaluation } = input;
  if (!run?.run_id || !run.timestamp_utc || !run.repo || !run.pr_number || !run.head_sha) {
    throw new Error('Missing run metadata');
  }
  if (typeof inputs?.learning_mode !== 'boolean') {
    throw new Error('Missing learning_mode');
  }
  if (!inputs.change_summary) throw new Error('Missing change_summary');
  if (typeof inputs.change_summary.files_changed !== 'number') {
    throw new Error('Missing change_summary.files_changed');
  }
  if (!inputs.change_summary.change_flags) {
    throw new Error('Missing change_flags');
  }
  if (!inputs.signals?.ci || !inputs.signals.security) {
    throw new Error('Missing required signals (ci/security)');
  }
  if (!inputs.signals.ci.status) {
    throw new Error('Missing CI status');
  }
  if (policyEvaluation.proposed_factory_action === undefined) {
    throw new Error('Missing policyEvaluation');
  }
}

function computeScorecard(inputs: VerdictEngineInput['inputs'], policyEvaluation: PolicyEvaluationSnapshot): Scorecard {
  const tests = scoreTests(inputs.signals.ci);
  const security = scoreSecurity(inputs.signals.security);
  const ops = scoreOps(inputs.signals.canary);
  const risk = scoreRisk(inputs.change_summary);
  const policy = scorePolicy(policyEvaluation);

  const overall = Math.round(
    tests * WEIGHTS.tests +
      security * WEIGHTS.security +
      ops * WEIGHTS.ops +
      risk * WEIGHTS.risk +
      policy * WEIGHTS.policy
  );

  let risk_level = riskLevelFromOverall(overall);
  // Risk overrides for high-impact flags
  if (inputs.change_summary.change_flags.infra_change && inputs.change_summary.change_flags.db_migration) {
    risk_level = 'HIGH';
  } else if (inputs.change_summary.change_flags.infra_change || inputs.change_summary.change_flags.db_migration) {
    if (risk_level === 'LOW') risk_level = 'MEDIUM';
  }

  return {
    overall,
    dimensions: { tests, security, risk, ops, policy },
    risk_level,
  };
}

function scoreTests(ci: CiSignal): number {
  if (ci.status === 'failure') return 0;
  let score = 90;
  if (typeof ci.coverage_delta === 'number') {
    if (ci.coverage_delta <= -5) score -= 40;
    else if (ci.coverage_delta < 0) score -= 15;
    else if (ci.coverage_delta > 0) score += 5;
  }
  return clampScore(score);
}

function scoreSecurity(sec: { critical_count: number; high_count: number }): number {
  if (sec.critical_count > 0 || sec.high_count > 0) return 0;
  return 90;
}

function scoreOps(canary?: CanarySignal): number {
  if (!canary) return 70;
  if (!canary.passed) return 0;
  if (typeof canary.error_rate === 'number' && canary.error_rate > 0.02) return 0;
  if (typeof canary.latency_delta === 'number' && canary.latency_delta > 100) return 0;
  return 90;
}

function scoreRisk(summary: ChangeSummary): number {
  let score = 100;
  const flags = summary.change_flags;
  if (flags.infra_change) score -= 25;
  if (flags.db_migration) score -= 25;
  if (flags.auth_change) score -= 15;
  if (flags.secrets_change) score -= 20;
  if (flags.dependency_change) score -= 10;
  if (flags.permission_change) score -= 20;

  if (summary.files_changed > 200) score -= 20;
  else if (summary.files_changed > 50) score -= 10;

  if (summary.touched_paths && summary.touched_paths.length > 0) {
    const riskyTouches = summary.touched_paths.filter((p) =>
      ['infra', 'cdk', 'terraform', 'database', 'db', 'secrets'].some((token) => p.includes(token))
    ).length;
    if (riskyTouches > 0) score -= 5;
  }

  return clampScore(score);
}

function scorePolicy(policyEvaluation: PolicyEvaluationSnapshot): number {
  const severities = policyEvaluation.matched_rules.map((r) => r.severity);
  if (severities.includes('BLOCK')) return 0;
  if (severities.includes('HIGH')) return 60;
  if (severities.length > 0) return 85;
  return 75;
}

function riskLevelFromOverall(overall: number): Scorecard['risk_level'] {
  if (overall <= RISK_LEVEL_FROM_OVERALL.HIGH.max) return 'HIGH';
  if (overall <= RISK_LEVEL_FROM_OVERALL.MEDIUM.max) return 'MEDIUM';
  return 'LOW';
}

function computeProposedAction(
  policyEvaluation: PolicyEvaluationSnapshot,
  inputs: VerdictEngineInput['inputs'],
  scorecard: Scorecard
) {
  let action = policyEvaluation.proposed_factory_action === 'NONE'
    ? 'HOLD_FOR_HUMAN'
    : policyEvaluation.proposed_factory_action;

  // Hard overrides
  if (inputs.signals.ci.status === 'failure') action = 'KILL_AND_ROLLBACK';
  if (inputs.signals.canary && canaryFailed(inputs.signals.canary)) action = 'KILL_AND_ROLLBACK';
  if (inputs.signals.security.critical_count > 0 || inputs.signals.security.high_count > 0) {
    action = 'KILL_AND_ROLLBACK';
  }

  // Learning mode: never auto-approve
  if (inputs.learning_mode && action === 'APPROVE_AUTOMERGE_DEPLOY') {
    action = 'HOLD_FOR_HUMAN';
  }

  // Very low overall can also force a hold
  if (scorecard.overall < 40 && action === 'APPROVE_AUTOMERGE_DEPLOY') {
    action = 'HOLD_FOR_HUMAN';
  }

  return action;
}

function canaryFailed(canary: CanarySignal): boolean {
  if (!canary.passed) return true;
  if (typeof canary.error_rate === 'number' && canary.error_rate > 0.02) return true;
  if (typeof canary.latency_delta === 'number' && canary.latency_delta > 100) return true;
  return false;
}

function computeConfidence(overall: number, risk_level: Scorecard['risk_level']): number {
  const base = overall / 100;
  let confidence: number;
  switch (risk_level) {
    case 'HIGH':
      confidence = base * 0.5;
      break;
    case 'MEDIUM':
      confidence = base * 0.75;
      break;
    case 'LOW':
      confidence = 0.5 + base * 0.5;
      break;
    default:
      confidence = base * 0.5;
  }
  return clamp01(Number(confidence.toFixed(2)));
}

function buildRationale(
  inputs: VerdictEngineInput['inputs'],
  policyEvaluation: PolicyEvaluationSnapshot,
  scorecard: Scorecard,
  action: VerdictDocument['verdict']['proposed_action']
): { summary: string; key_evidence_refs: string[]; recommended_next_steps: string[] } {
  const blockers: string[] = [];
  const riskFlags: string[] = [];
  const steps: string[] = [];
  const signals = inputs.signals;

  if (signals.ci.status === 'failure') {
    blockers.push('CI failed');
    steps.push('Fix CI failures and rerun checks');
  }
  if (signals.canary && canaryFailed(signals.canary)) {
    blockers.push('Canary failed');
    steps.push('Investigate canary degradation');
  }
  if (signals.security.critical_count > 0 || signals.security.high_count > 0) {
    blockers.push('Security findings present');
    steps.push('Resolve security critical/high findings');
  }
  const highestPolicySeverity = policyEvaluation.matched_rules
    .map((r) => r.severity)
    .reduce<'BLOCK' | 'HIGH' | 'INFO' | undefined>((acc, cur) => {
      if (acc === 'BLOCK' || cur === 'BLOCK') return 'BLOCK';
      if (acc === 'HIGH' || cur === 'HIGH') return 'HIGH';
      return acc ?? cur;
    }, undefined);
  if (highestPolicySeverity === 'BLOCK') {
    blockers.push('Policy BLOCK rule matched');
    steps.push('Address policy BLOCK conditions');
  }

  const flags = inputs.change_summary.change_flags;
  if (flags.infra_change) {
    riskFlags.push('infra_change');
    steps.push('Review infra diff (CDK)');
  }
  if (flags.db_migration) {
    riskFlags.push('db_migration');
    steps.push('Add migration rollback plan');
  }
  if (flags.auth_change) {
    riskFlags.push('auth_change');
    steps.push('Review auth changes');
  }
  if (flags.secrets_change) {
    riskFlags.push('secrets_change');
    steps.push('Verify secrets handling');
  }
  if (flags.dependency_change) {
    riskFlags.push('dependency_change');
    steps.push('Confirm dependency bumps are intended');
  }
  if (flags.permission_change) {
    riskFlags.push('permission_change');
    steps.push('Validate permission changes');
  }
  if (typeof signals.ci.coverage_delta === 'number' && signals.ci.coverage_delta < 0) {
    steps.push('Address coverage regressions');
  }

  const summaryParts: string[] = [];
  summaryParts.push(`Action=${action}`);
  summaryParts.push(`Score=${scorecard.overall} (${scorecard.risk_level})`);
  summaryParts.push(`Policy=${policyEvaluation.policy_action}`);
  if (blockers.length > 0) summaryParts.push(`Blockers=${blockers.join(', ')}`);
  if (riskFlags.length > 0) summaryParts.push(`Risks=${riskFlags.join(', ')}`);

  const key_evidence_refs: string[] = [];
  const firstCiCheck = signals.ci.checks?.find((c) => !!c.url);
  if (firstCiCheck?.url) key_evidence_refs.push(firstCiCheck.url);

  return {
    summary: summaryParts.join('; '),
    key_evidence_refs,
    recommended_next_steps: dedupeStrings(steps),
  };
}

function clampScore(score: number): number {
  if (score < 0) return 0;
  if (score > 100) return 100;
  return Math.round(score);
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((v) => {
    if (!seen.has(v)) {
      seen.add(v);
      result.push(v);
    }
  });
  return result;
}

function validateOrThrow(doc: VerdictDocument): void {
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
