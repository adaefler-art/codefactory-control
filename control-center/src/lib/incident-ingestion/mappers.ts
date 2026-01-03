/**
 * Incident Ingestion Mappers (E76.2 / I762)
 * 
 * Pure, deterministic functions that transform AFU-9 signals into normalized Incident records.
 * Each mapper follows the same contract:
 * - Input: concrete signal/evidence
 * - Output: IncidentInput or null (if no incident should be created)
 * - Idempotent: stable incident_key generation
 * - No side effects: pure data transformation
 * 
 * Signal Sources:
 * 1. Deploy Status Monitor (E65.1): YELLOW/RED status changes
 * 2. Post-Deploy Verification (E65.2): playbook run failures
 * 3. ECS Events: stopped/failed tasks
 * 4. GitHub Actions Runner: step failures
 * 
 * Reference: I762 (E76.2 - Incident Ingestion Pipelines)
 */

import {
  IncidentInput,
  IncidentSeverity,
  generateDeployStatusIncidentKey,
  generateVerificationIncidentKey,
  generateEcsStoppedIncidentKey,
  generateRunnerIncidentKey,
} from '../contracts/incident';
import {
  DeployStatus,
  StatusReason,
  StatusSignals,
} from '../contracts/deployStatus';

// ========================================
// Error Codes
// ========================================

export const ERROR_CODES = {
  DEPLOY_STATUS_YELLOW: 'DEPLOY_STATUS_YELLOW',
  DEPLOY_STATUS_RED: 'DEPLOY_STATUS_RED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  VERIFICATION_TIMEOUT: 'VERIFICATION_TIMEOUT',
  ECS_TASK_STOPPED: 'ECS_TASK_STOPPED',
  ECS_TASK_FAILED: 'ECS_TASK_FAILED',
  RUNNER_STEP_FAILED: 'RUNNER_STEP_FAILED',
  RUNNER_STEP_TIMEOUT: 'RUNNER_STEP_TIMEOUT',
} as const;

// ========================================
// 1. Deploy Status Mapper (E65.1)
// ========================================

export interface DeployStatusSignal {
  env: string;
  status: DeployStatus;
  changedAt: string; // ISO 8601 timestamp
  signals: StatusSignals;
  reasons: StatusReason[];
  deployId?: string;
}

/**
 * Map Deploy Status signal to IncidentInput
 * 
 * Rules:
 * - GREEN → null (no incident)
 * - YELLOW → YELLOW incident
 * - RED → RED incident
 * 
 * incident_key: deploy_status:<env>:<deployId|unknown>:<changedAt>
 */
export function mapDeployStatusToIncident(
  signal: DeployStatusSignal
): IncidentInput | null {
  // GREEN status does not create an incident
  if (signal.status === 'GREEN') {
    return null;
  }

  // Extract deployId or use "unknown"
  const deployId = signal.deployId || 'unknown';
  
  // Generate stable incident_key
  const incident_key = generateDeployStatusIncidentKey(
    signal.env,
    deployId,
    signal.changedAt
  );

  // Determine severity based on status
  const severity: IncidentSeverity = signal.status as IncidentSeverity;

  // Build title
  const title = `Deploy status ${signal.status} in ${signal.env}`;

  // Build summary from reasons
  const summary = signal.reasons
    .map((r) => `[${r.severity}] ${r.code}: ${r.message}`)
    .join('\n');

  // Determine error code
  const errorCode =
    signal.status === 'YELLOW'
      ? ERROR_CODES.DEPLOY_STATUS_YELLOW
      : ERROR_CODES.DEPLOY_STATUS_RED;

  // Build tags
  const tags = [
    'deploy_status',
    signal.env,
    `status:${signal.status.toLowerCase()}`,
  ];

  if (deployId !== 'unknown') {
    tags.push(`deploy:${deployId}`);
  }

  return {
    incident_key,
    severity,
    status: 'OPEN',
    title,
    summary,
    classification: {
      error_code: errorCode,
      signal_type: 'deploy_status',
      auto_generated: true,
    },
    lawbook_version: null,
    source_primary: {
      kind: 'deploy_status',
      ref: {
        env: signal.env,
        status: signal.status,
        changedAt: signal.changedAt,
        deployId,
        reasons: signal.reasons,
      },
    },
    tags,
    first_seen_at: signal.changedAt,
    last_seen_at: signal.changedAt,
  };
}

