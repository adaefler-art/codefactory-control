/**
 * Remediation Playbook Registry (I772 / E77.2)
 * 
 * Central registry for all remediation playbooks.
 * Provides lookup by ID and category.
 */

import { PlaybookDefinition } from '../contracts/remediation-playbook';
import { 
  SAFE_RETRY_RUNNER_PLAYBOOK,
  executeDispatchRunner,
  executePollRunner,
  executeIngestRunner,
  computeDispatchIdempotencyKey,
  computePollIdempotencyKey,
  computeIngestIdempotencyKey,
} from './safe-retry-runner';
import {
  RERUN_POST_DEPLOY_VERIFICATION_PLAYBOOK,
  executeRunVerification,
  executeIngestIncidentUpdate,
  computeVerificationIdempotencyKey,
  computeIncidentUpdateIdempotencyKey,
} from './rerun-post-deploy-verification';
import {
  REDEPLOY_LKG_PLAYBOOK,
  executeSelectLkg,
  executeDispatchDeploy,
  executePostDeployVerification,
  executeUpdateDeployStatus,
  computeSelectLkgIdempotencyKey,
  computeDispatchDeployIdempotencyKey,
  computeVerificationIdempotencyKey as computeLkgVerificationIdempotencyKey,
  computeUpdateStatusIdempotencyKey,
} from './redeploy-lkg';
import {
  SERVICE_HEALTH_RESET_PLAYBOOK,
  executeSnapshotState,
  executeApplyReset,
  executeWaitAndObserve,
  executePostVerification,
  executeUpdateStatus,
  computeSnapshotIdempotencyKey,
  computeResetIdempotencyKey,
  computeObserveIdempotencyKey,
  computeVerificationIdempotencyKey as computeHealthResetVerificationIdempotencyKey,
  computeStatusUpdateIdempotencyKey,
} from './service-health-reset';
import { Pool } from 'pg';
import { StepContext, StepResult } from '../contracts/remediation-playbook';

/**
 * Step executor function type
 */
export type StepExecutorFunction = (
  pool: Pool,
  context: StepContext
) => Promise<StepResult>;

/**
 * Idempotency key function type
 */
export type IdempotencyKeyFunction = (context: StepContext) => string;

/**
 * Playbook with executable steps
 */
export interface ExecutablePlaybook {
  definition: PlaybookDefinition;
  stepExecutors: Map<string, StepExecutorFunction>;
  idempotencyKeyFns: Map<string, IdempotencyKeyFunction>;
}

/**
 * Map of step executors for SAFE_RETRY_RUNNER
 */
const safeRetryRunnerExecutors = new Map<string, StepExecutorFunction>([
  ['dispatch-runner', executeDispatchRunner],
  ['poll-runner', executePollRunner],
  ['ingest-runner', executeIngestRunner],
]);

/**
 * Map of idempotency key functions for SAFE_RETRY_RUNNER
 */
const safeRetryRunnerIdempotencyFns = new Map<string, IdempotencyKeyFunction>([
  ['dispatch-runner', computeDispatchIdempotencyKey],
  ['poll-runner', computePollIdempotencyKey],
  ['ingest-runner', computeIngestIdempotencyKey],
]);

/**
 * Map of step executors for RERUN_POST_DEPLOY_VERIFICATION
 */
const rerunPostDeployVerificationExecutors = new Map<string, StepExecutorFunction>([
  ['run-verification', executeRunVerification],
  ['ingest-incident-update', executeIngestIncidentUpdate],
]);

/**
 * Map of idempotency key functions for RERUN_POST_DEPLOY_VERIFICATION
 */
const rerunPostDeployVerificationIdempotencyFns = new Map<string, IdempotencyKeyFunction>([
  ['run-verification', computeVerificationIdempotencyKey],
  ['ingest-incident-update', computeIncidentUpdateIdempotencyKey],
]);

/**
 * Map of step executors for REDEPLOY_LKG
 */
