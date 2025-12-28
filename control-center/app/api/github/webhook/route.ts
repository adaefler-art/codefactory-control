/**
 * @deprecated This route is deprecated. Use /api/webhooks/github instead.
 * This alias will be removed in v0.6.
 * 
 * @see /api/webhooks/github for the canonical endpoint
 */

import { NextRequest } from 'next/server';
import { handleGitHubWebhook } from '@/lib/github-webhook-handler';

export async function POST(request: NextRequest) {
  // Log deprecation warning
  console.warn(
    '[DEPRECATED] Route /api/github/webhook is deprecated. ' +
    'Please use /api/webhooks/github instead. ' +
    'This route will be removed in v0.6.'
  );

  const rawBody = Buffer.from(await request.arrayBuffer());
  return handleGitHubWebhook(rawBody, request.headers);
}
