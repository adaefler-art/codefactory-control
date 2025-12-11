#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CodefactoryControlStack } from '../lib/codefactory-control-stack';
// import { Afu9InfrastructureStack } from '../lib/afu9-infrastructure-stack';

const app = new cdk.App();

// v0.1 Lambda-based stack (existing)
new CodefactoryControlStack(app, 'CodefactoryControlStack', {
  /* You can specify env here if you want:
  env: { account: '123456789012', region: 'eu-central-1' }
  */
});

// v0.2 ECS-based infrastructure stack (new) - WIP
// TODO: Fix TypeScript compilation issues with CDK imports
// new Afu9InfrastructureStack(app, 'Afu9InfrastructureStack', {
//   env: {
//     region: 'eu-central-1',
//   },
//   description: 'AFU-9 v0.2 Control Center on ECS Fargate with RDS Postgres and ALB',
// });
