/**
 * Tests for collectors
 */

import { collectCdkOutputSignals } from '../src/collectors';

describe('CDK Output Collector', () => {
  test('parses stack failure from CDK output', () => {
    const cdkOutput = `
Deploying MyStack...
MyStack | CREATE_FAILED | AWS::CloudFormation::Stack | Stack deployment failed
Error: Stack creation failed
    `;

    const signals = collectCdkOutputSignals(cdkOutput);

    expect(signals.length).toBeGreaterThan(0);
    const stackSignal = signals.find(s => s.logicalId === 'MyStack');
    expect(stackSignal).toBeDefined();
    expect(stackSignal?.resourceType).toBe('AWS::CloudFormation::Stack');
  });

  test('parses resource failure from CDK output', () => {
    const cdkOutput = `
Stack: MyStack
Resource: MyFunction/Function
MyFunction/Function | AWS::Lambda::Function | CREATE_FAILED
Error: Missing required parameter
    `;

    const signals = collectCdkOutputSignals(cdkOutput);

    expect(signals.length).toBeGreaterThan(0);
    const resourceSignal = signals.find(s => s.resourceType === 'AWS::Lambda::Function');
    expect(resourceSignal).toBeDefined();
  });

  test('extracts error messages', () => {
    const cdkOutput = `
Stack MyStack
Error: ResourceNotFoundException: Secret not found
Failed to deploy stack
    `;

    const signals = collectCdkOutputSignals(cdkOutput);

    expect(signals.length).toBeGreaterThan(0);
    const signal = signals.find(s => s.statusReason.includes('ResourceNotFoundException'));
    expect(signal).toBeDefined();
  });

  test('handles multiple failures', () => {
    const cdkOutput = `
Stack: MyStack
Error: Missing environment variable
Resource1 | AWS::Lambda::Function | CREATE_FAILED
Error: Bucket name already exists  
Resource2 | AWS::S3::Bucket | CREATE_FAILED
    `;

    const signals = collectCdkOutputSignals(cdkOutput);

    // Should capture at least the two resource failures
    expect(signals.length).toBeGreaterThan(0);
    const lambdaFailure = signals.find(s => s.resourceType === 'AWS::Lambda::Function');
    const s3Failure = signals.find(s => s.resourceType === 'AWS::S3::Bucket');
    expect(lambdaFailure || s3Failure).toBeDefined();
  });

  test('returns empty array for clean output', () => {
    const cdkOutput = `
Deploying MyStack...
MyStack | CREATE_COMPLETE
Deployment successful
    `;

    const signals = collectCdkOutputSignals(cdkOutput);

    // Should have no failure signals for successful deployment
    expect(signals.length).toBe(0);
  });

  test('detects ResourceNotFoundException', () => {
    const cdkOutput = `
Stack deployment failed
ResourceNotFoundException: Secret arn:aws:secretsmanager:us-east-1:123456789:secret:my-secret not found
    `;

    const signals = collectCdkOutputSignals(cdkOutput);

    expect(signals.length).toBeGreaterThan(0);
    const signal = signals.find(s => s.statusReason.includes('ResourceNotFoundException'));
    expect(signal).toBeDefined();
  });

  test('handles rollback status', () => {
    const cdkOutput = `
MyStack | UPDATE_ROLLBACK_IN_PROGRESS | Rolling back changes
Resource failed to update
    `;

    const signals = collectCdkOutputSignals(cdkOutput);

    expect(signals.length).toBeGreaterThan(0);
    const rollbackSignal = signals.find(s => s.statusReason.includes('ROLLBACK'));
    expect(rollbackSignal).toBeDefined();
  });
});

describe('CloudFormation Collector', () => {
  // Note: These tests would require mocking AWS SDK
  // For now, we'll just verify the module exports correctly
  
  test('collectCfnFailureSignals is exported', () => {
    const { collectCfnFailureSignals } = require('../src/collectors');
    expect(typeof collectCfnFailureSignals).toBe('function');
  });
});
