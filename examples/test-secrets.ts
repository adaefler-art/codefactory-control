#!/usr/bin/env node
/**
 * Example: Testing Secret Management
 * 
 * This script demonstrates how to use the secret management helper library.
 * It loads secrets from AWS Secrets Manager (in production) or environment variables (locally).
 * 
 * Usage:
 *   # With environment variables (local development)
 *   GITHUB_TOKEN=ghp_xxx GITHUB_OWNER=org GITHUB_REPO=repo node -r ts-node/register examples/test-secrets.ts
 * 
 *   # With AWS Secrets Manager (production)
 *   AWS_REGION=eu-central-1 node -r ts-node/register examples/test-secrets.ts
 */

import {
  getGithubSecrets,
  getLlmSecrets,
  getDatabaseSecrets,
  isAwsEnvironment,
  getSecretStrategy,
  validateSecretFields,
  clearSecretCache,
} from '../lib/utils/secrets';

async function main() {
  console.log('='.repeat(60));
  console.log('AFU-9 Secret Management Test');
  console.log('='.repeat(60));
  console.log();

  // Display environment info
  console.log('Environment Information:');
  console.log(`  Node Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  AWS Environment: ${isAwsEnvironment() ? 'Yes' : 'No'}`);
  console.log(`  Secret Strategy: ${getSecretStrategy()}`);
  console.log(`  AWS Region: ${process.env.AWS_REGION || 'not set'}`);
  console.log();

  // Test 1: GitHub Secrets
  console.log('1. Testing GitHub Secrets...');
  try {
    const githubSecrets = await getGithubSecrets();
    console.log('   ✅ GitHub secrets loaded successfully');
    console.log(`   - Owner: ${githubSecrets.owner}`);
    console.log(`   - Repo: ${githubSecrets.repo}`);
    console.log(`   - Token: ${githubSecrets.token ? 'ghp_***' + githubSecrets.token.slice(-4) : 'not set'}`);
    
    // Validate required fields
    validateSecretFields(githubSecrets, ['token', 'owner', 'repo'], 'afu9-github');
    console.log('   ✅ All required fields validated');
  } catch (error) {
    console.error('   ❌ Failed to load GitHub secrets:', error instanceof Error ? error.message : String(error));
  }
  console.log();

  // Test 2: LLM Secrets
  console.log('2. Testing LLM Secrets...');
  try {
    const llmSecrets = await getLlmSecrets();
    console.log('   ✅ LLM secrets loaded successfully');
    
    // Check which providers are configured
    const providers: string[] = [];
    if (llmSecrets.openai_api_key) {
      providers.push('OpenAI');
      console.log(`   - OpenAI API Key: sk-***${llmSecrets.openai_api_key.slice(-4)}`);
    }
    if (llmSecrets.anthropic_api_key) {
      providers.push('Anthropic');
      console.log(`   - Anthropic API Key: sk-ant-***${llmSecrets.anthropic_api_key.slice(-4)}`);
    }
    if (llmSecrets.deepseek_api_key) {
      providers.push('DeepSeek');
      console.log(`   - DeepSeek API Key: sk-***${llmSecrets.deepseek_api_key.slice(-4)}`);
    }

    if (providers.length > 0) {
      console.log(`   ✅ Configured providers: ${providers.join(', ')}`);
    } else {
      console.log('   ⚠️  No LLM providers configured');
    }
  } catch (error) {
    console.error('   ❌ Failed to load LLM secrets:', error instanceof Error ? error.message : String(error));
  }
  console.log();

  // Test 3: Database Secrets
  console.log('3. Testing Database Secrets...');
  try {
    const dbSecrets = await getDatabaseSecrets();
    console.log('   ✅ Database secrets loaded successfully');
    console.log(`   - Host: ${dbSecrets.host}`);
    console.log(`   - Port: ${dbSecrets.port}`);
    console.log(`   - Database: ${dbSecrets.database}`);
    console.log(`   - Username: ${dbSecrets.username}`);
    console.log(`   - Password: ***${dbSecrets.password.slice(-4)}`);
    
    // Validate required fields
    validateSecretFields(dbSecrets, ['host', 'port', 'database', 'username', 'password'], 'afu9-database');
    console.log('   ✅ All required fields validated');
  } catch (error) {
    console.error('   ❌ Failed to load database secrets:', error instanceof Error ? error.message : String(error));
  }
  console.log();

  // Test 4: Caching
  console.log('4. Testing Secret Caching...');
  try {
    console.log('   Loading GitHub secrets (should be cached)...');
    const start = Date.now();
    const githubSecrets = await getGithubSecrets();
    const elapsed = Date.now() - start;
    console.log(`   ✅ Loaded in ${elapsed}ms (cached: ${elapsed < 100})`);
    
    // Clear cache and reload
    console.log('   Clearing cache...');
    clearSecretCache();
    console.log('   ✅ Cache cleared');
    
    console.log('   Loading GitHub secrets again (should reload from source)...');
    const start2 = Date.now();
    await getGithubSecrets();
    const elapsed2 = Date.now() - start2;
    console.log(`   ✅ Loaded in ${elapsed2}ms`);
  } catch (error) {
    console.error('   ❌ Cache test failed:', error instanceof Error ? error.message : String(error));
  }
  console.log();

  // Test 5: Custom Options
  console.log('5. Testing Custom Options...');
  try {
    // Test with custom cache TTL
    const githubSecrets = await getGithubSecrets({ cacheTtlMs: 60000 });
    console.log('   ✅ Loaded with custom cache TTL (60 seconds)');
    
    // Test with caching disabled
    const llmSecrets = await getLlmSecrets({ cacheTtlMs: 0 });
    console.log('   ✅ Loaded with caching disabled');
  } catch (error) {
    console.error('   ❌ Custom options test failed:', error instanceof Error ? error.message : String(error));
  }
  console.log();

  console.log('='.repeat(60));
  console.log('Secret Management Test Complete');
  console.log('='.repeat(60));
}

// Run the test
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
