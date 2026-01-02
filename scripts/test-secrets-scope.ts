#!/usr/bin/env ts-node

/**
 * Test Suite for Secrets Scope Validation - E7.0.5
 * 
 * Validates the secrets scope linter correctly identifies
 * cross-environment secret access violations.
 */

interface TestCase {
  name: string;
  environment: string;
  secretArn: string;
  expectViolation: boolean;
  expectedReason?: string;
}

/**
 * Environment-specific secret prefix rules (copied from validator)
 */
const ALLOWED_SECRET_PREFIXES: Record<string, string[]> = {
  prod: [
    'afu9/prod/',
    'afu9/database',
    'afu9/github',
    'afu9/llm',
  ],
  stage: [
    'afu9/stage/',
    'afu9/database',
    'afu9/github',
    'afu9/llm',
  ],
  legacy: [
    'afu9/',
  ],
};

const FORBIDDEN_CROSS_ENV_PATTERNS: Record<string, string[]> = {
  prod: ['afu9/stage/'],
  stage: ['afu9/prod/'],
};

/**
 * Simplified validation logic for testing
 */
function validateSecretScope(
  secretArn: string,
  environment: string
): { valid: boolean; reason?: string } {
  // Regex: Match everything after "secret:" until we hit a wildcard (*) or hyphen-suffix (-)
  const secretMatch = secretArn.match(/secret:([^*\-]+)/);
  if (!secretMatch) {
    return { valid: true };
  }

  const secretName = secretMatch[1];

  // Check forbidden patterns
  const forbiddenPatterns = FORBIDDEN_CROSS_ENV_PATTERNS[environment] || [];
  for (const pattern of forbiddenPatterns) {
    if (secretName.startsWith(pattern)) {
      return {
        valid: false,
        reason: `Cross-environment access forbidden: ${environment} environment cannot access ${pattern}* secrets`,
      };
    }
  }

  // Check allowed prefixes
  const allowedPrefixes = ALLOWED_SECRET_PREFIXES[environment] || ALLOWED_SECRET_PREFIXES.legacy;
  const isAllowed = allowedPrefixes.some(prefix => secretName.startsWith(prefix));

  if (!isAllowed) {
    return {
      valid: false,
      reason: `Secret ${secretName} does not match allowed prefixes for ${environment}: ${allowedPrefixes.join(', ')}`,
    };
  }

  return { valid: true };
}

const testCases: TestCase[] = [
  // ========================================
  // VALID CASES - Same Environment Access
  // ========================================
  {
    name: 'Valid: Prod role accessing prod secret',
    environment: 'prod',
    secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/prod/api-key-ABC123',
    expectViolation: false,
  },
  {
    name: 'Valid: Stage role accessing stage secret',
    environment: 'stage',
    secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/stage/smoke-key-XYZ789',
    expectViolation: false,
  },
  {
    name: 'Valid: Prod role accessing legacy database secret',
    environment: 'prod',
    secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/database-ABC123',
    expectViolation: false,
  },
  {
    name: 'Valid: Stage role accessing legacy database secret',
    environment: 'stage',
    secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/database-XYZ789',
    expectViolation: false,
  },
  {
    name: 'Valid: Prod role accessing legacy GitHub secret',
    environment: 'prod',
    secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/github-ABC123',
    expectViolation: false,
  },
  {
    name: 'Valid: Stage role accessing legacy GitHub secret',
    environment: 'stage',
    secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/github-XYZ789',
    expectViolation: false,
  },
  {
    name: 'Valid: Prod role accessing legacy LLM secret',
    environment: 'prod',
    secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/llm-ABC123',
    expectViolation: false,
  },
  {
    name: 'Valid: Legacy role accessing any afu9 secret',
    environment: 'legacy',
    secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/anything/here-ABC123',
    expectViolation: false,
  },

  // ========================================
  // INVALID CASES - Cross-Environment Access
  // ========================================
  {
    name: 'VIOLATION: Prod role accessing stage secret',
    environment: 'prod',
    secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/stage/smoke-key-XYZ789',
    expectViolation: true,
    expectedReason: 'Cross-environment access forbidden',
  },
  {
    name: 'VIOLATION: Stage role accessing prod secret',
    environment: 'stage',
    secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/prod/api-key-ABC123',
    expectViolation: true,
    expectedReason: 'Cross-environment access forbidden',
  },
  {
    name: 'VIOLATION: Prod role accessing stage-specific DB secret',
    environment: 'prod',
    secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/stage/database-XYZ789',
    expectViolation: true,
    expectedReason: 'Cross-environment access forbidden',
  },
  {
    name: 'VIOLATION: Stage role accessing prod-specific config',
    environment: 'stage',
    secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/prod/config-ABC123',
    expectViolation: true,
    expectedReason: 'Cross-environment access forbidden',
  },

  // ========================================
  // EDGE CASES
  // ========================================
  {
    name: 'Edge: Secret ARN with rotation suffix (wildcard)',
    environment: 'prod',
    secretArn: 'arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/prod/api-key-*',
    expectViolation: false,
  },
  {
    name: 'Edge: Template literal variable (skip validation)',
    environment: 'prod',
    secretArn: '${secretResourceArn}',
    expectViolation: false, // Variables are skipped
  },
];

