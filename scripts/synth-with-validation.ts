#!/usr/bin/env ts-node
/**
 * CDK Synth with Secret Validation
 * 
 * This script wraps `cdk synth` to ensure secrets are validated before synthesis.
 * It implements the preflight check guardrail for Issue I-01-02-SECRET-PREFLIGHT.
 * 
 * Features:
 * - Validates all secrets before running cdk synth
 * - Fails fast with clear error messages
 * - Can be disabled with SKIP_SECRET_VALIDATION=true
 * - Supports all CDK synth arguments
 * 
 * Usage:
 *   npm run synth                           # Synth all stacks with validation
 *   npm run synth -- Afu9EcsStack          # Synth specific stack
 *   SKIP_SECRET_VALIDATION=true npm run synth  # Skip validation (not recommended)
 */

import { execSync } from 'child_process';
import { validateAllSecrets } from '../lib/utils/secret-validator';

async function main() {
  // Check if validation should be skipped (for special cases)
  if (process.env.SKIP_SECRET_VALIDATION === 'true') {
    console.log('⚠️  Secret validation is SKIPPED (SKIP_SECRET_VALIDATION=true)');
    console.log('⚠️  This is not recommended for production deployments!\n');
    runCdkSynth();
    return;
  }

  console.log('=====================================');
  console.log('AFU-9 Preflight Secret Validation');
  console.log('=====================================\n');

  const region = process.env.AWS_REGION || 'eu-central-1';
  const profile = process.env.AWS_PROFILE;

  console.log(`Region: ${region}`);
  if (profile) {
    console.log(`Profile: ${profile}`);
  }
  console.log('\nValidating secrets before CDK synth...\n');

  try {
    const results = await validateAllSecrets();

    const passedResults = results.filter((r) => r.valid);
    const failedResults = results.filter((r) => !r.valid);

    console.log('\n=====================================');
    console.log('Validation Summary');
    console.log('=====================================\n');

    console.log(`✓ Passed: ${passedResults.length}`);
    console.log(`✗ Failed: ${failedResults.length}`);
    console.log(`Total: ${results.length}\n`);

    if (failedResults.length > 0) {
      console.error('✗ Secret validation FAILED!\n');
      console.error('Cannot proceed with CDK synth due to missing or invalid secrets:\n');

      for (const result of failedResults) {
        console.error(`  ❌ Secret: ${result.secretName}`);
        if (result.error) {
          console.error(`     Error: ${result.error}`);
        }
        if (result.missingKeys.length > 0) {
          console.error(`     Missing keys: ${result.missingKeys.join(', ')}`);
        }
        console.error('');
      }

      console.error('How to fix:');
      console.error('  1. Go to AWS Secrets Manager console');
      console.error('  2. Create or update the secret with missing keys');
      console.error('  3. Ensure all required keys exist with valid values');
      console.error('  4. Run this command again\n');
      console.error('For local development, you can skip validation with:');
      console.error('  SKIP_SECRET_VALIDATION=true npm run synth\n');

      process.exit(1);
    }

    console.log('✓ All secrets validated successfully!\n');
    console.log('Proceeding with CDK synth...\n');

    // Run CDK synth with validation passed
    runCdkSynth();

  } catch (error: any) {
    console.error('\n=====================================');
    console.error('Validation Error');
    console.error('=====================================\n');
    console.error('Failed to validate secrets:', error.message || String(error));
    console.error('\nPossible causes:');
    console.error('  - AWS credentials not configured');
    console.error('  - Insufficient permissions to read secrets');
    console.error('  - Network connectivity issues');
    console.error('  - Secrets do not exist in AWS Secrets Manager\n');
    console.error('For local development without AWS credentials:');
    console.error('  SKIP_SECRET_VALIDATION=true npm run synth\n');

    process.exit(2);
  }
}

/**
 * Run CDK synth with all command-line arguments passed through
 */
function runCdkSynth() {
  // Get CDK synth arguments (everything after 'npm run synth --')
  const cdkArgs = process.argv.slice(2);
  const command = `npx cdk synth ${cdkArgs.join(' ')}`;

  console.log('=====================================');
  console.log('Running CDK Synth');
  console.log('=====================================\n');
  console.log(`Command: ${command}\n`);

  try {
    execSync(command, {
      stdio: 'inherit',
      env: process.env,
    });
  } catch (error: any) {
    console.error('\n✗ CDK synth failed');
    process.exit(error.status || 1);
  }
}

// Run main function
main();
