#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { CodefactoryControlStack } from '../lib/codefactory-control-stack';
import { Afu9DnsStack } from '../lib/afu9-dns-stack';
import { Afu9NetworkStack } from '../lib/afu9-network-stack';
import { Afu9DatabaseStack } from '../lib/afu9-database-stack';
import { Afu9EcsStack } from '../lib/afu9-ecs-stack';
import { Afu9AlarmsStack } from '../lib/afu9-alarms-stack';
import { Afu9IamStack } from '../lib/afu9-iam-stack';
import { Afu9AuthStack } from '../infra/stacks/afu9-auth-stack';
import { Afu9RoutingStack } from '../lib/afu9-routing-stack';
import { Afu9DeployMemoryStack } from '../lib/afu9-deploy-memory-stack';
import { getValidatedContext } from '../lib/utils/context-validator';

const app = new cdk.App();

/**
 * Helper function to check if multi-environment mode is enabled
 * Uses validated context to ensure canonical keys are used
 */
function isMultiEnvEnabled(app: cdk.App): boolean {
  const contextValue = getValidatedContext<boolean | string>(app, 'afu9-multi-env');
  return contextValue === true || contextValue === 'true';
}

/**
 * Helper function to check if database integration should be enabled
 * Uses validated context to ensure canonical keys are used
 * @returns true if database is enabled (default), false if explicitly disabled
 */
function isDatabaseEnabled(app: cdk.App): boolean {
  const enableDatabaseContext = getValidatedContext<boolean | string>(app, 'afu9-enable-database');
  return enableDatabaseContext === undefined ? true : enableDatabaseContext !== false && enableDatabaseContext !== 'false';
}

// v0.1 Lambda-based stack (existing)
new CodefactoryControlStack(app, 'CodefactoryControlStack', {
  /* You can specify env here if you want:
  env: { account: '123456789012', region: 'eu-central-1' }
  */
});

// v0.2 Infrastructure
const env = {
  region: 'eu-central-1',
};

// Check if multi-environment deployment is enabled
// Use context: -c afu9-multi-env=true to enable stage/prod routing
const multiEnvEnabled = isMultiEnvEnabled(app);

// DNS and Certificate stack (optional, for HTTPS)
const enableHttps = (() => {
  const value = getValidatedContext<boolean | string>(app, 'afu9-enable-https');
  return value === undefined ? true : value !== false && value !== 'false';
})();
let dnsStack: Afu9DnsStack | undefined;

if (enableHttps) {
  dnsStack = new Afu9DnsStack(app, 'Afu9DnsStack', {
    env,
    description: 'AFU-9 v0.2 DNS and Certificate: Route53 and ACM certificate for HTTPS',
  });
}

// Network infrastructure stack
const networkStack = new Afu9NetworkStack(app, 'Afu9NetworkStack', {
  env,
  description: 'AFU-9 v0.2 Network Foundation: VPC, Subnets, Security Groups, and ALB',
  certificateArn: dnsStack?.certificate.certificateArn,
});

// Check if database should be enabled globally
const globalEnableDatabase = isDatabaseEnabled(app);

// Database stack (depends on network, only created if database is enabled)
const databaseStack = globalEnableDatabase ? new Afu9DatabaseStack(app, 'Afu9DatabaseStack', {
  env,
  description: 'AFU-9 v0.2 Database: RDS Postgres 15 with automated backups',
  vpc: networkStack.vpc,
  dbSecurityGroup: networkStack.dbSecurityGroup,
  multiAz: false, // Set to true for production high availability
}) : undefined;

