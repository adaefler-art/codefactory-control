import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type DeployEventRow = {
  id: string;
  created_at: string;
  env: string;
  service: string;
  version: string;
  commit_hash: string;
  status: string;
  message: string | null;
};

function isDatabaseEnabled(): boolean {
  return process.env.DATABASE_ENABLED === 'true';
}

function timingSafeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${field}`);
  }
  return value.trim();
}

function clampLen(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

export async function POST(request: NextRequest) {
  if (!isDatabaseEnabled()) {
    return NextResponse.json({ error: 'DB disabled' }, { status: 503 });
  }

  const configuredToken = process.env.DEPLOY_EVENTS_TOKEN;
  const providedToken = request.headers.get('x-internal-token') ?? '';

  if (!configuredToken || !timingSafeEquals(providedToken, configuredToken)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let env: string;
  let service: string;
  let message: string;

  try {
    const body = (await request.json()) as Partial<{
      env: string;
      service: string;
      message: string;
    }>;

    env = clampLen(requireString(body.env, 'env'), 32);
    service = clampLen(requireString(body.service, 'service'), 64);
    message = clampLen(requireString(body.message, 'message'), 2000);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    );
  }

  const version = clampLen(process.env.BUILD_VERSION ?? process.env.npm_package_version ?? 'unknown', 64);
  const commit_hash = clampLen(request.headers.get('x-deploy-sha') ?? request.headers.get('x-github-sha') ?? 'unknown', 64);
  const status = 'success';

  try {
    const pool = getPool();
    const result = await pool.query<DeployEventRow>(
      `INSERT INTO deploy_events (env, service, version, commit_hash, status, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at, env, service, version, commit_hash, status, message`,
      [env, service, version, commit_hash, status, message]
    );

    return NextResponse.json({ event: result.rows[0] });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to insert deploy event',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
