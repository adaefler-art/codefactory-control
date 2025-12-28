import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export type GitHubAppSecret = {
  appId: string | number;
  webhookSecret: string;
  privateKeyPem: string;
};

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
  return process.env.GITHUB_APP_SECRET_ID || 'afu9/github/app';
}

function normalizePrivateKeyPem(maybePem: string): string {
  return maybePem.includes('\\n') ? maybePem.replace(/\\n/g, '\n') : maybePem;
}

function toNumber(value: string | number, fieldName: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return n;
}

function toNonEmptyString(value: string | number, fieldName: string): string {
  const s = String(value).trim();
  if (!s) {
    throw new Error(`Missing ${fieldName}`);
  }
  return s;
}

export async function loadGitHubAppConfig(): Promise<GitHubAppConfig> {
  if (cachedSecretPromise) return cachedSecretPromise;

  cachedSecretPromise = (async () => {
    const region = getAwsRegion();
    const secretId = getSecretId();

    // Local/dev override for easier testing
    if (
      process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_WEBHOOK_SECRET &&
      process.env.GITHUB_APP_PRIVATE_KEY_PEM
    ) {
      return {
        appId: toNonEmptyString(process.env.GITHUB_APP_ID, 'GITHUB_APP_ID'),
        webhookSecret: toNonEmptyString(process.env.GITHUB_APP_WEBHOOK_SECRET, 'GITHUB_APP_WEBHOOK_SECRET'),
        privateKeyPem: normalizePrivateKeyPem(process.env.GITHUB_APP_PRIVATE_KEY_PEM),
      };
    }

    const client = new SecretsManagerClient({ region });
    const response = await client.send(
      new GetSecretValueCommand({
        SecretId: secretId,
      })
    );

    if (!response.SecretString) {
      throw new Error('GitHub App secret is missing SecretString');
    }

    let parsed: GitHubAppSecret;
    try {
      parsed = JSON.parse(response.SecretString) as GitHubAppSecret;
    } catch {
      throw new Error('GitHub App secret is not valid JSON');
    }

    return {
      appId: toNonEmptyString(parsed.appId, 'appId'),
      webhookSecret: toNonEmptyString(parsed.webhookSecret, 'webhookSecret'),
      privateKeyPem: normalizePrivateKeyPem(toNonEmptyString(parsed.privateKeyPem, 'privateKeyPem')),
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

  const pkcs8 = await importPKCS8(config.privateKeyPem, 'RS256');

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
