import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * AFU-9 IAM Roles Stack
 * 
 * Defines IAM roles for deployment automation and CI/CD:
 * - GitHub Actions deployment role for ECS deployments
 * - Follows least privilege principles with resource-scoped permissions
 * 
 * This stack is independent and can be deployed separately from the main infrastructure.
 */
export interface Afu9IamStackProps extends cdk.StackProps {
  /**
   * GitHub repository owner (organization or user)
   * Used to restrict which GitHub repos can assume the deployment role
   */
  readonly githubOrg: string;

  /**
   * GitHub repository name
   * Used to restrict which GitHub repos can assume the deployment role
   */
  readonly githubRepo: string;
}

export class Afu9IamStack extends cdk.Stack {
  public readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: Afu9IamStackProps) {
    super(scope, id, props);

    const { githubOrg, githubRepo } = props;

    // ========================================
    // GitHub Actions OIDC Provider
    // ========================================
    // Note: GitHub OIDC provider should be created once per AWS account
    // If it already exists, this will fail. To use an existing provider, replace this with:
    // const githubProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
    //   this, 'GithubOidcProvider',
    //   'arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com'
    // );

    const githubProvider = new iam.OpenIdConnectProvider(this, 'GithubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
      thumbprints: [
        // GitHub's OIDC thumbprint (valid as of 2024)
        // Reference: https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services
        // If authentication fails, verify thumbprint at: https://github.blog/changelog/2023-06-27-github-actions-update-on-oidc-integration-with-aws/
        '6938fd4d98bab03faadb97b34396831e3780aea1',
        // Backup thumbprint
        '1c58a3a8518e8759bf075b76b750d4f2df264fcd',
      ],
    });

    // ========================================
    // GitHub Actions Deployment Role
    // ========================================
    
    // This role allows GitHub Actions workflows to deploy to ECS
    // It follows the principle of least privilege by:
    // 1. Only allowing specific GitHub repos to assume the role (via OIDC)
    // 2. Scoping permissions to specific resources where possible
    // 3. Granting only the permissions needed for deployment operations

    this.deployRole = new iam.Role(this, 'GithubActionsDeployRole', {
      roleName: 'afu9-github-actions-deploy-role',
      description: 'Role for GitHub Actions to deploy AFU-9 services to ECS',
      assumedBy: new iam.FederatedPrincipal(
        githubProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': `repo:${githubOrg}/${githubRepo}:*`,
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // ========================================
    // ECR Permissions
    // ========================================
    // Allow pushing Docker images to ECR repositories
    // Justification: GitHub Actions needs to build and push container images
    
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECRAuthenticationAndImagePush',
        effect: iam.Effect.ALLOW,
        actions: [
          // Authentication
          'ecr:GetAuthorizationToken',
        ],
        // GetAuthorizationToken doesn't support resource-level permissions per AWS documentation:
        // https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonelasticcontainerregistry.html
        resources: ['*'],
      })
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECRRepositoryAccess',
        effect: iam.Effect.ALLOW,
        actions: [
          // Repository operations
          'ecr:DescribeRepositories',
          'ecr:ListImages',
          'ecr:DescribeImages',
          // Image operations
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
          'ecr:PutImage',
        ],
        resources: [
          // Scope to AFU-9 ECR repositories only
          `arn:aws:ecr:${this.region}:${this.account}:repository/afu9/*`,
        ],
      })
    );

    // ========================================
    // ECS Permissions
    // ========================================
    // Allow updating ECS services to trigger deployments
    // Justification: GitHub Actions needs to force new deployments after pushing images
    
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECSServiceUpdate',
        effect: iam.Effect.ALLOW,
        actions: [
          'ecs:DescribeClusters',
          'ecs:DescribeServices',
          'ecs:DescribeTasks',
          'ecs:ListTasks',
          'ecs:UpdateService',
        ],
        resources: [
          // Scope to AFU-9 ECS cluster and services only
          `arn:aws:ecs:${this.region}:${this.account}:cluster/afu9-cluster`,
          `arn:aws:ecs:${this.region}:${this.account}:service/afu9-cluster/*`,
          `arn:aws:ecs:${this.region}:${this.account}:task/afu9-cluster/*`,
          // Staging cluster resources
          `arn:aws:ecs:${this.region}:${this.account}:cluster/afu9-cluster-staging`,
          `arn:aws:ecs:${this.region}:${this.account}:service/afu9-cluster-staging/*`,
          `arn:aws:ecs:${this.region}:${this.account}:task/afu9-cluster-staging/*`,
        ],
      })
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECSTaskDefinitionManagement',
        effect: iam.Effect.ALLOW,
        actions: [
          'ecs:DescribeTaskDefinition',
          'ecs:RegisterTaskDefinition',
        ],
        // Task definition APIs require wildcard resources to cover revisions created at runtime
        resources: ['*'],
      })
    );

    // Allow running one-off tasks (used by the deploy workflow for DB migrations)
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECSTaskRun',
        effect: iam.Effect.ALLOW,
        actions: ['ecs:RunTask'],
        resources: [
          // Clusters
          `arn:aws:ecs:${this.region}:${this.account}:cluster/afu9-cluster`,
          `arn:aws:ecs:${this.region}:${this.account}:cluster/afu9-cluster-staging`,
          // Task definition families (all revisions)
          `arn:aws:ecs:${this.region}:${this.account}:task-definition/afu9-control-center:*`,
          `arn:aws:ecs:${this.region}:${this.account}:task-definition/afu9-control-center-staging:*`,
        ],
      })
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ECSListGlobal',
        effect: iam.Effect.ALLOW,
        actions: [
          'ecs:ListTasks',
          'ecs:ListServices',
          'ecs:ListClusters',
        ],
        // List* calls require wildcard scope
        resources: ['*'],
      })
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ELBv2DescribeGlobal',
        effect: iam.Effect.ALLOW,
        actions: [
          'elasticloadbalancing:DescribeLoadBalancers',
          'elasticloadbalancing:DescribeTargetGroups',
          'elasticloadbalancing:DescribeListeners',
          'elasticloadbalancing:DescribeRules',
        ],
        resources: ['*'],
      })
    );

    // ========================================
    // Secrets Manager Permissions
    // ========================================
    // Allow the workflow to resolve the canonical ARN for the DB secret.
    // Justification: deploy pipeline sanitizes ECS task definitions to reference the current
    // active secret ARN (rotation-safe) before registering and running migration tasks.
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SecretsManagerDescribeAfu9Database',
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:DescribeSecret'],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:afu9/database*`],
      })
    );

    // Allow CI/CD to validate required keys in AFU-9 secrets.
    // Justification: repo build/deploy scripts run secret validation (reads secret JSON).
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SecretsManagerGetAfu9SecretsForValidation',
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:afu9/database*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:afu9/github*`,
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:afu9/llm*`,
        ],
      })
    );

    // ========================================
    // CDK Bootstrap Permissions
    // ========================================
    // CDK verifies the bootstrap stack version via SSM parameter:
    //   /cdk-bootstrap/hnb659fds/version
    // Without this, `cdk diff/deploy` fails with AccessDenied.
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkBootstrapVersionRead',
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/hnb659fds/version`,
        ],
      })
    );

    // ========================================
    // CDK Asset Publishing Permissions
    // ========================================
    // CDK bootstrapping creates dedicated roles and buckets/repos for publishing assets.
    // Grant the deploy role permission to assume those bootstrap roles (preferred) and
    // a scoped fallback to publish directly to the bootstrap bucket/repo.

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkBootstrapAssumeRoles',
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: [
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-file-publishing-role-${this.account}-${this.region}`,
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-image-publishing-role-${this.account}-${this.region}`,
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-deploy-role-${this.account}-${this.region}`,
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-cfn-exec-role-${this.account}-${this.region}`,
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-lookup-role-${this.account}-${this.region}`,
        ],
      })
    );

    // Fallback: file assets published to the bootstrap S3 bucket
    const cdkAssetsBucketName = `cdk-hnb659fds-assets-${this.account}-${this.region}`;
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkBootstrapAssetsBucketWrite',
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetBucketLocation',
          's3:ListBucket',
          's3:ListBucketMultipartUploads',
          's3:GetObject',
          's3:PutObject',
          's3:AbortMultipartUpload',
          's3:ListMultipartUploadParts',
        ],
        resources: [
          `arn:aws:s3:::${cdkAssetsBucketName}`,
          `arn:aws:s3:::${cdkAssetsBucketName}/*`,
        ],
      })
    );

    // Fallback: container assets published to the bootstrap ECR repository
    const cdkAssetsRepoName = `cdk-hnb659fds-container-assets-${this.account}-${this.region}`;
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkBootstrapContainerAssetsRepoWrite',
        effect: iam.Effect.ALLOW,
        actions: [
          'ecr:DescribeRepositories',
          'ecr:CreateRepository',
          'ecr:DescribeImages',
          'ecr:ListImages',
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
          'ecr:PutImage',
        ],
        resources: [`arn:aws:ecr:${this.region}:${this.account}:repository/${cdkAssetsRepoName}`],
      })
    );

    // Allow preflight checks to read Route53 hosted zones/records (no write access)
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'Route53ReadOnlyForPreflight',
        effect: iam.Effect.ALLOW,
        actions: [
          'route53:ListHostedZonesByName',
          'route53:ListHostedZones',
          'route53:ListResourceRecordSets',
        ],
        resources: ['*'],
      })
    );

    // ========================================
    // IAM Pass Role Permission
    // ========================================
    // Allow passing ECS task and execution roles to ECS
    // Justification: Required for ECS to assume roles when running tasks
    
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'IAMPassRole',
        effect: iam.Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [
          // Scope to AFU-9 ECS task roles only
          `arn:aws:iam::${this.account}:role/afu9-ecs-task-role`,
          `arn:aws:iam::${this.account}:role/afu9-ecs-task-execution-role`,
        ],
        conditions: {
          StringEquals: {
            'iam:PassedToService': 'ecs-tasks.amazonaws.com',
          },
        },
      })
    );

    // ========================================
    // Stack Outputs
    // ========================================

    new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: this.deployRole.roleArn,
      description: 'ARN of the GitHub Actions deployment role',
      exportName: 'Afu9GithubActionsDeployRoleArn',
    });

    new cdk.CfnOutput(this, 'DeployRoleName', {
      value: this.deployRole.roleName,
      description: 'Name of the GitHub Actions deployment role',
      exportName: 'Afu9GithubActionsDeployRoleName',
    });

    // Output instructions for configuring GitHub Actions
    new cdk.CfnOutput(this, 'GitHubSecretsInstructions', {
      value: `Add this to your GitHub repository secrets as 'AWS_DEPLOY_ROLE_ARN': ${this.deployRole.roleArn}`,
      description: 'Instructions for GitHub Actions configuration',
    });
  }
}
