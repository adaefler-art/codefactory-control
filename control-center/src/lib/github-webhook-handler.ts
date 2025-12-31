import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { verifyGitHubSignature } from '@/lib/webhooks/signature';
import { recordGitHubWebhookDelivery } from '@/lib/webhooks/persistence';
import { getGitHubWebhookSecret } from '@/lib/github-app-auth';
import { postGitHubIssueComment } from '@/lib/github/auth-wrapper';

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
