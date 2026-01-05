/**
 * API Route: Execute Post-Deploy Verification Playbook
 * 
 * POST /api/playbooks/post-deploy-verify/run?env=stage|prod
 * 
 * Executes the post-deploy verification playbook for the specified environment.
 * Returns the run ID and status immediately (synchronous execution for MVP).
 * Issue 3: Blocked in production when ENABLE_PROD=false
 */

import { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getPool } from '../../../../../src/lib/db';
import { executePlaybook } from '../../../../../src/lib/playbook-executor';
import { validatePlaybookDefinition, PlaybookDefinition } from '../../../../../src/lib/contracts/playbook';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../src/lib/api/response-helpers';
import { checkProdWriteGuard } from '@/lib/api/prod-guard';

// Load playbook definition
let cachedPlaybook: PlaybookDefinition | null = null;

function loadPlaybook(): PlaybookDefinition {
  if (cachedPlaybook) {
    return cachedPlaybook;
  }

  try {
    const playbookPath = join(process.cwd(), '../docs/playbooks/post-deploy-verify.json');
    const playbookData = JSON.parse(readFileSync(playbookPath, 'utf-8'));
    
    const validation = validatePlaybookDefinition(playbookData);
    if (!validation.valid) {
      throw new Error(`Invalid playbook definition: ${validation.errors?.message}`);
    }

    cachedPlaybook = validation.playbook!;
    return cachedPlaybook;
  } catch (error: any) {
    console.error('[playbook] Failed to load playbook definition:', error);
    throw new Error(`Failed to load playbook: ${error.message}`);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  // Issue 3: Check prod write guard (fail-closed)
  const guardResponse = checkProdWriteGuard(request);
  if (guardResponse) {
    return guardResponse;
  }

  try {
    // Parse environment from query params
    const { searchParams } = new URL(request.url);
    const env = searchParams.get('env');

    if (!env || (env !== 'stage' && env !== 'prod')) {
      return errorResponse('Invalid environment parameter. Must be "stage" or "prod".', {
        status: 400,
        requestId,
      });
    }

    // Load playbook
    const playbook = loadPlaybook();

    // Validate environment is supported
    if (!playbook.metadata.environments.includes(env as any)) {
      return errorResponse(`Environment "${env}" not supported by this playbook`, {
        status: 400,
        requestId,
      });
    }

    // Parse optional variables from body
    const body = await request.json().catch(() => ({}));
    const variables = body.variables || {};

    // Set default DEPLOY_URL based on environment if not provided
    if (!variables.DEPLOY_URL) {
      variables.DEPLOY_URL = env === 'prod'
        ? process.env.PROD_DEPLOY_URL || 'https://control.afu9.dev'
        : process.env.STAGE_DEPLOY_URL || 'https://stage.control.afu9.dev';
    }

    console.log('[playbook] Executing post-deploy verification', {
      playbookId: playbook.metadata.id,
      version: playbook.metadata.version,
      env,
      variables: Object.keys(variables),
      requestId,
    });

    // Execute playbook
    const pool = getPool();
    const result = await executePlaybook(pool, playbook, env as 'stage' | 'prod', variables);

    console.log('[playbook] Execution completed', {
      runId: result.id,
      status: result.status,
      successCount: result.summary?.successCount,
      failedCount: result.summary?.failedCount,
      requestId,
    });

    return jsonResponse(result, {
      status: 200,
      requestId,
    });
  } catch (error: any) {
    console.error('[playbook] Execution error:', {
      error: error.message,
      stack: error.stack,
      requestId,
    });

    return errorResponse('Failed to execute playbook', {
      status: 500,
      requestId,
      details: error.message,
    });
  }
}
