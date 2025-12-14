import { FactoryAction, PolicyAction, PolicyRule } from '../policy/types';

export type VerdictSchemaVersion = 'aegis.verdict.v1';

export interface RunMetadata {
  run_id: string;
  timestamp_utc: string; // ISO-8601 UTC timestamp
  repo: string; // owner/repo
  pr_number: number;
  head_sha: string;
}

export interface ChangeFlags {
  infra_change: boolean;
  db_migration: boolean;
  auth_change: boolean;
  secrets_change: boolean;
  dependency_change: boolean;
  permission_change?: boolean;
}

export interface ChangeSummary {
  files_changed: number;
  touched_paths?: string[];
  change_flags: ChangeFlags;
}

export interface CiSignal {
  status: 'success' | 'failure';
  coverage_delta?: number;
  checks?: Array<{ name: string; url?: string; conclusion?: string }>;
}

export interface SecuritySignal {
  critical_count: number;
  high_count: number;
}

export interface CanarySignal {
  passed: boolean;
  error_rate?: number;
  latency_delta?: number;
}

export interface Signals {
  ci: CiSignal;
  security: SecuritySignal;
  canary?: CanarySignal;
}

export interface VerdictInputs {
  learning_mode: boolean;
  change_summary: ChangeSummary;
  signals: Signals;
}

export interface PolicyEvaluationSnapshot {
  matched_rules: Array<{ rule_id: string; severity: PolicyRule['severity']; then: PolicyAction; reason: string }>;
  policy_action: PolicyAction | 'NONE';
  proposed_factory_action: FactoryAction | 'NONE';
}

export interface ScorecardDimensions {
  tests: number;
  security: number;
  risk: number;
  ops: number;
  policy: number;
}

export interface Scorecard {
  overall: number;
  dimensions: ScorecardDimensions;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface VerdictSection {
  proposed_action: FactoryAction;
  confidence: number;
  recommended_next_steps: string[];
}

export interface RationaleSection {
  summary: string;
  key_evidence_refs: string[];
}

export interface VerdictDocument {
  schema_version: VerdictSchemaVersion;
  policy_version: 'aegis.policy.v1';
  run: RunMetadata;
  inputs: VerdictInputs;
  policy_evaluation: PolicyEvaluationSnapshot;
  scorecard: Scorecard;
  verdict: VerdictSection;
  rationale: RationaleSection;
}

export interface VerdictEngineInput {
  run: RunMetadata;
  policyEvaluation: PolicyEvaluationSnapshot;
  inputs: VerdictInputs;
}
