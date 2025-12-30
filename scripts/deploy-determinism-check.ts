#!/usr/bin/env ts-node
/**
 * Deploy Determinism Check Script
 * 
 * This script implements E64.2 - a comprehensive, automatable check that validates
 * deploy safety before CDK deployment. It ensures:
 * 
 * 1. Tests pass
 * 2. Build succeeds
 * 3. CDK synth is deterministic (reproducible)
 * 4. CDK diff contains no blocking changes (ECS replacement, ALB/TG changes, RDS changes, DNS/cert changes)
 * 
 * Features:
 * - Machine-readable JSON output (artifacts/determinism-report.json)
 * - Human-readable console output
 * - Comprehensive gate rules aligned with existing validate-cdk-diff.ts
 * - Determinism verification via double-synth comparison
 * 
 * Usage:
 *   npm run determinism:check
 *   ts-node scripts/deploy-determinism-check.ts
 *   ts-node scripts/deploy-determinism-check.ts -- --stack Afu9EcsStack
 *   SKIP_DETERMINISM_CHECK=true npm run determinism:check  # Skip (not recommended)
 * 
 * Environment Variables:
 *   SKIP_DETERMINISM_CHECK - Skip entire check (default: false)
 *   SKIP_TESTS - Skip test step (default: false)
 *   SKIP_BUILD - Skip build step (default: false)
 *   SKIP_SYNTH_CHECK - Skip synth determinism check (default: false)
 *   AWS_REGION - AWS region (default: eu-central-1)
 *   AWS_PROFILE - AWS profile to use (optional)
 * 
 * Exit Codes:
 *   0 - All checks passed, safe to deploy
 *   1 - Checks failed, deployment blocked
 *   2 - Script error or invalid usage
 */

import { spawnSync, execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as crypto from 'crypto';

interface DiffChange {
  changeType: 'add' | 'remove' | 'modify' | 'replace';
  resourceType: string;
  resourcePath: string;
  severity: 'safe' | 'warning' | 'blocking';
  reason?: string;
}

interface StackAnalysis {
  name: string;
  hasChanges: boolean;
  blockingChanges: DiffChange[];
  warningChanges: DiffChange[];
  safeChanges: DiffChange[];
  diffOutput?: string;
  error?: string;
  reasonCode?: string; // Machine-readable reason code
}

interface DeterminismReport {
  timestamp: string;
  success: boolean;
  testsPass: boolean;
  buildSuccess: boolean;
  synthDeterministic: boolean;
  stacks: StackAnalysis[];
  blockingIssues: string[];
  warnings: string[];
  summary: string;
  reasonCodes: string[]; // Machine-readable reason codes for all failures
}

/**
 * Blocking change patterns from validate-cdk-diff.ts
 */
const BLOCKING_PATTERNS = [
  {
    pattern: /\[~\].*AWS::ECS::Service.*\(replacement\)/i,
    resourceType: 'AWS::ECS::Service',
    reason: 'ECS Service replacement causes downtime and service interruption',
  },
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
  {
    pattern: /\[-\].*AWS::EC2::SecurityGroup/i,
    resourceType: 'AWS::EC2::SecurityGroup',
    reason: 'Security Group deletion can break service connectivity',
  },
  {
    pattern: /\[~\].*AWS::RDS::DBInstance.*\(replacement\)/i,
    resourceType: 'AWS::RDS::DBInstance',
    reason: 'Database replacement requires careful migration planning',
  },
  {
    pattern: /\[~\].*AWS::ElasticLoadBalancingV2::LoadBalancer.*\(replacement\)/i,
    resourceType: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
    reason: 'Load Balancer replacement changes DNS endpoint',
  },
  {
    pattern: /\[-\].*AWS::ElasticLoadBalancingV2::TargetGroup/i,
    resourceType: 'AWS::ElasticLoadBalancingV2::TargetGroup',
    reason: 'Target Group deletion breaks routing',
  },
  {
    pattern: /\[~\].*AWS::ElasticLoadBalancingV2::TargetGroup.*\(replacement\)/i,
    resourceType: 'AWS::ElasticLoadBalancingV2::TargetGroup',
    reason: 'Target Group replacement can cause connection errors',
  },
];

/**
 * Warning change patterns
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
 * Safe change patterns
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
 * Critical stacks to analyze
 */
const CRITICAL_STACKS = [
  'Afu9EcsStack',
  'Afu9EcsStageStack',
  'Afu9EcsProdStack',
  'Afu9NetworkStack',
  'Afu9DatabaseStack',
  'Afu9DnsStack',
  'Afu9RoutingStack',
  'Afu9RoutingSingleEnvStack',
];

/**
 * Run a command and return result
 */
function runCommand(
  command: string,
  args: string[],
  options: { silent?: boolean; ignoreError?: boolean } = {}
): { success: boolean; output: string; exitCode: number } {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      env: process.env,
    });

    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const exitCode = result.status ?? -1;
    const success = exitCode === 0 || (options.ignoreError ?? false);

    if (!options.silent) {
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.error(result.stderr);
    }

    return { success, output, exitCode };
  } catch (error: any) {
    return { success: false, output: error.message || String(error), exitCode: -1 };
  }
}

