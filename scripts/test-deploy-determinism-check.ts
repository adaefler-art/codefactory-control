#!/usr/bin/env ts-node
/**
 * Test for deploy-determinism-check.ts
 * 
 * This script verifies the deploy determinism check script works correctly.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';

function runTest() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Testing deploy-determinism-check.ts');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const reportPath = join(process.cwd(), 'artifacts', 'determinism-report.json');

  // Clean up any previous report
  if (existsSync(reportPath)) {
    unlinkSync(reportPath);
    console.log('✓ Cleaned up previous report\n');
  }

  // Run the determinism check with all steps skipped (for testing)
  console.log('Running determinism check (with steps skipped for testing)...\n');
  try {
    execSync(
      'SKIP_TESTS=true SKIP_BUILD=true SKIP_SECRET_VALIDATION=true npx ts-node scripts/deploy-determinism-check.ts',
      {
        stdio: 'inherit',
        env: process.env,
      }
    );
  } catch (error: any) {
    // Non-zero exit is expected if checks fail
    console.log('\nScript exited with non-zero code (may be expected)\n');
  }

  // Verify report was created
  if (!existsSync(reportPath)) {
    console.error('❌ FAILED: Report was not created');
    process.exit(1);
  }

  console.log('\n✓ Report file exists\n');

  // Verify report structure
  const reportContent = readFileSync(reportPath, 'utf8');
  const report = JSON.parse(reportContent);

  const requiredFields = [
    'timestamp',
    'success',
    'testsPass',
    'buildSuccess',
    'synthDeterministic',
    'stacks',
    'blockingIssues',
    'warnings',
    'summary',
  ];

  for (const field of requiredFields) {
    if (!(field in report)) {
      console.error(`❌ FAILED: Report missing field: ${field}`);
      process.exit(1);
    }
  }

  console.log('✓ Report has all required fields\n');

  // Verify stacks array
  if (!Array.isArray(report.stacks)) {
    console.error('❌ FAILED: stacks is not an array');
    process.exit(1);
  }

  console.log(`✓ Report contains ${report.stacks.length} stack analyses\n`);

  // Verify each stack has required fields
  for (const stack of report.stacks) {
    const requiredStackFields = [
      'name',
      'hasChanges',
      'blockingChanges',
      'warningChanges',
      'safeChanges',
    ];

    for (const field of requiredStackFields) {
      if (!(field in stack)) {
        console.error(`❌ FAILED: Stack missing field: ${field}`);
        process.exit(1);
      }
    }
  }

  console.log('✓ All stacks have required fields\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ All tests passed!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

runTest();
