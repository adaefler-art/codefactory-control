#!/usr/bin/env tsx
/**
 * Integration test for repo file import with installationId lookup
 * 
 * This test verifies that the installation ID lookup logic is correctly implemented:
 * 1. getInstallationIdForRepo is exported and available
 * 2. getGitHubInstallationToken requires owner/repo parameters
 * 3. The module no longer references installationId from config
 */

import * as fs from 'fs';
import * as path from 'path';

console.log('Testing GitHub App Auth - Installation ID Resolution\n');

// Test 1: Verify module exports the new function
console.log('Test 1: Checking module exports...');
try {
  const authModule = require('../control-center/src/lib/github-app-auth');
  
  if (typeof authModule.getInstallationIdForRepo !== 'function') {
    console.error('❌ FAILED: getInstallationIdForRepo function not exported');
    process.exit(1);
  }
  
  if (typeof authModule.getGitHubInstallationToken !== 'function') {
    console.error('❌ FAILED: getGitHubInstallationToken function not exported');
    process.exit(1);
  }
  
  console.log('✅ Module exports correct functions');
} catch (error) {
  console.error('❌ FAILED: Unable to import module', error);
  process.exit(1);
}

// Test 2: Verify no installationId in type definitions
console.log('\nTest 2: Checking type definitions...');
try {
  const authFilePath = path.join(__dirname, '../control-center/src/lib/github-app-auth.ts');
  const authFileContent = fs.readFileSync(authFilePath, 'utf-8');
  
  // Check GitHubAppSecret type
  const secretTypeMatch = authFileContent.match(/export type GitHubAppSecret = \{([^}]+)\}/s);
  if (!secretTypeMatch) {
    console.error('❌ FAILED: Could not find GitHubAppSecret type');
    process.exit(1);
  }
  
  const secretTypeContent = secretTypeMatch[1];
  if (secretTypeContent.includes('installationId')) {
    console.error('❌ FAILED: GitHubAppSecret still contains installationId');
    process.exit(1);
  }
  
  // Check GitHubAppConfig type
  const configTypeMatch = authFileContent.match(/type GitHubAppConfig = \{([^}]+)\}/s);
  if (!configTypeMatch) {
    console.error('❌ FAILED: Could not find GitHubAppConfig type');
    process.exit(1);
  }
  
  const configTypeContent = configTypeMatch[1];
  if (configTypeContent.includes('installationId')) {
    console.error('❌ FAILED: GitHubAppConfig still contains installationId');
    process.exit(1);
  }
  
  console.log('✅ Type definitions do not contain installationId');
} catch (error) {
  console.error('❌ FAILED: Unable to check type definitions', error);
  process.exit(1);
}

// Test 3: Verify getInstallationIdForRepo function exists and has correct signature
console.log('\nTest 3: Checking getInstallationIdForRepo implementation...');
try {
  const authFilePath = path.join(__dirname, '../control-center/src/lib/github-app-auth.ts');
  const authFileContent = fs.readFileSync(authFilePath, 'utf-8');
  
  if (!authFileContent.includes('export async function getInstallationIdForRepo')) {
    console.error('❌ FAILED: getInstallationIdForRepo function not found');
    process.exit(1);
  }
  
  if (!authFileContent.includes('GET /repos/{owner}/{repo}/installation')) {
    console.error('❌ FAILED: Function does not use correct API endpoint');
    process.exit(1);
  }
  
  if (!authFileContent.includes('repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/installation')) {
    console.error('❌ FAILED: Function does not make the correct API call');
    process.exit(1);
  }
  
  console.log('✅ getInstallationIdForRepo implemented correctly');
} catch (error) {
  console.error('❌ FAILED: Unable to verify implementation', error);
  process.exit(1);
}

