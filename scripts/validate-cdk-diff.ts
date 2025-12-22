#!/usr/bin/env ts-node
/**
 * CDK Diff Gate Validation Script
 * 
 * This script validates that CDK diffs do not contain unexpected or dangerous changes
 * before allowing deployment. It implements the diff-gate guardrail for Issue I-03-01-DIFF-GATE.
 * 
 * Features:
 * - Parses CDK diff output to identify resource changes
 * - Blocks deployments on critical changes (ECS Replacement, DNS/ACM modifications, etc.)
 * - Provides clear error messages for blocked changes
 * - Outputs structured JSON for CI/CD integration
 * 
 * Usage:
 *   npm run validate:diff -- Afu9EcsStack
 *   ts-node scripts/validate-cdk-diff.ts Afu9EcsStack
 *   SKIP_DIFF_GATE=true npm run validate:diff  # Skip validation (not recommended)
 * 
 * Environment Variables:
 *   SKIP_DIFF_GATE - Skip diff validation (default: false)
 *   AWS_REGION - AWS region (default: eu-central-1)
 *   AWS_PROFILE - AWS profile to use (optional)
 *   OUTPUT_JSON - Output results as JSON (default: false)
 * 
 * Exit Codes:
 *   0 - Diff is safe to deploy
 *   1 - Diff contains blocking changes
 *   2 - Script error or no stack specified
 */

import { spawnSync } from 'child_process';

interface DiffChange {
  changeType: 'add' | 'remove' | 'modify' | 'replace';
  resourceType: string;
  resourcePath: string;
  severity: 'safe' | 'warning' | 'blocking';
  reason?: string;
}

interface DiffValidationResult {
  success: boolean;
  changes: DiffChange[];
  blockingChanges: DiffChange[];
  warningChanges: DiffChange[];
  safeChanges: DiffChange[];
  message: string;
}

/**
 * Blocking change patterns - these prevent deployment
 */
const BLOCKING_PATTERNS = [
  // ECS Service Replacement - causes downtime
  {
    pattern: /\[~\].*AWS::ECS::Service.*\(replacement\)/i,
    resourceType: 'AWS::ECS::Service',
    reason: 'ECS Service replacement causes downtime and service interruption',
  },
  // DNS/Route53 deletions or replacements
  {
    pattern: /\[-\].*AWS::Route53::RecordSet/i,
    resourceType: 'AWS::Route53::RecordSet',
    reason: 'DNS record deletion can cause service unavailability',
  },
  {
    pattern: /\[~\].*AWS::Route53::RecordSet.*\(replacement\)/i,
    resourceType: 'AWS::Route53::RecordSet',
    reason: 'DNS record replacement can cause DNS propagation issues',
  },
  // ACM Certificate deletions or replacements
  {
    pattern: /\[-\].*AWS::CertificateManager::Certificate/i,
    resourceType: 'AWS::CertificateManager::Certificate',
    reason: 'ACM Certificate deletion breaks HTTPS',
  },
  {
    pattern: /\[~\].*AWS::CertificateManager::Certificate.*\(replacement\)/i,
    resourceType: 'AWS::CertificateManager::Certificate',
    reason: 'ACM Certificate replacement requires DNS revalidation',
  },
  // Security Group deletions - can break connectivity
  {
    pattern: /\[-\].*AWS::EC2::SecurityGroup/i,
    resourceType: 'AWS::EC2::SecurityGroup',
    reason: 'Security Group deletion can break service connectivity',
  },
  // Database instance replacements - data loss risk
  {
    pattern: /\[~\].*AWS::RDS::DBInstance.*\(replacement\)/i,
    resourceType: 'AWS::RDS::DBInstance',
    reason: 'Database replacement requires careful migration planning',
  },
  // Load balancer replacements - causes service interruption
  {
    pattern: /\[~\].*AWS::ElasticLoadBalancingV2::LoadBalancer.*\(replacement\)/i,
    resourceType: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
    reason: 'Load Balancer replacement changes DNS endpoint',
  },
];

/**
 * Warning change patterns - allowed but flagged for attention
 */
const WARNING_PATTERNS = [
  {
    pattern: /\[~\].*AWS::EC2::SecurityGroup.*SecurityGroupIngress/i,
    resourceType: 'AWS::EC2::SecurityGroup',
    reason: 'Security Group rule modification - verify access requirements',
  },
  {
    pattern: /\[~\].*AWS::EC2::SecurityGroup.*SecurityGroupEgress/i,
    resourceType: 'AWS::EC2::SecurityGroup',
    reason: 'Security Group egress rule modification - verify connectivity',
  },
  {
    pattern: /\[~\].*AWS::IAM::Role/i,
    resourceType: 'AWS::IAM::Role',
    reason: 'IAM Role modification - verify permissions are correct',
  },
  {
    pattern: /\[~\].*AWS::IAM::Policy/i,
    resourceType: 'AWS::IAM::Policy',
    reason: 'IAM Policy modification - verify least privilege principle',
  },
];

/**
 * Safe change patterns - explicitly allowed
 */
