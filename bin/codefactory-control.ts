#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import { CodefactoryControlStack } from '../lib/codefactory-control-stack';
import { Afu9DnsStack } from '../lib/afu9-dns-stack';
import { Afu9NetworkStack } from '../lib/afu9-network-stack';
import { Afu9DatabaseStack } from '../lib/afu9-database-stack';
import { Afu9EcsStack } from '../lib/afu9-ecs-stack';
import { Afu9AlarmsStack } from '../lib/afu9-alarms-stack';
import { Afu9IamStack } from '../lib/afu9-iam-stack';

const app = new cdk.App();

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

// DNS and Certificate stack (optional)
//
// ✅ New explicit DNS config (preferred):
//   npx cdk deploy Afu9DnsStack --profile codefactory -c enableDns=true -c domainName=afu-9.com
//
// 🧩 Legacy config (supported for backwards-compat):
//   -c afu9-enable-https=true -c afu9-domain=afu-9.com
//
// DNS must be a no-op unless explicitly enabled AND a non-empty domain is provided.
const enableDnsCtx = app.node.tryGetContext('enableDns');
const domainNameCtx = app.node.tryGetContext('domainName') ?? app.node.tryGetContext('afu9-domain');

const legacyEnableHttpsCtx = app.node.tryGetContext('afu9-enable-https');

const enableDns =
  enableDnsCtx === true || enableDnsCtx === 'true' || enableDnsCtx === 1 || enableDnsCtx === '1';

const legacyEnableHttps =
  legacyEnableHttpsCtx === true ||
  legacyEnableHttpsCtx === 'true' ||
  legacyEnableHttpsCtx === 1 ||
  legacyEnableHttpsCtx === '1';

const domainName = typeof domainNameCtx === 'string' ? domainNameCtx.trim() : '';
const dnsEnabled = (enableDns || legacyEnableHttps) && domainName.length > 0;

let dnsStack: Afu9DnsStack | undefined;

if (dnsEnabled) {
  dnsStack = new Afu9DnsStack(app, 'Afu9DnsStack', {
    env,
    description: 'AFU-9 v0.2 DNS and Certificate: Route53 and ACM certificate for HTTPS',
    // If Afu9DnsStack supports domainName as a prop, pass it through:
    // domainName,
  });
}

// Network infrastructure stack
const networkStack = new Afu9NetworkStack(app, 'Afu9NetworkStack', {
  env,
  description: 'AFU-9 v0.2 Network Foundation: VPC, Subnets, Security Groups, and ALB',
  ...(dnsEnabled ? { certificateArn: dnsStack!.certificate.certificateArn } : {}),
});

// If DNS stack exists, add Route53 A record to point to ALB
if (dnsEnabled) {
  networkStack.addDependency(dnsStack!);

  // Add A record to point domain to ALB
  new route53.ARecord(networkStack, 'AliasRecord', {
    zone: dnsStack!.hostedZone,
    recordName: dnsStack!.domainName,
    target: route53.RecordTarget.fromAlias(
      new route53Targets.LoadBalancerTarget(networkStack.loadBalancer),
    ),
    comment: 'A record for AFU-9 Control Center pointing to ALB',
  });
}

// Database stack (depends on network)
const databaseStack = new Afu9DatabaseStack(app, 'Afu9DatabaseStack', {
  env,
  description: 'AFU-9 v0.2 Database: RDS Postgres 15 with automated backups',
  vpc: networkStack.vpc,
  dbSecurityGroup: networkStack.dbSecurityGroup,
  multiAz: false, // Set to true for production high availability
});

// ECS stack (depends on network and database)
const ecsStack = new Afu9EcsStack(app, 'Afu9EcsStack', {
  env,
  description: 'AFU-9 v0.2 ECS: Fargate service with Control Center and MCP servers',
  vpc: networkStack.vpc,
  ecsSecurityGroup: networkStack.ecsSecurityGroup,
  targetGroup: networkStack.targetGroup,
  dbSecretArn: databaseStack.dbSecret.secretArn,
});

// CloudWatch Alarms stack (depends on ECS and database)
// Optional: Set alarm email via context: -c afu9-alarm-email=ops@example.com
// Optional: Set webhook URL via context: -c afu9-webhook-url=https://hooks.slack.com/services/...
const alarmEmail = app.node.tryGetContext('afu9-alarm-email');
const webhookUrl = app.node.tryGetContext('afu9-webhook-url');
new Afu9AlarmsStack(app, 'Afu9AlarmsStack', {
  env,
  description:
    'AFU-9 v0.2 CloudWatch Alarms: Monitoring for ECS, RDS, and ALB with email and webhook notifications',
  ecsClusterName: ecsStack.cluster.clusterName,
  ecsServiceName: ecsStack.service.serviceName,
  dbInstanceIdentifier: databaseStack.dbInstance.instanceIdentifier,
  albFullName: networkStack.loadBalancer.loadBalancerFullName,
  targetGroupFullName: networkStack.targetGroup.targetGroupFullName,
  alarmEmail,
  webhookUrl,
});

// IAM stack for deployment automation (independent)
// Provide GitHub org and repo via context:
// npx cdk deploy Afu9IamStack -c github-org=your-org -c github-repo=your-repo
const githubOrg = app.node.tryGetContext('github-org') || 'adaefler-art';
const githubRepo = app.node.tryGetContext('github-repo') || 'codefactory-control';
new Afu9IamStack(app, 'Afu9IamStack', {
  env,
  description: 'AFU-9 v0.2 IAM: Deployment roles for GitHub Actions',
  githubOrg,
  githubRepo,
});
