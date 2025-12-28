/**
 * @deprecated This route is deprecated. Use /api/webhooks/github instead.
 * This alias will be removed in v0.6.
 * 
 * @see /api/webhooks/github for the canonical endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleGitHubWebhook } from '@/lib/github-webhook-handler';

export async function POST(request: NextRequest) {
  // Log deprecation warning
  console.warn(
    '[DEPRECATED] Route /api/github/webhook is deprecated. ' +
    'Please use /api/webhooks/github instead. ' +
    'This route will be removed in v0.6.'
  );

  const rawBody = Buffer.from(await request.arrayBuffer());
  const response = await handleGitHubWebhook(rawBody, request.headers);
  
  // Add machine-readable deprecation headers
  // See: https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-deprecation-header
  const headers = new Headers(response.headers);
  
  // Deprecation header - indicates this endpoint is deprecated
  headers.set('Deprecation', 'true');
  
  // Sunset header - indicates when the endpoint will be removed (estimated v0.6 release: 2026-03-01)
  headers.set('Sunset', 'Sat, 01 Mar 2026 00:00:00 GMT');
  
  // Link header - points to the canonical alternative
  headers.set('Link', '</api/webhooks/github>; rel="alternate"; title="Canonical endpoint"');
  
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers,
  });
}