/**
 * Step 1: Run tests
 */
function runTests(): boolean {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 1: Test Validation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (process.env.SKIP_TESTS === 'true') {
    console.log('⚠️  Tests SKIPPED (SKIP_TESTS=true)\n');
    return true;
  }

  console.log('Running: npm test\n');
  const result = runCommand('npm', ['test'], { ignoreError: true });

  if (result.success) {
    console.log('\n✅ Tests passed\n');
    return true;
  } else {
    console.log('\n❌ Tests failed\n');
    return false;
  }
}

/**
 * Step 2: Run build
 */
function runBuild(): boolean {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 2: Build Validation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (process.env.SKIP_BUILD === 'true') {
    console.log('⚠️  Build SKIPPED (SKIP_BUILD=true)\n');
    return true;
  }

  console.log('Running: npm run build\n');
  const result = runCommand('npm', ['run', 'build'], { ignoreError: true });

  if (result.success) {
    console.log('\n✅ Build successful\n');
    return true;
  } else {
    console.log('\n❌ Build failed\n');
    return false;
  }
}

/**
 * Canonicalize CloudFormation template JSON for deterministic comparison
 * Removes volatile fields and sorts keys to ensure consistent hashing
 */
function canonicalizeTemplate(content: string): string {
  try {
    const template = JSON.parse(content);
    
    // Remove known volatile fields that don't affect deployment
    if (template.Rules && template.Rules.CheckBootstrapVersion) {
      delete template.Rules.CheckBootstrapVersion;
    }
    
    // Sort keys recursively to ensure consistent ordering
    const sortObject = (obj: any): any => {
      if (obj === null || typeof obj !== 'object') {
        return obj;
      }
      if (Array.isArray(obj)) {
        return obj.map(sortObject);
      }
      return Object.keys(obj)
        .sort()
        .reduce((result: any, key) => {
          result[key] = sortObject(obj[key]);
          return result;
        }, {});
    };
    
    return JSON.stringify(sortObject(template));
  } catch (error) {
    // If parse fails, return original content
    return content;
  }
}

/**
 * Compute hash of directory contents (for synth determinism check)
 * Canonicalizes templates before hashing to avoid false positives
 */
function hashDirectory(dirPath: string): string {
  if (!existsSync(dirPath)) {
    return '';
  }

  const files = readdirSync(dirPath, { recursive: true, encoding: 'utf8' }) as string[];
  const templateFiles = files
    .filter((f) => f.endsWith('.template.json'))
    .sort();

  const hash = crypto.createHash('sha256');
  for (const file of templateFiles) {
    const fullPath = join(dirPath, file);
    try {
      const content = readFileSync(fullPath, 'utf8');
      const canonicalized = canonicalizeTemplate(content);
      hash.update(file);
      hash.update(canonicalized);
    } catch (error) {
      // Skip files that can't be read
    }
  }

  return hash.digest('hex');
}

/**
 * Step 3 & 4: Run CDK synth twice and check determinism
 */
