import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2, aws_ecs as ecs, aws_ecr as ecr, aws_elasticloadbalancingv2 as elbv2, aws_iam as iam, aws_logs as logs, aws_secretsmanager as secretsmanager } from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * AFU-9 ECS Infrastructure Stack
 * 
 * Deploys AFU-9 Control Center and MCP servers on ECS Fargate:
 * - ECR repositories for all container images
 * - ECS Cluster with Container Insights
 * - ECS Task Definition with 4 containers (control-center + 3 MCP servers)
 * - ECS Fargate Service with auto-scaling and health checks
 * - IAM roles and policies for task execution and application
 * - CloudWatch log groups for centralized logging
 * - Secrets Manager integration for secure credentials
 * 
 * This stack depends on:
 * - Afu9NetworkStack: VPC, security groups, ALB, target group
 * - Afu9DatabaseStack: RDS database and connection secrets
 */
export interface Afu9EcsStackProps extends cdk.StackProps {
  /**
   * VPC to deploy ECS tasks in
   */
  vpc: ec2.Vpc;

  /**
   * Security group for ECS tasks
   */
  ecsSecurityGroup: ec2.SecurityGroup;

  /**
   * Target group to attach ECS service to
   */
  targetGroup: elbv2.ApplicationTargetGroup;

  /**
   * ARN of the database connection secret
   */
  dbSecretArn: string;
}

