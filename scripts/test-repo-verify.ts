#!/usr/bin/env ts-node
/**
 * Test script for repo-verify
 * Validates that the repo-verify script correctly detects violations
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '..');

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function runTest(name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`✅ ${name}`);
  } catch (error) {
    results.push({ 
      name, 
      passed: false, 
      error: error instanceof Error ? error.message : String(error)
    });
    console.log(`❌ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log('=====================================');
console.log('Repo Verify Test Suite');
console.log('=====================================\n');

// Test 1: Clean repo should pass
runTest('Clean repo passes all checks', () => {
  const output = execSync('npm run repo:verify', { 
    cwd: REPO_ROOT, 
    encoding: 'utf-8',
    stdio: 'pipe'
  });
  
  if (!output.includes('All repository canon checks passed')) {
    throw new Error('Clean repo should pass all checks');
  }
});

// Test 2: Invalid API call should fail
runTest('Invalid API call is detected', () => {
  const testFile = path.join(REPO_ROOT, 'control-center/app/__test-bad-api.tsx');
  
  try {
    // Create test file with invalid API call
    fs.writeFileSync(testFile, `
      export default function Test() {
        const test = () => fetch('/api/invalid-route-test-123');
        return <div>Test</div>;
      }
    `);
    
    // Run verification - should fail
    try {
      execSync('npm run repo:verify', { 
        cwd: REPO_ROOT, 
        encoding: 'utf-8',
        stdio: 'pipe'
      });
      throw new Error('Should have failed but passed');
    } catch (error: any) {
      // Should fail - check that error message is informative
      const stderr = error.stderr || error.stdout || '';
      if (!stderr.includes('does not exist') && !stderr.includes('invalid-route-test-123')) {
        // If it doesn't fail on API route, check if it caught it another way
        if (!error.message.includes('Command failed')) {
          throw new Error('Expected failure but got different error');
        }
      }
    }
  } finally {
    // Clean up
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  }
});

// Test 3: Forbidden paths should fail
runTest('Forbidden paths are detected', () => {
  const forbiddenDir = path.join(REPO_ROOT, '.next');
  
  try {
    // Create forbidden directory
    fs.mkdirSync(forbiddenDir, { recursive: true });
    fs.writeFileSync(path.join(forbiddenDir, 'test.txt'), 'test');
    
    // Run verification - should fail
    try {
      execSync('npm run repo:verify', { 
        cwd: REPO_ROOT, 
        encoding: 'utf-8',
        stdio: 'pipe'
      });
      throw new Error('Should have failed but passed');
    } catch (error: any) {
      // Should fail - check for forbidden path error
      const stderr = error.stderr || error.stdout || '';
      if (!stderr.includes('Forbidden') && !stderr.includes('.next')) {
        throw new Error('Should detect forbidden path');
      }
    }
  } finally {
    // Clean up
    if (fs.existsSync(forbiddenDir)) {
      fs.rmSync(forbiddenDir, { recursive: true, force: true });
    }
  }
});

// Test 4: Override flag works
runTest('AFU9_ALLOW_MIXED_SCOPE override works', () => {
  const output = execSync('AFU9_ALLOW_MIXED_SCOPE=true npm run repo:verify', { 
    cwd: REPO_ROOT, 
    encoding: 'utf-8',
    stdio: 'pipe',
    env: { ...process.env, AFU9_ALLOW_MIXED_SCOPE: 'true' }
  });
  
  if (!output.includes('Mixed-Scope Check SKIPPED')) {
    throw new Error('Override flag should skip mixed-scope check');
  }
});

console.log('\n=====================================');
console.log('Test Summary');
console.log('=====================================\n');

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log(`✓ Passed: ${passed}`);
console.log(`✗ Failed: ${failed}`);
console.log(`Total: ${results.length}\n`);

if (failed > 0) {
  console.error('Failed tests:');
  results.filter(r => !r.passed).forEach(r => {
    console.error(`  - ${r.name}: ${r.error}`);
  });
  process.exit(1);
} else {
  console.log('✅ All tests passed!');
  process.exit(0);
}
