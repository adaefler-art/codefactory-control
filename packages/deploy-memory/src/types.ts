/**
 * AFU-9 Deploy Memory Types
 */

export interface CfnFailureSignal {
  resourceType: string;
  logicalId: string;
  statusReason: string;
  timestamp: Date;
  physicalResourceId?: string;
  resourceStatus?: string;
}

export interface CdkOutputSignal {
  stackName: string;
  resourceType?: string;
  error: string;
  timestamp: Date;
}

export type FailureSignal = CfnFailureSignal | CdkOutputSignal;

export type ErrorClass =
  | 'ACM_DNS_VALIDATION_PENDING'
  | 'ROUTE53_DELEGATION_PENDING'
  | 'CFN_IN_PROGRESS_LOCK'
  | 'CFN_ROLLBACK_LOCK'
  | 'MISSING_SECRET'
  | 'MISSING_ENV_VAR'
  | 'DEPRECATED_CDK_API'
  | 'UNIT_MISMATCH'
  | 'UNKNOWN';

export interface FailureClassification {
  fingerprintId: string;
  errorClass: ErrorClass;
  service: string;
  confidence: number;
  tokens: string[];
}

export type FactoryAction = 'WAIT_AND_RETRY' | 'OPEN_ISSUE' | 'HUMAN_REQUIRED';

export interface Playbook {
  fingerprintId: string;
  errorClass: ErrorClass;
  steps: string; // Markdown-formatted steps
  proposedFactoryAction: FactoryAction;
  guardrails: string[];
}

export interface DeployMemoryEvent {
  fingerprintId: string;
  errorClass: ErrorClass;
  service: string;
  confidence: number;
  tokens: string[];
  timestamp: string;
  stackName?: string;
  region?: string;
  rawSignals: string; // JSON stringified signals
}

export interface DeployMemoryRecommendation {
  fingerprintId: string;
  proposedFactoryAction: FactoryAction;
  recommendedSteps: string;
  confidence: number;
  errorClass: ErrorClass;
}
