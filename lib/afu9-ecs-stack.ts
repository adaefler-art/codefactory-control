import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { validateSecretKeys } from './utils/secret-validator';

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
   * Optional domain name for external routing (no hosted zone management in this stack)
   */
  domainName?: string;

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
    * @default false (can be overridden via CDK context -c afu9-enable-database=true)
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

interface ResolvedEcsConfig {
  environment: string;
  domainName?: string;
  enableDatabase: boolean;
  dbSecretArn?: string;
  dbSecretName: string;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return undefined;
}

// Default database secret name when not explicitly provided
const DEFAULT_DB_SECRET_NAME = 'afu9/database/master';

function resolveEcsConfig(scope: Construct, props: Afu9EcsStackProps): ResolvedEcsConfig {
  const ctxDomain = scope.node.tryGetContext('domainName');
  const ctxEnvironment = scope.node.tryGetContext('environment') ?? scope.node.tryGetContext('stage');
  
  // Prioritize correct key 'afu9-enable-database', fall back to legacy 'enableDatabase'
  const ctxEnableDbCorrect = scope.node.tryGetContext('afu9-enable-database');
  const ctxEnableDbLegacy = scope.node.tryGetContext('enableDatabase');
  
  const ctxDbSecretArn = scope.node.tryGetContext('dbSecretArn');
  const ctxDbSecretName = scope.node.tryGetContext('dbSecretName');

  const environment = props.environment ?? ctxEnvironment ?? 'stage';
  const domainName = props.domainName ?? ctxDomain;

  // Deprecation warning for legacy key
  if (ctxEnableDbLegacy !== undefined) {
    if (ctxEnableDbCorrect === undefined) {
      // Only legacy key provided
      cdk.Annotations.of(scope).addWarning(
        'DEPRECATION: Context key "enableDatabase" is deprecated. ' +
        'Please use "afu9-enable-database" instead. ' +
        'Example: cdk deploy -c afu9-enable-database=false'
      );
    } else {
      // Both keys provided - warn about potential confusion
      cdk.Annotations.of(scope).addWarning(
        'Both "enableDatabase" (deprecated) and "afu9-enable-database" context keys are provided. ' +
        'Using "afu9-enable-database" value. Please remove the deprecated "enableDatabase" key.'
      );
    }
  }

  // Resolution priority: props > correct context key > legacy context key > default (false)
  const enableDatabase =
    toOptionalBoolean(props.enableDatabase) ??
    toOptionalBoolean(ctxEnableDbCorrect) ??
    toOptionalBoolean(ctxEnableDbLegacy) ??
    false;

  const dbSecretArn = props.dbSecretArn ?? ctxDbSecretArn;
  const dbSecretName = ctxDbSecretName;

  // Fail-fast validation: If database is enabled, we need either ARN or name (before applying defaults)
  // This prevents deployments with invalid configuration before they reach ECS
  if (enableDatabase && !dbSecretArn && !dbSecretName) {
    throw new Error(
      'DATABASE_ENABLED=true requires dbSecretArn or dbSecretName in CDK context. ' +
      `Provide via: -c dbSecretArn=arn:aws:secretsmanager:... ` +
      `or -c dbSecretName=${DEFAULT_DB_SECRET_NAME} ` +
      `or disable database with -c afu9-enable-database=false`
    );
  }

  // Apply default for dbSecretName after validation
  const resolvedDbSecretName = dbSecretName ?? DEFAULT_DB_SECRET_NAME;

  return {
    environment,
    domainName,
    enableDatabase,
    dbSecretArn,
    dbSecretName: resolvedDbSecretName,
  };
}

export class Afu9EcsStack extends cdk.Stack {
  public readonly cluster: ecs.ICluster;
  public readonly service: ecs.FargateService;
  public readonly controlCenterRepo: ecr.IRepository;
  public readonly mcpGithubRepo: ecr.IRepository;
  public readonly mcpDeployRepo: ecr.IRepository;
  public readonly mcpObservabilityRepo: ecr.IRepository;
  public readonly domainName?: string;

