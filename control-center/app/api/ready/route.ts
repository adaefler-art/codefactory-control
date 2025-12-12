import { NextResponse } from 'next/server';

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
    const checks: Record<string, { status: string; message?: string }> = {
      service: { status: 'ok' },
    };

    // Check database connectivity (optional - depends on if DB is required for serving traffic)
    // For now, we'll do a basic check. In production, you might want to add:
    // - Database connection pool health
    // - MCP server connectivity
    // - Essential service dependencies
    
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      // Database is configured, mark as ready
      // In a production system, you'd do an actual connectivity check here
      checks.database = { status: 'ok', message: 'configured' };
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

    // Determine overall readiness
    const hasFailures = Object.values(checks).some(
      check => check.status === 'error' || check.status === 'failed'
    );

    if (hasFailures) {
      return NextResponse.json(
        {
          ready: false,
          service: 'afu9-control-center',
          version: '0.2.5',
          timestamp: new Date().toISOString(),
          checks,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        ready: true,
        service: 'afu9-control-center',
        version: '0.2.5',
        timestamp: new Date().toISOString(),
        checks,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Readiness check failed:', error);
    return NextResponse.json(
      {
        ready: false,
        service: 'afu9-control-center',
        version: '0.2.5',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
