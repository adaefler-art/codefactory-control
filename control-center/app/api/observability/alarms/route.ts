/**
 * API Route: CloudWatch Alarms Status
 * 
 * GET /api/observability/alarms
 * 
 * Fetches the current status of all CloudWatch alarms for AFU-9 infrastructure.
 * Uses the observability MCP server to query CloudWatch.
 */

import { NextResponse } from 'next/server';
import { getMCPClient } from '../../../../src/lib/mcp-client';
import { logger } from '../../../../src/lib/logger';

const log = logger.withComponent('api-alarms');

export async function GET() {
  const startTime = Date.now();

  try {
    log.info('Fetching CloudWatch alarms status');

    const client = getMCPClient();
    
    // Fetch alarm status from observability MCP server
    try {
      const alarmsData = await client.callTool(
        'observability',
        'getAlarmStatus',
        {
          // No filter - get all alarms
        },
        {
          timeoutMs: 10000, // 10 second timeout
        }
      );

      const durationMs = Date.now() - startTime;
      log.timed('Successfully fetched CloudWatch alarms', durationMs);

      // Group alarms by state
      const alarms = alarmsData.alarms || [];
      const groupedAlarms = {
        ok: alarms.filter((a: any) => a.stateValue === 'OK'),
        alarm: alarms.filter((a: any) => a.stateValue === 'ALARM'),
        insufficientData: alarms.filter((a: any) => a.stateValue === 'INSUFFICIENT_DATA'),
      };

      return NextResponse.json({
        status: 'success',
        data: {
          alarms: alarmsData.alarms || [],
          summary: {
            total: alarms.length,
            ok: groupedAlarms.ok.length,
            alarm: groupedAlarms.alarm.length,
            insufficientData: groupedAlarms.insufficientData.length,
          },
          groupedAlarms,
        },
        timestamp: new Date().toISOString(),
        durationMs,
      });
    } catch (mcpError) {
      // If MCP call fails, return graceful error
      log.warn('MCP call failed for alarms', {
        error: mcpError instanceof Error ? mcpError.message : String(mcpError),
      });
      
      return NextResponse.json({
        status: 'unavailable',
        error: 'Alarms data unavailable - MCP server may be unreachable',
        message: mcpError instanceof Error ? mcpError.message : String(mcpError),
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error('Error fetching CloudWatch alarms', error instanceof Error ? error : undefined, {
      durationMs,
    });
    
    return NextResponse.json(
      {
        status: 'error',
        error: 'Failed to fetch CloudWatch alarms',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
