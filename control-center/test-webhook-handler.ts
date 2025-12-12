/**
 * Test Script for GitHub Webhook Handler
 * 
 * This script tests the webhook signature verification and event processing
 * without making actual HTTP requests.
 */

import { createHmac } from 'crypto';
import { verifyGitHubSignature, parseGitHubEvent } from './src/lib/webhooks/signature';

// Test data
const TEST_SECRET = 'test-webhook-secret-123';

const TEST_PAYLOADS = {
  issue_opened: {
    action: 'opened',
    issue: {
      number: 123,
      title: 'Test issue',
      body: 'This is a test issue',
      state: 'open',
      labels: [
        { name: 'bug' },
        { name: 'high-priority' }
      ]
    },
    repository: {
      name: 'test-repo',
      owner: {
        login: 'test-owner'
      },
      default_branch: 'main'
    },
    sender: {
      login: 'test-user'
    }
  },
  pull_request_opened: {
    action: 'opened',
    pull_request: {
      number: 456,
      title: 'Test PR',
      body: 'This is a test pull request',
      state: 'open',
      head: {
        ref: 'feature-branch'
      },
      base: {
        ref: 'main'
      }
    },
    repository: {
      name: 'test-repo',
      owner: {
        login: 'test-owner'
      },
      default_branch: 'main'
    },
    sender: {
      login: 'test-user'
    }
  },
  check_run_completed: {
    action: 'completed',
    check_run: {
      id: 789,
      name: 'CI Build',
      status: 'completed',
      conclusion: 'success',
      head_sha: 'abc123'
    },
    repository: {
      name: 'test-repo',
      owner: {
        login: 'test-owner'
      },
      default_branch: 'main'
    },
    sender: {
      login: 'test-user'
    }
  }
};

/**
 * Generate GitHub webhook signature
 */
function generateSignature(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Test signature verification
 */
function testSignatureVerification() {
  console.log('\n=== Testing Signature Verification ===\n');

  const testPayload = JSON.stringify(TEST_PAYLOADS.issue_opened);
  
  // Test valid signature
  const validSignature = generateSignature(testPayload, TEST_SECRET);
  const isValid = verifyGitHubSignature(testPayload, validSignature, TEST_SECRET);
  console.log(`✓ Valid signature verification: ${isValid ? 'PASS' : 'FAIL'}`);

  // Test invalid signature
  const invalidSignature = 'sha256=invalid';
  const isInvalid = verifyGitHubSignature(testPayload, invalidSignature, TEST_SECRET);
  console.log(`✓ Invalid signature rejection: ${!isInvalid ? 'PASS' : 'FAIL'}`);

  // Test wrong secret
  const wrongSecretSignature = generateSignature(testPayload, 'wrong-secret');
  const wrongSecret = verifyGitHubSignature(testPayload, wrongSecretSignature, TEST_SECRET);
  console.log(`✓ Wrong secret rejection: ${!wrongSecret ? 'PASS' : 'FAIL'}`);

  // Test malformed signature
  const malformedSignature = 'not-a-signature';
  const malformed = verifyGitHubSignature(testPayload, malformedSignature, TEST_SECRET);
  console.log(`✓ Malformed signature rejection: ${!malformed ? 'PASS' : 'FAIL'}`);
}

/**
 * Test event parsing
 */
function testEventParsing() {
  console.log('\n=== Testing Event Parsing ===\n');

  // Test issue event
  const issueEvent = parseGitHubEvent('issues', TEST_PAYLOADS.issue_opened);
  console.log(`✓ Issue event parsing:`, {
    type: issueEvent.event_type,
    action: issueEvent.event_action,
    expected: 'issues.opened',
    pass: issueEvent.event_type === 'issues' && issueEvent.event_action === 'opened'
  });

  // Test pull request event
  const prEvent = parseGitHubEvent('pull_request', TEST_PAYLOADS.pull_request_opened);
  console.log(`✓ PR event parsing:`, {
    type: prEvent.event_type,
    action: prEvent.event_action,
    expected: 'pull_request.opened',
    pass: prEvent.event_type === 'pull_request' && prEvent.event_action === 'opened'
  });

  // Test check run event
  const checkEvent = parseGitHubEvent('check_run', TEST_PAYLOADS.check_run_completed);
  console.log(`✓ Check run event parsing:`, {
    type: checkEvent.event_type,
    action: checkEvent.event_action,
    expected: 'check_run.completed',
    pass: checkEvent.event_type === 'check_run' && checkEvent.event_action === 'completed'
  });
}

/**
 * Test payload structure
 */
function testPayloadStructure() {
  console.log('\n=== Testing Payload Structure ===\n');

  // Test issue payload
  const issuePayload = TEST_PAYLOADS.issue_opened;
  console.log(`✓ Issue payload structure:`, {
    hasAction: !!issuePayload.action,
    hasIssue: !!issuePayload.issue,
    hasRepo: !!issuePayload.repository,
    hasSender: !!issuePayload.sender,
    issueNumber: issuePayload.issue.number,
    pass: !!(issuePayload.action && issuePayload.issue && issuePayload.repository)
  });

  // Test PR payload
  const prPayload = TEST_PAYLOADS.pull_request_opened;
  console.log(`✓ PR payload structure:`, {
    hasAction: !!prPayload.action,
    hasPR: !!prPayload.pull_request,
    hasRepo: !!prPayload.repository,
    hasSender: !!prPayload.sender,
    prNumber: prPayload.pull_request.number,
    pass: !!(prPayload.action && prPayload.pull_request && prPayload.repository)
  });

  // Test check run payload
  const checkPayload = TEST_PAYLOADS.check_run_completed;
  console.log(`✓ Check run payload structure:`, {
    hasAction: !!checkPayload.action,
    hasCheckRun: !!checkPayload.check_run,
    hasRepo: !!checkPayload.repository,
    hasSender: !!checkPayload.sender,
    checkId: checkPayload.check_run.id,
    pass: !!(checkPayload.action && checkPayload.check_run && checkPayload.repository)
  });
}

/**
 * Generate sample curl commands for manual testing
 */
function generateCurlCommands() {
  console.log('\n=== Sample cURL Commands for Manual Testing ===\n');

  Object.entries(TEST_PAYLOADS).forEach(([eventName, payload]) => {
    const payloadStr = JSON.stringify(payload);
    const signature = generateSignature(payloadStr, TEST_SECRET);
    const eventType = eventName.split('_')[0];

    console.log(`\n# Test ${eventName}`);
    console.log(`curl -X POST http://localhost:3000/api/webhooks/github \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -H "X-GitHub-Event: ${eventType}" \\`);
    console.log(`  -H "X-Hub-Signature-256: ${signature}" \\`);
    console.log(`  -H "X-GitHub-Delivery: test-${Date.now()}" \\`);
    console.log(`  -d '${payloadStr}'`);
  });

  console.log('\n');
  console.log('Note: Make sure to:');
  console.log('1. Update the webhook secret in the database to match TEST_SECRET');
  console.log('2. Have the Control Center running on port 3000');
  console.log('3. Have the database running and migrations applied');
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('GitHub Webhook Handler Tests');
  console.log('============================');

  try {
    testSignatureVerification();
    testEventParsing();
    testPayloadStructure();
    generateCurlCommands();

    console.log('\n=== All Tests Completed ===\n');
  } catch (error) {
    console.error('Test error:', error);
    process.exit(1);
  }
}

// Run tests
runTests();
