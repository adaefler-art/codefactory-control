#!/usr/bin/env ts-node

/**
 * Pre-Deploy Image Gate (E7.0.2)
 * 
 * Purpose: Pre-deployment check ensuring all images from the manifest are:
 *   1. Built and pushed to ECR
 *   2. ECR repositories exist and are accessible
 *   3. Images are tagged correctly for the target environment
 * 
 * This gate prevents "silent partial deploys" where TaskDef references images
 * that haven't been built or pushed.
 * 
 * Environment variables:
 *   DEPLOY_ENV - Required: "staging" or "production"
 *   GIT_SHA - Required: Full git commit SHA
 *   AWS_REGION - Optional: AWS region (default: eu-central-1)
 *   SKIP_IMAGE_GATE - Optional: Set to "true" to skip (NOT recommended)
 * 
 * Exit codes:
 *   0 - Gate passed (all images ready)
 *   1 - Gate failed (missing images or repos)
 *   2 - Usage error or missing env vars
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadManifest } from './validate-image-manifest';

// AWS SDK is optional - script can run in two modes:
// 1. With AWS SDK: actually check ECR repositories and images
// 2. Without AWS SDK: validate manifest structure only (for local dev)
let ecrClient: any = null;
try {
  const { ECRClient, DescribeRepositoriesCommand, DescribeImagesCommand } = require('@aws-sdk/client-ecr');
  const region = process.env.AWS_REGION || 'eu-central-1';
  ecrClient = new ECRClient({ region });
} catch (error) {
  console.warn('⚠️  AWS SDK not available - ECR checks will be skipped');
}

interface ImageRef {
  id: string;
  name: string;
  tags: string[];
  required: boolean;
}

function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ Missing required environment variable: ${name}`);
    process.exit(2);
  }
  return value;
}

function resolveTagPrefix(deployEnv: string): string {
  if (deployEnv === 'production') {
    return 'prod';
  } else if (deployEnv === 'staging') {
    return 'stage';
  } else {
    console.error(`❌ Invalid DEPLOY_ENV: ${deployEnv}. Must be "staging" or "production".`);
    process.exit(2);
  }
}

function generateTags(manifest: any, tagPrefix: string, gitSha: string): string[] {
  const shortSha = gitSha.substring(0, 7);
  
  return manifest.tagging.alwaysTag.map((pattern: string) => {
    return pattern
      .replace('{prefix}', tagPrefix)
      .replace('{full_sha}', gitSha)
      .replace('{short_sha}', shortSha);
  });
}

function buildImageReferences(manifest: any, deployEnv: string, gitSha: string): ImageRef[] {
  const tagPrefix = resolveTagPrefix(deployEnv);
  const tags = generateTags(manifest, tagPrefix, gitSha);

  return manifest.images
    .filter((img: any) => img.required)
    .map((img: any) => ({
      id: img.id,
      name: img.name,
      tags,
      required: img.required
    }));
}

async function checkEcrRepository(repoName: string): Promise<boolean> {
  if (!ecrClient) {
    console.log(`  ℹ️  Skipping ECR check for ${repoName} (AWS SDK not available)`);
    return true;
  }

  try {
    const { DescribeRepositoriesCommand } = require('@aws-sdk/client-ecr');
    const command = new DescribeRepositoriesCommand({
      repositoryNames: [repoName]
    });
    
    await ecrClient.send(command);
    return true;
  } catch (error: any) {
    if (error.name === 'RepositoryNotFoundException') {
      return false;
    }
    // Re-throw other errors (auth issues, network problems, etc.)
    throw error;
  }
}

async function checkImageExists(repoName: string, tag: string): Promise<boolean> {
  if (!ecrClient) {
    console.log(`  ℹ️  Skipping image check for ${repoName}:${tag} (AWS SDK not available)`);
    return true;
  }

  try {
    const { DescribeImagesCommand } = require('@aws-sdk/client-ecr');
    const command = new DescribeImagesCommand({
      repositoryName: repoName,
      imageIds: [{ imageTag: tag }]
    });
    
    const response = await ecrClient.send(command);
    return response.imageDetails && response.imageDetails.length > 0;
  } catch (error: any) {
    if (error.name === 'ImageNotFoundException') {
      return false;
    }
    // Re-throw other errors
    throw error;
  }
}

async function validateEcrRepositories(manifest: any): Promise<string[]> {
  const errors: string[] = [];

  console.log('🔍 Checking ECR repositories...');
  
  for (const repoName of manifest.ecrRepositories) {
    try {
      const exists = await checkEcrRepository(repoName);
      if (!exists) {
        errors.push(`ECR repository does not exist: ${repoName}`);
        console.error(`  ❌ Repository not found: ${repoName}`);
      } else {
        console.log(`  ✅ Repository exists: ${repoName}`);
      }
    } catch (error: any) {
      errors.push(`Failed to check ECR repository ${repoName}: ${error.message}`);
      console.error(`  ❌ Error checking ${repoName}: ${error.message}`);
    }
  }

  return errors;
}

async function validateImages(imageRefs: ImageRef[]): Promise<string[]> {
  const errors: string[] = [];

  console.log('\n🔍 Checking image availability in ECR...');
  
  // If ECR client is unavailable, fail for required images in CI
  if (!ecrClient) {
    console.warn('⚠️  AWS SDK for ECR not available');
    // In CI/CD environments, we should fail if ECR checks can't run
    if (process.env.CI || process.env.GITHUB_ACTIONS) {
      errors.push('ECR validation required in CI/CD but AWS SDK is not available');
      return errors;
    }
    console.warn('   Skipping ECR image checks (local development mode)');
    return errors;
  }
  
  for (const imageRef of imageRefs) {
    console.log(`\n  Image: ${imageRef.id} (${imageRef.name})`);
    
    let anyTagFound = false;
    for (const tag of imageRef.tags) {
      try {
        const exists = await checkImageExists(imageRef.name, tag);
        if (exists) {
          console.log(`    ✅ Tag found: ${tag}`);
          anyTagFound = true;
        } else {
          console.log(`    ⚠️  Tag not found: ${tag}`);
        }
      } catch (error: any) {
        console.error(`    ❌ Error checking tag ${tag}: ${error.message}`);
      }
    }

    // For required images, at least one tag must exist
    if (imageRef.required && !anyTagFound) {
      errors.push(`Required image ${imageRef.id} has no pushed tags: ${imageRef.tags.join(', ')}`);
      console.error(`  ❌ REQUIRED image missing: ${imageRef.id}`);
    }
  }

  return errors;
}

async function main() {
  console.log('🔒 Pre-Deploy Image Gate (E7.0.2)\n');

  // Check if gate should be skipped
  if (process.env.SKIP_IMAGE_GATE === 'true') {
    console.warn('⚠️  WARNING: Image gate is SKIPPED (SKIP_IMAGE_GATE=true)');
    console.warn('   This is NOT recommended for production deploys.\n');
    process.exit(0);
  }

  // Load required environment variables
  const deployEnv = getRequiredEnvVar('DEPLOY_ENV');
  const gitSha = getRequiredEnvVar('GIT_SHA');
  const region = process.env.AWS_REGION || 'eu-central-1';

  console.log('Environment:');
  console.log(`  DEPLOY_ENV: ${deployEnv}`);
  console.log(`  GIT_SHA: ${gitSha}`);
  console.log(`  AWS_REGION: ${region}`);
  console.log();

  // Load manifest
  const repoRoot = path.join(__dirname, '..');
  const manifestPath = path.join(repoRoot, 'images-manifest.json');
  
  console.log(`📋 Loading manifest: ${manifestPath}`);
  const manifest = loadManifest(manifestPath);
  console.log(`✓ Manifest loaded (version ${manifest.version})\n`);

  // Build image references
  const imageRefs = buildImageReferences(manifest, deployEnv, gitSha);
  
  console.log('📦 Required images for this deploy:');
  imageRefs.forEach(ref => {
    console.log(`  - ${ref.id} (${ref.name})`);
    console.log(`    Tags: ${ref.tags.join(', ')}`);
  });
  console.log();

  // Run validations
  const errors: string[] = [];

  try {
    // Validate ECR repositories exist
    const repoErrors = await validateEcrRepositories(manifest);
    errors.push(...repoErrors);

    // Validate images are pushed
    const imageErrors = await validateImages(imageRefs);
    errors.push(...imageErrors);

  } catch (error: any) {
    console.error(`\n❌ Unexpected error during validation: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  if (errors.length === 0) {
    console.log('✅ GATE PASSED - All images are ready for deployment');
    console.log('='.repeat(60));
    console.log('\nAll required images have been built and pushed.');
    console.log('Deployment is authorized to proceed.');
    process.exit(0);
  } else {
    console.log(`❌ GATE FAILED - ${errors.length} issue(s) detected`);
    console.log('='.repeat(60));
    console.log('\nIssues:');
    errors.forEach((err, idx) => {
      console.log(`  ${idx + 1}. ${err}`);
    });
    console.log('\nFix the issues above and ensure all images are built/pushed before deploying.');
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { buildImageReferences, resolveTagPrefix, generateTags };
