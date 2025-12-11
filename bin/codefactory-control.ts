#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CodefactoryControlStack } from '../lib/codefactory-control-stack';
import { Afu9DnsStack } from '../lib/afu9-dns-stack';
import { Afu9NetworkStack } from '../lib/afu9-network-stack';
import { Afu9DatabaseStack } from '../lib/afu9-database-stack';
import { Afu9EcsStack } from '../lib/afu9-ecs-stack';

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

// DNS and Certificate stack (optional, for HTTPS)
// To enable HTTPS, provide domain name via context:
// npx cdk deploy --all -c afu9-domain=afu9.yourdomain.com
const enableHttps = app.node.tryGetContext('afu9-enable-https') !== 'false'; // Default: true
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

// If DNS stack exists, add Route53 A record to point to ALB
if (dnsStack) {
  networkStack.addDependency(dnsStack);
  
  // Import Route53 module for A record
  const route53 = require('aws-cdk-lib/aws-route53');
  const route53Targets = require('aws-cdk-lib/aws-route53-targets');
  
  // Add A record to point domain to ALB
  new route53.ARecord(networkStack, 'AliasRecord', {
    zone: dnsStack.hostedZone,
    recordName: dnsStack.domainName,
    target: route53.RecordTarget.fromAlias(
      new route53Targets.LoadBalancerTarget(networkStack.loadBalancer)
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
new Afu9EcsStack(app, 'Afu9EcsStack', {
  env,
  description: 'AFU-9 v0.2 ECS: Fargate service with Control Center and MCP servers',
  vpc: networkStack.vpc,
  ecsSecurityGroup: networkStack.ecsSecurityGroup,
  targetGroup: networkStack.targetGroup,
  dbSecretArn: databaseStack.dbSecret.secretArn,
});
