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
 */
function validateProdArtifacts(context: DeployContext, artifacts: ArtifactRefs): string[] {
  const violations: string[] = [];

  // Check secret ARNs/names for stage references
  for (const arn of artifacts.secretArns) {
    if (arn.includes('/stage/') || arn.includes('staging')) {
      violations.push(`Secret ARN contains stage reference: ${arn}`);
    }
  }

  for (const name of artifacts.secretNames) {
    if (name.includes('/stage/') || name.includes('staging')) {
      violations.push(`Secret name contains stage reference: ${name}`);
    }
  }

  // Check image references for stage tags
  for (const image of artifacts.imageRefs) {
    if (image.includes(':stage-') || image.includes(':staging-')) {
      violations.push(`Image reference uses stage tag: ${image}`);
    }
  }

  // Check service names
  for (const service of artifacts.serviceNames) {
    if (service.includes('staging')) {
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
 */
function validateStageArtifacts(context: DeployContext, artifacts: ArtifactRefs): string[] {
  const violations: string[] = [];

  // Check service names - must include "staging"
  for (const service of artifacts.serviceNames) {
    if (service && !service.includes('staging') && service.includes('afu9')) {
      violations.push(`Service name for staging deploy should include "staging": ${service}`);
    }
  }

  // Check image references - should not use prod tags
  for (const image of artifacts.imageRefs) {
    if (image.includes(':prod-')) {
      violations.push(`Image reference uses prod tag in staging deploy: ${image}`);
    }
  }

  return violations;
}

/**
 * Displays target summary for verification
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
  for (const [key, value] of Object.entries(artifacts.envVars)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log('');
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

export { runGuardrail, validateProdArtifacts, validateStageArtifacts, extractArtifactRefs };