const SAFE_PATTERNS = [
  {
    pattern: /\[~\].*AWS::ECS::TaskDefinition/i,
    resourceType: 'AWS::ECS::TaskDefinition',
    reason: 'Task Definition update (e.g., image tag change)',
  },
  {
    pattern: /\[\+\]/i,
    resourceType: 'Any',
    reason: 'Adding new resources (non-destructive)',
  },
];

/**
 * Validate stack name to prevent command injection
 */
function validateStackName(stackName: string): boolean {
  // Stack names should only contain alphanumeric characters, hyphens, and underscores
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  return validPattern.test(stackName);
}

/**
 * Run CDK diff and capture output
 */
function runCdkDiff(stackName: string, cdkArgs: string[]): string {
  // Validate stack name to prevent command injection
  if (!validateStackName(stackName)) {
    throw new Error(
      `Invalid stack name: "${stackName}". Stack name must only contain alphanumeric characters, hyphens, and underscores.`
    );
  }

  try {
    // Use only required environment variables to prevent injection
    const safeEnv = {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      AWS_REGION: process.env.AWS_REGION || 'eu-central-1',
      AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'eu-central-1',
      AWS_PROFILE: process.env.AWS_PROFILE || '',
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',
      AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN || '',
    };

    // Diff gate should evaluate ONLY the requested stack. Including dependency stacks
    // can surface unrelated/blocking changes (e.g., a stuck database stack) and
    // incorrectly block safe infra/app updates.
    const args = ['cdk', 'diff', '--exclusively', stackName, ...cdkArgs];
    console.log(`Running: npx ${args.join(' ')}\n`);

    const result = spawnSync('npx', args, {
      encoding: 'utf8',
      env: safeEnv,
    });

    const output = `${result.stdout || ''}${result.stderr || ''}`;

    // CDK diff uses exit code 0 for no changes, 1 for changes.
    // Exit code 2 (or others) indicates an error.
    if (result.status === 0 || result.status === 1) {
      return output;
    }

    const exitCode = result.status ?? 'unknown';
    const error = new Error(`CDK diff failed with exit code ${exitCode}`);
    (error as any).stdout = result.stdout;
    (error as any).stderr = result.stderr;
    throw error;
  } catch (error: any) {
    // CDK diff returns exit code 1 when there are changes
    // This is expected, so we return the stdout
    if (error.stdout) {
      return error.stdout.toString();
    }
    throw error;
  }
}

/**
 * Parse CDK diff output and identify changes
 */
function parseDiffOutput(diffOutput: string): DiffChange[] {
  const changes: DiffChange[] = [];
  const lines = diffOutput.split('\n');
  
  for (const line of lines) {
    // Skip empty lines and section headers
    if (!line.trim() || line.startsWith('Stack ') || line.startsWith('===')) {
      continue;
    }

    // Check against blocking patterns
    for (const { pattern, resourceType, reason } of BLOCKING_PATTERNS) {
      if (pattern.test(line)) {
        const changeType = extractChangeType(line);
        changes.push({
          changeType,
          resourceType,
          resourcePath: line.trim(),
          severity: 'blocking',
          reason,
        });
        continue;
      }
    }

    // Check against warning patterns
    for (const { pattern, resourceType, reason } of WARNING_PATTERNS) {
      if (pattern.test(line)) {
        const changeType = extractChangeType(line);
        changes.push({
          changeType,
          resourceType,
          resourcePath: line.trim(),
          severity: 'warning',
          reason,
        });
        continue;
      }
    }

    // Check against safe patterns
    for (const { pattern, resourceType, reason } of SAFE_PATTERNS) {
      if (pattern.test(line)) {
        const changeType = extractChangeType(line);
        changes.push({
          changeType,
          resourceType,
          resourcePath: line.trim(),
          severity: 'safe',
          reason,
        });
        continue;
      }
    }
  }

  return changes;
}

/**
 * Extract change type from CDK diff line
 */
function extractChangeType(line: string): 'add' | 'remove' | 'modify' | 'replace' {
  if (line.includes('[+]')) return 'add';
  if (line.includes('[-]')) return 'remove';
  if (line.includes('(replacement)')) return 'replace';
  if (line.includes('[~]')) return 'modify';
  return 'modify';
}

/**
 * Validate diff changes against gate rules
 */
function validateChanges(changes: DiffChange[]): DiffValidationResult {
  const blockingChanges = changes.filter((c) => c.severity === 'blocking');
  const warningChanges = changes.filter((c) => c.severity === 'warning');
  const safeChanges = changes.filter((c) => c.severity === 'safe');

  const success = blockingChanges.length === 0;
  
  let message: string;
  if (success) {
    if (changes.length === 0) {
      message = '✓ No changes detected in diff';
    } else if (warningChanges.length > 0) {
      message = `✓ Diff is safe to deploy (${safeChanges.length} safe changes, ${warningChanges.length} warnings)`;
    } else {
      message = `✓ Diff is safe to deploy (${safeChanges.length} safe changes)`;
    }
  } else {
    message = `✗ Diff contains ${blockingChanges.length} blocking change(s)`;
  }

  return {
    success,
    changes,
    blockingChanges,
    warningChanges,
    safeChanges,
    message,
  };
}

