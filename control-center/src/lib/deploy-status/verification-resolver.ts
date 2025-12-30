import type { Pool } from 'pg';
import type {
  CreateDeployStatusInput,
  DeployEnvironment,
  DeployStatus,
  StatusReason,
  StatusSignals,
} from '@/lib/contracts/deployStatus';
import { listPlaybookRuns } from '@/lib/db/playbookRuns';
import { getPlaybookRunResult } from '@/lib/playbook-executor';

const POST_DEPLOY_VERIFY_PLAYBOOK_ID = 'post-deploy-verify';

export const VERIFICATION_REASON_CODES = {
  NO_RUN: 'NO_VERIFICATION_RUN',
  RUNNING: 'VERIFICATION_RUNNING',
  SUCCESS: 'VERIFICATION_SUCCESS',
  FAILED: 'VERIFICATION_FAILED',
  UNKNOWN: 'VERIFICATION_UNKNOWN',
  WRONG_PLAYBOOK: 'VERIFICATION_WRONG_PLAYBOOK',
  NOT_FOUND: 'VERIFICATION_NOT_FOUND',
} as const;

function isUuid(value: string): boolean {
  // Accept common UUID-like strings (8-4-4-4-12 hex). We intentionally do not
  // enforce RFC variant/version bits to keep correlationId handling permissive.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function deriveStatusFromRunStatus(runStatus: string | null | undefined): {
  status: DeployStatus;
  reason: StatusReason;
} {
  switch (runStatus) {
    case 'success':
      return {
        status: 'GREEN',
        reason: {
          code: VERIFICATION_REASON_CODES.SUCCESS,
          severity: 'info',
          message: 'Latest post-deploy verification run succeeded',
        },
      };
    case 'failed':
      return {
        status: 'RED',
        reason: {
          code: VERIFICATION_REASON_CODES.FAILED,
          severity: 'error',
          message: 'Latest post-deploy verification run failed',
        },
      };
    case 'running':
    case 'pending':
      return {
        status: 'YELLOW',
        reason: {
          code: VERIFICATION_REASON_CODES.RUNNING,
          severity: 'warning',
          message: 'Latest post-deploy verification run is still running',
        },
      };
    case 'timeout':
    case 'cancelled':
      return {
        status: 'RED',
        reason: {
          code: VERIFICATION_REASON_CODES.FAILED,
          severity: 'error',
          message: `Latest post-deploy verification run did not succeed (${runStatus})`,
        },
      };
    default:
      return {
        status: 'YELLOW',
        reason: {
          code: VERIFICATION_REASON_CODES.UNKNOWN,
          severity: 'warning',
          message: 'Latest post-deploy verification run has unknown status',
          evidence: { run_status: runStatus ?? null },
        },
      };
  }
}