// ========================================
// 2. Verification Failure Mapper (E65.2)
// ========================================

export interface VerificationSignal {
  runId: string;
  playbookId: string;
  playbookVersion: string;
  env: string;
  status: 'failed' | 'timeout';
  deployId?: string;
  failedSteps?: Array<{
    id: string;
    title: string;
    error?: string;
  }>;
  completedAt: string; // ISO 8601 timestamp
  reportHash?: string; // sha256 of verification report
}

/**
 * Map Verification failure to IncidentInput
 * 
 * incident_key: verification:<deployId>:<reportHash>
 * 
 * If reportHash is not available, falls back to:
 * verification:<deployId>:<runId>
 */
export function mapVerificationFailureToIncident(
  signal: VerificationSignal
): IncidentInput | null {
  // Only process failed/timeout statuses
  if (signal.status !== 'failed' && signal.status !== 'timeout') {
    return null;
  }

  const deployId = signal.deployId || 'unknown';
  const reportHash = signal.reportHash || signal.runId;

  // Generate stable incident_key
  const incident_key = generateVerificationIncidentKey(deployId, reportHash);

  // Verification failures are always RED severity
  const severity: IncidentSeverity = 'RED';

  // Build title
  const title = `Post-deploy verification ${signal.status} in ${signal.env}`;

  // Build summary
  let summary = `Playbook: ${signal.playbookId} v${signal.playbookVersion}\n`;
  summary += `Run: ${signal.runId}\n`;
  summary += `Status: ${signal.status}\n`;

  if (signal.failedSteps && signal.failedSteps.length > 0) {
    summary += '\nFailed steps:\n';
    signal.failedSteps.forEach((step) => {
      summary += `- ${step.title} (${step.id})`;
      if (step.error) {
        summary += `: ${step.error}`;
      }
      summary += '\n';
    });
  }

  // Determine error code
  const errorCode =
    signal.status === 'timeout'
      ? ERROR_CODES.VERIFICATION_TIMEOUT
      : ERROR_CODES.VERIFICATION_FAILED;

  // Build tags
  const tags = [
    'verification',
    signal.env,
    `playbook:${signal.playbookId}`,
    `status:${signal.status}`,
  ];

  if (deployId !== 'unknown') {
    tags.push(`deploy:${deployId}`);
  }

  return {
    incident_key,
    severity,
    status: 'OPEN',
    title,
    summary,
    classification: {
      error_code: errorCode,
      signal_type: 'verification',
      playbook_id: signal.playbookId,
      playbook_version: signal.playbookVersion,
      auto_generated: true,
    },
    lawbook_version: null,
    source_primary: {
      kind: 'verification',
      ref: {
        runId: signal.runId,
        playbookId: signal.playbookId,
        playbookVersion: signal.playbookVersion,
        env: signal.env,
        status: signal.status,
        completedAt: signal.completedAt,
        deployId,
        failedSteps: signal.failedSteps,
      },
    },
    tags,
    first_seen_at: signal.completedAt,
    last_seen_at: signal.completedAt,
  };
}

// ========================================
// 3. ECS Stopped Task Mapper
// ========================================

export interface EcsStoppedTaskSignal {
  cluster: string;
  taskArn: string;
  taskDefinition?: string;
  stoppedAt: string; // ISO 8601 timestamp
  stoppedReason?: string;
  exitCode?: number;
  lastStatus?: string;
  containers?: Array<{
    name: string;
    exitCode?: number;
    reason?: string;
  }>;
}

