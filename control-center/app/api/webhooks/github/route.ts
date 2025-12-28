/**
 * GitHub Webhook Handler (Canonical Route)
 * 
 * POST /api/webhooks/github
 * 
 * Receives and processes GitHub webhook events.
 * This is the canonical endpoint for GitHub webhooks.
 * 
 * @canonical
 * @see docs/API_ROUTES.md for route documentation
 */

import { NextRequest } from 'next/server';
import { handleGitHubWebhook } from '@/lib/github-webhook-handler';

export async function POST(request: NextRequest) {
  const rawBody = Buffer.from(await request.arrayBuffer());
  return handleGitHubWebhook(rawBody, request.headers);
}
