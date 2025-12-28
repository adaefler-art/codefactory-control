function base64urlEncodeJson(obj: unknown): string {
  const json = JSON.stringify(obj);
  return Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function decodeJwtPayload(token: string): any {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('Invalid JWT');
  const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(async () => {
      throw new Error('SecretsManager should not be called in this test');
    }),
  })),
  GetSecretValueCommand: jest.fn(),
}));

jest.mock('jose', () => {
  return {
    importPKCS8: jest.fn(async () => ({})),
    SignJWT: jest.fn().mockImplementation(function (payload: any) {
      this._payload = payload;
      this.setProtectedHeader = jest.fn(() => this);
      this.sign = jest.fn(async () => {
        const header = { alg: 'RS256', typ: 'JWT' };
        return `${base64urlEncodeJson(header)}.${base64urlEncodeJson(payload)}.sig`;
      });
    }),
  };
});

describe('createGitHubAppJwt', () => {
  it('mints an RS256 JWT with iat/exp/iss window', async () => {
    const nowSeconds = 1_700_000_000;

    jest.resetModules();

    const privateKeyPem = '-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n';

    process.env.GITHUB_APP_ID = '1234';
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'whsec_test';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = privateKeyPem;

    // Import after env is set so the module sees the env-based config.
    const { createGitHubAppJwt } = await import('../../src/lib/github-app-auth');

    const { jwt, iat, exp, iss } = await createGitHubAppJwt({ nowSeconds });

    expect(iss).toBe('1234');
    expect(iat).toBe(nowSeconds - 60);
    expect(exp).toBe(nowSeconds + 9 * 60);

    const payload = decodeJwtPayload(jwt);
    expect(payload.iss).toBe('1234');
    expect(payload.iat).toBe(iat);
    expect(payload.exp).toBe(exp);
  });
});
