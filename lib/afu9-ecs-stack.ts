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
 * Supported deployment environments
 */
export const ENVIRONMENT = {
  STAGE: 'stage',
  PROD: 'prod',
  LEGACY: 'legacy', // For backward compatibility with single-environment deployments
} as const;

export type Environment = typeof ENVIRONMENT[keyof typeof ENVIRONMENT];

/**
 * Configuration for AFU-9 ECS deployment
 * Resolved from CDK context and props with strict validation
 */
export interface Afu9EcsConfig {
  /**
   * Environment name (stage, prod, legacy)
   */
  environment: Environment;
  
  /**
   * Enable database integration
   * When false: no DB secrets, no IAM grants, app reports database:not_configured
   * When true: DB secret ARN required, IAM grants added, app connects to DB
   * @default true
   */
  enableDatabase: boolean;
  
  /**
   * ARN of the database connection secret
   * Required when enableDatabase=true
   */
  dbSecretArn?: string;
  
  /**
   * Image tag to use for deployments
   * @default 'staging-latest'
   */
  imageTag: string;
  
  /**
   * Desired count of tasks
   * @default 1 for stage, 2 for prod
   */
  desiredCount: number;
  
  /**
   * CPU allocation for tasks (in CPU units)
   * @default 1024 (1 vCPU)
   */
  cpu: number;
  
  /**
   * Memory allocation for tasks (in MiB)
   * @default 2048 (2 GB)
   */
  memoryLimitMiB: number;
}

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
 * - Optionally Afu9DatabaseStack: RDS database and connection secrets (if enableDatabase=true)
 * 
 * IMPORTANT: This stack does NOT depend on Afu9DnsStack. DNS is deployed separately.
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
   * Enable database integration
   * When false: no DB secrets, no IAM grants, app reports database:not_configured
   * When true: DB secret ARN required, IAM grants added, app connects to DB
   * @default true
   */
  enableDatabase?: boolean;

  /**
   * ARN of the database connection secret
   * Required when enableDatabase=true, ignored when enableDatabase=false
   */
  dbSecretArn?: string;

  /**
   * Image tag to use for deployments
   * @default 'staging-latest'
   */
  imageTag?: string;

  /**
   * Environment name (stage or prod)
   * Used for service naming and resource tagging
   * @default 'stage'
   */
  environment?: string;

  /**
   * Desired count of tasks for this environment
   * @default 1 for stage, 2 for prod
   */
  desiredCount?: number;

  /**
   * CPU allocation for tasks
   * @default 1024 (1 vCPU)
   */
  cpu?: number;

  /**
   * Memory allocation for tasks
   * @default 2048 (2 GB)
   */
  memoryLimitMiB?: number;
}

export class Afu9EcsStack extends cdk.Stack {
  public readonly cluster: ecs.ICluster;
  public readonly service: ecs.FargateService;
  public readonly controlCenterRepo: ecr.IRepository;
  public readonly mcpGithubRepo: ecr.IRepository;
  public readonly mcpDeployRepo: ecr.IRepository;
  public readonly mcpObservabilityRepo: ecr.IRepository;

  constructor(scope: Construct, id: string, props: Afu9EcsStackProps) {
    super(scope, id, props);

    // ========================================
    // Configuration Resolution and Validation
    // ========================================
    
    const {
      vpc,
      ecsSecurityGroup,
      targetGroup,
      enableDatabase = true, // Default to enabled for backward compatibility
      dbSecretArn,
      imageTag = 'staging-latest',
      environment = 'stage',
      desiredCount,
      cpu = 1024,
      memoryLimitMiB = 2048,
    } = props;

    // Validate configuration
    if (enableDatabase && !dbSecretArn) {
      throw new Error(
        'Afu9EcsStack: enableDatabase=true but dbSecretArn is not provided. ' +
        'Either provide dbSecretArn or set enableDatabase=false.'
      );
    }

    if (!enableDatabase && dbSecretArn) {
      console.warn(
        'Afu9EcsStack: enableDatabase=false but dbSecretArn is provided. ' +
        'dbSecretArn will be ignored.'
      );
    }

    // Environment-specific defaults
    const envDesiredCount = desiredCount ?? (environment === 'prod' ? 2 : 1);

    // Log configuration for diagnostics
    console.log('AFU-9 ECS Stack Configuration:');
    console.log(`  Environment: ${environment}`);
    console.log(`  Database Enabled: ${enableDatabase}`);
    console.log(`  Image Tag: ${imageTag}`);
    console.log(`  Desired Count: ${envDesiredCount}`);
    console.log(`  CPU: ${cpu}, Memory: ${memoryLimitMiB}`);

    // ========================================
    // ECR Repositories (import existing)
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
    // Secrets Manager
    // ========================================

    let dbSecret: secretsmanager.ISecret | undefined;
    
    if (enableDatabase) {
      // Import database secret (connection details for application)
      // This is the comprehensive secret created by Afu9DatabaseStack
      dbSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        'DatabaseSecret',
        dbSecretArn!
      );
    }

