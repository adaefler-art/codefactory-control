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

function decodeJwtHeader(token: string): any {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('Invalid JWT');
  const headerB64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
  const padded = headerB64 + '='.repeat((4 - (headerB64.length % 4)) % 4);
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
  class MockSignJWT {
    private _payload: any;

    constructor(payload: any) {
      this._payload = payload;
    }

    setProtectedHeader() {
      return this;
    }

    async sign() {
      const header = { alg: 'RS256', typ: 'JWT' };
      return `${base64urlEncodeJson(header)}.${base64urlEncodeJson(this._payload)}.sig`;
    }
  }

  return {
    importPKCS8: jest.fn(async () => ({})),
    SignJWT: MockSignJWT as any,
  };
});

describe('createGitHubAppJwt', () => {
  beforeEach(() => {
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    delete process.env.GITHUB_APP_PRIVATE_KEY_PEM;
    delete process.env.GH_APP_ID;
    delete process.env.GH_APP_WEBHOOK_SECRET;
    delete process.env.GH_APP_PRIVATE_KEY_PEM;
  });

  it('mints an RS256 JWT with iat/exp/iss window', async () => {
    const nowSeconds = 1_700_000_000;

    jest.resetModules();

    const privateKeyPem = '-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n';

    process.env.GITHUB_APP_ID = '1234';
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'whsec_test';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = privateKeyPem;

    // Import after env is set so the module sees the env-based config.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createGitHubAppJwt } = require('../../src/lib/github-app-auth');

    const { jwt, iat, exp, iss } = await createGitHubAppJwt({ nowSeconds });

    const header = decodeJwtHeader(jwt);
    expect(header.alg).toBe('RS256');
    expect(header.typ).toBe('JWT');

    expect(iss).toBe('1234');
    expect(iat).toBe(nowSeconds - 60);
    expect(exp).toBe(nowSeconds + 9 * 60);

    const payload = decodeJwtPayload(jwt);
    expect(payload.iss).toBe('1234');
    expect(payload.iat).toBe(iat);
    expect(payload.exp).toBe(exp);
  });

  it('accepts legacy GH_* env vars (fallback)', async () => {
    jest.resetModules();

    process.env.GH_APP_ID = '2345';
    process.env.GH_APP_WEBHOOK_SECRET = 'whsec_legacy';
    process.env.GH_APP_PRIVATE_KEY_PEM = '-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----\\n';

    const jose = await import('jose');
    (jose as any).importPKCS8.mockClear();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createGitHubAppJwt } = require('../../src/lib/github-app-auth');
    const { iss } = await createGitHubAppJwt({ nowSeconds: 1_700_000_000 });

    expect(iss).toBe('2345');
    expect((jose as any).importPKCS8).toHaveBeenCalledTimes(1);
  });

  it('normalizes escaped newlines in private key PEM', async () => {
    jest.resetModules();

    const pkcs8WithEscapedNewlines = '-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----\\n';

    process.env.GITHUB_APP_ID = '3456';
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'whsec_test';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = pkcs8WithEscapedNewlines;

    const jose = await import('jose');
    (jose as any).importPKCS8.mockClear();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createGitHubAppJwt } = require('../../src/lib/github-app-auth');
    await createGitHubAppJwt({ nowSeconds: 1_700_000_000 });

    const pemArg = (jose as any).importPKCS8.mock.calls[0][0] as string;
    expect(pemArg).toContain('-----BEGIN PRIVATE KEY-----');
    expect(pemArg).toContain('\n');
    expect(pemArg).not.toContain('\\n');
  });

  it('accepts a quoted PEM string (common when values get double-serialized)', async () => {
    jest.resetModules();

    const quotedPem = '"-----BEGIN PRIVATE KEY-----\\nTEST\\n-----END PRIVATE KEY-----\\n"';

    process.env.GITHUB_APP_ID = '3456';
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'whsec_test';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = quotedPem;

    const jose = await import('jose');
    (jose as any).importPKCS8.mockClear();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createGitHubAppJwt } = require('../../src/lib/github-app-auth');
    await createGitHubAppJwt({ nowSeconds: 1_700_000_000 });

    const pemArg = (jose as any).importPKCS8.mock.calls[0][0] as string;
    expect(pemArg).toContain('-----BEGIN PRIVATE KEY-----');
    expect(pemArg).toContain('\n');
  });

  it('accepts a base64-wrapped PEM string (common when stored in env/secret)', async () => {
    jest.resetModules();

    const pem = '-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n';
    const pemB64 = Buffer.from(pem, 'utf8').toString('base64');

    process.env.GITHUB_APP_ID = '3456';
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'whsec_test';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = pemB64;

    const jose = await import('jose');
    (jose as any).importPKCS8.mockClear();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createGitHubAppJwt } = require('../../src/lib/github-app-auth');
    await createGitHubAppJwt({ nowSeconds: 1_700_000_000 });

    const pemArg = (jose as any).importPKCS8.mock.calls[0][0] as string;
    expect(pemArg).toContain('-----BEGIN PRIVATE KEY-----');
    expect(pemArg).toContain('-----END PRIVATE KEY-----');
  });

  it('accepts a base64-encoded DER private key (pkcs8)', async () => {
    jest.resetModules();

    const { generateKeyPairSync } = await import('crypto');
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { format: 'der', type: 'pkcs8' },
      publicKeyEncoding: { format: 'pem', type: 'pkcs1' },
    });

    const derB64 = Buffer.from(privateKey).toString('base64');

    process.env.GITHUB_APP_ID = '3456';
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'whsec_test';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = derB64;

    const jose = await import('jose');
    (jose as any).importPKCS8.mockClear();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createGitHubAppJwt } = require('../../src/lib/github-app-auth');
    await createGitHubAppJwt({ nowSeconds: 1_700_000_000 });

    const pemArg = (jose as any).importPKCS8.mock.calls[0][0] as string;
    expect(pemArg).toContain('-----BEGIN PRIVATE KEY-----');
    expect(pemArg).toContain('-----END PRIVATE KEY-----');
  });

  it('throws a clear config error when privateKeyPem is missing from the secret JSON', async () => {
    jest.resetModules();

    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    delete process.env.GITHUB_APP_PRIVATE_KEY_PEM;
    delete process.env.GH_APP_ID;
    delete process.env.GH_APP_WEBHOOK_SECRET;
    delete process.env.GH_APP_PRIVATE_KEY_PEM;

    const { SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager');
    (SecretsManagerClient as any).mockImplementation(() => ({
      send: jest.fn(async () => ({
        SecretString: JSON.stringify({ appId: '123', webhookSecret: 'whsec_test' }),
      })),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createGitHubAppJwt } = require('../../src/lib/github-app-auth');
    await expect(createGitHubAppJwt({ nowSeconds: 1_700_000_000 })).rejects.toMatchObject({
      name: 'GitHubAppConfigError',
      message: expect.stringContaining('Missing privateKeyPem'),
    });
  });

  it('accepts snake_case secret JSON fields from Secrets Manager', async () => {
    jest.resetModules();

    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    delete process.env.GITHUB_APP_PRIVATE_KEY_PEM;
    delete process.env.GH_APP_ID;
    delete process.env.GH_APP_WEBHOOK_SECRET;
    delete process.env.GH_APP_PRIVATE_KEY_PEM;

    const pem = '-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n';

    const { SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager');
    (SecretsManagerClient as any).mockImplementation(() => ({
      send: jest.fn(async () => ({
        SecretString: JSON.stringify({
          app_id: '123',
          webhook_secret: 'whsec_snake',
          private_key_pem: pem,
        }),
      })),
    }));

    const jose = await import('jose');
    (jose as any).importPKCS8.mockClear();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createGitHubAppJwt } = require('../../src/lib/github-app-auth');
    const { iss } = await createGitHubAppJwt({ nowSeconds: 1_700_000_000 });

    expect(iss).toBe('123');
    expect((jose as any).importPKCS8).toHaveBeenCalledTimes(1);
  });

  it('converts PKCS#1 (RSA PRIVATE KEY) PEM to PKCS#8 before calling jose', async () => {
    jest.resetModules();

    const { generateKeyPairSync } = await import('crypto');
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
      publicKeyEncoding: { format: 'pem', type: 'pkcs1' },
    });

    expect(privateKey).toContain('BEGIN RSA PRIVATE KEY');

    process.env.GITHUB_APP_ID = '4567';
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'whsec_test';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = privateKey;

    const jose = await import('jose');
    (jose as any).importPKCS8.mockClear();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createGitHubAppJwt } = require('../../src/lib/github-app-auth');
    await createGitHubAppJwt({ nowSeconds: 1_700_000_000 });

    const pemArg = (jose as any).importPKCS8.mock.calls[0][0] as string;
    expect(pemArg).toContain('BEGIN PRIVATE KEY');
    expect(pemArg).not.toContain('BEGIN RSA PRIVATE KEY');
  });

  it('throws a config/key error for unknown private key format', async () => {
    jest.resetModules();

    process.env.GITHUB_APP_ID = '5678';
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'whsec_test';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = 'not a pem';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createGitHubAppJwt } = require('../../src/lib/github-app-auth');
    await expect(createGitHubAppJwt({ nowSeconds: 1_700_000_000 })).rejects.toMatchObject({
      name: 'GitHubAppKeyFormatError',
    });
  });
});
