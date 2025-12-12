import { MCPServer } from '../../base/src/server';
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  DescribeLogGroupsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
  DescribeAlarmsCommand,
} from '@aws-sdk/client-cloudwatch';

/**
 * Observability MCP Server
 * 
 * Provides CloudWatch observability operations as MCP tools:
 * - logs.search
 * - metrics.getServiceHealth
 * - metrics.getAlarmStatus
 */
export class ObservabilityMCPServer extends MCPServer {
  private logsClient: CloudWatchLogsClient;
  private cloudwatchClient: CloudWatchClient;

  constructor(port: number = 3003) {
    super(port, 'mcp-observability');
    
    const region = process.env.AWS_REGION || 'eu-central-1';
    this.logsClient = new CloudWatchLogsClient({ region });
    this.cloudwatchClient = new CloudWatchClient({ region });
  }

  protected registerTools(): void {
    this.tools.set('searchLogs', {
      name: 'searchLogs',
      description: 'Search CloudWatch logs',
      inputSchema: {
        type: 'object',
        properties: {
          logGroupName: { type: 'string', description: 'Log group name' },
          filterPattern: { type: 'string', description: 'Filter pattern (e.g., "ERROR")' },
          startTime: { type: 'number', description: 'Start time (Unix timestamp in ms)' },
          endTime: { type: 'number', description: 'End time (Unix timestamp in ms)' },
          limit: { type: 'number', description: 'Maximum number of events', default: 100 },
        },
        required: ['logGroupName'],
      },
    });

    this.tools.set('getServiceHealth', {
      name: 'getServiceHealth',
      description: 'Get ECS service health metrics',
      inputSchema: {
        type: 'object',
        properties: {
          cluster: { type: 'string', description: 'ECS cluster name' },
          service: { type: 'string', description: 'ECS service name' },
          period: { type: 'number', description: 'Period in seconds', default: 300 },
        },
        required: ['cluster', 'service'],
      },
    });

    this.tools.set('getAlarmStatus', {
      name: 'getAlarmStatus',
      description: 'Get CloudWatch alarm status',
      inputSchema: {
        type: 'object',
        properties: {
          alarmNames: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'Alarm names (optional, returns all if not specified)' 
          },
          stateValue: { 
            type: 'string', 
            enum: ['OK', 'ALARM', 'INSUFFICIENT_DATA'],
            description: 'Filter by state' 
          },
        },
      },
    });
  }

  protected async handleToolCall(tool: string, args: Record<string, any>): Promise<any> {
    switch (tool) {
      case 'searchLogs':
        return this.searchLogs(args as { logGroupName: string; filterPattern?: string; startTime?: number; endTime?: number; limit?: number });
      case 'getServiceHealth':
        return this.getServiceHealth(args as { cluster: string; service: string; period?: number });
      case 'getAlarmStatus':
        return this.getAlarmStatus(args as { alarmNames?: string[]; stateValue?: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA' });
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  private async searchLogs(args: {
    logGroupName: string;
    filterPattern?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }) {
    const {
      logGroupName,
      filterPattern,
      startTime = Date.now() - 3600000, // Default: 1 hour ago
      endTime = Date.now(),
      limit = 100,
    } = args;

    const command = new FilterLogEventsCommand({
      logGroupName,
      filterPattern,
      startTime,
      endTime,
      limit,
    });

    const response = await this.logsClient.send(command);

    return {
      events: response.events?.map((e) => ({
        timestamp: e.timestamp,
        message: e.message,
        logStreamName: e.logStreamName,
      })) || [],
      searchedLogStreams: response.searchedLogStreams?.map((s) => ({
        logStreamName: s.logStreamName,
        searchedCompletely: s.searchedCompletely,
      })),
    };
  }

  private async getServiceHealth(args: {
    cluster: string;
    service: string;
    period?: number;
  }) {
    const { cluster, service, period = 300 } = args;
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 3600000); // 1 hour ago

    // Get CPU utilization
    const cpuCommand = new GetMetricStatisticsCommand({
      Namespace: 'AWS/ECS',
      MetricName: 'CPUUtilization',
      Dimensions: [
        { Name: 'ServiceName', Value: service },
        { Name: 'ClusterName', Value: cluster },
      ],
      StartTime: startTime,
      EndTime: endTime,
      Period: period,
      Statistics: ['Average', 'Maximum'],
    });

    // Get memory utilization
    const memoryCommand = new GetMetricStatisticsCommand({
      Namespace: 'AWS/ECS',
      MetricName: 'MemoryUtilization',
      Dimensions: [
        { Name: 'ServiceName', Value: service },
        { Name: 'ClusterName', Value: cluster },
      ],
      StartTime: startTime,
      EndTime: endTime,
      Period: period,
      Statistics: ['Average', 'Maximum'],
    });

    const [cpuResponse, memoryResponse] = await Promise.all([
      this.cloudwatchClient.send(cpuCommand),
      this.cloudwatchClient.send(memoryCommand),
    ]);

    return {
      cluster,
      service,
      period,
      cpu: {
        datapoints: cpuResponse.Datapoints?.map((d) => ({
          timestamp: d.Timestamp,
          average: d.Average,
          maximum: d.Maximum,
        })),
        unit: cpuResponse.Datapoints?.[0]?.Unit,
      },
      memory: {
        datapoints: memoryResponse.Datapoints?.map((d) => ({
          timestamp: d.Timestamp,
          average: d.Average,
          maximum: d.Maximum,
        })),
        unit: memoryResponse.Datapoints?.[0]?.Unit,
      },
    };
  }

  private async getAlarmStatus(args: {
    alarmNames?: string[];
    stateValue?: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';
  }) {
    const { alarmNames, stateValue } = args;

    const command = new DescribeAlarmsCommand({
      AlarmNames: alarmNames,
      StateValue: stateValue,
    });

    const response = await this.cloudwatchClient.send(command);

    return {
      alarms: response.MetricAlarms?.map((a) => ({
        alarmName: a.AlarmName,
        alarmDescription: a.AlarmDescription,
        stateValue: a.StateValue,
        stateReason: a.StateReason,
        stateUpdatedTimestamp: a.StateUpdatedTimestamp,
        metricName: a.MetricName,
        namespace: a.Namespace,
        threshold: a.Threshold,
        comparisonOperator: a.ComparisonOperator,
      })) || [],
    };
  }
}

// Start server if run directly
if (require.main === module) {
  const port = parseInt(process.env.PORT || '3003', 10);
  const server = new ObservabilityMCPServer(port);
  server.start();
}