    // Import GitHub credentials secret (shared across environments)
    const githubSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'GithubSecret',
      'afu9/github'
    );

    // Import LLM API keys secret (shared across environments)
    const llmSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'LlmSecret',
      'afu9/llm'
    );

    // ========================================
    // ECS Cluster (Shared across environments)
    // ========================================
    // Create cluster only in stage environment, import in others
    if (environment === ENVIRONMENT.STAGE) {
      this.cluster = new ecs.Cluster(this, 'Afu9Cluster', {
        clusterName: 'afu9-cluster',
        vpc,
        containerInsights: true,
      });

      cdk.Tags.of(this.cluster).add('Name', 'afu9-cluster');
      cdk.Tags.of(this.cluster).add('Project', 'AFU-9');
    } else {
      // Import existing cluster for prod and legacy environments
      this.cluster = ecs.Cluster.fromClusterAttributes(this, 'Afu9Cluster', {
        clusterName: 'afu9-cluster',
        vpc,
        securityGroups: [],
      });
    }

    // ========================================
    // IAM Roles
    // ========================================

    // Task execution role (used by ECS to pull images and write logs)
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      roleName: `afu9-ecs-task-execution-role-${environment}`,
      description: 'IAM role for ECS to pull container images and manage logs',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy'
        ),
      ],
    });

    // Grant access to secrets for injecting them as environment variables
    // Justification: ECS needs to read secrets to inject them into containers at startup
    if (enableDatabase && dbSecret) {
      dbSecret.grantRead(taskExecutionRole);
    }
    githubSecret.grantRead(taskExecutionRole);
    llmSecret.grantRead(taskExecutionRole);

    // Task role (used by application code for AWS API calls)
    const taskRole = new iam.Role(this, 'TaskRole', {
      roleName: `afu9-ecs-task-role-${environment}`,
      description: 'IAM role for AFU-9 ECS tasks to access AWS services',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Grant task role access to secrets (conditionally for database)
    // Justification: Application needs to read GitHub tokens and LLM API keys
    // Database secret only granted if database is enabled
    if (enableDatabase && dbSecret) {
      dbSecret.grantRead(taskRole);
    }
    githubSecret.grantRead(taskRole);
    llmSecret.grantRead(taskRole);

    // Store region and account for ARN construction (reduces repetition)
    const region = cdk.Stack.of(this).region;
    const account = cdk.Stack.of(this).account;

    // Grant CloudWatch Logs permissions
    // Justification: MCP Observability server needs to query logs for monitoring
    // Note: CloudWatch Logs doesn't support fine-grained resource-level permissions for FilterLogEvents
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
          // Scope to AFU-9 log groups only
          `arn:aws:logs:${region}:${account}:log-group:/ecs/afu9/*`,
          `arn:aws:logs:${region}:${account}:log-group:/ecs/afu9/*:log-stream:*`,
        ],
      })
    );

    // Grant CloudWatch Metrics permissions
    // Justification: MCP Observability server needs to read metrics and alarms for monitoring
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
        resources: ['*'], // CloudWatch Metrics doesn't support resource-level permissions
      })
    );

    // Grant ECS permissions for deploy MCP server
    // Justification: MCP Deploy server needs to query and update ECS services for deployments
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
          // Scope to AFU-9 ECS resources only
          `arn:aws:ecs:${region}:${account}:cluster/afu9-cluster`,
          `arn:aws:ecs:${region}:${account}:service/afu9-cluster/*`,
          `arn:aws:ecs:${region}:${account}:task/afu9-cluster/*`,
          `arn:aws:ecs:${region}:${account}:task-definition/afu9-*:*`,
        ],
      })
    );

    // UpdateService requires cluster ARN in resources
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECSServiceUpdate',
        effect: iam.Effect.ALLOW,
        actions: ['ecs:UpdateService'],
        resources: [
          `arn:aws:ecs:${region}:${account}:service/afu9-cluster/*`,
        ],
      })
    );

    // Optional: Grant RDS Data API access if using RDS Data API instead of direct connections
    // This is commented out by default but can be enabled if needed
    // Justification: Allows querying RDS via Data API for enhanced security (no direct DB connections)
    /*
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'RDSDataAPIAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          'rds-data:ExecuteStatement',
          'rds-data:BatchExecuteStatement',
          'rds-data:BeginTransaction',
          'rds-data:CommitTransaction',
          'rds-data:RollbackTransaction',
        ],
        resources: [
          `arn:aws:rds:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:cluster:afu9-*`,
        ],
      })
    );
    */

    // ========================================
    // CloudWatch Log Groups (stable names to avoid replacement)
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
    // 
    // Image Tagging Strategy:
    // - Primary tag: Git commit SHA (7 chars, e.g., 'a1b2c3d') - immutable, production deployments
    // - Secondary tag: Timestamp (e.g., '20251212-143000') - immutable, audit trail
    // - Convenience tag: 'staging-latest' - mutable, for development/staging
    // 
    // GitHub Actions deployments create new task definitions with SHA tags.
    // CDK deployments use 'staging-latest' by default (can be overridden via imageTag prop).
    // 
    // For rollback procedures, see docs/ROLLBACK.md

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      family: 'afu9-control-center',
      cpu,
      memoryLimitMiB,
      executionRole: taskExecutionRole,
      taskRole: taskRole,
    });

    // Control Center container
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
        ENVIRONMENT: environment, // Add environment variable for app-level detection
        DATABASE_ENABLED: enableDatabase ? 'true' : 'false', // Signal to app whether DB is configured
        MCP_GITHUB_ENDPOINT: 'http://localhost:3001',
        MCP_DEPLOY_ENDPOINT: 'http://localhost:3002',
        MCP_OBSERVABILITY_ENDPOINT: 'http://localhost:3003',
      },
      secrets: enableDatabase && dbSecret ? {
        DATABASE_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
        DATABASE_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
        DATABASE_NAME: ecs.Secret.fromSecretsManager(dbSecret, 'database'),
        DATABASE_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        GITHUB_TOKEN: ecs.Secret.fromSecretsManager(githubSecret, 'token'),
        GITHUB_OWNER: ecs.Secret.fromSecretsManager(githubSecret, 'owner'),
        GITHUB_REPO: ecs.Secret.fromSecretsManager(githubSecret, 'repo'),
        OPENAI_API_KEY: ecs.Secret.fromSecretsManager(llmSecret, 'openai_api_key'),
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(llmSecret, 'anthropic_api_key'),
        DEEPSEEK_API_KEY: ecs.Secret.fromSecretsManager(llmSecret, 'deepseek_api_key'),
      } : {
        // Database disabled - only provide non-DB secrets
        GITHUB_TOKEN: ecs.Secret.fromSecretsManager(githubSecret, 'token'),
        GITHUB_OWNER: ecs.Secret.fromSecretsManager(githubSecret, 'owner'),
        GITHUB_REPO: ecs.Secret.fromSecretsManager(githubSecret, 'repo'),
        OPENAI_API_KEY: ecs.Secret.fromSecretsManager(llmSecret, 'openai_api_key'),
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(llmSecret, 'anthropic_api_key'),
        DEEPSEEK_API_KEY: ecs.Secret.fromSecretsManager(llmSecret, 'deepseek_api_key'),
      },
      essential: true,
      healthCheck: {
        command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1'],
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
      image: ecs.ContainerImage.fromEcrRepository(this.mcpGithubRepo, imageTag),
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
      healthCheck: {
        command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    mcpGithubContainer.addPortMappings({
      containerPort: 3001,
      protocol: ecs.Protocol.TCP,
      name: 'mcp-github-http',
    });

    // MCP Deploy Server container
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
      },
      essential: true,
      healthCheck: {
        command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://127.0.0.1:3002/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    mcpDeployContainer.addPortMappings({
      containerPort: 3002,
      protocol: ecs.Protocol.TCP,
      name: 'mcp-deploy-http',
    });

    // MCP Observability Server container
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
      },
      essential: true,
      healthCheck: {
        command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://127.0.0.1:3003/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
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
      serviceName: `afu9-control-center-${environment}`,
      desiredCount: envDesiredCount,
      // Deployment preferences: keep at least 50% healthy during updates
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
      securityGroups: [ecsSecurityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      assignPublicIp: false,
      // Increased grace period for database initialization and health checks
      // 240s = 4 minutes to account for DB connection pooling and MCP server startup
      healthCheckGracePeriod: cdk.Duration.seconds(240),
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
