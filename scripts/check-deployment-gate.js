#!/usr/bin/env node

/**
 * AFU-9 Deployment Gate Check Script
 * 
 * Issue B3: Verdict als Gate vor Deploy
 * 
 * Checks if deployment should be allowed based on verdict.
 * Only GREEN verdicts allow deployment to proceed.
 * 
 * Usage:
 *   node check-deployment-gate.js <verdict>
 *   node check-deployment-gate.js GREEN
 * 
 * Or with environment variable:
 *   DEPLOYMENT_VERDICT=GREEN node check-deployment-gate.js
 * 
 * Exit codes:
 *   0 - Deployment allowed (verdict is GREEN)
 *   1 - Deployment blocked (verdict is not GREEN)
 */

// Import verdict-engine types (in production, this would import from the package)
const SimpleVerdict = {
  GREEN: 'GREEN',
  RED: 'RED',
  HOLD: 'HOLD',
  RETRY: 'RETRY',
};

const SimpleAction = {
  ADVANCE: 'ADVANCE',
  ABORT: 'ABORT',
  FREEZE: 'FREEZE',
  RETRY_OPERATION: 'RETRY_OPERATION',
};

// Colors for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

/**
 * Check if a deployment should be allowed based on verdict
 */
function checkDeploymentGate(verdict) {
  const allowed = verdict === SimpleVerdict.GREEN;
  
  let reason;
  let action;
  
  if (allowed) {
    reason = 'Deployment allowed: Verdict is GREEN (all checks passed)';
    action = SimpleAction.ADVANCE;
  } else {
    switch (verdict) {
      case SimpleVerdict.RED:
        reason = 'Deployment BLOCKED: Verdict is RED (critical failure detected). Fix the issues and retry.';
        action = SimpleAction.ABORT;
        break;
      case SimpleVerdict.HOLD:
        reason = 'Deployment BLOCKED: Verdict is HOLD (requires human review). Manual intervention needed.';
        action = SimpleAction.FREEZE;
        break;
      case SimpleVerdict.RETRY:
        reason = 'Deployment BLOCKED: Verdict is RETRY (transient condition detected). Wait and retry.';
        action = SimpleAction.RETRY_OPERATION;
        break;
      default:
        reason = `Deployment BLOCKED: Unknown verdict "${verdict}". Only GREEN verdicts allow deployment.`;
        action = 'UNKNOWN';
    }
  }
  
  return { allowed, verdict, action, reason };
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  const verdict = args[0] || process.env.DEPLOYMENT_VERDICT || '';
  
  if (!verdict) {
    console.error(`${colors.red}ERROR: No verdict provided${colors.reset}`);
    console.error('');
    console.error('Usage:');
    console.error('  node check-deployment-gate.js <verdict>');
    console.error('  node check-deployment-gate.js GREEN');
    console.error('');
    console.error('Or with environment variable:');
    console.error('  DEPLOYMENT_VERDICT=GREEN node check-deployment-gate.js');
    console.error('');
    console.error('Valid verdicts: GREEN, RED, HOLD, RETRY');
    process.exit(1);
  }
  
  console.log(`${colors.blue}========================================${colors.reset}`);
  console.log(`${colors.blue}AFU-9 Deployment Gate Check${colors.reset}`);
  console.log(`${colors.blue}========================================${colors.reset}`);
  console.log('');
  
  const result = checkDeploymentGate(verdict.toUpperCase());
  
  console.log(`Verdict: ${colors.yellow}${result.verdict}${colors.reset}`);
  console.log(`Action:  ${colors.yellow}${result.action}${colors.reset}`);
  console.log('');
  
  if (result.allowed) {
    console.log(`${colors.green}✅ ${result.reason}${colors.reset}`);
    console.log('');
    console.log(`${colors.green}Deployment is ALLOWED to proceed.${colors.reset}`);
    process.exit(0);
  } else {
    console.log(`${colors.red}❌ ${result.reason}${colors.reset}`);
    console.log('');
    console.log(`${colors.red}Deployment is BLOCKED.${colors.reset}`);
    console.log('');
    console.log('Required action:');
    switch (result.action) {
      case SimpleAction.ABORT:
        console.log(`  ${colors.red}• ABORT: Fix critical issues before retrying deployment${colors.reset}`);
        break;
      case SimpleAction.FREEZE:
        console.log(`  ${colors.yellow}• FREEZE: Requires human review and manual approval${colors.reset}`);
        break;
      case SimpleAction.RETRY_OPERATION:
        console.log(`  ${colors.yellow}• RETRY: Wait for transient conditions to resolve, then retry${colors.reset}`);
        break;
    }
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { checkDeploymentGate, SimpleVerdict, SimpleAction };