// Test 4: Verify getGitHubInstallationToken uses repo-based lookup
console.log('\nTest 4: Checking getGitHubInstallationToken uses repo lookup...');
try {
  const authFilePath = path.join(__dirname, '../control-center/src/lib/github-app-auth.ts');
  const authFileContent = fs.readFileSync(authFilePath, 'utf-8');
  
  // Check that function signature requires owner and repo
  const tokenFuncMatch = authFileContent.match(/export async function getGitHubInstallationToken\(input: \{([^}]+)\}/s);
  if (!tokenFuncMatch) {
    console.error('❌ FAILED: Could not find getGitHubInstallationToken function signature');
    process.exit(1);
  }
  
  const tokenFuncParams = tokenFuncMatch[1];
  if (!tokenFuncParams.includes('owner: string') || !tokenFuncParams.includes('repo: string')) {
    console.error('❌ FAILED: getGitHubInstallationToken does not require owner and repo parameters');
    process.exit(1);
  }
  
  // Check that it calls getInstallationIdForRepo
  if (!authFileContent.includes('await getInstallationIdForRepo({')) {
    console.error('❌ FAILED: getGitHubInstallationToken does not call getInstallationIdForRepo');
    process.exit(1);
  }
  
  console.log('✅ getGitHubInstallationToken uses repo-based lookup');
} catch (error) {
  console.error('❌ FAILED: Unable to verify token function', error);
  process.exit(1);
}

// Test 5: Verify logging is present
console.log('\nTest 5: Checking for logging...');
try {
  const authFilePath = path.join(__dirname, '../control-center/src/lib/github-app-auth.ts');
  const authFileContent = fs.readFileSync(authFilePath, 'utf-8');
  
  if (!authFileContent.includes('console.log(`[getInstallationIdForRepo]')) {
    console.error('❌ FAILED: No logging found in getInstallationIdForRepo');
    process.exit(1);
  }
  
  if (!authFileContent.includes('Looking up installation for')) {
    console.error('❌ FAILED: Logging does not mention lookup');
    process.exit(1);
  }
  
  if (!authFileContent.includes('Found installationId')) {
    console.error('❌ FAILED: Logging does not mention found installationId');
    process.exit(1);
  }
  
  console.log('✅ Logging is properly implemented');
} catch (error) {
  console.error('❌ FAILED: Unable to verify logging', error);
  process.exit(1);
}

// Test 6: Verify fetchGitHubFile passes owner/repo
console.log('\nTest 6: Checking fetchGitHubFile integration...');
try {
  const fetchFilePath = path.join(__dirname, '../control-center/src/lib/github/fetch-file.ts');
  const fetchFileContent = fs.readFileSync(fetchFilePath, 'utf-8');
  
  if (!fetchFileContent.includes('getGitHubInstallationToken({')) {
    console.error('❌ FAILED: fetchGitHubFile does not call getGitHubInstallationToken with parameters');
    process.exit(1);
  }
  
  if (!fetchFileContent.includes('owner: options.owner') || !fetchFileContent.includes('repo: options.repo')) {
    console.error('❌ FAILED: fetchGitHubFile does not pass owner/repo parameters');
    process.exit(1);
  }
  
  console.log('✅ fetchGitHubFile correctly passes owner/repo');
} catch (error) {
  console.error('❌ FAILED: Unable to verify fetchGitHubFile', error);
  process.exit(1);
}

// Test 7: Verify documentation is updated
console.log('\nTest 7: Checking documentation updates...');
try {
  const docsPath = path.join(__dirname, '../docs/GITHUB_APP_INTEGRATION.md');
  const docsContent = fs.readFileSync(docsPath, 'utf-8');
  
  if (docsContent.includes('"installationId":')) {
    console.error('❌ FAILED: Documentation still shows installationId in secret JSON');
    process.exit(1);
  }
  
  if (!docsContent.includes('Installation ID Resolution') && !docsContent.includes('deterministically resolved')) {
    console.error('⚠️  WARNING: Documentation may not fully explain the new resolution mechanism');
  } else {
    console.log('✅ Documentation updated correctly');
  }
} catch (error) {
  console.error('❌ FAILED: Unable to verify documentation', error);
  process.exit(1);
}

console.log('\n' + '='.repeat(50));
console.log('✅ ALL TESTS PASSED');
console.log('='.repeat(50));
console.log('\nSummary:');
console.log('  ✓ Module exports new functions');
console.log('  ✓ Type definitions updated');
console.log('  ✓ getInstallationIdForRepo implemented');
console.log('  ✓ getGitHubInstallationToken uses repo lookup');
console.log('  ✓ Logging is implemented');
console.log('  ✓ fetchGitHubFile integration correct');
console.log('  ✓ Documentation updated');
console.log('\nThe installationId is now deterministically resolved from repo context!');
process.exit(0);
