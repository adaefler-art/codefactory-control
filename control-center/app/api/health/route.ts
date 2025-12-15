import { NextResponse } from 'next/server';
import { getAppVersion } from '../version';

/**
 * Health check endpoint for ALB health checks
 * 
 * Returns 200 OK if the service is healthy
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'afu9-control-center',
      version: getAppVersion(),
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}
