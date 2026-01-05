#!/usr/bin/env ts-node
/**
 * Deploy Context Guardrail (E7.0.1)
 * 
 * Enforces strict environment separation for deploys:
 * - Explicit DEPLOY_ENV required (no defaults, no implicit prod)
 * - Hard-fail if DEPLOY_ENV=prod uses any stage artifacts
 * - Hard-fail if DEPLOY_ENV=stage uses any prod-only artifacts
 * - Display target summary before deploy
 * 
 * Exit codes:
 *   0 - Guardrail passed
 *   1 - Validation error (cross-env artifact detected)
 *   2 - Usage error (missing DEPLOY_ENV)
 */

import { resolveDeployContext, DeployContext } from './deploy-context-resolver';

interface ArtifactRefs {
  secretArns: string[];
  secretNames: string[];
  imageRefs: string[];
  serviceNames: string[];
  envVars: Record<string, string>;
}

/**
 * Extracts artifact references from environment for validation
 */
function extractArtifactRefs(): ArtifactRefs {
  const refs: ArtifactRefs = {
    secretArns: [],
    secretNames: [],
    imageRefs: [],
    serviceNames: [],
    envVars: {},
  };

  // Extract from common environment variables
  const envVars = process.env;
  
  for (const [key, value] of Object.entries(envVars)) {
    if (!value) continue;

    // Collect secret ARNs
    if (key.includes('SECRET') && value.includes('arn:aws:secretsmanager')) {
      refs.secretArns.push(value);
    }

    // Collect secret names
    if (key.includes('SECRET') && !value.includes('arn:')) {
      refs.secretNames.push(value);
    }

    // Collect image references
    if (key.includes('IMAGE') || key.includes('ECR')) {
      refs.imageRefs.push(value);
    }

    // Collect service names
    if (key.includes('SERVICE') || key === 'ECS_SERVICE') {
      refs.serviceNames.push(value);
    }

    // Store relevant env vars for summary
    if (key.startsWith('AFU9_') || key.includes('DEPLOY') || key.includes('CREATE_STAGING')) {
      refs.envVars[key] = value;
    }
  }

  return refs;
}

/**
 * Validates that prod deploy doesn't use stage artifacts
 * Uses structured rules to avoid false positives
 */
