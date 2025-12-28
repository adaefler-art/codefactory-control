import { NextRequest } from 'next/server';
import { handleGitHubWebhook } from '@/lib/github-webhook-handler';

export async function POST(request: NextRequest) {
  const rawBody = Buffer.from(await request.arrayBuffer());
  return handleGitHubWebhook(rawBody, request.headers);
}
