import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getPool } from '@/lib/db';
import { validateDeployEventInput, DeployEventInput } from '@/lib/contracts/deployEvent';
import { insertDeployEvent } from '@/lib/db/deployEvents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isDatabaseEnabled(): boolean {
  return process.env.DATABASE_ENABLED === 'true';
}

function timingSafeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
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

  // Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Invalid JSON',
        message: error instanceof Error ? error.message : 'Request body must be valid JSON',
      },
      { status: 400 }
    );
  }

  // Validate against contract
  const validation = validateDeployEventInput(body);
  if (!validation.valid) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        errors: validation.errors,
        required: ['env', 'service', 'version', 'commit_hash', 'status'],
      },
      { status: 400 }
    );
  }

  // Type-safe input after validation
  const input = body as DeployEventInput;

  // Safe, non-secret log for traceability (no tokens, no cookies).
  console.log(
    JSON.stringify({
      level: 'info',
      route: '/api/internal/deploy-events',
      action: 'insert',
      env: input.env,
      service: input.service,
      version: input.version,
      commit_hash: input.commit_hash,
      status: input.status,
      timestamp: new Date().toISOString(),
    })
  );

  // Insert using helper
  const pool = getPool();
  const result = await insertDeployEvent(pool, input);

  if (!result.success) {
    // Database operation failed - return 503 for infrastructure issues
    return NextResponse.json(
      {
        error: 'Database operation failed',
        message: result.error || 'Failed to insert deploy event',
      },
      { status: 503 }
    );
  }

  return NextResponse.json({ event: result.event });
}