/**
 * Print validation results to console
 */
function printResults(result: DiffValidationResult, stackName: string) {
  console.log('\n=====================================');
  console.log('CDK Diff Gate Validation Results');
  console.log('=====================================\n');
  console.log(`Stack: ${stackName}`);
  console.log(`Status: ${result.success ? '✓ PASS' : '✗ BLOCKED'}\n`);

  if (result.blockingChanges.length > 0) {
    console.log('🚫 BLOCKING CHANGES (deployment not allowed):\n');
    for (const change of result.blockingChanges) {
      console.log(`  ❌ ${change.resourceType} (${change.changeType})`);
      console.log(`     ${change.resourcePath}`);
      console.log(`     Reason: ${change.reason}\n`);
    }
  }

  if (result.warningChanges.length > 0) {
    console.log('⚠️  WARNING CHANGES (review recommended):\n');
    for (const change of result.warningChanges) {
      console.log(`  ⚠️  ${change.resourceType} (${change.changeType})`);
      console.log(`     ${change.resourcePath}`);
      console.log(`     Note: ${change.reason}\n`);
    }
  }

  if (result.safeChanges.length > 0) {
    console.log(`✓ SAFE CHANGES (${result.safeChanges.length} total):\n`);
    for (const change of result.safeChanges.slice(0, 5)) {
      console.log(`  ✓ ${change.resourceType} (${change.changeType})`);
      console.log(`     ${change.resourcePath}\n`);
    }
    if (result.safeChanges.length > 5) {
      console.log(`  ... and ${result.safeChanges.length - 5} more safe changes\n`);
    }
  }

  console.log('=====================================');
  console.log(result.message);
  console.log('=====================================\n');

  if (!result.success) {
    console.log('How to proceed:');
    console.log('  1. Review the blocking changes above');
    console.log('  2. Determine if they are intentional and necessary');
    console.log('  3. If intentional, consider manual review and approval');
    console.log('  4. If unintentional, fix the infrastructure code\n');
    console.log('To skip this gate (NOT recommended):');
    console.log('  SKIP_DIFF_GATE=true npm run validate:diff\n');
  } else if (result.warningChanges.length > 0) {
    console.log('Recommendations:');
    console.log('  - Review warning changes before deployment');
    console.log('  - Ensure changes are intentional and safe');
    console.log('  - Consider testing in staging first\n');
  }
}

/**
 * Main function
 */
async function main() {
  // Check if validation should be skipped
  if (process.env.SKIP_DIFF_GATE === 'true') {
    console.log('⚠️  Diff gate validation is SKIPPED (SKIP_DIFF_GATE=true)');
    console.log('⚠️  This is not recommended for production deployments!\n');
    process.exit(0);
  }

  // Get stack name from command line
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Error: Stack name is required\n');
    console.error('Usage:');
    console.error('  npm run validate:diff -- Afu9EcsStack');
    console.error('  ts-node scripts/validate-cdk-diff.ts Afu9EcsStack\n');
    process.exit(2);
  }

  const stackName = args[0];

  console.log('=====================================');
  console.log('AFU-9 CDK Diff Gate Validation');
  console.log('=====================================\n');
  console.log(`Stack: ${stackName}`);
  console.log(`Region: ${process.env.AWS_REGION || 'eu-central-1'}`);
  if (process.env.AWS_PROFILE) {
    console.log(`Profile: ${process.env.AWS_PROFILE}`);
  }
  console.log('');

  try {
    // Run CDK diff
    console.log('Running CDK diff...\n');
    const cdkArgs = args.slice(1);
    const diffOutput = runCdkDiff(stackName, cdkArgs);
    
    // Print raw diff output
    console.log('--- CDK Diff Output ---');
    console.log(diffOutput);
    console.log('--- End of Diff ---\n');

    // Parse and validate changes
    console.log('Analyzing changes...\n');
    const changes = parseDiffOutput(diffOutput);
    const result = validateChanges(changes);

    // Output results
    if (process.env.OUTPUT_JSON === 'true') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printResults(result, stackName);
    }

    // Exit with appropriate code
    process.exit(result.success ? 0 : 1);

  } catch (error: any) {
    console.error('\n=====================================');
    console.error('Diff Gate Error');
    console.error('=====================================\n');
    console.error('Failed to run diff validation:', error.message || String(error));

    const stdout = (error && (error.stdout || error.output)) ? String(error.stdout || '') : '';
    const stderr = error && error.stderr ? String(error.stderr) : '';
    const combined = `${stdout}${stderr ? (stdout ? '\n' : '') + stderr : ''}`.trim();
    if (combined) {
      console.error('\n--- CDK Output (captured) ---');
      console.error(combined);
      console.error('--- End of CDK Output ---');
    }

    console.error('\nPossible causes:');
    console.error('  - Stack does not exist');
    console.error('  - AWS credentials not configured');
    console.error('  - CDK not properly installed');
    console.error('  - Invalid stack name\n');
    
    process.exit(2);
  }
}

// Run main function
main();
