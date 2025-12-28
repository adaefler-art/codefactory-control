import { NextResponse } from 'next/server';
import { createGitHubAppJwt, GitHubAppConfigError } from '@/lib/github-app-auth';

const GH_API = 'https://api.github.com';
const API_VERSION = '2022-11-28';

function getEnvFirst(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value;
  }
  return undefined;
}

export async function GET() {
  const owner = getEnvFirst(['GITHUB_OWNER', 'GH_OWNER']);
  const repo = getEnvFirst(['GITHUB_REPO', 'GH_REPO']);

  if (!owner || !repo) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'MISSING_ENV',
        details: {
          missing: ['owner', 'repo'],
          expectedEnv: {
            owner: ['GITHUB_OWNER', 'GH_OWNER'],
            repo: ['GITHUB_REPO', 'GH_REPO'],
          },
        },
      },
      { status: 200 }
    );
  }

  try {
    const { jwt, iat, exp, iss } = await createGitHubAppJwt();

    // READ-ONLY proof calls only (no token creation):
    // A) Validate the app JWT works by calling GET /app
    const appRes = await fetch(`${GH_API}/app`, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'AFU-9',
        Authorization: `Bearer ${jwt}`,
      },
      cache: 'no-store',
    });

    if (!appRes.ok) {
      const text = await appRes.text().catch(() => '');
      return NextResponse.json(
        {
          ok: false,
          errorCode: 'GITHUB_APP_AUTH_FAILED',
          details: {
            endpoint: '/app',
            status: appRes.status,
            body: text.slice(0, 2000),
          },
        },
        { status: 200 }
      );
    }

    // B) Validate the app is installed for the repo (GET /repos/{owner}/{repo}/installation)
    const instRes = await fetch(`${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'AFU-9',
        Authorization: `Bearer ${jwt}`,
      },
      cache: 'no-store',
    });

    if (!instRes.ok) {
      const text = await instRes.text().catch(() => '');
      return NextResponse.json(
        {
          ok: false,
          errorCode: instRes.status === 404 ? 'GITHUB_APP_NOT_INSTALLED' : 'GITHUB_INSTALLATION_LOOKUP_FAILED',
          details: {
            endpoint: '/repos/{owner}/{repo}/installation',
            owner,
            repo,
            status: instRes.status,
            body: text.slice(0, 2000),
          },
        },
        { status: 200 }
      );
    }

    const inst = (await instRes.json()) as { id?: number; app_id?: number };

    return NextResponse.json(
      {
        ok: true,
        owner,
        repo,
        installationId: inst.id ?? null,
        appId: inst.app_id ?? null,
        jwt: { iss, iat, exp },
      },
      { status: 200 }
    );
  } catch (e: any) {
    if (e instanceof GitHubAppConfigError) {
      return NextResponse.json(
        {
          ok: false,
          errorCode: 'GITHUB_APP_CONFIG',
          details: { message: e.message },
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        errorCode: 'UNEXPECTED_ERROR',
        details: { message: e?.message ?? String(e) },
      },
      { status: 200 }
    );
  }
}
