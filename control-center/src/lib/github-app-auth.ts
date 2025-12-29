import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createPrivateKey } from 'crypto';

export type GitHubAppSecret = {
  appId?: string | number;
  app_id?: string | number;
  webhookSecret?: string;
  webhook_secret?: string;
  webhook_secret_token?: string;
  privateKeyPem?: string;
  private_key_pem?: string;
  private_key?: string;
  privateKey?: string;
};

export class GitHubAppConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubAppConfigError';
  }
}

export class GitHubAppKeyFormatError extends GitHubAppConfigError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubAppKeyFormatError';
  }
}

type GitHubAppConfig = {
  appId: string;
  webhookSecret: string;
  privateKeyPem: string;
};

let cachedSecretPromise: Promise<GitHubAppConfig> | null = null;

type JoseModule = {
  importPKCS8: (pem: string, alg: string) => Promise<unknown>;
  SignJWT: new (payload: Record<string, unknown>) => {
    setProtectedHeader: (header: Record<string, unknown>) => any;
    sign: (key: unknown) => Promise<string>;
  };
};

let joseModulePromise: Promise<JoseModule> | null = null;

async function getJose(): Promise<JoseModule> {
  if (!joseModulePromise) {
    joseModulePromise = import('jose') as any;
  }
  return joseModulePromise;
}

function getAwsRegion(): string {
  return (
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    process.env.NEXT_PUBLIC_AWS_REGION ||
    'eu-central-1'
  );
}

function getSecretId(): string {
  return (
    process.env.GITHUB_APP_SECRET_ID ||
    process.env.GH_APP_SECRET_ID ||
    'afu9/github/app'
  );
}

function getEnvFirst(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value;
  }
  return undefined;
}

function stripSurroundingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function tryDecodeBase64WrappedPem(value: string): string | null {
  const compact = value.trim().replace(/\s+/g, '');
  if (compact.length < 80) return null;

  const asB64 = compact.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/=]+$/.test(asB64)) return null;

  const padded = asB64 + '='.repeat((4 - (asB64.length % 4)) % 4);

  let raw: Buffer;
  try {
    raw = Buffer.from(padded, 'base64');
  } catch {
    return null;
  }

  // Case 1: It's base64 of a PEM string.
  try {
    const decodedUtf8 = raw.toString('utf8');
    if (
      decodedUtf8.includes('-----BEGIN PRIVATE KEY-----') ||
      decodedUtf8.includes('-----BEGIN RSA PRIVATE KEY-----')
    ) {
      return decodedUtf8;
    }
  } catch {
    // ignore
  }

  // Case 2: It's base64 of DER bytes. Try PKCS#8 first, then PKCS#1.
  for (const type of ['pkcs8', 'pkcs1'] as const) {
    try {
      const keyObject = createPrivateKey({ key: raw, format: 'der', type });
      const pkcs8 = keyObject.export({ format: 'pem', type: 'pkcs8' });
      return String(pkcs8).replace(/\r\n/g, '\n').trim() + '\n';
    } catch {
      // ignore
    }
  }

  return null;
}

