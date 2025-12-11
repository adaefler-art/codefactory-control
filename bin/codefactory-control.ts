#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CodefactoryControlStack } from '../lib/codefactory-control-stack';
import { Afu9NetworkStack } from '../lib/afu9-network-stack';
import { Afu9DatabaseStack } from '../lib/afu9-database-stack';

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

// Network infrastructure stack
const networkStack = new Afu9NetworkStack(app, 'Afu9NetworkStack', {
  env,
  description: 'AFU-9 v0.2 Network Foundation: VPC, Subnets, Security Groups, and ALB',
});

// Database stack (depends on network)
new Afu9DatabaseStack(app, 'Afu9DatabaseStack', {
  env,
  description: 'AFU-9 v0.2 Database: RDS Postgres 15 with automated backups',
  vpc: networkStack.vpc,
  dbSecurityGroup: networkStack.dbSecurityGroup,
  multiAz: false, // Set to true for production high availability
});
