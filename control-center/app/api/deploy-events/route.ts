import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { DeployEventOutput, isDeployEventOutput } from '@/lib/contracts/outputContracts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isDatabaseEnabled(): boolean {
  return process.env.DATABASE_ENABLED === 'true';
}

function defaultEnvFromHost(host: string | null): string {
  const normalized = (host || '').toLowerCase();
  if (normalized.startsWith('stage.')) return 'staging';
  return 'prod';
}

function isPostgresAuthError(error: unknown): boolean {
  const anyErr = error as { code?: unknown; message?: unknown };
  const code = typeof anyErr?.code === 'string' ? anyErr.code : '';
  if (code === '28P01' || code === '28000') return true;
  const message = typeof anyErr?.message === 'string' ? anyErr.message : '';
  return /password authentication failed|no pg_hba\.conf entry|authentication/i.test(message);
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
  const env = searchParams.get('env') || defaultEnvFromHost(request.headers.get('host'));
  const service = searchParams.get('service') || 'control-center';
  const limitRaw = parseInt(searchParams.get('limit') || '20', 10);
  const limit = clampInt(limitRaw, 1, 100);

  if (!isDatabaseEnabled()) {
    logRequest({ route, method: 'GET', duration_ms: Date.now() - start, rowcount: 0, env, service });
    return NextResponse.json({ error: 'DB disabled' }, { status: 503 });
  }

  if (!process.env.DATABASE_PASSWORD) {
    logRequest({ route, method: 'GET', duration_ms: Date.now() - start, rowcount: 0, env, service });
    return NextResponse.json(
      {
        error: 'DB unavailable',
        message: 'DATABASE_PASSWORD is not configured',
      },
      { status: 503 }
    );
  }

  try {
    const pool = getPool();
    const result = await pool.query<DeployEventOutput>(
      `SELECT id, created_at, env, service, version, commit_hash, status, message
       FROM deploy_events
       WHERE env = $1 AND service = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [env, service, limit]
    );

    // Validate output contract
    for (const row of result.rows) {
      if (!isDeployEventOutput(row)) {
        console.error('[Deploy Events API] Contract validation failed for row:', row);
        throw new Error('Output contract validation failed');
      }
    }

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

    if (isPostgresAuthError(error)) {
      return NextResponse.json(
        {
          error: 'DB unauthorized',
          message: 'Database authentication failed',
        },
        { status: 401 }
      );
    }

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

  logRequest({ route, method: 'POST', duration_ms: Date.now() - start, rowcount: 0 });
  return NextResponse.json(
    {
      error: 'Method Not Allowed',
      message: 'Use POST /api/internal/deploy-events (machine-auth) to write deploy events.',
    },
    {
      status: 405,
      headers: {
        Allow: 'GET',
      },
    }
  );
}
