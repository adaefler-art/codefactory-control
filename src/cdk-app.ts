#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CodeFactoryStack } from '../lib/codefactory-stack';

const app = new cdk.App();

new CodeFactoryStack(app, 'CodeFactoryControlStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'AFU-9 CodeFactory Control Plane - Autonomous Code Fabrication',
});

app.synth();
