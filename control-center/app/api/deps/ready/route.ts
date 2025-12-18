import { NextResponse } from 'next/server';

const VERSION = '0.2.5';

export async function GET() {
  try {
    const checks: Record<string, { status: string; message?: string; latency_ms?: number }> = {
      service: { status: 'ok' },
    };

    const databaseEnabled = process.env.DATABASE_ENABLED === 'true';

    if (!databaseEnabled) {
      checks.database = { status: 'not_configured', message: 'Database disabled in configuration' };
    } else {
      const dbHost = process.env.DATABASE_HOST;
      const dbPort = process.env.DATABASE_PORT;
      const dbName = process.env.DATABASE_NAME;
      const dbUser = process.env.DATABASE_USER;
      const dbPassword = process.env.DATABASE_PASSWORD;

      if (dbHost && dbPort && dbName && dbUser && dbPassword) {
        try {
          const port = parseInt(dbPort, 10);
          if (port > 0 && port < 65536) {
            checks.database = { status: 'ok', message: 'connection_configured' };
          } else {
            checks.database = { status: 'error', message: 'invalid_port' };
          }
        } catch (error) {
          checks.database = {
            status: 'error',
            message: error instanceof Error ? error.message : 'invalid_port',
          };
        }
      } else {
        const missing: string[] = [];
        if (!dbHost) missing.push('DATABASE_HOST');
        if (!dbPort) missing.push('DATABASE_PORT');
        if (!dbName) missing.push('DATABASE_NAME');
        if (!dbUser) missing.push('DATABASE_USER');
        if (!dbPassword) missing.push('DATABASE_PASSWORD');

        checks.database = {
          status: 'error',
          message: `Missing required environment variables: ${missing.join(', ')}`,
        };
      }
    }

    const essentialVars = ['NODE_ENV'];
    const missingVars = essentialVars.filter((v) => !process.env[v]);

    if (missingVars.length > 0) {
      checks.environment = {
        status: 'warning',
        message: `Missing vars: ${missingVars.join(', ')}`,
      };
    } else {
      checks.environment = { status: 'ok' };
    }

    const env = process.env.NODE_ENV;
    const shouldCheckMCPServers = env === 'production' || env === 'staging';
    const mcpServers = [
      { name: 'mcp-github', url: process.env.MCP_GITHUB_URL || 'http://127.0.0.1:3001' },
      { name: 'mcp-deploy', url: process.env.MCP_DEPLOY_URL || 'http://127.0.0.1:3002' },
      { name: 'mcp-observability', url: process.env.MCP_OBSERVABILITY_URL || 'http://127.0.0.1:3003' },
    ];

    if (shouldCheckMCPServers) {
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

    const hasFailures = Object.values(checks).some(
      (check) => check.status === 'error' || check.status === 'failed'
    );

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
        optional: shouldCheckMCPServers ? ['mcp-github', 'mcp-deploy', 'mcp-observability'] : [],
      },
      ...(errors.length > 0 && { errors }),
    };

    return NextResponse.json(response, { status: ready ? 200 : 503 });
  } catch (error) {
    console.error('Dependency readiness check failed:', error);
    return NextResponse.json(
      {
        ready: false,
        service: 'afu9-control-center',
        version: VERSION,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        checks: {
          service: { status: 'error', message: 'Readiness check exception' },
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
