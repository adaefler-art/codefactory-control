export interface PolicyRule {
  id: string;
  when: string;
  then: 'KILL_AND_ROLLBACK' | 'HOLD_FOR_HUMAN' | 'REQUIRE_APPROVAL' | 'ALLOW';
  severity: 'BLOCK' | 'HIGH' | 'INFO';
  reason: string;
}

export type PolicyAction = PolicyRule['then'];
export type FactoryAction = 'APPROVE_AUTOMERGE_DEPLOY' | 'HOLD_FOR_HUMAN' | 'KILL_AND_ROLLBACK';

export interface PolicyDefaults {
  learning_mode?: boolean;
}

export interface PolicyDocument {
  policy_version: string;
  defaults?: PolicyDefaults;
  rules: PolicyRule[];
}

export interface EvaluationInput {
  ci: {
    status: string;
  };
  security: {
    critical_count: number;
    high_count: number;
  };
  change_flags: {
    infra_change: boolean;
    db_migration: boolean;
    auth_change: boolean;
    secrets_change: boolean;
    dependency_change: boolean;
  };
  canary: {
    error_rate: number;
    latency_delta: number;
  };
}

export interface MatchedRuleResult {
  id: string;
  severity: PolicyRule['severity'];
  action: PolicyRule['then'];
  reason: string;
}

export interface EvaluationResult {
  matched: MatchedRuleResult[];
  highestSeverity: PolicyRule['severity'] | 'NONE';
  proposedAction: PolicyAction | 'NONE';
  proposedFactoryAction: FactoryAction | 'NONE';
}
