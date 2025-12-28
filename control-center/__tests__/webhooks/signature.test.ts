import { verifyGitHubSignature } from '../../src/lib/webhooks/signature';
import { createHmac } from 'crypto';

describe('verifyGitHubSignature', () => {
  it('accepts a valid sha256 signature', () => {
    const secret = 'test-secret';
    const payload = JSON.stringify({ hello: 'world' });

    const hmac = createHmac('sha256', secret);
    hmac.update(payload, 'utf8');
    const signature = `sha256=${hmac.digest('hex')}`;

    expect(verifyGitHubSignature(payload, signature, secret)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    const secret = 'test-secret';
    const payload = JSON.stringify({ hello: 'world' });

    expect(verifyGitHubSignature(payload, 'sha256=deadbeef', secret)).toBe(false);
  });
});
