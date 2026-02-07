import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getPool } from '@/lib/db';
import { verifyGitHubSignature } from '@/lib/webhooks/signature';
import { recordGitHubWebhookDelivery } from '@/lib/webhooks/persistence';
import { getGitHubWebhookSecret } from '@/lib/github-app-auth';
import { postGitHubIssueComment } from '@/lib/github/auth-wrapper';
import { applyMergeToWorkflow } from '@/lib/loop/applyMergeToWorkflow';

export async function handleGitHubWebhook(rawBody: Buffer, headers: Headers): Promise<Response> {
  const signature = headers.get('x-hub-signature-256');
  const eventType = headers.get('x-github-event');
  const deliveryId = headers.get('x-github-delivery');

  if (!signature) {
    return NextResponse.json({ ok: false, error: 'missing_signature' }, { status: 401 });
  }

  if (!eventType || !deliveryId) {
    return NextResponse.json({ ok: false, error: 'missing_required_headers' }, { status: 400 });
  }

  const webhookSecret = await getGitHubWebhookSecret();
  const valid = verifyGitHubSignature(rawBody, signature, webhookSecret);
  if (!valid) {
    return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  console.log('[GitHubWebhook]', {
    delivery_id: deliveryId,
    event_type: eventType,
    action: payload?.action,
  });

  const pool = getPool();
  const requestId = deliveryId || randomUUID();

  const repositoryFullName: string | undefined =
    typeof payload?.repository?.full_name === 'string' ? payload.repository.full_name : undefined;

  const deliveryRecord = await recordGitHubWebhookDelivery(pool, {
    delivery_id: deliveryId,
    event_type: eventType,
    repository_full_name: repositoryFullName,
  });

  if (!deliveryRecord.inserted) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  if (
    eventType === 'pull_request' &&
    payload?.action === 'closed' &&
    payload?.pull_request?.merged === true
  ) {
    const owner = payload?.repository?.owner?.login;
    const repo = payload?.repository?.name;
    const prNumber = payload?.pull_request?.number;
    const prUrl = payload?.pull_request?.html_url;
    const mergeSha = payload?.pull_request?.merge_commit_sha;
    const mergedAt = payload?.pull_request?.merged_at;

    if (typeof owner !== 'string' || typeof repo !== 'string' || typeof prNumber !== 'number') {
      console.warn('[GitHubWebhook] Missing PR merge metadata', {
        delivery_id: deliveryId,
      });
      return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
    }

    const meshResult = await applyMergeToWorkflow({
      pool,
      repository: { owner, repo },
      prNumber,
      prUrl: typeof prUrl === 'string' ? prUrl : undefined,
      mergeSha: typeof mergeSha === 'string' ? mergeSha : null,
      mergedAt: typeof mergedAt === 'string' ? mergedAt : null,
      requestId,
      source: 'webhook',
    });

    if (!meshResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          code: meshResult.code,
          message: meshResult.message,
          requestId,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        issueId: meshResult.issueId,
        requestId,
      },
      { status: 200 }
    );
  }

  // Minimal roundtrip: issues.opened -> comment
  if (eventType === 'issues' && payload?.action === 'opened') {
    const owner = payload?.repository?.owner?.login;
    const repo = payload?.repository?.name;
    const issueNumber = payload?.issue?.number;

    if (typeof owner === 'string' && typeof repo === 'string' && typeof issueNumber === 'number') {
      await postGitHubIssueComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: `AFU-9 webhook ok (delivery=${deliveryId})`,
      });

      return NextResponse.json({ ok: true, handled: 'issues.opened' }, { status: 200 });
    }

    console.warn('[GitHubWebhook] Missing owner/repo/issueNumber for issues.opened', {
      delivery_id: deliveryId,
    });

    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
}
