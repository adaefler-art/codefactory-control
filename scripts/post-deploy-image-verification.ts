#!/usr/bin/env ts-node

/**
 * Post-Deploy Image Verification (E7.0.2)
 * 
 * Purpose: Verify that the running ECS task definition contains ONLY images
 * from the current deploy (no mixed/stale image references).
 * 
 * This prevents "silent partial deploys" where some containers run old images
 * while others run new images.
 * 
 * Environment variables:
 *   DEPLOY_ENV - Required: "staging" or "production"
 *   GIT_SHA - Required: Full git commit SHA
 *   ECS_CLUSTER - Required: ECS cluster name
 *   ECS_SERVICE - Required: ECS service name
 *   AWS_REGION - Optional: AWS region (default: eu-central-1)
 * 
 * Exit codes:
 *   0 - Verification passed (all images match deploy)
 *   1 - Verification failed (image mismatch detected)
 *   2 - Usage error or missing env vars
 */

import * as path from 'path';
import { loadManifest } from './validate-image-manifest';
import { resolveTagPrefix, generateTags } from './pre-deploy-image-gate';

// AWS SDK for ECS
let ecsClient: any = null;
try {
  const { ECSClient, DescribeServicesCommand, DescribeTaskDefinitionCommand } = require('@aws-sdk/client-ecs');
  const region = process.env.AWS_REGION || 'eu-central-1';
  ecsClient = new ECSClient({ region });
} catch (error) {
  console.error('❌ AWS SDK for ECS not available');
  console.error('   Install @aws-sdk/client-ecs to run this verification');
  process.exit(2);
}

interface ContainerImage {
  containerName: string;
  image: string;
  repository: string;
  tag: string;
}

function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ Missing required environment variable: ${name}`);
    process.exit(2);
  }
  return value;
}

function parseImageUri(imageUri: string): { repository: string; tag: string } {
  // Format: account.dkr.ecr.region.amazonaws.com/repo-name:tag
  const parts = imageUri.split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid image URI format: ${imageUri}`);
  }
  
  const tag = parts[1];
  const repoFullPath = parts[0];
  // Extract just the repo name (e.g., "afu9/control-center")
  const repoParts = repoFullPath.split('/');
  const repository = repoParts.slice(1).join('/'); // Skip ECR registry part
  
  return { repository, tag };
}

async function getCurrentTaskDefinition(cluster: string, service: string): Promise<any> {
  const { DescribeServicesCommand, DescribeTaskDefinitionCommand } = require('@aws-sdk/client-ecs');

  // Get current service to find task definition ARN
  console.log(`🔍 Fetching current task definition for service ${service}...`);
  
  const serviceCmd = new DescribeServicesCommand({
    cluster,
    services: [service]
  });
  
  const serviceResponse = await ecsClient.send(serviceCmd);
  
  if (!serviceResponse.services || serviceResponse.services.length === 0) {
    throw new Error(`Service not found: ${service} in cluster ${cluster}`);
  }
  
  const taskDefArn = serviceResponse.services[0].taskDefinition;
  if (!taskDefArn) {
    throw new Error(`No task definition found for service ${service}`);
  }
  
  console.log(`  Task Definition ARN: ${taskDefArn}`);
  
  // Get task definition details
  const taskDefCmd = new DescribeTaskDefinitionCommand({
    taskDefinition: taskDefArn
  });
  
  const taskDefResponse = await ecsClient.send(taskDefCmd);
  return taskDefResponse.taskDefinition;
}

function extractContainerImages(taskDef: any): ContainerImage[] {
  const images: ContainerImage[] = [];
  
  for (const container of taskDef.containerDefinitions || []) {
    const imageUri = container.image;
    const { repository, tag } = parseImageUri(imageUri);
    
    images.push({
      containerName: container.name,
      image: imageUri,
      repository,
      tag
    });
  }
  
  return images;
}

