import { MCPServer, DependencyCheck } from '../../base/src/server';
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
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

/**
 * Observability MCP Server
 * 
 * Provides CloudWatch observability operations as MCP tools:
 * - logs.search: Search CloudWatch Logs by pattern (ERROR, RequestId, TaskId, etc.)
 * - metrics.getServiceHealth: Get ECS service health metrics (CPU, Memory, ALB 5xx rate)
 * - getAlarmStatus: Get CloudWatch alarm status (bonus feature)
 */
export class ObservabilityMCPServer extends MCPServer {
  private logsClient: CloudWatchLogsClient;
  private cloudwatchClient: CloudWatchClient;
  private stsClient: STSClient;
  private region: string;

  constructor(port: number = 3003) {
    super(port, 'mcp-observability', '0.2.0');
    
    this.region = process.env.AWS_REGION || 'eu-central-1';
    this.logsClient = new CloudWatchLogsClient({ region: this.region });
    this.cloudwatchClient = new CloudWatchClient({ region: this.region });
    this.stsClient = new STSClient({ region: this.region });
  }

  /**
   * Check dependencies for readiness probe
   */
  protected async checkDependencies(): Promise<Map<string, DependencyCheck>> {
    const checks = new Map<string, DependencyCheck>();

    // Check 1: Service is running
    checks.set('service', { status: 'ok' });

    // Check 2: AWS connectivity
    const awsCheck = await this.checkAWSConnectivity();
    checks.set('aws_connectivity', awsCheck);

    // Check 3: CloudWatch permissions
    const cwCheck = await this.checkCloudWatchPermissions();
    checks.set('cloudwatch_permissions', cwCheck);

    return checks;
  }

  /**
   * Check AWS API connectivity
   */
  private async checkAWSConnectivity(): Promise<DependencyCheck> {
    const startTime = Date.now();
    try {
      const command = new GetCallerIdentityCommand({});
      await this.stsClient.send(command);
      
      const latency = Date.now() - startTime;

      return {
        status: latency > 2000 ? 'warning' : 'ok',
        message: latency > 2000 ? 'High latency detected' : 'AWS API reachable',
        latency_ms: latency,
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'AWS connectivity check failed',
        latency_ms: latency,
      };
    }
  }

  /**
   * Check CloudWatch permissions
   */
  private async checkCloudWatchPermissions(): Promise<DependencyCheck> {
    const startTime = Date.now();
    try {
      // Try a lightweight CloudWatch API call to verify permissions
      const command = new DescribeAlarmsCommand({ MaxRecords: 1 });
      await this.cloudwatchClient.send(command);
      
      const latency = Date.now() - startTime;

      return {
        status: 'ok',
        message: 'CloudWatch permissions verified',
        latency_ms: latency,
      };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      
      if (error.name === 'AccessDeniedException') {
        return {
          status: 'error',
          message: 'Missing CloudWatch permissions',
          latency_ms: latency,
        };
      }

      return {
        status: 'warning',
        message: `CloudWatch permissions check failed: ${error.message}`,
        latency_ms: latency,
      };
    }
  }

  /**
   * Get required dependencies
   */
  protected getRequiredDependencies(): string[] {
    return ['aws_connectivity', 'cloudwatch_permissions'];
  }

  /**
   * Get optional dependencies
   */
  protected getOptionalDependencies(): string[] {
    return [];
  }