export async function resolveDeployStatusFromVerificationRuns(
  pool: Pool,
  options: {
    env: DeployEnvironment;
    correlationId?: string;
  }
): Promise<CreateDeployStatusInput> {
  const nowIso = new Date().toISOString();
  const correlationId = options.correlationId?.trim() || undefined;

  // Optional correlationId support (MVP):
  // - If it looks like a UUID, treat it as a playbook run ID.
  // - Otherwise, we can only return the latest run for the env because playbook_runs
  //   does not currently persist correlation IDs.
  if (correlationId && isUuid(correlationId)) {
    const runResult = await getPlaybookRunResult(pool, correlationId);

    if (!runResult) {
      return {
        env: options.env,
        status: 'YELLOW',
        observed_at: nowIso,
        reasons: [
          {
            code: VERIFICATION_REASON_CODES.NOT_FOUND,
            severity: 'warning',
            message: 'Requested verification run was not found',
            evidence: { correlation_id: correlationId },
          },
        ],
        signals: {
          checked_at: nowIso,
          correlation_id: correlationId,
          verification_run: null,
        },
        staleness_seconds: 0,
      };
    }

    if (runResult.playbookId !== POST_DEPLOY_VERIFY_PLAYBOOK_ID) {
      return {
        env: options.env,
        status: 'YELLOW',
        observed_at: runResult.completedAt || runResult.createdAt,
        reasons: [
          {
            code: VERIFICATION_REASON_CODES.WRONG_PLAYBOOK,
            severity: 'warning',
            message: 'Requested run is not a post-deploy verification run',
            evidence: {
              correlation_id: correlationId,
              run_id: runResult.id,
              playbook_id: runResult.playbookId,
            },
          },
        ],
        signals: {
          checked_at: nowIso,
          correlation_id: correlationId,
          verification_run: {
            run_id: runResult.id,
            playbook_id: runResult.playbookId,
            playbook_version: runResult.playbookVersion,
            env: runResult.env,
            status: runResult.status,
            created_at: runResult.createdAt,
            started_at: runResult.startedAt,
            completed_at: runResult.completedAt,
          },
        },
        staleness_seconds: Math.max(
          0,
          Math.floor((Date.now() - new Date(runResult.completedAt || runResult.createdAt).getTime()) / 1000)
        ),
      };
    }

    const derived = deriveStatusFromRunStatus(runResult.status);
    const observedAt = runResult.completedAt || runResult.createdAt;

    return {
      env: options.env,
      status: derived.status,
      observed_at: observedAt,
      reasons: [
        {
          ...derived.reason,
          evidence: {
            ...(derived.reason.evidence || {}),
            correlation_id: correlationId,
            run_id: runResult.id,
            run_status: runResult.status,
          },
        },
      ],
      signals: {
        checked_at: nowIso,
        correlation_id: correlationId,
        verification_run: {
          run_id: runResult.id,
          playbook_id: runResult.playbookId,
          playbook_version: runResult.playbookVersion,
          env: runResult.env,
          status: runResult.status,
          created_at: runResult.createdAt,
          started_at: runResult.startedAt,
          completed_at: runResult.completedAt,
        },
      },
      staleness_seconds: Math.max(0, Math.floor((Date.now() - new Date(observedAt).getTime()) / 1000)),
    };
  }

  const latestRuns = await listPlaybookRuns(pool, {
    playbookId: POST_DEPLOY_VERIFY_PLAYBOOK_ID,
    env: options.env,
    limit: 1,
    offset: 0,
  });

  if (!latestRuns || latestRuns.length === 0) {
    const reasons: StatusReason[] = [
      {
        code: VERIFICATION_REASON_CODES.NO_RUN,
        severity: 'warning',
        message: 'No post-deploy verification run found for this environment',
        evidence: correlationId ? { correlation_id: correlationId } : undefined,
      },
    ];

    const signals: StatusSignals = {
      checked_at: nowIso,
      ...(correlationId ? { correlation_id: correlationId } : {}),
      verification_run: null,
    };

    return {
      env: options.env,
      status: 'YELLOW',
      observed_at: nowIso,
      reasons,
      signals,
      staleness_seconds: 0,
    };
  }

  const run = latestRuns[0];
  const derived = deriveStatusFromRunStatus(run.status);
  const observedAt = run.completed_at || run.created_at;

  const reasons: StatusReason[] = [
    {
      ...derived.reason,
      evidence: {
        ...(derived.reason.evidence || {}),
        ...(correlationId ? { correlation_id: correlationId } : {}),
        run_id: run.id,
        run_status: run.status,
      },
    },
  ];

  const signals: StatusSignals = {
    checked_at: nowIso,
    ...(correlationId ? { correlation_id: correlationId } : {}),
    verification_run: {
      run_id: run.id,
      playbook_id: run.playbook_id,
      playbook_version: run.playbook_version,
      env: run.env,
      status: run.status,
      created_at: run.created_at,
      started_at: run.started_at,
      completed_at: run.completed_at,
    },
  };

  return {
    env: options.env,
    status: derived.status,
    observed_at: observedAt,
    reasons,
    signals,
    staleness_seconds: Math.max(0, Math.floor((Date.now() - new Date(observedAt).getTime()) / 1000)),
  };
}