const redeployLkgExecutors = new Map<string, StepExecutorFunction>([
  ['select-lkg', executeSelectLkg],
  ['dispatch-deploy', executeDispatchDeploy],
  ['post-deploy-verification', executePostDeployVerification],
  ['update-deploy-status', executeUpdateDeployStatus],
]);

/**
 * Map of idempotency key functions for REDEPLOY_LKG
 */
const redeployLkgIdempotencyFns = new Map<string, IdempotencyKeyFunction>([
  ['select-lkg', computeSelectLkgIdempotencyKey],
  ['dispatch-deploy', computeDispatchDeployIdempotencyKey],
  ['post-deploy-verification', computeLkgVerificationIdempotencyKey],
  ['update-deploy-status', computeUpdateStatusIdempotencyKey],
]);

/**
 * Map of step executors for SERVICE_HEALTH_RESET
 */
const serviceHealthResetExecutors = new Map<string, StepExecutorFunction>([
  ['snapshot-state', executeSnapshotState],
  ['apply-reset', executeApplyReset],
  ['wait-observe', executeWaitAndObserve],
  ['post-verification', executePostVerification],
  ['update-status', executeUpdateStatus],
]);

/**
 * Map of idempotency key functions for SERVICE_HEALTH_RESET
 */
const serviceHealthResetIdempotencyFns = new Map<string, IdempotencyKeyFunction>([
  ['snapshot-state', computeSnapshotIdempotencyKey],
  ['apply-reset', computeResetIdempotencyKey],
  ['wait-observe', computeObserveIdempotencyKey],
  ['post-verification', computeHealthResetVerificationIdempotencyKey],
  ['update-status', computeStatusUpdateIdempotencyKey],
]);

/**
 * Registry of all playbooks
 */
const PLAYBOOK_REGISTRY = new Map<string, ExecutablePlaybook>([
  [
    'safe-retry-runner',
    {
      definition: SAFE_RETRY_RUNNER_PLAYBOOK,
      stepExecutors: safeRetryRunnerExecutors,
      idempotencyKeyFns: safeRetryRunnerIdempotencyFns,
    },
  ],
  [
    'rerun-post-deploy-verification',
    {
      definition: RERUN_POST_DEPLOY_VERIFICATION_PLAYBOOK,
      stepExecutors: rerunPostDeployVerificationExecutors,
      idempotencyKeyFns: rerunPostDeployVerificationIdempotencyFns,
    },
  ],
  [
    'redeploy-lkg',
    {
      definition: REDEPLOY_LKG_PLAYBOOK,
      stepExecutors: redeployLkgExecutors,
      idempotencyKeyFns: redeployLkgIdempotencyFns,
    },
  ],
  [
    'service-health-reset',
    {
      definition: SERVICE_HEALTH_RESET_PLAYBOOK,
      stepExecutors: serviceHealthResetExecutors,
      idempotencyKeyFns: serviceHealthResetIdempotencyFns,
    },
  ],
]);

/**
 * Get playbook by ID
 */
export function getPlaybookById(id: string): ExecutablePlaybook | undefined {
  return PLAYBOOK_REGISTRY.get(id);
}

/**
 * Get all playbooks applicable to a category
 */
export function getPlaybooksByCategory(category: string): ExecutablePlaybook[] {
  const playbooks: ExecutablePlaybook[] = [];
  
  for (const playbook of PLAYBOOK_REGISTRY.values()) {
    if (playbook.definition.applicableCategories.includes(category)) {
      playbooks.push(playbook);
    }
  }
  
  return playbooks;
}

/**
 * Get all playbook definitions
 */
export function getAllPlaybooks(): ExecutablePlaybook[] {
  return Array.from(PLAYBOOK_REGISTRY.values());
}

/**
 * Check if playbook exists
 */
export function hasPlaybook(id: string): boolean {
  return PLAYBOOK_REGISTRY.has(id);
}
