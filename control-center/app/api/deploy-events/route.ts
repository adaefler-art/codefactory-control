import { NextRequest, NextResponse } from 'next/server';
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

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function logRequest(params: {
  route: string;
  method: string;
  duration_ms: number;
  rowcount: number;
  env?: string;
  service?: string;
}) {
  console.log(
    JSON.stringify({
      level: 'info',
      ...params,
      timestamp: new Date().toISOString(),
    })
  );
}

export async function GET(request: NextRequest) {
  const start = Date.now();
  const route = '/api/deploy-events';

  const { searchParams } = new URL(request.url);
  const env = searchParams.get('env') || 'prod';
  const service = searchParams.get('service') || 'control-center';
  const limitRaw = parseInt(searchParams.get('limit') || '20', 10);
  const limit = clampInt(limitRaw, 1, 100);

  if (!isDatabaseEnabled()) {
    logRequest({ route, method: 'GET', duration_ms: Date.now() - start, rowcount: 0, env, service });
    return NextResponse.json({ error: 'DB disabled' }, { status: 503 });
  }

  try {
    const pool = getPool();
    const result = await pool.query<DeployEventRow>(
      `SELECT id, created_at, env, service, version, commit_hash, status, message
       FROM deploy_events
       WHERE env = $1 AND service = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [env, service, limit]
    );

    logRequest({
      route,
      method: 'GET',
      duration_ms: Date.now() - start,
      rowcount: result.rowCount || 0,
      env,
      service,
    });

    return NextResponse.json({
      events: result.rows,
    });
  } catch (error) {
    logRequest({ route, method: 'GET', duration_ms: Date.now() - start, rowcount: 0, env, service });
    console.error('[Deploy Events API] Error:', error);

    return NextResponse.json(
      {
        error: 'Failed to retrieve deploy events',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const start = Date.now();
  const route = '/api/deploy-events';

  if (!isDatabaseEnabled()) {
    logRequest({ route, method: 'POST', duration_ms: Date.now() - start, rowcount: 0 });
    return NextResponse.json({ error: 'DB disabled' }, { status: 503 });
  }

  try {
    const body = (await request.json()) as Partial<{
      env: string;
      service: string;
      version: string;
      commit_hash: string;
      status: string;
      message: string | null;
    }>;

    const env = body.env || 'prod';
    const service = body.service || 'control-center';

    const version = body.version;
    const commit_hash = body.commit_hash;
    const status = body.status;
    const message = body.message ?? null;

    if (!version || !commit_hash || !status) {
      logRequest({ route, method: 'POST', duration_ms: Date.now() - start, rowcount: 0, env, service });
      return NextResponse.json(
        {
          error: 'Missing required fields',
          required: ['version', 'commit_hash', 'status'],
        },
        { status: 400 }
      );
    }

    const pool = getPool();
    const result = await pool.query<DeployEventRow>(
      `INSERT INTO deploy_events (env, service, version, commit_hash, status, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at, env, service, version, commit_hash, status, message`,
      [env, service, version, commit_hash, status, message]
    );

    logRequest({
      route,
      method: 'POST',
      duration_ms: Date.now() - start,
      rowcount: result.rowCount || 0,
      env,
      service,
    });

    return NextResponse.json({
      event: result.rows[0],
    });
  } catch (error) {
    logRequest({ route, method: 'POST', duration_ms: Date.now() - start, rowcount: 0 });
    console.error('[Deploy Events API] Error:', error);

    return NextResponse.json(
      {
        error: 'Failed to insert deploy event',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