  constructor(scope: Construct, id: string, props: Afu9EcsStackProps) {
    super(scope, id, props);

    // ========================================
    // Configuration Resolution and Validation
    // ========================================
    
    const {
      vpc,
      ecsSecurityGroup,
      targetGroup,
      imageTag = 'staging-latest',
      desiredCount,
      cpu = 1024,
      memoryLimitMiB = 2048,
    } = props;

    const { environment, domainName, enableDatabase, dbSecretArn, dbSecretName } = resolveEcsConfig(this, props);
    this.domainName = domainName;

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

    // Import database secret (connection details for application) when enabled
    // Prefer ARN when provided; otherwise fall back to name (supports rotated suffix secrets)
    const dbSecret = enableDatabase
      ? dbSecretArn
        ? secretsmanager.Secret.fromSecretCompleteArn(this, 'DatabaseSecret', dbSecretArn)
        : secretsmanager.Secret.fromSecretNameV2(this, 'DatabaseSecret', dbSecretName)
      : undefined;

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
    // Secret Key Validation (Guardrail I-ECS-DB-02)
    // ========================================

    // Validate that all required secret keys exist
    // This prevents deployment failures due to missing or misconfigured secrets
    if (dbSecret) {
      validateSecretKeys(
        this,
        dbSecret,
        ['host', 'port', 'database', 'username', 'password'],
        'Database connection credentials'
      );
    }

    validateSecretKeys(
      this,
      githubSecret,
      ['token', 'owner', 'repo'],
      'GitHub API credentials'
    );

    // LLM keys are all optional, so we just validate the secret exists
    // but don't require specific keys
    validateSecretKeys(
      this,
      llmSecret,
      [], // No required keys for LLM secret
      'LLM API keys (all optional)'
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

    const taskExecutionRoleName = environment === ENVIRONMENT.PROD
      ? 'afu9-ecs-task-execution-role-prod'
      : 'afu9-ecs-task-execution-role';

    // Task execution role (used by ECS to pull images and write logs)
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      roleName: taskExecutionRoleName,
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
    if (dbSecret) {
      dbSecret.grantRead(taskExecutionRole);

      // Belt-and-suspenders policy to cover rotated/aliased secret ARNs (name suffixed by AWS)
      // Resource is scoped to afu9/database/* to allow for AWS secret rotation (suffix added by AWS)
      const secretResourceArn = dbSecretArn ?? `arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:secret:${dbSecretName}*`;
      taskExecutionRole.addToPolicy(
        new iam.PolicyStatement({
          sid: 'DbSecretRead',
          effect: iam.Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
          resources: [secretResourceArn],
        })
      );
    }
    githubSecret.grantRead(taskExecutionRole);
    llmSecret.grantRead(taskExecutionRole);

    const taskRoleName = environment === ENVIRONMENT.PROD
      ? 'afu9-ecs-task-role-prod'
      : 'afu9-ecs-task-role';

    // Task role (used by application code for AWS API calls)
    const taskRole = new iam.Role(this, 'TaskRole', {
      roleName: taskRoleName,
      description: 'IAM role for AFU-9 ECS tasks to access AWS services',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Grant task role access to secrets (database omitted; injected by execution role only)
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
        DATABASE_SSL: 'true',
        MCP_GITHUB_ENDPOINT: 'http://localhost:3001',
        MCP_DEPLOY_ENDPOINT: 'http://localhost:3002',
        MCP_OBSERVABILITY_ENDPOINT: 'http://localhost:3003',
        MCP_GITHUB_URL: 'http://127.0.0.1:3001',
        MCP_DEPLOY_URL: 'http://127.0.0.1:3002',
        MCP_OBSERVABILITY_URL: 'http://127.0.0.1:3003',
      },
      secrets: {
        ...(dbSecret
          ? {
              DATABASE_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
              DATABASE_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
              // Application connection secret uses 'database' as the key (defined in Afu9DatabaseStack)
              // Note: This differs from RDS-generated secrets which use 'dbname'
              DATABASE_NAME: ecs.Secret.fromSecretsManager(dbSecret, 'database'),
              DATABASE_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
              DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
            }
          : {}),
        GITHUB_TOKEN: ecs.Secret.fromSecretsManager(githubSecret, 'token'),
        GITHUB_OWNER: ecs.Secret.fromSecretsManager(githubSecret, 'owner'),
        GITHUB_REPO: ecs.Secret.fromSecretsManager(githubSecret, 'repo'),
        OPENAI_API_KEY: ecs.Secret.fromSecretsManager(llmSecret, 'openai_api_key'),
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(llmSecret, 'anthropic_api_key'),
        DEEPSEEK_API_KEY: ecs.Secret.fromSecretsManager(llmSecret, 'deepseek_api_key'),
      },
      essential: true,
      healthCheck: {
        // Avoid wget dependency in minimal images; use built-in Node HTTP probe
        command: [
          'CMD-SHELL',
          "node -e \"require('http').get('http://127.0.0.1:3000/api/health', r => { if (r.statusCode === 200) process.exit(0); process.exit(1); }).on('error', () => process.exit(1));\"",
        ],
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
        // Avoid wget dependency in minimal images; use built-in Node HTTP probe
        command: [
          'CMD-SHELL',
          "node -e \"require('http').get('http://127.0.0.1:3001/health', r => { if (r.statusCode === 200) process.exit(0); process.exit(1); }).on('error', () => process.exit(1));\"",
        ],
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
        // Avoid wget dependency in minimal images; use built-in Node HTTP probe
        command: [
          'CMD-SHELL',
          "node -e \"require('http').get('http://127.0.0.1:3002/health', r => { if (r.statusCode === 200) process.exit(0); process.exit(1); }).on('error', () => process.exit(1));\"",
        ],
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
        // Avoid wget dependency in minimal images; use built-in Node HTTP probe
        command: [
          'CMD-SHELL',
          "node -e \"require('http').get('http://127.0.0.1:3003/health', r => { if (r.statusCode === 200) process.exit(0); process.exit(1); }).on('error', () => process.exit(1));\"",
        ],
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

    const serviceName = environment === ENVIRONMENT.PROD
      ? 'afu9-control-center-prod'
      : 'afu9-control-center';

    this.service = new ecs.FargateService(this, 'Service', {
      cluster: this.cluster,
      taskDefinition,
      serviceName,
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