  protected registerTools(): void {
    this.tools.set('logs.search', {
      name: 'logs.search',
      description: 'Search CloudWatch logs by pattern (e.g., ERROR, RequestId, TaskId)',
      inputSchema: {
        type: 'object',
        properties: {
          logGroupName: { type: 'string', description: 'Log group name' },
          filterPattern: { type: 'string', description: 'Filter pattern (e.g., "ERROR", "RequestId", "TaskId")' },
          startTime: { type: 'number', description: 'Start time (Unix timestamp in ms)' },
          endTime: { type: 'number', description: 'End time (Unix timestamp in ms)' },
          limit: { type: 'number', description: 'Maximum number of events', default: 100 },
          nextToken: { type: 'string', description: 'Token for pagination (from previous response)' },
        },
        required: ['logGroupName'],
      },
    });

    this.tools.set('metrics.getServiceHealth', {
      name: 'metrics.getServiceHealth',
      description: 'Get ECS service health metrics including CPU, Memory, and ALB 5xx rate',
      inputSchema: {
        type: 'object',
        properties: {
          cluster: { type: 'string', description: 'ECS cluster name' },
          service: { type: 'string', description: 'ECS service name' },
          loadBalancerName: { type: 'string', description: 'ALB name (optional, for 5xx metrics)' },
          targetGroupArn: { type: 'string', description: 'Target Group ARN (optional, for 5xx metrics)' },
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
      case 'logs.search':
        return this.searchLogs(args as { logGroupName: string; filterPattern?: string; startTime?: number; endTime?: number; limit?: number; nextToken?: string });
      case 'metrics.getServiceHealth':
        return this.getServiceHealth(args as { cluster: string; service: string; loadBalancerName?: string; targetGroupArn?: string; period?: number });
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
    nextToken?: string;
  }) {
    const {
      logGroupName,
      filterPattern,
      startTime = Date.now() - 3600000, // Default: 1 hour ago
      endTime = Date.now(),
      limit = 100,
      nextToken,
    } = args;

    this.logger.info('Searching CloudWatch logs', { 
      logGroupName, 
      filterPattern,
      timeRange: `${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`,
      limit 
    });

    const command = new FilterLogEventsCommand({
      logGroupName,
      filterPattern,
      startTime,
      endTime,
      limit,
      nextToken,
    });

    const response = await this.logsClient.send(command);

    this.logger.info('Log search completed', { 
      logGroupName,
      eventsFound: response.events?.length || 0,
      hasMore: !!response.nextToken 
    });

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
      nextToken: response.nextToken, // Return nextToken for pagination
    };
  }

  private async getServiceHealth(args: {
    cluster: string;
    service: string;
    loadBalancerName?: string;
    targetGroupArn?: string;
    period?: number;
  }) {
    const { cluster, service, loadBalancerName, targetGroupArn, period = 300 } = args;
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 3600000); // 1 hour ago

    this.logger.info('Fetching service health metrics', { 
      cluster, 
      service, 
      period,
      hasAlbMetrics: !!(loadBalancerName && targetGroupArn)
    });

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

    // Prepare promises for parallel execution
    const promises = [
      this.cloudwatchClient.send(cpuCommand),
      this.cloudwatchClient.send(memoryCommand),
    ];

    // Get ALB 5xx metrics if load balancer information is provided
    let hasAlbMetrics = false;
    if (targetGroupArn && loadBalancerName) {
      // Extract the targetgroup/name/id part from the full ARN
      // ARN format: arn:aws:elasticloadbalancing:region:account-id:targetgroup/name/id
      const targetGroupDimension = targetGroupArn.includes('targetgroup/')
        ? targetGroupArn.split('targetgroup/')[1]
        : targetGroupArn;

      const alb5xxCommand = new GetMetricStatisticsCommand({
        Namespace: 'AWS/ApplicationELB',
        MetricName: 'HTTPCode_Target_5XX_Count',
        Dimensions: [
          { Name: 'LoadBalancer', Value: loadBalancerName },
          { Name: 'TargetGroup', Value: `targetgroup/${targetGroupDimension}` },
        ],
        StartTime: startTime,
        EndTime: endTime,
        Period: period,
        Statistics: ['Sum', 'Average'],
      });
      promises.push(this.cloudwatchClient.send(alb5xxCommand));
      hasAlbMetrics = true;
    }

    const responses = await Promise.all(promises);
    const cpuResponse = responses[0];
    const memoryResponse = responses[1];
    const alb5xxResponse = hasAlbMetrics ? responses[2] : undefined;

    const result: any = {
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

    // Add ALB 5xx metrics if available
    if (alb5xxResponse) {
      result.alb5xx = {
        datapoints: alb5xxResponse.Datapoints?.map((d) => ({
          timestamp: d.Timestamp,
          sum: d.Sum,
          average: d.Average,
        })),
        unit: alb5xxResponse.Datapoints?.[0]?.Unit,
      };
    }

    return result;
  }

  private async getAlarmStatus(args: {
    alarmNames?: string[];
    stateValue?: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';
  }) {
    const { alarmNames, stateValue } = args;

    this.logger.info('Fetching alarm status', { 
      alarmCount: alarmNames?.length || 'all',
      stateFilter: stateValue 
    });

    const command = new DescribeAlarmsCommand({
      AlarmNames: alarmNames,
      StateValue: stateValue,
    });

    const response = await this.cloudwatchClient.send(command);

    this.logger.info('Alarm status retrieved', { 
      alarmsFound: response.MetricAlarms?.length || 0 
    });

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