/**
 * Map ECS stopped task to IncidentInput
 * 
 * incident_key: ecs_stopped:<cluster>:<taskArn>:<stoppedAt>
 * 
 * Severity determination:
 * - exitCode !== 0 → RED
 * - stoppedReason indicates error → RED
 * - Otherwise → YELLOW
 */
export function mapEcsStoppedTaskToIncident(
  signal: EcsStoppedTaskSignal
): IncidentInput | null {
  // Generate stable incident_key
  const incident_key = generateEcsStoppedIncidentKey(
    signal.cluster,
    signal.taskArn,
    signal.stoppedAt
  );

  // Determine severity based on exit code and reason
  let severity: IncidentSeverity = 'YELLOW';
  let errorCode: typeof ERROR_CODES.ECS_TASK_STOPPED | typeof ERROR_CODES.ECS_TASK_FAILED = ERROR_CODES.ECS_TASK_STOPPED;

  // Check if this is a failure (non-zero exit code or error reason)
  const hasFailure =
    signal.exitCode !== undefined && signal.exitCode !== 0;
  
  const reasonIndicatesError =
    signal.stoppedReason &&
    (signal.stoppedReason.toLowerCase().includes('error') ||
      signal.stoppedReason.toLowerCase().includes('fail') ||
      signal.stoppedReason.toLowerCase().includes('crash'));

  if (hasFailure || reasonIndicatesError) {
    severity = 'RED';
    errorCode = ERROR_CODES.ECS_TASK_FAILED;
  }

  // Build title
  const taskId = signal.taskArn.split('/').pop() || signal.taskArn;
  const title = `ECS task stopped in ${signal.cluster}: ${taskId}`;

  // Build summary
  let summary = `Task: ${signal.taskArn}\n`;
  if (signal.taskDefinition) {
    summary += `Task Definition: ${signal.taskDefinition}\n`;
  }
  summary += `Last Status: ${signal.lastStatus || 'unknown'}\n`;
  if (signal.exitCode !== undefined) {
    summary += `Exit Code: ${signal.exitCode}\n`;
  }
  if (signal.stoppedReason) {
    summary += `Stopped Reason: ${signal.stoppedReason}\n`;
  }
  if (signal.containers && signal.containers.length > 0) {
    summary += '\nContainers:\n';
    signal.containers.forEach((container) => {
      summary += `- ${container.name}`;
      if (container.exitCode !== undefined) {
        summary += ` (exit: ${container.exitCode})`;
      }
      if (container.reason) {
        summary += `: ${container.reason}`;
      }
      summary += '\n';
    });
  }

  // Build tags
  const tags = [
    'ecs',
    'task_stopped',
    `cluster:${signal.cluster}`,
  ];

  if (signal.taskDefinition) {
    // Extract task definition name from ARN format:
    // arn:aws:ecs:region:account:task-definition/name:version
    // or just name:version
    const parts = signal.taskDefinition.split('/');
    const nameWithVersion = parts[parts.length - 1]; // Get last part after /
    const taskDefName = nameWithVersion.split(':')[0]; // Remove version
    if (taskDefName) {
      tags.push(`task_def:${taskDefName}`);
    }
  }

  return {
    incident_key,
    severity,
    status: 'OPEN',
    title,
    summary,
    classification: {
      error_code: errorCode,
      signal_type: 'ecs_event',
      exit_code: signal.exitCode,
      auto_generated: true,
    },
    lawbook_version: null,
    source_primary: {
      kind: 'ecs_event',
      ref: {
        cluster: signal.cluster,
        taskArn: signal.taskArn,
        taskDefinition: signal.taskDefinition,
        stoppedAt: signal.stoppedAt,
        stoppedReason: signal.stoppedReason,
        exitCode: signal.exitCode,
        lastStatus: signal.lastStatus,
        containers: signal.containers,
      },
    },
    tags,
    first_seen_at: signal.stoppedAt,
    last_seen_at: signal.stoppedAt,
  };
}

