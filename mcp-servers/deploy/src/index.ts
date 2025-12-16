import { MCPServer, DependencyCheck } from '../../base/src/server';
import {
  ECSClient,
  UpdateServiceCommand,
  DescribeServicesCommand,
  DescribeTasksCommand,
  ListTasksCommand,
  DescribeTaskDefinitionCommand,
  RegisterTaskDefinitionCommand,
  ContainerDefinition
} from '@aws-sdk/client-ecs';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

/**
 * AWS Deploy MCP Server
 * 
 * Provides AWS ECS deployment operations as MCP tools:
 * - deploy.updateService
 * - deploy.getServiceStatus
 */
export class DeployMCPServer extends MCPServer {
  private ecsClient: ECSClient;
  private stsClient: STSClient;
  private region: string;

  constructor(port: number = 3002) {
    super(port, 'mcp-deploy', '0.2.0');
    
    this.region = process.env.AWS_REGION || 'eu-central-1';
    this.ecsClient = new ECSClient({ region: this.region });
    this.stsClient = new STSClient({ region: this.region });
    this.logger.info('DeployMCPServer initialized', { region: this.region });
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

    // Check 3: ECS permissions
    const ecsCheck = await this.checkECSPermissions();
    checks.set('ecs_permissions', ecsCheck);

    return checks;
  }

  /**
   * Check AWS API connectivity using STS
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
   * Check if we have ECS permissions by listing clusters
   */
  private async checkECSPermissions(): Promise<DependencyCheck> {
    const startTime = Date.now();
    try {
      // Use ListClustersCommand which is already imported
      const { ListClustersCommand } = await import('@aws-sdk/client-ecs');
      const command = new ListClustersCommand({ maxResults: 1 });
      await this.ecsClient.send(command);
      
      const latency = Date.now() - startTime;

      return {
        status: 'ok',
        message: 'ECS permissions verified',
        latency_ms: latency,
      };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      
      if (error.name === 'AccessDeniedException') {
        return {
          status: 'error',
          message: 'Missing ECS permissions',
          latency_ms: latency,
        };
      }

      return {
        status: 'warning',
        message: `ECS permissions check failed: ${error.message}`,
        latency_ms: latency,
      };
    }
  }

  /**
   * Get required dependencies
   */
  protected getRequiredDependencies(): string[] {
    return ['aws_connectivity', 'ecs_permissions'];
  }

  /**
   * Get optional dependencies
   */
  protected getOptionalDependencies(): string[] {
    return [];
  }

  protected registerTools(): void {
    this.tools.set('updateService', {
      name: 'updateService',
      description: 'Update an ECS service with a new image tag or force a new deployment. Supports updating specific container images within the task definition.',
      inputSchema: {
        type: 'object',
        properties: {
          cluster: { type: 'string', description: 'ECS cluster name' },
          service: { type: 'string', description: 'ECS service name' },
          containerName: { type: 'string', description: 'Container name to update (optional, required if imageUri is provided)' },
          imageUri: { type: 'string', description: 'New image URI with tag (e.g., 123456789.dkr.ecr.eu-central-1.amazonaws.com/my-app:v1.2.3). If omitted, forces new deployment with existing task definition.' },
          forceNewDeployment: { type: 'boolean', description: 'Force new deployment even without task definition changes', default: true },
        },
        required: ['cluster', 'service'],
      },
    });

    this.tools.set('getServiceStatus', {
      name: 'getServiceStatus',
      description: 'Get comprehensive status of an ECS service including deployments, tasks, and recent events',
      inputSchema: {
        type: 'object',
        properties: {
          cluster: { type: 'string', description: 'ECS cluster name' },
          service: { type: 'string', description: 'ECS service name' },
          includeTaskDetails: { type: 'boolean', description: 'Include detailed information about running tasks', default: true },
        },
        required: ['cluster', 'service'],
      },
    });
  }

