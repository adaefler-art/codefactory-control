/**
 * Incident Ingestion Mappers Tests (E76.2 / I762)
 * 
 * Tests for pure mapper functions:
 * - Deploy Status → Incident
 * - Verification → Incident
 * - ECS Events → Incident
 * - Runner → Incident
 * 
 * All tests verify:
 * - Deterministic output (same input → same output)
 * - Stable incident_key generation
 * - Proper severity mapping
 * - Null handling for non-incident signals
 * 
 * @jest-environment node
 */

import {
  mapDeployStatusToIncident,
  mapVerificationFailureToIncident,
  mapEcsStoppedTaskToIncident,
  mapRunnerStepFailureToIncident,
  DeployStatusSignal,
  VerificationSignal,
  EcsStoppedTaskSignal,
  RunnerStepFailureSignal,
  validateDeployStatusSignal,
  validateVerificationSignal,
  validateEcsStoppedTaskSignal,
  validateRunnerStepFailureSignal,
  ERROR_CODES,
} from '../../../src/lib/incident-ingestion/mappers';

describe('Incident Ingestion Mappers', () => {
  describe('mapDeployStatusToIncident', () => {
    test('GREEN status returns null (no incident)', () => {
      const signal: DeployStatusSignal = {
        env: 'prod',
        status: 'GREEN',
        changedAt: '2024-01-01T00:00:00Z',
        signals: {
          checkedAt: '2024-01-01T00:00:00Z',
        },
        reasons: [],
        deployId: 'deploy-123',
      };

      const result = mapDeployStatusToIncident(signal);

      expect(result).toBeNull();
    });

    test('YELLOW status creates YELLOW incident', () => {
      const signal: DeployStatusSignal = {
        env: 'prod',
        status: 'YELLOW',
        changedAt: '2024-01-01T00:00:00Z',
        signals: {
          checkedAt: '2024-01-01T00:00:00Z',
        },
        reasons: [
          {
            code: 'READY_DEGRADED',
            severity: 'warning',
            message: 'Ready endpoint degraded',
          },
        ],
        deployId: 'deploy-123',
      };

      const result = mapDeployStatusToIncident(signal);

      expect(result).not.toBeNull();
      expect(result?.severity).toBe('YELLOW');
      expect(result?.status).toBe('OPEN');
      expect(result?.title).toBe('Deploy status YELLOW in prod');
      expect(result?.incident_key).toBe('deploy_status:prod:deploy-123:2024-01-01T00:00:00Z');
      expect(result?.tags).toContain('deploy_status');
      expect(result?.tags).toContain('prod');
      expect(result?.tags).toContain('status:yellow');
      expect(result?.classification?.error_code).toBe(ERROR_CODES.DEPLOY_STATUS_YELLOW);
    });

    test('RED status creates RED incident', () => {
      const signal: DeployStatusSignal = {
        env: 'prod',
        status: 'RED',
        changedAt: '2024-01-01T00:00:00Z',
        signals: {
          checkedAt: '2024-01-01T00:00:00Z',
        },
        reasons: [
          {
            code: 'HEALTH_FAIL',
            severity: 'error',
            message: 'Health endpoint failed',
          },
        ],
        deployId: 'deploy-123',
      };

      const result = mapDeployStatusToIncident(signal);

      expect(result).not.toBeNull();
      expect(result?.severity).toBe('RED');
      expect(result?.status).toBe('OPEN');
      expect(result?.title).toBe('Deploy status RED in prod');
      expect(result?.incident_key).toBe('deploy_status:prod:deploy-123:2024-01-01T00:00:00Z');
      expect(result?.classification?.error_code).toBe(ERROR_CODES.DEPLOY_STATUS_RED);
    });

    test('missing deployId uses "unknown" in incident_key', () => {
      const signal: DeployStatusSignal = {
        env: 'stage',
        status: 'YELLOW',
        changedAt: '2024-01-02T00:00:00Z',
        signals: {
          checkedAt: '2024-01-02T00:00:00Z',
        },
        reasons: [],
      };

      const result = mapDeployStatusToIncident(signal);

      expect(result?.incident_key).toBe('deploy_status:stage:unknown:2024-01-02T00:00:00Z');
      expect(result?.tags).not.toContain('deploy:unknown');
    });

    test('includes reasons in summary', () => {
      const signal: DeployStatusSignal = {
        env: 'prod',
        status: 'RED',
        changedAt: '2024-01-01T00:00:00Z',
        signals: {
          checkedAt: '2024-01-01T00:00:00Z',
        },
        reasons: [
          {
            code: 'HEALTH_FAIL',
            severity: 'error',
            message: 'Health check failed',
          },
          {
            code: 'READY_FAIL',
            severity: 'error',
            message: 'Ready check failed',
          },
        ],
        deployId: 'deploy-123',
      };

      const result = mapDeployStatusToIncident(signal);

      expect(result?.summary).toContain('[error] HEALTH_FAIL: Health check failed');
      expect(result?.summary).toContain('[error] READY_FAIL: Ready check failed');
    });

    test('deterministic: same input produces same output', () => {
      const signal: DeployStatusSignal = {
        env: 'prod',
        status: 'YELLOW',
        changedAt: '2024-01-01T00:00:00Z',
        signals: {
          checkedAt: '2024-01-01T00:00:00Z',
        },
        reasons: [],
        deployId: 'deploy-123',
      };

      const result1 = mapDeployStatusToIncident(signal);
      const result2 = mapDeployStatusToIncident(signal);

      expect(result1).toEqual(result2);
    });
  });

  describe('mapVerificationFailureToIncident', () => {
    test('failed status creates RED incident', () => {
      const signal: VerificationSignal = {
        runId: 'run-123',
        playbookId: 'post-deploy-verify',
        playbookVersion: '1.0.0',
        env: 'prod',
        status: 'failed',
        deployId: 'deploy-123',
        completedAt: '2024-01-01T00:00:00Z',
        reportHash: 'sha256-abc123',
      };

      const result = mapVerificationFailureToIncident(signal);

      expect(result).not.toBeNull();
      expect(result?.severity).toBe('RED');
      expect(result?.status).toBe('OPEN');
      expect(result?.title).toBe('Post-deploy verification failed in prod');
      expect(result?.incident_key).toBe('verification:deploy-123:sha256-abc123');
      expect(result?.tags).toContain('verification');
      expect(result?.tags).toContain('prod');
      expect(result?.tags).toContain('playbook:post-deploy-verify');
      expect(result?.classification?.error_code).toBe(ERROR_CODES.VERIFICATION_FAILED);
    });

    test('timeout status creates RED incident with timeout error code', () => {
      const signal: VerificationSignal = {
        runId: 'run-456',
        playbookId: 'post-deploy-verify',
        playbookVersion: '1.0.0',
        env: 'stage',
        status: 'timeout',
        completedAt: '2024-01-01T00:00:00Z',
      };

      const result = mapVerificationFailureToIncident(signal);

      expect(result).not.toBeNull();
      expect(result?.severity).toBe('RED');
      expect(result?.title).toBe('Post-deploy verification timeout in stage');
      expect(result?.classification?.error_code).toBe(ERROR_CODES.VERIFICATION_TIMEOUT);
    });

    test('falls back to runId when reportHash is missing', () => {
      const signal: VerificationSignal = {
        runId: 'run-789',
        playbookId: 'post-deploy-verify',
        playbookVersion: '1.0.0',
        env: 'prod',
        status: 'failed',
        deployId: 'deploy-456',
        completedAt: '2024-01-01T00:00:00Z',
      };

      const result = mapVerificationFailureToIncident(signal);

      expect(result?.incident_key).toBe('verification:deploy-456:run-789');
    });

    test('includes failed steps in summary', () => {
      const signal: VerificationSignal = {
        runId: 'run-123',
        playbookId: 'post-deploy-verify',
        playbookVersion: '1.0.0',
        env: 'prod',
        status: 'failed',
        completedAt: '2024-01-01T00:00:00Z',
        failedSteps: [
          {
            id: 'step-1',
            title: 'Health check',
            error: 'HTTP 500',
          },
          {
            id: 'step-2',
            title: 'Database check',
          },
        ],
      };

      const result = mapVerificationFailureToIncident(signal);

      expect(result?.summary).toContain('Failed steps:');
      expect(result?.summary).toContain('Health check (step-1): HTTP 500');
      expect(result?.summary).toContain('Database check (step-2)');
    });

    test('non-failed status returns null', () => {
      const signal: any = {
        runId: 'run-123',
        playbookId: 'post-deploy-verify',
        playbookVersion: '1.0.0',
        env: 'prod',
        status: 'success',
        completedAt: '2024-01-01T00:00:00Z',
      };

      const result = mapVerificationFailureToIncident(signal);

      expect(result).toBeNull();
    });
  });

  describe('mapEcsStoppedTaskToIncident', () => {
    test('stopped task with exit code 0 creates YELLOW incident', () => {
      const signal: EcsStoppedTaskSignal = {
        cluster: 'prod-cluster',
        taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/prod-cluster/abc123',
        taskDefinition: 'control-center:1',
        stoppedAt: '2024-01-01T00:00:00Z',
        stoppedReason: 'Task stopped normally',
        exitCode: 0,
        lastStatus: 'STOPPED',
      };

      const result = mapEcsStoppedTaskToIncident(signal);

      expect(result).not.toBeNull();
      expect(result?.severity).toBe('YELLOW');
      expect(result?.status).toBe('OPEN');
      expect(result?.title).toContain('ECS task stopped in prod-cluster');
      expect(result?.incident_key).toBe(
        'ecs_stopped:prod-cluster:arn:aws:ecs:us-east-1:123456789012:task/prod-cluster/abc123:2024-01-01T00:00:00Z'
      );
      expect(result?.classification?.error_code).toBe(ERROR_CODES.ECS_TASK_STOPPED);
    });

    test('stopped task with non-zero exit code creates RED incident', () => {
      const signal: EcsStoppedTaskSignal = {
        cluster: 'prod-cluster',
        taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/prod-cluster/abc123',
        stoppedAt: '2024-01-01T00:00:00Z',
        exitCode: 1,
        stoppedReason: 'Task failed',
      };

      const result = mapEcsStoppedTaskToIncident(signal);

      expect(result?.severity).toBe('RED');
      expect(result?.classification?.error_code).toBe(ERROR_CODES.ECS_TASK_FAILED);
    });

    test('error reason creates RED incident', () => {
      const signal: EcsStoppedTaskSignal = {
        cluster: 'prod-cluster',
        taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/prod-cluster/abc123',
        stoppedAt: '2024-01-01T00:00:00Z',
        stoppedReason: 'Task encountered an error during startup',
      };

      const result = mapEcsStoppedTaskToIncident(signal);

      expect(result?.severity).toBe('RED');
      expect(result?.classification?.error_code).toBe(ERROR_CODES.ECS_TASK_FAILED);
    });

    test('includes container details in summary', () => {
      const signal: EcsStoppedTaskSignal = {
        cluster: 'prod-cluster',
        taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/prod-cluster/abc123',
        stoppedAt: '2024-01-01T00:00:00Z',
        containers: [
          {
            name: 'app',
            exitCode: 137,
            reason: 'OutOfMemory',
          },
          {
            name: 'sidecar',
            exitCode: 0,
          },
        ],
      };

      const result = mapEcsStoppedTaskToIncident(signal);

      expect(result?.summary).toContain('Containers:');
      expect(result?.summary).toContain('app (exit: 137): OutOfMemory');
      expect(result?.summary).toContain('sidecar (exit: 0)');
    });

    test('extracts task definition name for tags', () => {
      const signal: EcsStoppedTaskSignal = {
        cluster: 'prod-cluster',
        taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/prod-cluster/abc123',
        taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/control-center:1',
        stoppedAt: '2024-01-01T00:00:00Z',
      };

      const result = mapEcsStoppedTaskToIncident(signal);

      expect(result?.tags).toContain('task_def:control-center');
    });
  });

  describe('mapRunnerStepFailureToIncident', () => {
    test('failure conclusion creates RED incident', () => {
      const signal: RunnerStepFailureSignal = {
        runId: '123456789',
        stepName: 'Build',
        conclusion: 'failure',
        completedAt: '2024-01-01T00:00:00Z',
        workflowName: 'CI',
        jobName: 'build-job',
        repository: 'adaefler-art/codefactory-control',
        ref: 'refs/heads/main',
      };

      const result = mapRunnerStepFailureToIncident(signal);

      expect(result).not.toBeNull();
      expect(result?.severity).toBe('RED');
      expect(result?.status).toBe('OPEN');
      expect(result?.title).toBe('Workflow CI failure: Build');
      expect(result?.incident_key).toBe('runner:123456789:Build:failure');
      expect(result?.tags).toContain('github_runner');
      expect(result?.tags).toContain('conclusion:failure');
      expect(result?.tags).toContain('workflow:CI');
      expect(result?.classification?.error_code).toBe(ERROR_CODES.RUNNER_STEP_FAILED);
    });

    test('timeout conclusion creates RED incident with timeout error code', () => {
      const signal: RunnerStepFailureSignal = {
        runId: '987654321',
        stepName: 'Deploy',
        conclusion: 'timeout',
        completedAt: '2024-01-01T00:00:00Z',
      };

      const result = mapRunnerStepFailureToIncident(signal);

      expect(result?.severity).toBe('RED');
      expect(result?.classification?.error_code).toBe(ERROR_CODES.RUNNER_STEP_TIMEOUT);
    });

    test('cancelled conclusion creates YELLOW incident', () => {
      const signal: RunnerStepFailureSignal = {
        runId: '555555555',
        stepName: 'Test',
        conclusion: 'cancelled',
        completedAt: '2024-01-01T00:00:00Z',
      };

      const result = mapRunnerStepFailureToIncident(signal);

      expect(result?.severity).toBe('YELLOW');
    });

    test('includes error message in summary', () => {
      const signal: RunnerStepFailureSignal = {
        runId: '123456789',
        stepName: 'Build',
        conclusion: 'failure',
        completedAt: '2024-01-01T00:00:00Z',
        errorMessage: 'Build failed: compilation error in src/main.ts',
      };

      const result = mapRunnerStepFailureToIncident(signal);

      expect(result?.summary).toContain('Error:');
      expect(result?.summary).toContain('Build failed: compilation error in src/main.ts');
    });

    test('includes run URL in summary', () => {
      const signal: RunnerStepFailureSignal = {
        runId: '123456789',
        stepName: 'Build',
        conclusion: 'failure',
        completedAt: '2024-01-01T00:00:00Z',
        runUrl: 'https://github.com/user/repo/actions/runs/123456789',
      };

      const result = mapRunnerStepFailureToIncident(signal);

      expect(result?.summary).toContain('Run URL: https://github.com/user/repo/actions/runs/123456789');
    });

    test('success conclusion returns null', () => {
      const signal: any = {
        runId: '123456789',
        stepName: 'Build',
        conclusion: 'success',
        completedAt: '2024-01-01T00:00:00Z',
      };

      const result = mapRunnerStepFailureToIncident(signal);

      expect(result).toBeNull();
    });
  });

  describe('Validation Helpers', () => {
    test('validateDeployStatusSignal accepts valid signal', () => {
      const signal: DeployStatusSignal = {
        env: 'prod',
        status: 'YELLOW',
        changedAt: '2024-01-01T00:00:00Z',
        signals: { checkedAt: '2024-01-01T00:00:00Z' },
        reasons: [],
      };

      const result = validateDeployStatusSignal(signal);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('validateDeployStatusSignal rejects invalid status', () => {
      const signal = {
        env: 'prod',
        status: 'ORANGE',
        changedAt: '2024-01-01T00:00:00Z',
        signals: {},
        reasons: [],
      };

      const result = validateDeployStatusSignal(signal);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('status must be GREEN, YELLOW, or RED');
    });

    test('validateVerificationSignal accepts valid signal', () => {
      const signal: VerificationSignal = {
        runId: 'run-123',
        playbookId: 'verify',
        playbookVersion: '1.0.0',
        env: 'prod',
        status: 'failed',
        completedAt: '2024-01-01T00:00:00Z',
      };

      const result = validateVerificationSignal(signal);

      expect(result.valid).toBe(true);
    });

    test('validateEcsStoppedTaskSignal accepts valid signal', () => {
      const signal: EcsStoppedTaskSignal = {
        cluster: 'prod',
        taskArn: 'arn:aws:ecs:us-east-1:123:task/abc',
        stoppedAt: '2024-01-01T00:00:00Z',
      };

      const result = validateEcsStoppedTaskSignal(signal);

      expect(result.valid).toBe(true);
    });

    test('validateRunnerStepFailureSignal accepts valid signal', () => {
      const signal: RunnerStepFailureSignal = {
        runId: '123',
        stepName: 'Build',
        conclusion: 'failure',
        completedAt: '2024-01-01T00:00:00Z',
      };

      const result = validateRunnerStepFailureSignal(signal);

      expect(result.valid).toBe(true);
    });

    test('validateRunnerStepFailureSignal rejects invalid conclusion', () => {
      const signal = {
        runId: '123',
        stepName: 'Build',
        conclusion: 'skipped',
        completedAt: '2024-01-01T00:00:00Z',
      };

      const result = validateRunnerStepFailureSignal(signal);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('conclusion must be failure, timeout, or cancelled');
    });
  });
});