// ========================================
// 4. GitHub Actions Runner Mapper
// ========================================

export interface RunnerStepFailureSignal {
  runId: string; // GitHub Actions run ID
  runUrl?: string;
  stepName: string;
  conclusion: 'failure' | 'timeout' | 'cancelled';
  completedAt: string; // ISO 8601 timestamp
  errorMessage?: string;
  jobName?: string;
  workflowName?: string;
  repository?: string;
  ref?: string; // branch/tag
}

/**
 * Map GitHub Actions runner step failure to IncidentInput
 * 
 * incident_key: runner:<runId>:<stepName>:<conclusion>
 * 
 * Severity:
 * - failure/timeout → RED
 * - cancelled → YELLOW
 */
export function mapRunnerStepFailureToIncident(
  signal: RunnerStepFailureSignal
): IncidentInput | null {
  // Only process failure, timeout, cancelled
  if (
    signal.conclusion !== 'failure' &&
    signal.conclusion !== 'timeout' &&
    signal.conclusion !== 'cancelled'
  ) {
    return null;
  }

  // Generate stable incident_key
  const incident_key = generateRunnerIncidentKey(
    signal.runId,
    signal.stepName,
    signal.conclusion
  );

  // Determine severity
  const severity: IncidentSeverity =
    signal.conclusion === 'cancelled' ? 'YELLOW' : 'RED';

  // Determine error code
  let errorCode: typeof ERROR_CODES.RUNNER_STEP_FAILED | typeof ERROR_CODES.RUNNER_STEP_TIMEOUT = ERROR_CODES.RUNNER_STEP_FAILED;
  if (signal.conclusion === 'timeout') {
    errorCode = ERROR_CODES.RUNNER_STEP_TIMEOUT;
  }

  // Build title
  let title = `GitHub Actions ${signal.conclusion}: ${signal.stepName}`;
  if (signal.workflowName) {
    title = `Workflow ${signal.workflowName} ${signal.conclusion}: ${signal.stepName}`;
  }

  // Build summary
  let summary = `Run ID: ${signal.runId}\n`;
  if (signal.workflowName) {
    summary += `Workflow: ${signal.workflowName}\n`;
  }
  if (signal.jobName) {
    summary += `Job: ${signal.jobName}\n`;
  }
  summary += `Step: ${signal.stepName}\n`;
  summary += `Conclusion: ${signal.conclusion}\n`;
  if (signal.repository) {
    summary += `Repository: ${signal.repository}\n`;
  }
  if (signal.ref) {
    summary += `Ref: ${signal.ref}\n`;
  }
  if (signal.errorMessage) {
    summary += `\nError:\n${signal.errorMessage}\n`;
  }
  if (signal.runUrl) {
    summary += `\nRun URL: ${signal.runUrl}\n`;
  }

  // Build tags
  const tags = [
    'github_runner',
    `conclusion:${signal.conclusion}`,
  ];

  if (signal.workflowName) {
    tags.push(`workflow:${signal.workflowName}`);
  }

  if (signal.repository) {
    tags.push(`repo:${signal.repository}`);
  }

  return {
    incident_key,
    severity,
    status: 'OPEN',
    title,
    summary,
    classification: {
      error_code: errorCode,
      signal_type: 'runner',
      conclusion: signal.conclusion,
      auto_generated: true,
    },
    lawbook_version: null,
    source_primary: {
      kind: 'runner',
      ref: {
        runId: signal.runId,
        runUrl: signal.runUrl,
        stepName: signal.stepName,
        conclusion: signal.conclusion,
        completedAt: signal.completedAt,
        errorMessage: signal.errorMessage,
        jobName: signal.jobName,
        workflowName: signal.workflowName,
        repository: signal.repository,
        ref: signal.ref,
      },
    },
    tags,
    first_seen_at: signal.completedAt,
    last_seen_at: signal.completedAt,
  };
}

