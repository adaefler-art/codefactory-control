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
    lawbookVersion?: string | null;
  }
): Promise<CreateDeployStatusInput> {
  const nowIso = new Date().toISOString();
  const correlationId = options.correlationId?.trim() || undefined;
  const lawbookVersion = options.lawbookVersion ?? null;

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
        observedAt: nowIso,
        reasons: [
          {
            code: VERIFICATION_REASON_CODES.NOT_FOUND,
            severity: 'warning',
            message: 'Requested verification run was not found',
            evidence: { correlationId },
          },
        ],
        signals: {
          checkedAt: nowIso,
          correlationId,
          verificationRun: null,
          lawbookVersion,
        },
        stalenessSeconds: 0,
      };
    }

    if (runResult.playbookId !== POST_DEPLOY_VERIFY_PLAYBOOK_ID) {
      return {
        env: options.env,
        status: 'YELLOW',
        observedAt: runResult.completedAt || runResult.createdAt,
        reasons: [
          {
            code: VERIFICATION_REASON_CODES.WRONG_PLAYBOOK,
            severity: 'warning',
            message: 'Requested run is not a post-deploy verification run',
            evidence: {
              correlationId,
              runId: runResult.id,
              playbookId: runResult.playbookId,
            },
          },
        ],
        signals: {
          checkedAt: nowIso,
          correlationId,
          verificationRun: {
            runId: runResult.id,
            playbookId: runResult.playbookId,
            playbookVersion: runResult.playbookVersion,
            env: runResult.env,
            status: runResult.status,
            createdAt: runResult.createdAt,
            startedAt: runResult.startedAt,
            completedAt: runResult.completedAt,
          },
          lawbookVersion,
        },
        stalenessSeconds: Math.max(
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
      observedAt,
      reasons: [
        {
          ...derived.reason,
          evidence: {
            ...(derived.reason.evidence || {}),
            correlationId,
            runId: runResult.id,
            runStatus: runResult.status,
          },
        },
      ],
      signals: {
        checkedAt: nowIso,
        correlationId,
        verificationRun: {
          runId: runResult.id,
          playbookId: runResult.playbookId,
          playbookVersion: runResult.playbookVersion,
          env: runResult.env,
          status: runResult.status,
          createdAt: runResult.createdAt,
          startedAt: runResult.startedAt,
          completedAt: runResult.completedAt,
        },
        lawbookVersion,
      },
      stalenessSeconds: Math.max(0, Math.floor((Date.now() - new Date(observedAt).getTime()) / 1000)),
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
        evidence: correlationId ? { correlationId } : undefined,
      },
    ];

    const signals: StatusSignals = {
      checkedAt: nowIso,
      ...(correlationId ? { correlationId } : {}),
      verificationRun: null,
      lawbookVersion,
    };

    return {
      env: options.env,
      status: 'YELLOW',
      observedAt: nowIso,
      reasons,
      signals,
      stalenessSeconds: 0,
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
        ...(correlationId ? { correlationId } : {}),
        runId: run.id,
        runStatus: run.status,
      },
    },
  ];

  const signals: StatusSignals = {
    checkedAt: nowIso,
    ...(correlationId ? { correlationId } : {}),
    verificationRun: {
      runId: run.id,
      playbookId: run.playbook_id,
      playbookVersion: run.playbook_version,
      env: run.env,
      status: run.status,
      createdAt: run.created_at,
      startedAt: run.started_at,
      completedAt: run.completed_at,
    },
    lawbookVersion,
  };

  return {
    env: options.env,
    status: derived.status,
    observedAt,
    reasons,
    signals,
    stalenessSeconds: Math.max(0, Math.floor((Date.now() - new Date(observedAt).getTime()) / 1000)),
  };
}
