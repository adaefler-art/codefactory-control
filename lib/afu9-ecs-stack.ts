import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
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

  /**
   * Image tag to use for deployments
   * @default 'staging-latest'
   */
  imageTag?: string;

  /**
   * Desired task count; can be overridden via CDK context desiredCount
   * @default 1 (staging-safe)
   */
  desiredCount?: number;
}

export class Afu9EcsStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;

  public readonly controlCenterRepo: ecr.IRepository;
  public readonly mcpGithubRepo: ecr.IRepository;
  public readonly mcpDeployRepo: ecr.IRepository;
  public readonly mcpObservabilityRepo: ecr.IRepository;

  constructor(scope: Construct, id: string, props: Afu9EcsStackProps) {
    super(scope, id, props);

    const { vpc, ecsSecurityGroup, targetGroup, dbSecretArn } = props;

    const contextImageTag = this.node.tryGetContext('imageTag');
    const contextDesiredCount = this.node.tryGetContext('desiredCount');

    // IMPORTANT: make imageTag available for env + image selection consistently
    const imageTag = (contextImageTag as string) ?? props.imageTag ?? 'staging-latest';

    const desiredCountRaw = contextDesiredCount ?? props.desiredCount ?? 1;
    let desiredCountNormalized = Number.parseInt(String(desiredCountRaw), 10);
    if (!Number.isFinite(desiredCountNormalized) || Number.isNaN(desiredCountNormalized)) {
      desiredCountNormalized = 1;
    }
    if (desiredCountNormalized < 0) {
      desiredCountNormalized = 0;
    }

    // ========================================
    // ECR Repositories (IMPORT, do not create)
    // ========================================

    this.controlCenterRepo = ecr.Repository.fromRepositoryName(
      this,
      'ControlCenterRepo',
      'afu9/control-center'
    );

    this.mcpGithubRepo = ecr.Repository.fromRepositoryName(
      this,
      'McpGithubRepo',
      'afu9/mcp-github'
    );

    this.mcpDeployRepo = ecr.Repository.fromRepositoryName(
      this,
      'McpDeployRepo',
      'afu9/mcp-deploy'
    );

    this.mcpObservabilityRepo = ecr.Repository.fromRepositoryName(
      this,
      'McpObservabilityRepo',
      'afu9/mcp-observability'
    );

    // ========================================
    // Secrets Manager (IMPORT, do not create)
    // ========================================

    const dbSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'DatabaseSecret', dbSecretArn);

    const githubSecret = secretsmanager.Secret.fromSecretNameV2(this, 'GithubSecret', 'afu9/github');

    const llmSecret = secretsmanager.Secret.fromSecretNameV2(this, 'LlmSecret', 'afu9/llm');

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

    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      roleName: 'afu9-ecs-task-execution-role',
      description: 'IAM role for ECS to pull container images and manage logs',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    dbSecret.grantRead(taskExecutionRole);
    githubSecret.grantRead(taskExecutionRole);
    llmSecret.grantRead(taskExecutionRole);

    const taskRole = new iam.Role(this, 'TaskRole', {
      roleName: 'afu9-ecs-task-role',
      description: 'IAM role for AFU-9 ECS tasks to access AWS services',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    dbSecret.grantRead(taskRole);
    githubSecret.grantRead(taskRole);
    llmSecret.grantRead(taskRole);

    const region = cdk.Stack.of(this).region;
    const account = cdk.Stack.of(this).account;

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchLogsAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'logs:FilterLogEvents',
          'logs:DescribeLogStreams',
          'logs:DescribeLogGroups',
        ],
        resources: [
          `arn:aws:logs:${region}:${account}:log-group:/ecs/afu9/*`,
          `arn:aws:logs:${region}:${account}:log-group:/ecs/afu9/*:log-stream:*`,
        ],
      })
    );

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchMetricsAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudwatch:GetMetricStatistics',
          'cloudwatch:GetMetricData',
          'cloudwatch:ListMetrics',
          'cloudwatch:DescribeAlarms',
          'cloudwatch:PutMetricData',
        ],
        resources: ['*'],
      })
    );

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECSServiceManagement',
        effect: iam.Effect.ALLOW,
        actions: [
          'ecs:DescribeServices',
          'ecs:DescribeTasks',
          'ecs:ListTasks',
          'ecs:DescribeTaskDefinition',
          'ecs:ListTaskDefinitions',
        ],
        resources: [
          `arn:aws:ecs:${region}:${account}:cluster/afu9-cluster`,
          `arn:aws:ecs:${region}:${account}:service/afu9-cluster/*`,
          `arn:aws:ecs:${region}:${account}:task/afu9-cluster/*`,
          `arn:aws:ecs:${region}:${account}:task-definition/afu9-*:*`,
        ],
      })
    );

    taskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECSServiceUpdate',
        effect: iam.Effect.ALLOW,
        actions: ['ecs:UpdateService'],
        resources: [`arn:aws:ecs:${region}:${account}:service/afu9-cluster/*`],
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
      cpu: 1024,
      memoryLimitMiB: 2048,
      executionRole: taskExecutionRole,
      taskRole: taskRole,
    });

    const controlCenterContainer = taskDefinition.addContainer('control-center', {
      image: ecs.ContainerImage.fromEcrRepository(this.controlCenterRepo, imageTag),
      containerName: 'control-center',
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'control-center',
        logGroup: controlCenterLogGroup,
      }),
      environment: {
        NODE_ENV: 'production',
        PORT: '3000',
        // NEW: surface version/tag directly to the app (for /api/health + /api/ready)
        APP_VERSION: imageTag,
        IMAGE_TAG: imageTag,

        MCP_GITHUB_ENDPOINT: 'http://localhost:3001',
        MCP_DEPLOY_ENDPOINT: 'http://localhost:3002',
        MCP_OBSERVABILITY_ENDPOINT: 'http://localhost:3003',
      },
      secrets: {
        DATABASE_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
        DATABASE_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
        DATABASE_NAME: ecs.Secret.fromSecretsManager(dbSecret, 'dbname'),
        DATABASE_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        GITHUB_TOKEN: ecs.Secret.fromSecretsManager(githubSecret, 'token'),
        GITHUB_OWNER: ecs.Secret.fromSecretsManager(githubSecret, 'owner'),
        GITHUB_REPO: ecs.Secret.fromSecretsManager(githubSecret, 'repo'),
        OPENAI_API_KEY: ecs.Secret.fromSecretsManager(llmSecret, 'openai_api_key'),
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(llmSecret, 'anthropic_api_key'),
        DEEPSEEK_API_KEY: ecs.Secret.fromSecretsManager(llmSecret, 'deepseek_api_key'),
      },
      essential: true,
    });

    controlCenterContainer.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
      name: 'control-center-http',
    });

    const mcpGithubContainer = taskDefinition.addContainer('mcp-github', {
      image: ecs.ContainerImage.fromEcrRepository(this.mcpGithubRepo, imageTag),
      containerName: 'mcp-github',
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'mcp-github',
        logGroup: mcpGithubLogGroup,
      }),
      environment: {
        NODE_ENV: 'production',
        PORT: '3001',
        // optional but useful for debugging
        APP_VERSION: imageTag,
        IMAGE_TAG: imageTag,
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

    const mcpDeployContainer = taskDefinition.addContainer('mcp-deploy', {
      image: ecs.ContainerImage.fromEcrRepository(this.mcpDeployRepo, imageTag),
      containerName: 'mcp-deploy',
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'mcp-deploy',
        logGroup: mcpDeployLogGroup,
      }),
      environment: {
        NODE_ENV: 'production',
        PORT: '3002',
        AWS_REGION: cdk.Stack.of(this).region,
        // optional
        APP_VERSION: imageTag,
        IMAGE_TAG: imageTag,
      },
      essential: true,
    });

    mcpDeployContainer.addPortMappings({
      containerPort: 3002,
      protocol: ecs.Protocol.TCP,
      name: 'mcp-deploy-http',
    });

    const mcpObservabilityContainer = taskDefinition.addContainer('mcp-observability', {
      image: ecs.ContainerImage.fromEcrRepository(this.mcpObservabilityRepo, imageTag),
      containerName: 'mcp-observability',
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'mcp-observability',
        logGroup: mcpObservabilityLogGroup,
      }),
      environment: {
        NODE_ENV: 'production',
        PORT: '3003',
        AWS_REGION: cdk.Stack.of(this).region,
        // optional
        APP_VERSION: imageTag,
        IMAGE_TAG: imageTag,
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
      desiredCount: desiredCountNormalized,
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
      securityGroups: [ecsSecurityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      assignPublicIp: false,
      healthCheckGracePeriod: cdk.Duration.seconds(180),
      enableExecuteCommand: true,
    });

    this.service.attachToApplicationTargetGroup(targetGroup);

    targetGroup.addTarget(
      this.service.loadBalancerTarget({
        containerName: controlCenterContainer.containerName,
        containerPort: 3000,
      })
    );

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
    // Outputs
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
