/**
 * GitHub App Authentication for MCP Server
 * 
 * Provides server-to-server authentication using GitHub App credentials.
 * No Personal Access Tokens (PATs) required.
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createPrivateKey } from 'crypto';

export type GitHubAppSecret = {
  appId?: string | number;
  app_id?: string | number;
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
  privateKeyPem: string;
};

let cachedConfigPromise: Promise<GitHubAppConfig> | null = null;

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
  return joseModulePromise!;
}

function getAwsRegion(): string {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'eu-central-1';
}

function getSecretId(): string {
  return process.env.GITHUB_APP_SECRET_ID || process.env.GH_APP_SECRET_ID || 'afu9/github/app';
}

const PEM_BEGIN = '-----BEGIN ';
const PEM_END = '-----END ';
const PEM_PRIVATE_KEY_SUFFIX = 'PRIVATE' + ' KEY-----';
const PEM_RSA_PRIVATE_KEY_SUFFIX = 'RSA ' + PEM_PRIVATE_KEY_SUFFIX;
const PKCS8_BEGIN = PEM_BEGIN + PEM_PRIVATE_KEY_SUFFIX;
const PKCS8_END = PEM_END + PEM_PRIVATE_KEY_SUFFIX;
const PKCS1_BEGIN = PEM_BEGIN + PEM_RSA_PRIVATE_KEY_SUFFIX;
const PKCS1_END = PEM_END + PEM_RSA_PRIVATE_KEY_SUFFIX;

function normalizePrivateKeyPem(maybePem: string): string {
  const unquoted = maybePem.trim().replace(/^["']|["']$/g, '');
  const withRealNewlines = unquoted.includes('\\n') ? unquoted.replace(/\\n/g, '\n') : unquoted;
  const normalized = withRealNewlines.replace(/\r\n/g, '\n').trim() + '\n';

  if (normalized.includes(PKCS8_BEGIN) && normalized.includes(PKCS8_END)) {
    return normalized;
  }

  if (normalized.includes(PKCS1_BEGIN) && normalized.includes(PKCS1_END)) {
    try {
      const keyObject = createPrivateKey(normalized);
      const pkcs8 = keyObject.export({ format: 'pem', type: 'pkcs8' });
      return String(pkcs8).replace(/\r\n/g, '\n').trim() + '\n';
    } catch (error) {
      throw new GitHubAppKeyFormatError(
        `GitHub App private key is not a valid RSA key: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  throw new GitHubAppKeyFormatError(
    'GitHub App private key must be a PEM string (PKCS#8 or PKCS#1 format)'
  );
}

export async function loadGitHubAppConfig(): Promise<GitHubAppConfig> {
  if (cachedConfigPromise) return cachedConfigPromise;

  cachedConfigPromise = (async () => {
    // Try environment variables first (for local dev)
    const envAppId = process.env.GITHUB_APP_ID || process.env.GH_APP_ID;
    const envPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY_PEM || process.env.GH_APP_PRIVATE_KEY_PEM;

    if (envAppId && envPrivateKey) {
      console.log('[github-app-auth] Using GitHub App credentials from environment variables');
      return {
        appId: String(envAppId).trim(),
        privateKeyPem: normalizePrivateKeyPem(envPrivateKey),
      };
    }

    // Fall back to AWS Secrets Manager
    const region = getAwsRegion();
    const secretId = getSecretId();

    console.log(`[github-app-auth] Loading GitHub App config from Secrets Manager: ${secretId}`);

    const client = new SecretsManagerClient({ region });
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

    if (!response.SecretString) {
      throw new GitHubAppConfigError('GitHub App secret is missing SecretString');
    }

    let parsed: GitHubAppSecret;
    try {
      parsed = JSON.parse(response.SecretString) as GitHubAppSecret;
    } catch {
      throw new GitHubAppConfigError('GitHub App secret is not valid JSON');
    }

    const appId = parsed.appId || parsed.app_id;
    const privateKeyPem =
      parsed.privateKeyPem || parsed.private_key_pem || parsed.private_key || parsed.privateKey;

    if (!appId) {
      throw new GitHubAppConfigError('Missing appId in GitHub App secret');
    }
    if (!privateKeyPem) {
      throw new GitHubAppConfigError('Missing privateKeyPem in GitHub App secret');
    }

    console.log(`[github-app-auth] GitHub App ID: ${appId}`);

    return {
      appId: String(appId).trim(),
      privateKeyPem: normalizePrivateKeyPem(String(privateKeyPem)),
    };
  })();

  return cachedConfigPromise;
}

export async function createGitHubAppJwt(): Promise<{ jwt: string; iat: number; exp: number; iss: string }> {
  const config = await loadGitHubAppConfig();
  const { importPKCS8, SignJWT } = await getJose();

  const now = Math.floor(Date.now() / 1000);
  const iat = now - 60;
  const exp = now + 9 * 60;
  const iss = config.appId;

  let pkcs8: unknown;
  try {
    pkcs8 = await importPKCS8(config.privateKeyPem, 'RS256');
  } catch (error) {
    throw new GitHubAppKeyFormatError(
      `GitHub App private key could not be parsed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const jwt = await new SignJWT({ iat, exp, iss })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .sign(pkcs8);

  return { jwt, iat, exp, iss };
}

export async function getInstallationIdForRepo(input: { owner: string; repo: string }): Promise<number> {
  const { jwt } = await createGitHubAppJwt();

  console.log(`[github-app-auth] Looking up installation for ${input.owner}/${input.repo}`);

  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/installation`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'afu9-mcp-github',
      },
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to get installation for ${input.owner}/${input.repo} (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { id?: number };
  if (json.id == null || typeof json.id !== 'number') {
    throw new Error(`Invalid installation response for ${input.owner}/${input.repo}: missing id`);
  }

  console.log(`[github-app-auth] Found installationId ${json.id} for ${input.owner}/${input.repo}`);

  return json.id;
}

export async function getGitHubInstallationToken(input: {
  owner: string;
  repo: string;
}): Promise<{ token: string; expiresAt?: string }> {
  const { jwt } = await createGitHubAppJwt();
  const installationId = await getInstallationIdForRepo({ owner: input.owner, repo: input.repo });

  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'afu9-mcp-github',
    },
  });

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
