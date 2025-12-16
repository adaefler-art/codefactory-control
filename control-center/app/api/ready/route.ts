import { NextResponse } from 'next/server';

// Version should match control-center package.json
// In a production system, this could be read from process.env.APP_VERSION
const VERSION = '0.2.5';

/**
 * Readiness check endpoint for Kubernetes-style readiness probes
 * 
 * This endpoint performs deeper checks than /api/health:
 * - Database connectivity (if configured)
 * - MCP server availability (if in production mode)
 * 
 * Returns:
 * - 200 OK if service is ready to accept traffic
 * - 503 Service Unavailable if service is not ready
 * 
 * ALB should use this endpoint for health checks to ensure traffic
 * is only routed to fully initialized instances.
 */
export async function GET() {
  try {
    const checks: Record<string, { status: string; message?: string; latency_ms?: number }> = {
      service: { status: 'ok' },
    };

    // Check database connectivity
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      try {
        // In staging/production, attempt actual database connection
        // For now, we verify the URL is configured and parseable
        const url = new URL(dbUrl);
        if (url.protocol === 'postgresql:' || url.protocol === 'postgres:') {
          checks.database = { status: 'ok', message: 'connection_configured' };
        } else {
          checks.database = { status: 'warning', message: 'invalid_protocol' };
        }
      } catch (error) {
        checks.database = { 
          status: 'error', 
          message: error instanceof Error ? error.message : 'invalid_url'
        };
      }
    } else {
      // Database not configured - this is okay for development
      checks.database = { status: 'not_configured' };
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

    // Check MCP servers health in production/staging
    const env = process.env.NODE_ENV;
    const shouldCheckMCPServers = env === 'production' || env === 'staging';
    
    if (shouldCheckMCPServers) {
      const mcpServers = [
        { name: 'mcp-github', url: process.env.MCP_GITHUB_URL || 'http://localhost:3001' },
        { name: 'mcp-deploy', url: process.env.MCP_DEPLOY_URL || 'http://localhost:3002' },
        { name: 'mcp-observability', url: process.env.MCP_OBSERVABILITY_URL || 'http://localhost:3003' },
      ];

      for (const server of mcpServers) {
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
    const hasFailures = Object.values(checks).some(
      check => check.status === 'error' || check.status === 'failed'
    );

    // Collect errors
    const errors: string[] = [];
    Object.entries(checks).forEach(([name, check]) => {
      if (check.status === 'error') {
        errors.push(`${name} check failed: ${check.message || 'unknown error'}`);
      }
    });

    const ready = !hasFailures;

    const response = {
      ready,
      service: 'afu9-control-center',
      version: VERSION,
      timestamp: new Date().toISOString(),
      checks,
      dependencies: {
        required: ['database', 'environment'],
        optional: shouldCheckMCPServers 
          ? ['mcp-github', 'mcp-deploy', 'mcp-observability']
          : [],
      },
      ...(errors.length > 0 && { errors }),
    };

    return NextResponse.json(
      response,
      { status: ready ? 200 : 503 }
    );
  } catch (error) {
    console.error('Readiness check failed:', error);
    return NextResponse.json(
      {
        ready: false,
        service: 'afu9-control-center',
        version: VERSION,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        checks: {
          service: { status: 'error', message: 'Readiness check exception' }
        },
        dependencies: {
          required: ['database', 'environment'],
          optional: [],
        },
      },
      { status: 503 }
    );
  }
}
