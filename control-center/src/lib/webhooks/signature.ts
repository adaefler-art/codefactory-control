/**
 * GitHub Webhook Signature Verification
 * 
 * Validates that webhook requests are authentically from GitHub
 * using HMAC-SHA256 signature verification.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify GitHub webhook signature
 * 
 * @param payload - Raw payload body as string
 * @param signature - Signature from X-Hub-Signature-256 header
 * @param secret - Webhook secret configured in GitHub
 * @returns True if signature is valid
 */
export function verifyGitHubSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!signature || !signature.startsWith('sha256=')) {
    console.error('[Webhook] Invalid signature format');
    return false;
  }

  try {
    // Calculate expected signature
    const hmac = createHmac('sha256', secret);
    hmac.update(payload, 'utf8');
    const expectedSignature = `sha256=${hmac.digest('hex')}`;

    // Use timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedBuffer.length) {
      console.error('[Webhook] Signature length mismatch');
      return false;
    }

    return timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch (error) {
    console.error('[Webhook] Error verifying signature:', error);
    return false;
  }
}

/**
 * Extract event type and action from GitHub webhook headers
 * 
 * @param eventHeader - Value from X-GitHub-Event header
 * @param payload - Parsed webhook payload
 * @returns Object with event_type and event_action
 */
export function parseGitHubEvent(
  eventHeader: string,
  payload: Record<string, unknown>
): { event_type: string; event_action?: string } {
  const event_type = eventHeader;
  const event_action = typeof payload.action === 'string' ? payload.action : undefined;

  return {
    event_type,
    event_action,
  };
}
