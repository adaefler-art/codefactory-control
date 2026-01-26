import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';
import { getBuildInfo } from '@/lib/build/build-info';
import { isProdEnabled, getProdDisabledReason } from '@/lib/utils/prod-control';
import { getDeploymentEnv } from '@/lib/utils/deployment-env';

// MCP Server configuration - single source of truth
const MCP_SERVERS = [
  { name: 'mcp-github', url: process.env.MCP_GITHUB_URL || 'http://127.0.0.1:3001' },
  { name: 'mcp-deploy', url: process.env.MCP_DEPLOY_URL || 'http://127.0.0.1:3002' },
  { name: 'mcp-observability', url: process.env.MCP_OBSERVABILITY_URL || 'http://127.0.0.1:3003' },
  { name: 'mcp-runner', url: process.env.MCP_RUNNER_URL || 'http://127.0.0.1:3004' },
] as const;

const SELF_PROPELLING_WORKFLOW_PATH = path.join(
  process.cwd(),
  'runtime',
  'workflows',
  'self_propelling_issue.json'
);

/**
 * Build the list of required dependencies based on current configuration
 */
function getRequiredDependencies(): string[] {
  const requiredDeps = ['environment'];
  const databaseEnabled = process.env.DATABASE_ENABLED === 'true';
  
  if (databaseEnabled) {
    requiredDeps.push('database');
  }
  
  return requiredDeps;
}

