#!/usr/bin/env ts-node
/**
 * Preflight Secret Validation Script
 * 
 * This script validates that all required secret keys exist in AWS Secrets Manager
 * before deployment. It can be run locally or in CI pipelines.
 * 
 * Usage:
 *   npm run validate-secrets
 *   ts-node scripts/validate-secrets.ts
 *   
 * Environment Variables:
 *   AWS_REGION - AWS region (default: eu-central-1)
 *   AWS_PROFILE - AWS profile to use (optional)
 * 
 * Exit Codes:
 *   0 - All secrets validated successfully
 *   1 - One or more secrets failed validation
 *   2 - Script error (e.g., AWS credentials not configured)
 */

import { validateAllSecrets } from '../lib/utils/secret-validator';

async function main() {
  console.log('=====================================');
  console.log('AFU-9 Preflight Secret Validation');
  console.log('=====================================\n');

  const region = process.env.AWS_REGION || 'eu-central-1';
  const profile = process.env.AWS_PROFILE;

  console.log(`Region: ${region}`);
  if (profile) {
    console.log(`Profile: ${profile}`);
    console.log('Note: AWS SDK will use the specified profile from your AWS config\n');
  } else {
    console.log('Using default AWS credentials\n');
  }
  console.log('Validating secrets...\n');

  try {
    const results = await validateAllSecrets();

    console.log('\n=====================================');
    console.log('Validation Summary');
    console.log('=====================================\n');

    const passedResults = results.filter((r) => r.valid);
    const failedResults = results.filter((r) => !r.valid);

    console.log(`✓ Passed: ${passedResults.length}`);
    console.log(`✗ Failed: ${failedResults.length}`);
    console.log(`Total: ${results.length}\n`);

    if (failedResults.length === 0) {
      console.log('✓ All secrets validated successfully!');
      console.log('You can proceed with deployment.\n');
      process.exit(0);
    } else {
      console.error('✗ Secret validation failed!\n');
      console.error('The following secrets have issues:\n');
      
      for (const result of failedResults) {
        console.error(`  ❌ ${result.secretName}`);
        if (result.error) {
          console.error(`     Error: ${result.error}`);
        }
        if (result.missingKeys.length > 0) {
          console.error(`     Missing keys: ${result.missingKeys.join(', ')}`);
        }
        console.error('');
      }

      console.error('Please fix the above errors before deploying.\n');
      console.error('To fix missing keys:');
      console.error('  1. Go to AWS Secrets Manager console');
      console.error('  2. Find the secret by name');
      console.error('  3. Add the missing keys to the secret value (JSON format)');
      console.error('  4. Run this script again to verify\n');
      
      process.exit(1);
    }
  } catch (error: any) {
    console.error('\n=====================================');
    console.error('Script Error');
    console.error('=====================================\n');
    console.error('Failed to validate secrets:', error.message || String(error));
    console.error('\nPossible causes:');
    console.error('  - AWS credentials not configured');
    console.error('  - Insufficient permissions to read secrets');
    console.error('  - Network connectivity issues');
    console.error('  - Invalid AWS_REGION\n');
    console.error('Please check your AWS configuration and try again.\n');
    process.exit(2);
  }
}

// Run main function
main();