// ========================================
// Validation Helpers
// ========================================

/**
 * Validate DeployStatusSignal
 */
export function validateDeployStatusSignal(
  signal: unknown
): { valid: boolean; error?: string } {
  if (!signal || typeof signal !== 'object') {
    return { valid: false, error: 'Signal must be an object' };
  }

  const s = signal as any;

  if (!s.env || typeof s.env !== 'string') {
    return { valid: false, error: 'env is required and must be a string' };
  }

  if (!['GREEN', 'YELLOW', 'RED'].includes(s.status)) {
    return { valid: false, error: 'status must be GREEN, YELLOW, or RED' };
  }

  if (!s.changedAt || typeof s.changedAt !== 'string') {
    return { valid: false, error: 'changedAt is required and must be an ISO 8601 string' };
  }

  if (!s.signals || typeof s.signals !== 'object') {
    return { valid: false, error: 'signals is required and must be an object' };
  }

  if (!Array.isArray(s.reasons)) {
    return { valid: false, error: 'reasons must be an array' };
  }

  return { valid: true };
}

/**
 * Validate VerificationSignal
 */
export function validateVerificationSignal(
  signal: unknown
): { valid: boolean; error?: string } {
  if (!signal || typeof signal !== 'object') {
    return { valid: false, error: 'Signal must be an object' };
  }

  const s = signal as any;

  if (!s.runId || typeof s.runId !== 'string') {
    return { valid: false, error: 'runId is required and must be a string' };
  }

  if (!s.playbookId || typeof s.playbookId !== 'string') {
    return { valid: false, error: 'playbookId is required and must be a string' };
  }

  if (!s.env || typeof s.env !== 'string') {
    return { valid: false, error: 'env is required and must be a string' };
  }

  if (!['failed', 'timeout'].includes(s.status)) {
    return { valid: false, error: 'status must be failed or timeout' };
  }

  if (!s.completedAt || typeof s.completedAt !== 'string') {
    return { valid: false, error: 'completedAt is required and must be an ISO 8601 string' };
  }

  return { valid: true };
}

/**
 * Validate EcsStoppedTaskSignal
 */
export function validateEcsStoppedTaskSignal(
  signal: unknown
): { valid: boolean; error?: string } {
  if (!signal || typeof signal !== 'object') {
    return { valid: false, error: 'Signal must be an object' };
  }

  const s = signal as any;

  if (!s.cluster || typeof s.cluster !== 'string') {
    return { valid: false, error: 'cluster is required and must be a string' };
  }

  if (!s.taskArn || typeof s.taskArn !== 'string') {
    return { valid: false, error: 'taskArn is required and must be a string' };
  }

  if (!s.stoppedAt || typeof s.stoppedAt !== 'string') {
    return { valid: false, error: 'stoppedAt is required and must be an ISO 8601 string' };
  }

  return { valid: true };
}

/**
 * Validate RunnerStepFailureSignal
 */
export function validateRunnerStepFailureSignal(
  signal: unknown
): { valid: boolean; error?: string } {
  if (!signal || typeof signal !== 'object') {
    return { valid: false, error: 'Signal must be an object' };
  }

  const s = signal as any;

  if (!s.runId || typeof s.runId !== 'string') {
    return { valid: false, error: 'runId is required and must be a string' };
  }

  if (!s.stepName || typeof s.stepName !== 'string') {
    return { valid: false, error: 'stepName is required and must be a string' };
  }

  if (!['failure', 'timeout', 'cancelled'].includes(s.conclusion)) {
    return { valid: false, error: 'conclusion must be failure, timeout, or cancelled' };
  }

  if (!s.completedAt || typeof s.completedAt !== 'string') {
    return { valid: false, error: 'completedAt is required and must be an ISO 8601 string' };
  }

  return { valid: true };
}