if (multiEnvEnabled) {
  // ========================================
  // Multi-Environment Deployment (Stage + Prod)
  // ========================================

  // Check if database should be enabled
  const enableDatabase = isDatabaseEnabled(app);

  // Create environment-specific target groups
  const stageTargetGroup = new elbv2.ApplicationTargetGroup(networkStack, 'Afu9StageTargetGroup', {
    vpc: networkStack.vpc,
    port: 3000,
    protocol: elbv2.ApplicationProtocol.HTTP,
    targetType: elbv2.TargetType.IP,
    targetGroupName: 'afu9-tg-stage',
    healthCheck: {
      path: '/api/ready',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
      protocol: elbv2.Protocol.HTTP,
    },
    deregistrationDelay: cdk.Duration.seconds(30),
  });

  const prodTargetGroup = new elbv2.ApplicationTargetGroup(networkStack, 'Afu9ProdTargetGroup', {
    vpc: networkStack.vpc,
    port: 3000,
    protocol: elbv2.ApplicationProtocol.HTTP,
    targetType: elbv2.TargetType.IP,
    targetGroupName: 'afu9-tg-prod',
    healthCheck: {
      path: '/api/ready',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
      protocol: elbv2.Protocol.HTTP,
    },
    deregistrationDelay: cdk.Duration.seconds(30),
  });

  // ECS Stack for Stage Environment
  const ecsStageStack = new Afu9EcsStack(app, 'Afu9EcsStageStack', {
    env,
    description: 'AFU-9 v0.2 ECS: Fargate service for Stage environment',
    vpc: networkStack.vpc,
    ecsSecurityGroup: networkStack.ecsSecurityGroup,
    targetGroup: stageTargetGroup,
    enableDatabase,
    dbSecretArn: enableDatabase && databaseStack ? databaseStack.dbSecret.secretArn : undefined,
    environment: 'stage',
    imageTag: 'stage-latest',
    desiredCount: 1,
    cpu: 1024,
    memoryLimitMiB: 2048,
  });

  // ECS Stack for Prod Environment
  const ecsProdStack = new Afu9EcsStack(app, 'Afu9EcsProdStack', {
    env,
    description: 'AFU-9 v0.2 ECS: Fargate service for Production environment',
    vpc: networkStack.vpc,
    ecsSecurityGroup: networkStack.ecsSecurityGroup,
    targetGroup: prodTargetGroup,
    enableDatabase,
    dbSecretArn: enableDatabase && databaseStack ? databaseStack.dbSecret.secretArn : undefined,
    environment: 'prod',
    imageTag: 'prod-latest',
    desiredCount: 2,
    cpu: 1024,
    memoryLimitMiB: 2048,
  });

  // Routing Stack (depends on DNS and both ECS stacks)
  if (dnsStack) {
    const routingStack = new Afu9RoutingStack(app, 'Afu9RoutingStack', {
      env,
      description: 'AFU-9 v0.2 Routing: Host-based routing for stage/prod environments',
      loadBalancer: networkStack.loadBalancer,
      httpsListener: networkStack.httpsListener,
      httpListener: networkStack.httpListener,
      stageTargetGroup,
      prodTargetGroup,
      hostedZone: dnsStack.hostedZone,
      baseDomainName: dnsStack.domainName,
    });
    routingStack.addDependency(ecsStageStack);
    routingStack.addDependency(ecsProdStack);
    routingStack.addDependency(dnsStack);
  }

  // CloudWatch Alarms for Stage
  const alarmEmail = getValidatedContext<string>(app, 'afu9-alarm-email');
  const webhookUrl = getValidatedContext<string>(app, 'afu9-webhook-url');
  new Afu9AlarmsStack(app, 'Afu9AlarmsStageStack', {
    env,
    description: 'AFU-9 v0.2 CloudWatch Alarms: Monitoring for Stage environment',
    ecsClusterName: ecsStageStack.cluster.clusterName,
    ecsServiceName: ecsStageStack.service.serviceName,
    dbInstanceIdentifier: databaseStack?.dbInstance.instanceIdentifier,
    albFullName: networkStack.loadBalancer.loadBalancerFullName,
    targetGroupFullName: stageTargetGroup.targetGroupFullName,
    alarmEmail,
    webhookUrl,
  });

  // CloudWatch Alarms for Prod
  new Afu9AlarmsStack(app, 'Afu9AlarmsProdStack', {
    env,
    description: 'AFU-9 v0.2 CloudWatch Alarms: Monitoring for Production environment',
    ecsClusterName: ecsProdStack.cluster.clusterName,
    ecsServiceName: ecsProdStack.service.serviceName,
    dbInstanceIdentifier: databaseStack?.dbInstance.instanceIdentifier,
    albFullName: networkStack.loadBalancer.loadBalancerFullName,
    targetGroupFullName: prodTargetGroup.targetGroupFullName,
    alarmEmail,
    webhookUrl,
  });

} else {
  // ========================================
  // Single Environment Deployment (Backward Compatible)
  // ========================================

  // Check if database should be enabled
  const enableDatabase = isDatabaseEnabled(app);

  // ECS stack (depends on network, optionally on database)
  const ecsStack = new Afu9EcsStack(app, 'Afu9EcsStack', {
    env,
    description: 'AFU-9 v0.2 ECS: Fargate service with Control Center and MCP servers',
    vpc: networkStack.vpc,
    ecsSecurityGroup: networkStack.ecsSecurityGroup,
    targetGroup: networkStack.targetGroup,
    enableDatabase,
    dbSecretArn: enableDatabase && databaseStack ? databaseStack.dbSecret.secretArn : undefined,
  });

  // If DNS stack exists, add Route53 A record to point to ALB
  if (dnsStack) {
    networkStack.addDependency(dnsStack);
    
    // Add A record to point domain to ALB
    new route53.ARecord(networkStack, 'AliasRecord', {
      zone: dnsStack.hostedZone,
      recordName: dnsStack.domainName,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(networkStack.loadBalancer)
      ),
      comment: 'A record for AFU-9 Control Center pointing to ALB',
    });

    // Convenience A records for www and stage hosts pointing to the same ALB
    new route53.ARecord(networkStack, 'AliasRecordWww', {
      zone: dnsStack.hostedZone,
      recordName: `www.${dnsStack.domainName}`,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(networkStack.loadBalancer)
      ),
      comment: 'A record for www.<domain> pointing to AFU-9 ALB',
    });

    new route53.ARecord(networkStack, 'AliasRecordStage', {
      zone: dnsStack.hostedZone,
      recordName: `stage.${dnsStack.domainName}`,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(networkStack.loadBalancer)
      ),
      comment: 'A record for stage.<domain> pointing to AFU-9 ALB',
    });
  }

  // CloudWatch Alarms stack (depends on ECS and database)
  const alarmEmail = getValidatedContext<string>(app, 'afu9-alarm-email');
  const webhookUrl = getValidatedContext<string>(app, 'afu9-webhook-url');
  new Afu9AlarmsStack(app, 'Afu9AlarmsStack', {
    env,
    description: 'AFU-9 v0.2 CloudWatch Alarms: Monitoring for ECS, RDS, and ALB with email and webhook notifications',
    ecsClusterName: ecsStack.cluster.clusterName,
    ecsServiceName: ecsStack.service.serviceName,
    dbInstanceIdentifier: databaseStack?.dbInstance.instanceIdentifier,
    albFullName: networkStack.loadBalancer.loadBalancerFullName,
    targetGroupFullName: networkStack.targetGroup.targetGroupFullName,
    alarmEmail,
    webhookUrl,
  });
}

// IAM stack for deployment automation (independent)
const githubOrg = getValidatedContext<string>(app, 'github-org') || 'adaefler-art';
const githubRepo = getValidatedContext<string>(app, 'github-repo') || 'codefactory-control';
new Afu9IamStack(app, 'Afu9IamStack', {
  env,
  description: 'AFU-9 v0.2 IAM: Deployment roles for GitHub Actions',
  githubOrg,
  githubRepo,
});

// Authentication stack (independent)
const cognitoDomainPrefix = getValidatedContext<string>(app, 'afu9-cognito-domain-prefix');
new Afu9AuthStack(app, 'Afu9AuthStack', {
  env,
  description: 'AFU-9 v0.2 Authentication: Cognito User Pool for Control Center',
  domainPrefix: cognitoDomainPrefix,
});

// Deploy Memory stack (independent)
new Afu9DeployMemoryStack(app, 'Afu9DeployMemoryStack', {
  env,
  description: 'AFU-9 Deploy Memory: DynamoDB table for tracking deploy failures',
});