function normalizePrivateKeyPem(maybePem: string): string {
  const unquoted = stripSurroundingQuotes(maybePem);
  const base64Decoded = tryDecodeBase64WrappedPem(unquoted);
  const maybeDecoded = base64Decoded ?? unquoted;

  const withRealNewlines = maybeDecoded.includes('\\n') ? maybeDecoded.replace(/\\n/g, '\n') : maybeDecoded;
  const normalizedNewlines = withRealNewlines.replace(/\r\n/g, '\n').trim() + '\n';

  if (normalizedNewlines.includes('-----BEGIN PRIVATE KEY-----')) {
    return normalizedNewlines;
  }

  if (normalizedNewlines.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    try {
      const keyObject = createPrivateKey(normalizedNewlines);
      const pkcs8 = keyObject.export({ format: 'pem', type: 'pkcs8' });
      return String(pkcs8).replace(/\r\n/g, '\n').trim() + '\n';
    } catch (error) {
      throw new GitHubAppKeyFormatError(
        `GitHub App private key is not a valid RSA key (failed to convert PKCS#1 to PKCS#8): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  throw new GitHubAppKeyFormatError(
    'GitHub App private key must be a PEM string (PKCS#8: "BEGIN PRIVATE KEY" or PKCS#1: "BEGIN RSA PRIVATE KEY")'
  );
}

function toNumber(value: string | number, fieldName: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new GitHubAppConfigError(`Invalid ${fieldName}`);
  }
  return n;
}

function toNonEmptyString(value: unknown, fieldName: string): string {
  if (value === undefined || value === null) {
    throw new GitHubAppConfigError(`Missing ${fieldName}`);
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new GitHubAppConfigError(`Invalid ${fieldName}`);
  }

  const s = String(value).trim();
  if (!s) {
    throw new GitHubAppConfigError(`Missing ${fieldName}`);
  }
  return s;
}

function pickFirstNonEmptyString(obj: Record<string, unknown>, keys: string[], fieldName: string): string {
  for (const key of keys) {
    const value = obj[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const s = String(value).trim();
    if (s) return s;
  }
  throw new GitHubAppConfigError(`Missing ${fieldName}`);
}

export async function loadGitHubAppConfig(): Promise<GitHubAppConfig> {
  if (cachedSecretPromise) return cachedSecretPromise;

  cachedSecretPromise = (async () => {
    const region = getAwsRegion();
    const secretId = getSecretId();

    // Local/dev override for easier testing (+ legacy env fallbacks)
    const envAppId = getEnvFirst(['GITHUB_APP_ID', 'GH_APP_ID']);
    const envWebhookSecret = getEnvFirst(['GITHUB_APP_WEBHOOK_SECRET', 'GH_APP_WEBHOOK_SECRET']);
    const envPrivateKeyPem = getEnvFirst(['GITHUB_APP_PRIVATE_KEY_PEM', 'GH_APP_PRIVATE_KEY_PEM']);

    if (envAppId && envWebhookSecret && envPrivateKeyPem) {
      return {
        appId: toNonEmptyString(envAppId, 'GITHUB_APP_ID'),
        webhookSecret: toNonEmptyString(envWebhookSecret, 'GITHUB_APP_WEBHOOK_SECRET'),
        privateKeyPem: normalizePrivateKeyPem(envPrivateKeyPem),
      };
    }

    const client = new SecretsManagerClient({ region });
    const response = await client.send(
      new GetSecretValueCommand({
        SecretId: secretId,
      })
    );

    if (!response.SecretString) {
      throw new GitHubAppConfigError('GitHub App secret is missing SecretString');
    }

    let parsed: GitHubAppSecret;
    try {
      parsed = JSON.parse(response.SecretString) as GitHubAppSecret;
    } catch {
      throw new GitHubAppConfigError('GitHub App secret is not valid JSON');
    }

    const parsedObj = parsed as unknown as Record<string, unknown>;

    return {
      appId: pickFirstNonEmptyString(parsedObj, ['appId', 'app_id'], 'appId'),
      webhookSecret: pickFirstNonEmptyString(
        parsedObj,
        ['webhookSecret', 'webhook_secret', 'webhook_secret_token'],
        'webhookSecret'
      ),
      privateKeyPem: normalizePrivateKeyPem(
        pickFirstNonEmptyString(parsedObj, ['privateKeyPem', 'private_key_pem', 'private_key', 'privateKey'], 'privateKeyPem')
      ),
    };
  })();

  return cachedSecretPromise;
}

export async function getGitHubWebhookSecret(): Promise<string> {
  const config = await loadGitHubAppConfig();
  return config.webhookSecret;
}

export async function createGitHubAppJwt(input?: {
  nowSeconds?: number;
}): Promise<{ jwt: string; iat: number; exp: number; iss: string }> {
  const config = await loadGitHubAppConfig();

  const { importPKCS8, SignJWT } = await getJose();

  const now = input?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const iat = now - 60;
  const exp = now + 9 * 60;
  const iss = config.appId;

  let pkcs8: unknown;
  try {
    pkcs8 = await importPKCS8(config.privateKeyPem, 'RS256');
  } catch (error) {
    throw new GitHubAppKeyFormatError(
      `GitHub App private key could not be parsed as PKCS#8 for jose/importPKCS8: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const jwt = await new SignJWT({ iat, exp, iss })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .sign(pkcs8);

  return { jwt, iat, exp, iss };
}

/**
 * Get the installation ID for a specific repository
 * Uses GitHub API: GET /repos/{owner}/{repo}/installation
 * 
 * @param owner - Repository owner
 * @param repo - Repository name
 * @returns Installation ID for the repository
 */
export async function getInstallationIdForRepo(input: {
  owner: string;
  repo: string;
}): Promise<number> {
  const { jwt } = await createGitHubAppJwt();

  console.log(`[getInstallationIdForRepo] Looking up installation for ${input.owner}/${input.repo}`);

  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/installation`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'codefactory-control-center',
      },
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to get installation for ${input.owner}/${input.repo} (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { id?: number };
  if (json.id == null || typeof json.id !== 'number') {
    throw new Error(`Invalid installation response for ${input.owner}/${input.repo}: missing or invalid id`);
  }

  console.log(`[getInstallationIdForRepo] Found installationId ${json.id} for ${input.owner}/${input.repo}`);

  return json.id;
}

export async function getGitHubInstallationToken(input: {
  owner: string;
  repo: string;
  nowSeconds?: number;
}): Promise<{ token: string; expiresAt?: string } > {
  const { jwt } = await createGitHubAppJwt({ nowSeconds: input.nowSeconds });
  
  // Lookup installation ID for this specific repository
  // NOTE: We do NOT cache this to ensure deterministic, repo-based auth.
  // This enforces governance rules: no hidden state, always repo-deterministic.
  const installationId = await getInstallationIdForRepo({
    owner: input.owner,
    repo: input.repo,
  });

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'codefactory-control-center',
      },
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to create installation token (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { token?: string; expires_at?: string };
  if (!json.token) {
    throw new Error('GitHub installation token response missing token');
  }

  return { token: json.token, expiresAt: json.expires_at };
}

export async function postGitHubIssueComment(input: {
  owner: string;
  repo: string;
  issue_number: number;
  body: string;
}): Promise<void> {
  const { token } = await getGitHubInstallationToken({
    owner: input.owner,
    repo: input.repo,
  });

  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.issue_number}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'codefactory-control-center',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: input.body }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to create issue comment (${res.status}): ${text}`);
  }
}