function validateImageTags(
  containerImages: ContainerImage[],
  manifest: any,
  expectedTags: string[]
): string[] {
  const errors: string[] = [];
  const expectedTagSet = new Set(expectedTags);

  console.log('\n🔍 Validating container images...\n');

  for (const containerImg of containerImages) {
    console.log(`  Container: ${containerImg.containerName}`);
    console.log(`    Image: ${containerImg.image}`);
    console.log(`    Repository: ${containerImg.repository}`);
    console.log(`    Tag: ${containerImg.tag}`);

    // Find corresponding image in manifest
    const manifestImage = manifest.images.find(
      (img: any) => img.taskDefContainerName === containerImg.containerName
    );

    if (!manifestImage) {
      console.warn(`    ⚠️  Warning: Container not found in manifest`);
      continue;
    }

    // Check if repository matches
    if (manifestImage.name !== containerImg.repository) {
      errors.push(
        `Container ${containerImg.containerName}: repository mismatch. ` +
        `Expected ${manifestImage.name}, got ${containerImg.repository}`
      );
      console.error(`    ❌ Repository mismatch`);
      continue;
    }

    // Check if tag is one of the expected tags
    if (!expectedTagSet.has(containerImg.tag)) {
      errors.push(
        `Container ${containerImg.containerName}: unexpected tag "${containerImg.tag}". ` +
        `Expected one of: ${expectedTags.join(', ')}`
      );
      console.error(`    ❌ Tag not in expected set`);
    } else {
      console.log(`    ✅ Tag matches expected set`);
    }
  }

  return errors;
}

async function main() {
  console.log('🔍 Post-Deploy Image Verification (E7.0.2)\n');

  // Load required environment variables
  const deployEnv = getRequiredEnvVar('DEPLOY_ENV');
  const gitSha = getRequiredEnvVar('GIT_SHA');
  const cluster = getRequiredEnvVar('ECS_CLUSTER');
  const service = getRequiredEnvVar('ECS_SERVICE');
  const region = process.env.AWS_REGION || 'eu-central-1';

  console.log('Environment:');
  console.log(`  DEPLOY_ENV: ${deployEnv}`);
  console.log(`  GIT_SHA: ${gitSha}`);
  console.log(`  ECS_CLUSTER: ${cluster}`);
  console.log(`  ECS_SERVICE: ${service}`);
  console.log(`  AWS_REGION: ${region}`);
  console.log();

  // Load manifest
  const repoRoot = path.join(__dirname, '..');
  const manifestPath = path.join(repoRoot, 'images-manifest.json');
  
  console.log(`📋 Loading manifest: ${manifestPath}`);
  const manifest = loadManifest(manifestPath);
  console.log(`✓ Manifest loaded (version ${manifest.version})\n`);

  // Generate expected tags for this deploy
  const tagPrefix = resolveTagPrefix(deployEnv);
  const expectedTags = generateTags(manifest, tagPrefix, gitSha);
  
  console.log('📦 Expected image tags for this deploy:');
  expectedTags.forEach(tag => console.log(`  - ${tag}`));
  console.log();

  try {
    // Get current task definition from ECS
    const taskDef = await getCurrentTaskDefinition(cluster, service);
    console.log(`✓ Task definition retrieved\n`);

    // Extract container images
    const containerImages = extractContainerImages(taskDef);
    console.log('📦 Container images in running task definition:');
    containerImages.forEach(img => {
      console.log(`  - ${img.containerName}: ${img.repository}:${img.tag}`);
    });

    // Validate images match expected tags
    const errors = validateImageTags(containerImages, manifest, expectedTags);

    // Summary
    console.log('\n' + '='.repeat(60));
    if (errors.length === 0) {
      console.log('✅ VERIFICATION PASSED - All images match current deploy');
      console.log('='.repeat(60));
      console.log('\nRunning task definition uses only images from this deploy.');
      console.log('No stale or mixed image references detected.');
      process.exit(0);
    } else {
      console.log(`❌ VERIFICATION FAILED - ${errors.length} issue(s) detected`);
      console.log('='.repeat(60));
      console.log('\nIssues:');
      errors.forEach((err, idx) => {
        console.log(`  ${idx + 1}. ${err}`);
      });
      console.log('\nThe running task definition contains images that do not match this deploy.');
      console.log('This may indicate a partial deploy or deployment rollback.');
      process.exit(1);
    }

  } catch (error: any) {
    console.error(`\n❌ Verification error: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { parseImageUri, extractContainerImages, validateImageTags };
