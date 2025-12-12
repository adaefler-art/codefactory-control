import * as cdk from 'aws-cdk-lib';
import { aws_iam as iam } from 'aws-cdk-lib';
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
    // If it already exists, import it instead of creating a new one
    // We'll use a conditional here, but in production you may want to import existing

    const githubProvider = new iam.OpenIdConnectProvider(this, 'GithubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
      thumbprints: [
        // GitHub's OIDC thumbprint (valid as of 2024)
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
        resources: ['*'], // GetAuthorizationToken doesn't support resource-level permissions
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
          'ecs:DescribeServices',
          'ecs:DescribeTasks',
          'ecs:DescribeTaskDefinition',
          'ecs:ListTasks',
          'ecs:UpdateService',
        ],
        resources: [
          // Scope to AFU-9 ECS cluster and services only
          `arn:aws:ecs:${this.region}:${this.account}:cluster/afu9-cluster`,
          `arn:aws:ecs:${this.region}:${this.account}:service/afu9-cluster/*`,
          `arn:aws:ecs:${this.region}:${this.account}:task/afu9-cluster/*`,
          `arn:aws:ecs:${this.region}:${this.account}:task-definition/afu9-*:*`,
        ],
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
