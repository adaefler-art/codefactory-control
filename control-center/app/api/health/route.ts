import { NextResponse } from 'next/server';

/**
 * Health check endpoint for ALB health checks
 * 
 * Returns 200 OK if the service is healthy
 * Simple liveness probe - responds quickly without dependency checks
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'afu9-control-center',
      version: '0.2.5',
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
