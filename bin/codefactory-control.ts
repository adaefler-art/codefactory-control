#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CodefactoryControlStack } from '../lib/codefactory-control-stack';

const app = new cdk.App();

new CodefactoryControlStack(app, 'CodefactoryControlStack', {
  /* You can specify env here if you want:
  env: { account: '123456789012', region: 'eu-central-1' }
  */
});