function runTests(): boolean {
  console.log('='.repeat(80));
  console.log('Secrets Scope Validation Test Suite - E7.0.5');
  console.log('='.repeat(80));
  console.log('');

  let passed = 0;
  let failed = 0;

  testCases.forEach((testCase, index) => {
    const result = validateSecretScope(testCase.secretArn, testCase.environment);
    const hasViolation = !result.valid;
    
    const testPassed = hasViolation === testCase.expectViolation;

    if (testPassed) {
      console.log(`✅ Test ${index + 1}: ${testCase.name}`);
      if (hasViolation && testCase.expectedReason) {
        const reasonMatches = result.reason?.includes(testCase.expectedReason);
        if (reasonMatches) {
          console.log(`   ✓ Reason matches: "${testCase.expectedReason}"`);
        } else {
          console.log(`   ⚠ Reason mismatch: expected "${testCase.expectedReason}", got "${result.reason}"`);
        }
      }
      passed++;
    } else {
      console.log(`❌ Test ${index + 1}: ${testCase.name}`);
      console.log(`   Environment: ${testCase.environment}`);
      console.log(`   Secret ARN: ${testCase.secretArn}`);
      console.log(`   Expected violation: ${testCase.expectViolation}`);
      console.log(`   Got violation: ${hasViolation}`);
      if (result.reason) {
        console.log(`   Reason: ${result.reason}`);
      }
      failed++;
    }
  });

  console.log('');
  console.log('='.repeat(80));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(80));

  return failed === 0;
}

/**
 * Integration test: Run actual validation on CDK stacks
 */
async function integrationTest(): Promise<boolean> {
  console.log('');
  console.log('='.repeat(80));
  console.log('Integration Test: Validate Actual CDK Stacks');
  console.log('='.repeat(80));
  console.log('');

  try {
    const { validateAllStacks } = await import('./validate-secrets-scope');
    const result = validateAllStacks();
    
    if (result.passed) {
      console.log('✅ Integration test passed: No cross-environment secret access');
      return true;
    } else {
      console.log('❌ Integration test failed: Cross-environment violations detected');
      return false;
    }
  } catch (error) {
    console.error('❌ Integration test error:', error);
    return false;
  }
}

/**
 * Demonstration test: Show what a violation looks like
 */
function demonstrationTest(): void {
  console.log('');
  console.log('='.repeat(80));
  console.log('DEMONSTRATION: Cross-Environment Violation Example');
  console.log('='.repeat(80));
  console.log('');
  console.log('Scenario: Production ExecutionRole tries to access stage secrets');
  console.log('');
  
  const violation = validateSecretScope(
    'arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/stage/smoke-key-ABC123',
    'prod'
  );
  
  if (!violation.valid) {
    console.log('❌ VIOLATION DETECTED:');
    console.log(`   ${violation.reason}`);
    console.log('');
    console.log('This is the type of security/governance smell we prevent!');
  }
  
  console.log('');
  console.log('='.repeat(80));
}

// Main execution
async function main() {
  const unitTestsPassed = runTests();
  
  demonstrationTest();
  
  const integrationTestPassed = await integrationTest();

  if (unitTestsPassed && integrationTestPassed) {
    console.log('');
    console.log('✅ All tests passed!');
    console.log('   Secrets scope linter is working correctly.');
    console.log('   Cross-environment access violations will be blocked in CI.');
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