function validateProdArtifacts(context: DeployContext, artifacts: ArtifactRefs): string[] {
  const violations: string[] = [];

  // Check secret ARNs/names for stage references
  // Look for explicit stage path segments, not substring matches
  for (const arn of artifacts.secretArns) {
    if (arn.match(/\/stage\//) || arn.match(/\/staging\//)) {
      violations.push(`Secret ARN contains stage reference: ${arn}`);
    }
  }

  for (const name of artifacts.secretNames) {
    if (name.match(/\/stage\//) || name.match(/\/staging\//)) {
      violations.push(`Secret name contains stage reference: ${name}`);
    }
  }

  // Check image references for stage tags
  // Match explicit tag patterns: :stage- or :staging-
  for (const image of artifacts.imageRefs) {
    if (image.match(/:stage-/) || image.match(/:staging-/)) {
      violations.push(`Image reference uses stage tag: ${image}`);
    }
  }

  // Check service names - must not contain "staging" as a word
  for (const service of artifacts.serviceNames) {
    if (service.match(/\bstaging\b/i)) {
      violations.push(`Service name contains "staging": ${service}`);
    }
  }

  // Check environment variables
  if (artifacts.envVars.CREATE_STAGING_SERVICE === 'true') {
    violations.push('CREATE_STAGING_SERVICE=true is not allowed for production deploys');
  }

  return violations;
}

/**
 * Validates that stage deploy doesn't use prod-only artifacts
 * Uses structured rules to avoid false positives
 */
function validateStageArtifacts(context: DeployContext, artifacts: ArtifactRefs): string[] {
  const violations: string[] = [];

  // Check service names - must include "staging" as a word for staging deploys
  for (const service of artifacts.serviceNames) {
    // Only validate if it looks like an AFU9 service name
    if (service && service.match(/afu9.*control-center/i) && !service.match(/\bstaging\b/i)) {
      violations.push(`Service name for staging deploy should include "staging": ${service}`);
    }
  }

  // Check image references - should not use prod tags
  // Match explicit tag pattern: :prod-
  for (const image of artifacts.imageRefs) {
    if (image.match(/:prod-/)) {
      violations.push(`Image reference uses prod tag in staging deploy: ${image}`);
    }
  }

  return violations;
}

/**
 * Displays target summary for verification
 * SECURITY: Only shows ARNs/names, never secret values
 */
function displayTargetSummary(context: DeployContext, artifacts: ArtifactRefs): void {
  console.log('\n========================================');
  console.log('DEPLOY CONTEXT GUARDRAIL - TARGET SUMMARY');
  console.log('========================================\n');

  console.log('Environment Configuration:');
  console.log(`  DEPLOY_ENV:           ${context.environment}`);
  console.log(`  ECS Cluster:          ${context.cluster}`);
  console.log(`  ECS Service:          ${context.service}`);
  console.log(`  Image Tag Prefix:     ${context.imageTagPrefix}`);
  console.log(`  Secrets Prefix:       ${context.secretsPrefix}`);
  console.log(`  Ready Host:           ${context.readyHost}`);
  console.log('');

  console.log('Detected Artifacts:');
  if (artifacts.secretArns.length > 0) {
    console.log(`  Secret ARNs:          ${artifacts.secretArns.join(', ')}`);
  }
  if (artifacts.secretNames.length > 0) {
    console.log(`  Secret Names:         ${artifacts.secretNames.join(', ')}`);
  }
  if (artifacts.imageRefs.length > 0) {
    console.log(`  Image References:     ${artifacts.imageRefs.join(', ')}`);
  }
  if (artifacts.serviceNames.length > 0) {
    console.log(`  Service Names:        ${artifacts.serviceNames.join(', ')}`);
  }
  console.log('');

  console.log('Feature Flags:');
  // Only show safe configuration flags, not secret values
  const safeEnvVars = Object.entries(artifacts.envVars).filter(([key]) => 
    !key.includes('SECRET') && !key.includes('TOKEN') && !key.includes('PASSWORD') && !key.includes('KEY')
  );
  for (const [key, value] of safeEnvVars) {
    console.log(`  ${key}: ${value}`);
  }
  console.log('');
}

/**
 * Check if production deployments are enabled
 * Returns true if ENABLE_PROD=true, false otherwise (fail-closed)
 */
function isProdEnabled(): boolean {
  const enableProd = process.env.ENABLE_PROD;
  return enableProd === 'true';
}

/**
 * Main guardrail execution
 */
function runGuardrail(): number {
  console.log('🔒 Deploy Context Guardrail - E7.0.1\n');

  let context: DeployContext;
  try {
    context = resolveDeployContext();
  } catch (err) {
    console.error(`❌ GUARDRAIL FAIL: ${(err as Error).message}`);
    return 2;
  }

  // Issue 3: Block production deploys when ENABLE_PROD=false (fail-closed)
  if (context.environment === 'production' && !isProdEnabled()) {
    console.error('❌ GUARDRAIL FAIL: Production deploys are currently disabled\n');
    console.error('Production environment is in cost-reduction mode (Issue 3).');
    console.error('All work should be done in staging environment only.\n');
    console.error('To re-enable production deploys:');
    console.error('  1. Set ENABLE_PROD=true environment variable');
    console.error('  2. Follow the re-enable procedure in docs/issues/ISSUE_3_PROD_DEACTIVATION.md\n');
    return 1;
  }

  const artifacts = extractArtifactRefs();
  displayTargetSummary(context, artifacts);

  let violations: string[] = [];

  if (context.environment === 'production') {
    console.log('🔍 Validating production deploy (checking for stage artifacts)...\n');
    violations = validateProdArtifacts(context, artifacts);
  } else {
    console.log('🔍 Validating staging deploy (checking for prod-only artifacts)...\n');
    violations = validateStageArtifacts(context, artifacts);
  }

  if (violations.length > 0) {
    console.error('❌ GUARDRAIL FAIL: Cross-environment artifact violations detected:\n');
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    console.error('');
    console.error('Deploy blocked to prevent cross-environment contamination.');
    console.error('Fix the violations above and retry.\n');
    return 1;
  }

  console.log('✅ GUARDRAIL PASS: All environment checks passed');
  console.log(`   Deploy to ${context.environment} is authorized.\n`);
  return 0;
}

// CLI entry point
if (require.main === module) {
  process.exit(runGuardrail());
}

export { runGuardrail, validateProdArtifacts, validateStageArtifacts, extractArtifactRefs, isProdEnabled };