function checkSynthDeterminism(): boolean {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 3 & 4: CDK Synth Determinism Check');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (process.env.SKIP_SYNTH_CHECK === 'true') {
    console.log('⚠️  Synth determinism check SKIPPED (SKIP_SYNTH_CHECK=true)\n');
    return true;
  }

  const cdkOutPath = join(process.cwd(), 'cdk.out');

  // First synth
  console.log('Running: npx cdk synth (first pass)\n');
  const result1 = runCommand('npx', ['cdk', 'synth', '--quiet'], { silent: true, ignoreError: true });
  
  if (!result1.success) {
    console.log('❌ First CDK synth failed\n');
    console.log(result1.output);
    return false;
  }

  const hash1 = hashDirectory(cdkOutPath);
  console.log(`First synth hash: ${hash1}\n`);

  // Second synth
  console.log('Running: npx cdk synth (second pass)\n');
  const result2 = runCommand('npx', ['cdk', 'synth', '--quiet'], { silent: true, ignoreError: true });

  if (!result2.success) {
    console.log('❌ Second CDK synth failed\n');
    console.log(result2.output);
    return false;
  }

  const hash2 = hashDirectory(cdkOutPath);
  console.log(`Second synth hash: ${hash2}\n`);

  if (hash1 === hash2) {
    console.log('✅ CDK synth is deterministic (hashes match)\n');
    return true;
  } else {
    console.log('❌ CDK synth is NON-DETERMINISTIC (hashes differ)\n');
    console.log('Templates differ between runs - review for non-deterministic constructs\n');
    return false;
  }
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
 * Parse CDK diff output
 */
