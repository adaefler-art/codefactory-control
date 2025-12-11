#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CodefactoryControlStack } from '../lib/codefactory-control-stack';
import { Afu9NetworkStack } from '../lib/afu9-network-stack';

const app = new cdk.App();

// v0.1 Lambda-based stack (existing)
new CodefactoryControlStack(app, 'CodefactoryControlStack', {
  /* You can specify env here if you want:
  env: { account: '123456789012', region: 'eu-central-1' }
  */
});

// v0.2 Network infrastructure stack
new Afu9NetworkStack(app, 'Afu9NetworkStack', {
  env: {
    region: 'eu-central-1',
  },
  description: 'AFU-9 v0.2 Network Foundation: VPC, Subnets, Security Groups, and ALB',
});
