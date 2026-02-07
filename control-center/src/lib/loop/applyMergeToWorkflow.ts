/**
 * Apply merge results to AFU-9 workflow state and mesh updates.
 *
 * Single source of truth for post-merge state updates.
 */

import type { Pool, PoolClient } from "pg";
import { logger } from "@/lib/logger";
import { IssueEvidenceType } from "@/lib/contracts/issueEvidence";
import { IssueTimelineEventType, ActorType } from "@/lib/contracts/issueTimeline";
import { recordEvidence } from "@/lib/db/issueEvidence";
import { logTimelineEvent } from "@/lib/db/issueTimeline";
import { recordTimelineEvent as recordUnifiedTimelineEvent } from "@/lib/db/unifiedTimelineEvents";
import { IssueState } from "./stateMachine";
import { getStageRegistryEntry, getStageRegistryError } from "@/lib/stage-registry";

export type ApplyMergeInput = {
  pool: Pool;
  issueId?: string;
  repository?: {
    owner: string;
    repo: string;
  };
  prNumber: number;
  prUrl?: string;
  mergeSha?: string | null;
  mergedAt?: string | null;
  requestId: string;
  source?: "webhook" | "executor" | "poller";
};

export type ApplyMergeResult =
  | {
      ok: true;
      issueId: string;
      stateBefore: string;
      stateAfter: string;
      fromStep: string;
      toStep: string;
      updatedAt: string;
    }
  | {
      ok: false;
      code: "ENGINE_MISCONFIGURED";
      message: string;
      requestId: string;
      reason?: string;
    }
  | {
      ok: false;
      code: "MESH_UPDATE_FAILED";
      message: string;
      requestId: string;
      reason?: string;
    };

const FROM_STEP = "S5";
const TO_STEP = "S6";

function buildPrUrl(repository: ApplyMergeInput["repository"], prNumber: number): string | null {
  if (!repository) return null;
  return `https://github.com/${repository.owner}/${repository.repo}/pull/${prNumber}`;
}

function buildUpdateFailed(requestId: string, message: string, reason?: string): ApplyMergeResult {
  return {
    ok: false,
    code: "MESH_UPDATE_FAILED",
    message,
    requestId,
    reason,
  };
}

async function loadIssueById(client: PoolClient, issueId: string) {
  const result = await client.query(
    `SELECT id, status, pr_url
     FROM afu9_issues
     WHERE id = $1`,
    [issueId]
  );
  return result.rows[0] as { id: string; status: string; pr_url?: string | null } | undefined;
}

async function loadIssueByPrUrl(client: PoolClient, prUrl: string) {
  const result = await client.query(
    `SELECT id, status, pr_url
     FROM afu9_issues
     WHERE pr_url = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [prUrl]
  );
  return result.rows[0] as { id: string; status: string; pr_url?: string | null } | undefined;
}

export async function applyMergeToWorkflow(input: ApplyMergeInput): Promise<ApplyMergeResult> {
  const stageEntry = getStageRegistryEntry("S5");
  const mergeRoute = stageEntry?.routes.merge;
  if (!stageEntry || !mergeRoute?.handler) {
    const registryError = getStageRegistryError("S5");
    return {
      ok: false,
      code: registryError.code,
      message: registryError.message,
      requestId: input.requestId,
      reason: "registry",
    };
  }

  const prUrl = input.prUrl || buildPrUrl(input.repository, input.prNumber) || undefined;

  const client = await input.pool.connect();
  try {
    await client.query("BEGIN");

    const tx = { query: client.query.bind(client) } as unknown as Pool;

    const issue = input.issueId
      ? await loadIssueById(client, input.issueId)
      : prUrl
        ? await loadIssueByPrUrl(client, prUrl)
        : undefined;

    if (!issue) {
      await client.query("ROLLBACK");
      return buildUpdateFailed(
        input.requestId,
        "Issue not found for merged PR",
        prUrl ? `prUrl=${prUrl}` : "issueId missing"
      );
    }

    const stateBefore = issue.status;
    const stateAfter = IssueState.DONE;

    if (stateBefore !== stateAfter) {
      await client.query(
        `UPDATE afu9_issues
         SET status = $1, updated_at = NOW()
         WHERE id = $2`,
        [stateAfter, issue.id]
      );
    }

    const mergeSha = input.mergeSha ?? null;
    const mergedAt = input.mergedAt ?? new Date().toISOString();

    await logTimelineEvent(tx, {
      issue_id: issue.id,
      event_type: IssueTimelineEventType.STATE_CHANGED,
      event_data: {
        from: stateBefore,
        to: stateAfter,
        fromStep: FROM_STEP,
        toStep: TO_STEP,
        prUrl: prUrl ?? issue.pr_url ?? null,
        prNumber: input.prNumber,
        mergeSha,
        mergedAt,
        requestId: input.requestId,
        source: input.source ?? "unknown",
      },
      actor: "system",
      actor_type: ActorType.SYSTEM,
    });

    await recordEvidence(tx, {
      issue_id: issue.id,
      evidence_type: IssueEvidenceType.STATE_TRANSITION_RECEIPT,
      evidence_data: {
        from: stateBefore,
        to: stateAfter,
        fromStep: FROM_STEP,
        toStep: TO_STEP,
        prUrl: prUrl ?? issue.pr_url ?? null,
        prNumber: input.prNumber,
        mergeSha,
        mergedAt,
        requestId: input.requestId,
        source: input.source ?? "unknown",
      },
      request_id: input.requestId,
    });

    await recordUnifiedTimelineEvent(tx, {
      event_type: "afu9.mesh.updated",
      timestamp: new Date().toISOString(),
      actor: "system",
      subject_type: "afu9_issue",
      subject_identifier: issue.id,
      request_id: input.requestId,
      pr_number: input.prNumber,
      summary: `mesh updated ${FROM_STEP}->${TO_STEP} for PR #${input.prNumber}`,
      details: {
        fromStep: FROM_STEP,
        toStep: TO_STEP,
        mergeSha,
        mergedAt,
        prUrl: prUrl ?? issue.pr_url ?? null,
        source: input.source ?? "unknown",
      },
    });

    await client.query("COMMIT");

    logger.info(
      "Applied merge to workflow",
      {
        issueId: issue.id,
        stateBefore,
        stateAfter,
        prNumber: input.prNumber,
        requestId: input.requestId,
      },
      "applyMergeToWorkflow"
    );

    return {
      ok: true,
      issueId: issue.id,
      stateBefore,
      stateAfter,
      fromStep: FROM_STEP,
      toStep: TO_STEP,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");

    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      "Failed to apply merge to workflow",
      error instanceof Error ? error : new Error(String(error)),
      {
        requestId: input.requestId,
        prNumber: input.prNumber,
        issueId: input.issueId,
      },
      "applyMergeToWorkflow"
    );

    return buildUpdateFailed(input.requestId, "Mesh update failed", message);
  } finally {
    client.release();
  }
}