/**
 * Readiness check endpoint for validating service readiness to accept traffic
 * 
 * **READINESS PROBE** - This endpoint checks if the service is ready to handle requests.
 * 
 * Unlike /api/health (liveness probe), this endpoint:
 * - Validates all critical dependencies (database, environment)
 * - Checks optional dependencies (MCP servers) without blocking
 * - Returns 503 if any REQUIRED dependency is unavailable
 * - **Issue 3:** Returns ready=true with explicit flags when ENABLE_PROD=false
 * - Can safely fail without triggering deployment rollbacks
 * 
 * Critical dependencies (MUST be available):
 * - Database connectivity (if DATABASE_ENABLED=true)
 * - Essential environment variables
 * 
 * Optional dependencies (monitored but non-blocking):
 * - MCP servers (mcp-github, mcp-deploy, mcp-observability)
 * - ENABLE_PROD flag (info only, not blocking)
 * 
 * Returns:
 * - 200 OK if service is ready to accept traffic
 * - 503 Service Unavailable if service is not ready (missing required dependencies)
 * 
 * Response time target: < 5 seconds
 * 
 * NOTE: Do NOT use this endpoint for ECS/ALB health checks as it can return 503
 * during startup or when dependencies are temporarily unavailable. Use /api/health instead.
 * 
 * ALB HEALTH CHECK: Uses /api/health (always 200), not /api/ready
 * ECS HEALTH CHECK: Uses /api/health (always 200), not /api/ready
 * 
 * @see /api/health for liveness checks (always returns 200)
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const buildInfo = getBuildInfo();
  const missing: string[] = [];
  const invalid: string[] = [];

  const requiredStage = process.env.AFU9_STAGE;
  const serviceReadToken = process.env.SERVICE_READ_TOKEN;
  const intentEnabled = process.env.AFU9_INTENT_ENABLED === 'true';
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const databaseEnabled = process.env.DATABASE_ENABLED === 'true';

  if (!requiredStage || !requiredStage.trim()) {
    missing.push('AFU9_STAGE');
  } else {
    const normalizedStage = requiredStage.trim().toLowerCase();
    const allowedStages = ['staging', 'stage', 'prod', 'production', 'dev', 'development'];
    if (!allowedStages.includes(normalizedStage)) {
      invalid.push('AFU9_STAGE');
    }
  }

  if (!serviceReadToken || !serviceReadToken.trim()) {
    missing.push('SERVICE_READ_TOKEN');
  }

  if (intentEnabled) {
    if (!deepseekKey || !deepseekKey.trim()) {
      missing.push('DEEPSEEK_API_KEY');
    }
  }

  if (missing.length > 0 || invalid.length > 0) {
    return jsonResponse(
      {
        ok: false,
        service: 'afu9-control-center',
        timestamp: new Date().toISOString(),
        missing,
        invalid,
        checks: {
          database: databaseEnabled
            ? { enabled: true, ok: false, status: 'error', message: 'Missing required environment variables' }
            : { enabled: false, ok: true, status: 'not_configured', message: 'Database disabled in configuration' },
        },
      },
      { status: 503, requestId }
    );
  }
  
  try {
    const checks: Record<string, { status: string; message?: string; latency_ms?: number; enabled?: boolean; ok?: boolean }> = {
      service: { status: 'ok' },
    };

    // Issue 3: Check if production is disabled
    // This is INFORMATIONAL only - does NOT block readiness
    // Prevents unhealthy churn when prod is intentionally paused
    const deploymentEnv = getDeploymentEnv();
    const prodEnabled = isProdEnabled();
    
    if (deploymentEnv === 'production') {
      if (!prodEnabled) {
        // Prod is disabled: report as INFO, not ERROR
        // Keep ready=true to prevent ECS/ALB churn
        checks.prod_enabled = {
          status: 'info',
          message: 'Production write operations disabled (ENABLE_PROD=false). Read operations allowed.',
        };
      } else {
        checks.prod_enabled = { 
          status: 'ok', 
          message: 'Production environment is enabled' 
        };
      }
    }


    // Preflight: if self-propelling is enabled, verify the runtime workflow artifact exists
    const selfPropellingEnabled = process.env.AFU9_ENABLE_SELF_PROPELLING === 'true';
    if (selfPropellingEnabled) {
      if (!fs.existsSync(SELF_PROPELLING_WORKFLOW_PATH)) {
        checks.self_propelling = {
          status: 'error',
          message: `AFU9_ENABLE_SELF_PROPELLING=true but workflow artifact missing: ${SELF_PROPELLING_WORKFLOW_PATH}`,
        };
      } else {
        checks.self_propelling = { status: 'ok' };
      }
    }

    // Check database connectivity based on DATABASE_ENABLED flag
    if (!databaseEnabled) {
      // Database explicitly disabled - report as not_configured (this is expected)
      checks.database = { enabled: false, ok: true, status: 'not_configured', message: 'Database disabled in configuration' };
    } else {
      // Database is enabled, check if credentials are configured
      const dbHost = process.env.DATABASE_HOST;
      const dbPort = process.env.DATABASE_PORT;
      const dbName = process.env.DATABASE_NAME;
      const dbUser = process.env.DATABASE_USER;
      const dbPassword = process.env.DATABASE_PASSWORD;
      
      if (dbHost && dbPort && dbName && dbUser && dbPassword) {
        // All required DB env vars are present
        // In production, we could attempt an actual connection here
        // For now, verify the configuration looks valid
        try {
          const port = parseInt(dbPort, 10);
          if (port > 0 && port < 65536) {
            checks.database = { enabled: true, ok: true, status: 'ok', message: 'connection_configured' };
          } else {
            checks.database = { enabled: true, ok: false, status: 'error', message: 'invalid_port' };
          }
        } catch (error) {
          checks.database = { 
            enabled: true,
            ok: false,
            status: 'error', 
            message: error instanceof Error ? error.message : 'invalid_port'
          };
        }
      } else {
        // Database enabled but credentials missing
        const missing: string[] = [];
        if (!dbHost) missing.push('DATABASE_HOST');
        if (!dbPort) missing.push('DATABASE_PORT');
        if (!dbName) missing.push('DATABASE_NAME');
        if (!dbUser) missing.push('DATABASE_USER');
        if (!dbPassword) missing.push('DATABASE_PASSWORD');
        
        checks.database = { 
          enabled: true,
          ok: false,
          status: 'error', 
          message: `Missing required environment variables: ${missing.join(', ')}`
        };
      }
    }

    // Check if essential environment variables are set
    const essentialVars = ['NODE_ENV'];
    const missingVars = essentialVars.filter(v => !process.env[v]);
    
    if (missingVars.length > 0) {
      checks.environment = { 
        status: 'warning', 
        message: `Missing vars: ${missingVars.join(', ')}` 
      };
    } else {
      checks.environment = { status: 'ok' };
    }

    // Check MCP servers health in production/staging, but do NOT gate readiness
    const env = process.env.NODE_ENV;
    const shouldCheckMCPServers = env === 'production' || env === 'staging';
    
    // Extract MCP server names for consistent reference
    const mcpServerNames = MCP_SERVERS.map(s => s.name);

    if (shouldCheckMCPServers) {
      for (const server of MCP_SERVERS) {
        try {
          const startTime = Date.now();
          const response = await fetch(`${server.url}/health`, {
            signal: AbortSignal.timeout(3000),
          });
          const latency = Date.now() - startTime;

          if (!response.ok) {
            checks[server.name] = {
              status: 'error',
              message: `Server returned status ${response.status}`,
              latency_ms: latency,
            };
          } else {
            checks[server.name] = {
              status: latency > 2000 ? 'warning' : 'ok',
              message: latency > 2000 ? 'High latency' : 'Server healthy',
              latency_ms: latency,
            };
          }
        } catch (error) {
          checks[server.name] = {
            status: 'error',
            message: error instanceof Error ? error.message : 'Connection failed',
          };
        }
      }
    }

    // Determine overall readiness
    // MCP servers and prod_enabled are optional/informational
    const hasFailures = Object.entries(checks).some(([name, check]) => {
      if (mcpServerNames.includes(name)) {
        return false; // MCP servers are optional dependencies
      }
      if (name === 'prod_enabled') {
        return false; // prod_enabled is informational only (Issue 3)
      }
      return check.status === 'error' || check.status === 'failed';
    });

    // Collect errors (exclude info-level checks)
    const errors: string[] = [];
    Object.entries(checks).forEach(([name, check]) => {
      if (check.status === 'error') {
        errors.push(`${name} check failed: ${check.message || 'unknown error'}`);
      }
    });

    const ready = !hasFailures;
    
    // Build explicit production control flags (Issue 3)
    const prodControlFlags = deploymentEnv === 'production' ? {
      prodEnabled: prodEnabled,
      prodWritesBlocked: !prodEnabled,
      reason: !prodEnabled ? getProdDisabledReason() : undefined,
    } : undefined;

    const response = {
      ready,
      service: 'afu9-control-center',
      version: buildInfo.appVersion,
      timestamp: new Date().toISOString(),
      checks,
      dependencies: {
        required: getRequiredDependencies(),
        optional: shouldCheckMCPServers 
          ? mcpServerNames
          : [],
      },
      ...(prodControlFlags && { prodControl: prodControlFlags }),
      ...(errors.length > 0 && { errors }),
    };

    return jsonResponse(
      response,
      { status: ready ? 200 : 503, requestId }
    );
  } catch (error) {
    console.error('Readiness check failed:', error);
    
    return jsonResponse(
      {
        ready: false,
        service: 'afu9-control-center',
        version: buildInfo.appVersion,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        checks: {
          service: { status: 'error', message: 'Readiness check exception' },
          database: databaseEnabled
            ? { enabled: true, ok: false, status: 'error', message: 'Readiness check exception' }
            : { enabled: false, ok: true, status: 'not_configured', message: 'Database disabled in configuration' },
        },
        dependencies: {
          required: getRequiredDependencies(),
          optional: [],
        },
      },
      { status: 503, requestId }
    );
  }
}
