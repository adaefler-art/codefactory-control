import { MCPServer } from '../../base/src/server';
import { ECSClient, UpdateServiceCommand, DescribeServicesCommand } from '@aws-sdk/client-ecs';

/**
 * AWS Deploy MCP Server
 * 
 * Provides AWS ECS deployment operations as MCP tools:
 * - deploy.updateService
 * - deploy.getServiceStatus
 */
export class DeployMCPServer extends MCPServer {
  private ecsClient: ECSClient;

  constructor(port: number = 3002) {
    super(port, 'mcp-deploy');
    
    const region = process.env.AWS_REGION || 'eu-central-1';
    this.ecsClient = new ECSClient({ region });
  }

  protected registerTools(): void {
    this.tools.set('updateService', {
      name: 'updateService',
      description: 'Update an ECS service with a new image',
      inputSchema: {
        type: 'object',
        properties: {
          cluster: { type: 'string', description: 'ECS cluster name' },
          service: { type: 'string', description: 'ECS service name' },
          forceNewDeployment: { type: 'boolean', description: 'Force new deployment', default: true },
        },
        required: ['cluster', 'service'],
      },
    });

    this.tools.set('getServiceStatus', {
      name: 'getServiceStatus',
      description: 'Get the status of an ECS service',
      inputSchema: {
        type: 'object',
        properties: {
          cluster: { type: 'string', description: 'ECS cluster name' },
          service: { type: 'string', description: 'ECS service name' },
        },
        required: ['cluster', 'service'],
      },
    });
  }

  protected async handleToolCall(tool: string, args: Record<string, any>): Promise<any> {
    switch (tool) {
      case 'updateService':
        return this.updateService(args);
      case 'getServiceStatus':
        return this.getServiceStatus(args);
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  private async updateService(args: {
    cluster: string;
    service: string;
    forceNewDeployment?: boolean;
  }) {
    const { cluster, service, forceNewDeployment = true } = args;

    const command = new UpdateServiceCommand({
      cluster,
      service,
      forceNewDeployment,
    });

    const response = await this.ecsClient.send(command);

    return {
      serviceArn: response.service?.serviceArn,
      serviceName: response.service?.serviceName,
      status: response.service?.status,
      desiredCount: response.service?.desiredCount,
      runningCount: response.service?.runningCount,
      deployments: response.service?.deployments?.map((d) => ({
        id: d.id,
        status: d.status,
        desiredCount: d.desiredCount,
        runningCount: d.runningCount,
        createdAt: d.createdAt,
      })),
    };
  }

  private async getServiceStatus(args: { cluster: string; service: string }) {
    const { cluster, service } = args;

    const command = new DescribeServicesCommand({
      cluster,
      services: [service],
    });

    const response = await this.ecsClient.send(command);
    const serviceData = response.services?.[0];

    if (!serviceData) {
      throw new Error(`Service ${service} not found in cluster ${cluster}`);
    }

    return {
      serviceArn: serviceData.serviceArn,
      serviceName: serviceData.serviceName,
      status: serviceData.status,
      desiredCount: serviceData.desiredCount,
      runningCount: serviceData.runningCount,
      pendingCount: serviceData.pendingCount,
      deployments: serviceData.deployments?.map((d) => ({
        id: d.id,
        status: d.status,
        taskDefinition: d.taskDefinition,
        desiredCount: d.desiredCount,
        runningCount: d.runningCount,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
      events: serviceData.events?.slice(0, 5).map((e) => ({
        message: e.message,
        createdAt: e.createdAt,
      })),
    };
  }
}

// Start server if run directly
if (require.main === module) {
  const port = parseInt(process.env.PORT || '3002', 10);
  const server = new DeployMCPServer(port);
  server.start();
}
