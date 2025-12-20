#!/usr/bin/env ts-node

/**
 * Test Suite for IAM Policy Validation
 * 
 * Tests the security validation logic to ensure it correctly
 * identifies policy violations and compliances.
 */

import * as fs from 'fs';
import * as path from 'path';

interface TestCase {
  name: string;
  policy: {
    actions: string[];
    resources: string[];
    sid: string;
  };
  expectedErrors: number;
  expectedWarnings: number;
}

// Mock validation function (simplified version for testing)
function validateTestPolicy(policy: any): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;

  const FORBIDDEN_WILDCARD_ACTIONS = [
    'iam:CreateRole',
    'iam:DeleteRole',
    'rds:DeleteDBInstance',
    'ec2:TerminateInstances',
  ];

  const ALLOWED_WILDCARDS: Record<string, string> = {
    'ecr:GetAuthorizationToken': 'AWS limitation',
    'cloudwatch:GetMetricStatistics': 'AWS limitation',
    'cloudwatch:GetMetricData': 'AWS limitation',
    'cloudwatch:ListMetrics': 'AWS limitation',
  };

  const hasWildcard = policy.resources.some((r: string) => r === '*');

  if (hasWildcard) {
    const forbiddenActions = policy.actions.filter((action: string) =>
      FORBIDDEN_WILDCARD_ACTIONS.some((forbidden) => action === forbidden)
    );

    if (forbiddenActions.length > 0) {
      errors++;
    }

    const allowedActions = policy.actions.filter((action: string) =>
      ALLOWED_WILDCARDS.hasOwnProperty(action)
    );
    
    const unallowedActions = policy.actions.filter(
      (action: string) => !ALLOWED_WILDCARDS.hasOwnProperty(action)
    );

    // Only warn if there are unallowed actions AND we didn't already error
    if (unallowedActions.length > 0 && forbiddenActions.length === 0) {
      warnings++;
    }
  }

  // Check for overly broad actions
  const broadActions = policy.actions.filter(
    (action: string) => action.endsWith(':*') || action === '*'
  );

  if (broadActions.length > 0) {
    errors++;
  }

  return { errors, warnings };
}

const testCases: TestCase[] = [
  {
    name: 'Valid policy with specific resources',
    policy: {
      sid: 'ValidPolicy',
      actions: ['s3:GetObject', 's3:PutObject'],
      resources: ['arn:aws:s3:::afu9-bucket/*'],
    },
    expectedErrors: 0,
    expectedWarnings: 0,
  },
  {
    name: 'Invalid: Wildcard with forbidden action',
    policy: {
      sid: 'DangerousPolicy',
      actions: ['iam:DeleteRole'],
      resources: ['*'],
    },
    expectedErrors: 1,
    expectedWarnings: 0,  // Error takes precedence over warning
  },
  {
    name: 'Warning: Wildcard without justification',
    policy: {
      sid: 'UnjustifiedWildcard',
      actions: ['s3:ListBuckets'],
      resources: ['*'],
    },
    expectedErrors: 0,
    expectedWarnings: 1,
  },
  {
    name: 'Valid: Wildcard with AWS limitation justification',
    policy: {
      sid: 'ECRAuth',
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],
    },
    expectedErrors: 0,
    expectedWarnings: 0,
  },
  {
    name: 'Invalid: Broad action permissions',
    policy: {
      sid: 'TooPermissive',
      actions: ['s3:*'],
      resources: ['arn:aws:s3:::bucket/*'],
    },
    expectedErrors: 1,
    expectedWarnings: 0,
  },
  {
    name: 'Valid: Scoped database secret access',
    policy: {
      sid: 'DbSecretAccess',
      actions: ['secretsmanager:GetSecretValue'],
      resources: ['arn:aws:secretsmanager:region:account:secret:afu9-database/*'],
    },
    expectedErrors: 0,
    expectedWarnings: 0,
  },
  {
    name: 'Valid: CloudWatch Metrics (AWS limitation)',
    policy: {
      sid: 'CloudWatchMetrics',
      actions: [
        'cloudwatch:GetMetricStatistics',
        'cloudwatch:GetMetricData',
        'cloudwatch:ListMetrics',
      ],
      resources: ['*'],
    },
    expectedErrors: 0,
    expectedWarnings: 0,  // All actions are in allowed list, so no warning
  },
  {
    name: 'Invalid: Multiple violations',
    policy: {
      sid: 'VeryBadPolicy',
      actions: ['*'],
      resources: ['*'],
    },
    expectedErrors: 1,  // Error for broad action
    expectedWarnings: 1, // Warning for wildcard resource with unallowed action
  },
];

function runTests(): boolean {
  console.log('='.repeat(80));
  console.log('IAM Policy Validation Test Suite');
  console.log('='.repeat(80));
  console.log('');

  let passed = 0;
  let failed = 0;

  testCases.forEach((testCase, index) => {
    const result = validateTestPolicy(testCase.policy);
    const testPassed =
      result.errors === testCase.expectedErrors &&
      result.warnings === testCase.expectedWarnings;

    if (testPassed) {
      console.log(`✅ Test ${index + 1}: ${testCase.name}`);
      passed++;
    } else {
      console.log(`❌ Test ${index + 1}: ${testCase.name}`);
      console.log(`   Expected: ${testCase.expectedErrors} errors, ${testCase.expectedWarnings} warnings`);
      console.log(`   Got:      ${result.errors} errors, ${result.warnings} warnings`);
      failed++;
    }
  });

  console.log('');
  console.log('='.repeat(80));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(80));

  return failed === 0;
}

// Integration test: Run actual validation on CDK stacks
async function integrationTest(): Promise<boolean> {
  console.log('');
  console.log('='.repeat(80));
  console.log('Integration Test: Validate Actual CDK Stacks');
  console.log('='.repeat(80));
  console.log('');

  try {
    const { validateAllStacks } = await import('./validate-iam-policies');
    const result = validateAllStacks();
    
    if (result.passed) {
      console.log('✅ Integration test passed: All CDK stacks are compliant');
      return true;
    } else {
      console.log('❌ Integration test failed: CDK stacks have violations');
      return false;
    }
  } catch (error) {
    console.error('❌ Integration test error:', error);
    return false;
  }
}

// Main execution
async function main() {
  const unitTestsPassed = runTests();
  const integrationTestPassed = await integrationTest();

  if (unitTestsPassed && integrationTestPassed) {
    console.log('');
    console.log('✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('');
    console.log('❌ Some tests failed');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { runTests, integrationTest };