export class Afu9EcsStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;
  public readonly controlCenterRepo: ecr.Repository;
  public readonly mcpGithubRepo: ecr.Repository;
  public readonly mcpDeployRepo: ecr.Repository;
  public readonly mcpObservabilityRepo: ecr.Repository;

  constructor(scope: Construct, id: string, props: Afu9EcsStackProps) {
    super(scope, id, props);

    const { vpc, ecsSecurityGroup, targetGroup, dbSecretArn } = props;

    // ========================================
    // ECR Repositories
    // ========================================

    // Control Center repository
    this.controlCenterRepo = new ecr.Repository(this, 'ControlCenterRepo', {
      repositoryName: 'afu9/control-center',
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          description: 'Keep last 10 images',
          maxImageCount: 10,
        },
      ],
    });

    // MCP GitHub Server repository
    this.mcpGithubRepo = new ecr.Repository(this, 'McpGithubRepo', {
      repositoryName: 'afu9/mcp-github',
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          description: 'Keep last 10 images',
          maxImageCount: 10,
        },
      ],
    });

    // MCP Deploy Server repository
    this.mcpDeployRepo = new ecr.Repository(this, 'McpDeployRepo', {
      repositoryName: 'afu9/mcp-deploy',
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          description: 'Keep last 10 images',
          maxImageCount: 10,
        },
      ],
    });

    // MCP Observability Server repository
    this.mcpObservabilityRepo = new ecr.Repository(this, 'McpObservabilityRepo', {
      repositoryName: 'afu9/mcp-observability',
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          description: 'Keep last 10 images',
          maxImageCount: 10,
        },
      ],
    });

    // ========================================
    // Secrets Manager
    // ========================================

    // Import database secret
    const dbSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'DatabaseSecret',
      dbSecretArn
    );

    // Placeholder for GitHub credentials (to be populated manually)
    const githubSecret = new secretsmanager.Secret(this, 'GithubSecret', {
      secretName: 'afu9/github',
      description: 'AFU-9 GitHub credentials',
      secretObjectValue: {
        token: cdk.SecretValue.unsafePlainText('PLACEHOLDER_UPDATE_MANUALLY'),
        owner: cdk.SecretValue.unsafePlainText('your-github-org'),
        repo: cdk.SecretValue.unsafePlainText('your-repo'),
      },
    });

    // Placeholder for LLM API keys (to be populated manually)
    const llmSecret = new secretsmanager.Secret(this, 'LlmSecret', {
      secretName: 'afu9/llm',
      description: 'AFU-9 LLM API keys',
      secretObjectValue: {
        openai_api_key: cdk.SecretValue.unsafePlainText('PLACEHOLDER_UPDATE_MANUALLY'),
      },
    });

    // ========================================
    // ECS Cluster
    // ========================================

    this.cluster = new ecs.Cluster(this, 'Afu9Cluster', {
      clusterName: 'afu9-cluster',
      vpc,
      containerInsights: true,
    });

    cdk.Tags.of(this.cluster).add('Name', 'afu9-cluster');
    cdk.Tags.of(this.cluster).add('Environment', 'production');
    cdk.Tags.of(this.cluster).add('Project', 'AFU-9');

    // ========================================
    // IAM Roles
    // ========================================

    // Task execution role (used by ECS to pull images and write logs)
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      roleName: 'afu9-ecs-task-execution-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy'
        ),
      ],
    });

    // Grant access to secrets
    dbSecret.grantRead(taskExecutionRole);
    githubSecret.grantRead(taskExecutionRole);
    llmSecret.grantRead(taskExecutionRole);

    // Task role (used by application code for AWS API calls)
    const taskRole = new iam.Role(this, 'TaskRole', {
      roleName: 'afu9-ecs-task-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Grant task role access to secrets
    dbSecret.grantRead(taskRole);
    githubSecret.grantRead(taskRole);
    llmSecret.grantRead(taskRole);

    // Grant CloudWatch permissions
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'logs:FilterLogEvents',
          'logs:DescribeLogStreams',
          'cloudwatch:GetMetricStatistics',
          'cloudwatch:DescribeAlarms',
          'cloudwatch:PutMetricData',
        ],
        resources: ['*'],
      })
    );

    // Grant ECS permissions for deploy MCP server
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ecs:DescribeServices',
          'ecs:UpdateService',
          'ecs:DescribeTasks',
          'ecs:ListTasks',
          'ecs:DescribeTaskDefinition',
        ],
        resources: ['*'],
      })
    );

    // ========================================
    // CloudWatch Log Groups
    // ========================================

    const controlCenterLogGroup = new logs.LogGroup(this, 'ControlCenterLogGroup', {
      logGroupName: '/ecs/afu9/control-center',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const mcpGithubLogGroup = new logs.LogGroup(this, 'McpGithubLogGroup', {
      logGroupName: '/ecs/afu9/mcp-github',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const mcpDeployLogGroup = new logs.LogGroup(this, 'McpDeployLogGroup', {
      logGroupName: '/ecs/afu9/mcp-deploy',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const mcpObservabilityLogGroup = new logs.LogGroup(this, 'McpObservabilityLogGroup', {
      logGroupName: '/ecs/afu9/mcp-observability',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ========================================
    // ECS Task Definition
    // ========================================

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      family: 'afu9-control-center',
      cpu: 1024, // 1 vCPU
      memoryLimitMiB: 2048, // 2 GB
      executionRole: taskExecutionRole,
      taskRole: taskRole,
    });

    // Control Center container
    const controlCenterContainer = taskDefinition.addContainer('control-center', {
      image: ecs.ContainerImage.fromEcrRepository(this.controlCenterRepo, 'latest'),
      containerName: 'control-center',
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'control-center',
        logGroup: controlCenterLogGroup,
      }),
      environment: {
        NODE_ENV: 'production',
        PORT: '3000',
        MCP_GITHUB_ENDPOINT: 'http://localhost:3001',
        MCP_DEPLOY_ENDPOINT: 'http://localhost:3002',
        MCP_OBSERVABILITY_ENDPOINT: 'http://localhost:3003',
      },
      secrets: {
        DATABASE_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
        DATABASE_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
        DATABASE_NAME: ecs.Secret.fromSecretsManager(dbSecret, 'database'),
        DATABASE_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        GITHUB_TOKEN: ecs.Secret.fromSecretsManager(githubSecret, 'token'),
        GITHUB_OWNER: ecs.Secret.fromSecretsManager(githubSecret, 'owner'),
        GITHUB_REPO: ecs.Secret.fromSecretsManager(githubSecret, 'repo'),
        OPENAI_API_KEY: ecs.Secret.fromSecretsManager(llmSecret, 'openai_api_key'),
      },
      essential: true,
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3000/api/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    controlCenterContainer.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
      name: 'control-center-http',
    });

    // MCP GitHub Server container
    const mcpGithubContainer = taskDefinition.addContainer('mcp-github', {
      image: ecs.ContainerImage.fromEcrRepository(this.mcpGithubRepo, 'latest'),
      containerName: 'mcp-github',
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'mcp-github',
        logGroup: mcpGithubLogGroup,
      }),
      environment: {
        NODE_ENV: 'production',
        PORT: '3001',
      },
      secrets: {
        GITHUB_TOKEN: ecs.Secret.fromSecretsManager(githubSecret, 'token'),
      },
      essential: true,
    });

    mcpGithubContainer.addPortMappings({
      containerPort: 3001,
      protocol: ecs.Protocol.TCP,
      name: 'mcp-github-http',
    });

    // MCP Deploy Server container
    const mcpDeployContainer = taskDefinition.addContainer('mcp-deploy', {
      image: ecs.ContainerImage.fromEcrRepository(this.mcpDeployRepo, 'latest'),
      containerName: 'mcp-deploy',
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'mcp-deploy',
        logGroup: mcpDeployLogGroup,
      }),
      environment: {
        NODE_ENV: 'production',
        PORT: '3002',
        AWS_REGION: cdk.Stack.of(this).region,
      },
      essential: true,
    });

    mcpDeployContainer.addPortMappings({
      containerPort: 3002,
      protocol: ecs.Protocol.TCP,
      name: 'mcp-deploy-http',
    });

    // MCP Observability Server container
    const mcpObservabilityContainer = taskDefinition.addContainer('mcp-observability', {
      image: ecs.ContainerImage.fromEcrRepository(this.mcpObservabilityRepo, 'latest'),
      containerName: 'mcp-observability',
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'mcp-observability',
        logGroup: mcpObservabilityLogGroup,
      }),
      environment: {
        NODE_ENV: 'production',
        PORT: '3003',
        AWS_REGION: cdk.Stack.of(this).region,
      },
      essential: true,
    });

    mcpObservabilityContainer.addPortMappings({
      containerPort: 3003,
      protocol: ecs.Protocol.TCP,
      name: 'mcp-observability-http',
    });

    // ========================================
    // ECS Service
    // ========================================

    this.service = new ecs.FargateService(this, 'Service', {
      cluster: this.cluster,
      taskDefinition,
      serviceName: 'afu9-control-center',
      desiredCount: 1,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      securityGroups: [ecsSecurityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      assignPublicIp: false,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      enableExecuteCommand: true, // Enable ECS Exec for debugging
    });

    // Attach service to ALB target group
    this.service.attachToApplicationTargetGroup(targetGroup);

    // Enable circuit breaker for automatic rollback on deployment failures
    const cfnService = this.service.node.defaultChild as ecs.CfnService;
    cfnService.deploymentConfiguration = {
      ...cfnService.deploymentConfiguration,
      deploymentCircuitBreaker: {
        enable: true,
        rollback: true,
      },
    };

    cdk.Tags.of(this.service).add('Name', 'afu9-control-center-service');
    cdk.Tags.of(this.service).add('Environment', 'production');
    cdk.Tags.of(this.service).add('Project', 'AFU-9');

    // ========================================
    // Stack Outputs
    // ========================================

    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'ECS cluster name',
      exportName: 'Afu9ClusterName',
    });

    new cdk.CfnOutput(this, 'ClusterArn', {
      value: this.cluster.clusterArn,
      description: 'ECS cluster ARN',
      exportName: 'Afu9ClusterArn',
    });

    new cdk.CfnOutput(this, 'ServiceName', {
      value: this.service.serviceName,
      description: 'ECS service name',
      exportName: 'Afu9ServiceName',
    });

    new cdk.CfnOutput(this, 'ServiceArn', {
      value: this.service.serviceArn,
      description: 'ECS service ARN',
      exportName: 'Afu9ServiceArn',
    });

    new cdk.CfnOutput(this, 'TaskDefinitionArn', {
      value: taskDefinition.taskDefinitionArn,
      description: 'ECS task definition ARN',
      exportName: 'Afu9TaskDefinitionArn',
    });

    new cdk.CfnOutput(this, 'EcrControlCenterRepo', {
      value: this.controlCenterRepo.repositoryUri,
      description: 'ECR repository URI for Control Center',
      exportName: 'Afu9EcrControlCenterRepo',
    });

    new cdk.CfnOutput(this, 'EcrMcpGithubRepo', {
      value: this.mcpGithubRepo.repositoryUri,
      description: 'ECR repository URI for MCP GitHub Server',
      exportName: 'Afu9EcrMcpGithubRepo',
    });

    new cdk.CfnOutput(this, 'EcrMcpDeployRepo', {
      value: this.mcpDeployRepo.repositoryUri,
      description: 'ECR repository URI for MCP Deploy Server',
      exportName: 'Afu9EcrMcpDeployRepo',
    });

    new cdk.CfnOutput(this, 'EcrMcpObservabilityRepo', {
      value: this.mcpObservabilityRepo.repositoryUri,
      description: 'ECR repository URI for MCP Observability Server',
      exportName: 'Afu9EcrMcpObservabilityRepo',
    });

    new cdk.CfnOutput(this, 'TaskRoleArn', {
      value: taskRole.roleArn,
      description: 'IAM task role ARN',
      exportName: 'Afu9TaskRoleArn',
    });

    new cdk.CfnOutput(this, 'TaskExecutionRoleArn', {
      value: taskExecutionRole.roleArn,
      description: 'IAM task execution role ARN',
      exportName: 'Afu9TaskExecutionRoleArn',
    });
  }
}