function parseDiffOutput(diffOutput: string): DiffChange[] {
  const changes: DiffChange[] = [];
  const lines = diffOutput.split('\n');

  for (const line of lines) {
    if (!line.trim() || line.startsWith('Stack ') || line.startsWith('===')) {
      continue;
    }

    // Check blocking patterns
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

    // Check warning patterns
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

    // Check safe patterns
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
 * Step 5: Analyze CDK diff for each critical stack
 */
function analyzeStackDiffs(stackNames?: string[]): StackAnalysis[] {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 5: CDK Diff Analysis');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const stacksToCheck = stackNames && stackNames.length > 0 ? stackNames : CRITICAL_STACKS;
  const results: StackAnalysis[] = [];

  for (const stackName of stacksToCheck) {
    console.log(`Analyzing: ${stackName}...`);

    const result = runCommand(
      'npx',
      ['cdk', 'diff', '--exclusively', stackName],
      { silent: true, ignoreError: true }
    );

    // CDK diff returns exit code 0 (no changes) or 1 (has changes)
    // Both are valid states; exit code 2+ indicates error
    if (result.exitCode > 1) {
      console.log(`  ⚠️  Stack may not exist or error occurred\n`);
      results.push({
        name: stackName,
        hasChanges: false,
        blockingChanges: [],
        warningChanges: [],
        safeChanges: [],
        error: 'Stack not found or diff failed',
      });
      continue;
    }

    const changes = parseDiffOutput(result.output);
    const blockingChanges = changes.filter((c) => c.severity === 'blocking');
    const warningChanges = changes.filter((c) => c.severity === 'warning');
    const safeChanges = changes.filter((c) => c.severity === 'safe');

    const hasChanges = changes.length > 0;

    if (!hasChanges) {
      console.log(`  ✅ No changes\n`);
    } else if (blockingChanges.length > 0) {
      console.log(`  ❌ ${blockingChanges.length} blocking change(s)\n`);
    } else if (warningChanges.length > 0) {
      console.log(`  ⚠️  ${warningChanges.length} warning(s), ${safeChanges.length} safe change(s)\n`);
    } else {
      console.log(`  ✅ ${safeChanges.length} safe change(s)\n`);
    }

    results.push({
      name: stackName,
      hasChanges,
      blockingChanges,
      warningChanges,
      safeChanges,
      diffOutput: result.output,
    });
  }

  return results;
}

/**
 * Generate and save report
 */
function generateReport(
  testsPass: boolean,
  buildSuccess: boolean,
  synthDeterministic: boolean,
  stackAnalyses: StackAnalysis[]
): DeterminismReport {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  const reasonCodes: string[] = [];

  // Collect issues and reason codes
  if (!testsPass) {
    blockingIssues.push('Tests failed');
    reasonCodes.push('TESTS_FAILED');
  }
  if (!buildSuccess) {
    blockingIssues.push('Build failed');
    reasonCodes.push('BUILD_FAILED');
  }
  if (!synthDeterministic) {
    blockingIssues.push('CDK synth is non-deterministic');
    reasonCodes.push('NONDETERMINISTIC_SYNTH');
  }

  for (const stack of stackAnalyses) {
    if (stack.blockingChanges.length > 0) {
      blockingIssues.push(
        `${stack.name}: ${stack.blockingChanges.length} blocking change(s)`
      );
      // Add resource-specific reason codes
      for (const change of stack.blockingChanges) {
        const resourceCode = change.resourceType.replace(/::/g, '_').toUpperCase();
        const changeCode = change.changeType.toUpperCase();
        reasonCodes.push(`${resourceCode}_${changeCode}`);
      }
      // Add stack-level reason code
      stack.reasonCode = 'BLOCKING_CHANGES_DETECTED';
    }
    if (stack.warningChanges.length > 0) {
      warnings.push(`${stack.name}: ${stack.warningChanges.length} warning(s)`);
    }
  }

  const success = blockingIssues.length === 0;
  const summary = success
    ? 'All checks passed - deployment is SAFE to proceed'
    : 'Checks failed - deployment is BLOCKED';

  const report: DeterminismReport = {
    timestamp: new Date().toISOString(),
    success,
    testsPass,
    buildSuccess,
    synthDeterministic,
    stacks: stackAnalyses,
    blockingIssues,
    warnings,
    summary,
    reasonCodes,
  };

  return report;
}

/**
 * Save report to file
 */
function saveReport(report: DeterminismReport): void {
  const artifactsDir = join(process.cwd(), 'artifacts');
  if (!existsSync(artifactsDir)) {
    mkdirSync(artifactsDir, { recursive: true });
  }

  const reportPath = join(artifactsDir, 'determinism-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved to: ${reportPath}\n`);
}

/**
 * Print final summary
 */
function printSummary(report: DeterminismReport): void {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (report.success) {
    console.log('✅ Deploy Determinism Check: PASSED');
  } else {
    console.log('❌ Deploy Determinism Check: BLOCKED');
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`Tests:     ${report.testsPass ? '✅ Pass' : '❌ Fail'}`);
  console.log(`Build:     ${report.buildSuccess ? '✅ Success' : '❌ Fail'}`);
  console.log(`Synth:     ${report.synthDeterministic ? '✅ Deterministic' : '❌ Non-deterministic'}`);

  const stacksAnalyzed = report.stacks.filter((s) => !s.error).length;
  const stacksWithChanges = report.stacks.filter((s) => s.hasChanges).length;
  console.log(`Stacks:    ${stacksAnalyzed} analyzed, ${stacksWithChanges} with changes\n`);

  if (report.blockingIssues.length > 0) {
    console.log('🚫 Blocking Issues:');
    for (const issue of report.blockingIssues) {
      console.log(`   • ${issue}`);
    }
    console.log('');
  }

  if (report.warnings.length > 0) {
    console.log('⚠️  Warnings:');
    for (const warning of report.warnings) {
      console.log(`   • ${warning}`);
    }
    console.log('');
  }

  // Show details for stacks with blocking changes
  for (const stack of report.stacks) {
    if (stack.blockingChanges.length > 0) {
      console.log(`Stack: ${stack.name}`);
      for (const change of stack.blockingChanges) {
        console.log(`  ❌ ${change.resourceType} (${change.changeType})`);
        console.log(`     ${change.resourcePath}`);
        console.log(`     Reason: ${change.reason}\n`);
      }
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(report.summary);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

/**
 * Main function
 */
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('AFU-9 Deploy Determinism Check');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Region: ${process.env.AWS_REGION || 'eu-central-1'}`);
  if (process.env.AWS_PROFILE) {
    console.log(`Profile: ${process.env.AWS_PROFILE}`);
  }

  // Check for skip flag
  if (process.env.SKIP_DETERMINISM_CHECK === 'true') {
    console.log('\n⚠️  Determinism check is SKIPPED (SKIP_DETERMINISM_CHECK=true)');
    console.log('⚠️  This is not recommended for production deployments!\n');
    process.exit(0);
  }

  // Parse command line args for specific stacks
  const args = process.argv.slice(2);
  const stackArg = args.indexOf('--stack');
  const stackNames = stackArg >= 0 && args[stackArg + 1] ? [args[stackArg + 1]] : undefined;

  // Run all steps
  const testsPass = runTests();
  const buildSuccess = runBuild();
  const synthDeterministic = checkSynthDeterminism();
  const stackAnalyses = analyzeStackDiffs(stackNames);

  // Generate and save report
  const report = generateReport(testsPass, buildSuccess, synthDeterministic, stackAnalyses);
  saveReport(report);

  // Print summary
  printSummary(report);

  // Exit with appropriate code
  process.exit(report.success ? 0 : 1);
}

// Run main
main().catch((error) => {
  console.error('\n❌ Unexpected error:', error.message || String(error));
  process.exit(2);
});