  protected async handleToolCall(tool: string, args: Record<string, any>): Promise<any> {
    switch (tool) {
      case 'updateService':
        return await this.updateService(args as {
          cluster: string;
          service: string;
          containerName?: string;
          imageUri?: string;
          forceNewDeployment?: boolean;
        });
      case 'getServiceStatus':
        return await this.getServiceStatus(args as {
          cluster: string;
          service: string;
          includeTaskDetails?: boolean;
        });
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  private async updateService(args: {
    cluster: string;
    service: string;
    containerName?: string;
    imageUri?: string;
    forceNewDeployment?: boolean;
  }) {
    const { cluster, service, containerName, imageUri, forceNewDeployment = true } = args;

    this.logger.info('Starting service update', {
      cluster,
      service,
      containerName,
      imageUri,
      forceNewDeployment
    });

    // If imageUri is provided, we need to create a new task definition
    let taskDefinition: string | undefined;
    if (imageUri) {
      if (!containerName) {
        throw new Error('containerName is required when imageUri is provided');
      }

      // Get current service to find its task definition
      const describeCommand = new DescribeServicesCommand({
        cluster,
        services: [service],
      });
      const describeResponse = await this.ecsClient.send(describeCommand);
      const currentService = describeResponse.services?.[0];

      if (!currentService?.taskDefinition) {
        throw new Error(`Service ${service} not found or has no task definition`);
      }

      // Get current task definition
      const taskDefCommand = new DescribeTaskDefinitionCommand({
        taskDefinition: currentService.taskDefinition,
      });
      const taskDefResponse = await this.ecsClient.send(taskDefCommand);
      const currentTaskDef = taskDefResponse.taskDefinition;

      if (!currentTaskDef) {
        throw new Error('Could not retrieve current task definition');
      }

      // Validate container exists before updating
      if (!currentTaskDef.containerDefinitions?.some(c => c.name === containerName)) {
        throw new Error(`Container ${containerName} not found in task definition`);
      }

      // Update the container image
      const updatedContainers = currentTaskDef.containerDefinitions.map((container) => {
        if (container.name === containerName) {
          this.logger.info('Updating container image', {
            containerName,
            oldImage: container.image,
            newImage: imageUri
          });
          return { ...container, image: imageUri };
        }
        return container;
      }) as ContainerDefinition[];

      // Register new task definition with updated image
      const registerParams: any = {
        family: currentTaskDef.family!,
        containerDefinitions: updatedContainers,
      };

      // Only include defined optional properties
      if (currentTaskDef.taskRoleArn) registerParams.taskRoleArn = currentTaskDef.taskRoleArn;
      if (currentTaskDef.executionRoleArn) registerParams.executionRoleArn = currentTaskDef.executionRoleArn;
      if (currentTaskDef.networkMode) registerParams.networkMode = currentTaskDef.networkMode;
      if (currentTaskDef.volumes) registerParams.volumes = currentTaskDef.volumes;
      if (currentTaskDef.requiresCompatibilities) registerParams.requiresCompatibilities = currentTaskDef.requiresCompatibilities;
      if (currentTaskDef.cpu) registerParams.cpu = currentTaskDef.cpu;
      if (currentTaskDef.memory) registerParams.memory = currentTaskDef.memory;
      if (currentTaskDef.runtimePlatform) registerParams.runtimePlatform = currentTaskDef.runtimePlatform;

      const registerCommand = new RegisterTaskDefinitionCommand(registerParams);

      const registerResponse = await this.ecsClient.send(registerCommand);
      taskDefinition = registerResponse.taskDefinition?.taskDefinitionArn;

      this.logger.info('Registered new task definition', {
        oldTaskDefinition: currentTaskDef.taskDefinitionArn,
        newTaskDefinition: taskDefinition,
        containerName,
        imageUri
      });
    }

    const command = new UpdateServiceCommand({
      cluster,
      service,
      forceNewDeployment,
      ...(taskDefinition && { taskDefinition }),
    });

    const response = await this.ecsClient.send(command);

    this.logger.info('Service update completed', {
      cluster,
      service,
      serviceArn: response.service?.serviceArn,
      status: response.service?.status,
      deployments: response.service?.deployments?.length
    });

    // Get task information for the new deployment
    const tasks = await this.getServiceTasks(cluster, service);

    return {
      serviceArn: response.service?.serviceArn,
      serviceName: response.service?.serviceName,
      clusterArn: response.service?.clusterArn,
      status: response.service?.status,
      desiredCount: response.service?.desiredCount,
      runningCount: response.service?.runningCount,
      pendingCount: response.service?.pendingCount,
      taskDefinition: response.service?.taskDefinition,
      deployments: response.service?.deployments?.map((d) => ({
        id: d.id,
        status: d.status,
        taskDefinition: d.taskDefinition,
        desiredCount: d.desiredCount,
        runningCount: d.runningCount,
        pendingCount: d.pendingCount,
        failedTasks: d.failedTasks,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        rolloutState: d.rolloutState,
        rolloutStateReason: d.rolloutStateReason,
      })),
      events: response.service?.events?.slice(0, 10).map((e) => ({
        id: e.id,
        message: e.message,
        createdAt: e.createdAt,
      })),
      tasks: tasks,
    };
  }

  private async getServiceStatus(args: {
    cluster: string;
    service: string;
    includeTaskDetails?: boolean;
  }) {
    const { cluster, service, includeTaskDetails = true } = args;

    this.logger.info('Getting service status', { cluster, service, includeTaskDetails });

    const command = new DescribeServicesCommand({
      cluster,
      services: [service],
    });

    const response = await this.ecsClient.send(command);
    const serviceData = response.services?.[0];

    if (!serviceData) {
      const error = new Error(`Service ${service} not found in cluster ${cluster}`);
      this.logger.error('Service not found', error, { cluster, service });
      throw error;
    }

    // Get task details if requested
    const tasks = includeTaskDetails ? await this.getServiceTasks(cluster, service) : [];

    this.logger.info('Service status retrieved', {
      cluster,
      service,
      status: serviceData.status,
      runningCount: serviceData.runningCount,
      desiredCount: serviceData.desiredCount,
      taskCount: tasks.length
    });

    return {
      serviceArn: serviceData.serviceArn,
      serviceName: serviceData.serviceName,
      clusterArn: serviceData.clusterArn,
      status: serviceData.status,
      desiredCount: serviceData.desiredCount,
      runningCount: serviceData.runningCount,
      pendingCount: serviceData.pendingCount,
      taskDefinition: serviceData.taskDefinition,
      createdAt: serviceData.createdAt,
      launchType: serviceData.launchType,
      platformVersion: serviceData.platformVersion,
      deployments: serviceData.deployments?.map((d) => ({
        id: d.id,
        status: d.status,
        taskDefinition: d.taskDefinition,
        desiredCount: d.desiredCount,
        runningCount: d.runningCount,
        pendingCount: d.pendingCount,
        failedTasks: d.failedTasks,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        rolloutState: d.rolloutState,
        rolloutStateReason: d.rolloutStateReason,
      })),
      events: serviceData.events?.slice(0, 10).map((e) => ({
        id: e.id,
        message: e.message,
        createdAt: e.createdAt,
      })),
      tasks: tasks,
    };
  }

  /**
   * Get detailed information about tasks running in a service
   * Note: Only retrieves RUNNING tasks. To see stopped/failed tasks, query with different desiredStatus.
   */
  private async getServiceTasks(cluster: string, service: string) {
    try {
      // List tasks for the service (only RUNNING tasks to show current deployment state)
      const listCommand = new ListTasksCommand({
        cluster,
        serviceName: service,
        desiredStatus: 'RUNNING',
      });

      const listResponse = await this.ecsClient.send(listCommand);
      
      if (!listResponse.taskArns || listResponse.taskArns.length === 0) {
        this.logger.info('No running tasks found', { cluster, service });
        return [];
      }

      // Describe the tasks to get detailed information
      const describeCommand = new DescribeTasksCommand({
        cluster,
        tasks: listResponse.taskArns,
      });

      const describeResponse = await this.ecsClient.send(describeCommand);

      return describeResponse.tasks?.map((task) => ({
        taskArn: task.taskArn,
        taskDefinitionArn: task.taskDefinitionArn,
        lastStatus: task.lastStatus,
        desiredStatus: task.desiredStatus,
        healthStatus: task.healthStatus,
        cpu: task.cpu,
        memory: task.memory,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        stoppedAt: task.stoppedAt,
        stoppedReason: task.stoppedReason,
        connectivity: task.connectivity,
        connectivityAt: task.connectivityAt,
        containers: task.containers?.map((c) => ({
          name: c.name,
          image: c.image,
          lastStatus: c.lastStatus,
          healthStatus: c.healthStatus,
          exitCode: c.exitCode,
          reason: c.reason,
          networkBindings: c.networkBindings,
        })),
      })) || [];
    } catch (error) {
      this.logger.error('Failed to get task details', error, { cluster, service });
      // Return empty array but error is logged - caller can check logs if task count is 0
      // This allows the main operation to succeed even if task details fail
      return [];
    }
  }
}

// Start server if run directly
if (require.main === module) {
  const port = parseInt(process.env.PORT || '3002', 10);
  const server = new DeployMCPServer(port);
  server.start();
}
