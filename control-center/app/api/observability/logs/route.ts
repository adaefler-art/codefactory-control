/**
 * API Route: CloudWatch Logs
 * 
 * GET /api/observability/logs?logGroup=...&filterPattern=...&hours=...
 * 
 * Fetches recent logs from CloudWatch, with optional filtering.
 * Primarily used to display errors and important events in the Control Center UI.
 */

import { NextResponse } from 'next/server';
import { getMCPClient } from '../../../../src/lib/mcp-client';
import { logger } from '../../../../src/lib/logger';

const log = logger.withComponent('api-logs');

export async function GET(request: Request) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  
  // Parse and validate query parameters
  const logGroupName = searchParams.get('logGroup') || '/ecs/afu9/control-center';
  const filterPattern = searchParams.get('filterPattern') || 'ERROR';
  const hours = Math.min(Math.max(parseInt(searchParams.get('hours') || '1', 10), 1), 72); // 1-72 hours
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10), 1), 1000); // 1-1000 events

  try {
    log.info('Fetching CloudWatch logs', {
      logGroup: logGroupName,
      filterPattern,
      hours,
      limit,
    });

    const client = getMCPClient();
    
    // Calculate time range
    const endTime = Date.now();
    const startTimeMs = endTime - (hours * 60 * 60 * 1000);

    try {
      const logsData = await client.callTool(
        'observability',
        'logs.search',
        {
          logGroupName,
          filterPattern,
          startTime: startTimeMs,
          endTime,
          limit,
        },
        {
          timeoutMs: 10000, // 10 second timeout
        }
      );

      const durationMs = Date.now() - startTime;
      log.timed('Successfully fetched CloudWatch logs', durationMs, {
        eventCount: logsData.events?.length || 0,
      });

      return NextResponse.json({
        status: 'success',
        data: {
          events: logsData.events || [],
          searchedLogStreams: logsData.searchedLogStreams || [],
          nextToken: logsData.nextToken,
          query: {
            logGroup: logGroupName,
            filterPattern,
            startTime: new Date(startTimeMs).toISOString(),
            endTime: new Date(endTime).toISOString(),
            hours,
            limit,
          },
        },
        timestamp: new Date().toISOString(),
        durationMs,
      });
    } catch (mcpError) {
      // If MCP call fails, return graceful error
      log.warn('MCP call failed for logs', {
        error: mcpError instanceof Error ? mcpError.message : String(mcpError),
        logGroup: logGroupName,
      });
      
      return NextResponse.json({
        status: 'unavailable',
        error: 'Logs data unavailable - MCP server may be unreachable',
        message: mcpError instanceof Error ? mcpError.message : String(mcpError),
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error('Error fetching CloudWatch logs', error instanceof Error ? error : undefined, {
      durationMs,
      logGroup: logGroupName,
    });
    
    return NextResponse.json(
      {
        status: 'error',
        error: 'Failed to fetch CloudWatch logs',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
