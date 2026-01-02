#!/usr/bin/env ts-node

/**
 * Image Manifest Validator (E7.0.2)
 * 
 * Purpose: Validate that the images-manifest.json is complete, consistent,
 * and matches the actual repository structure.
 * 
 * Exit codes:
 *   0 - Manifest is valid
 *   1 - Validation failed
 *   2 - Usage error or file not found
 */

import * as fs from 'fs';
import * as path from 'path';

interface ImageManifest {
  version: string;
  metadata: {
    description: string;
    purpose: string;
  };
  images: Array<{
    id: string;
    name: string;
    dockerfile: string;
    context: string;
    buildArgs?: string[];
    required: boolean;
    taskDefContainerName: string;
    healthCheck?: string;
  }>;
  ecrRepositories: string[];
  tagging: {
    strategy: string;
    prefixes: {
      production: string;
      staging: string;
    };
    alwaysTag: string[];
  };
}

function loadManifest(manifestPath: string): ImageManifest {
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Manifest file not found: ${manifestPath}`);
    process.exit(2);
  }

  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(content);
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`❌ Failed to parse manifest: ${err.message}`);
    process.exit(2);
  }
}

function validateManifestStructure(manifest: ImageManifest): string[] {
  const errors: string[] = [];

  // Check required top-level fields
  if (!manifest.version || typeof manifest.version !== 'string') {
    errors.push('Missing or invalid "version" field');
  }

  if (!manifest.metadata) {
    errors.push('Missing "metadata" field');
  }

  if (!manifest.images || !Array.isArray(manifest.images)) {
    errors.push('Missing or invalid "images" field (must be array)');
  } else if (manifest.images.length === 0) {
    errors.push('Images array is empty');
  }

  if (!manifest.ecrRepositories || !Array.isArray(manifest.ecrRepositories)) {
    errors.push('Missing or invalid "ecrRepositories" field (must be array)');
  }

  if (!manifest.tagging) {
    errors.push('Missing "tagging" field');
  }

  return errors;
}

function validateImages(manifest: ImageManifest, repoRoot: string): string[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  for (const image of manifest.images) {
    // Check for duplicate IDs
    if (seenIds.has(image.id)) {
      errors.push(`Duplicate image ID: ${image.id}`);
    }
    seenIds.add(image.id);

    // Check for duplicate names
    if (seenNames.has(image.name)) {
      errors.push(`Duplicate image name: ${image.name}`);
    }
    seenNames.add(image.name);

    // Validate required fields
    if (!image.id || typeof image.id !== 'string') {
      errors.push(`Image missing or invalid "id" field`);
    }

    if (!image.name || typeof image.name !== 'string') {
      errors.push(`Image ${image.id || '(unknown)'}: missing or invalid "name" field`);
    }

    if (!image.dockerfile || typeof image.dockerfile !== 'string') {
      errors.push(`Image ${image.id}: missing or invalid "dockerfile" field`);
    } else {
      // Check if Dockerfile exists
      const dockerfilePath = path.join(repoRoot, image.dockerfile);
      if (!fs.existsSync(dockerfilePath)) {
        errors.push(`Image ${image.id}: Dockerfile not found at ${image.dockerfile}`);
      }
    }

    if (!image.context || typeof image.context !== 'string') {
      errors.push(`Image ${image.id}: missing or invalid "context" field`);
    } else {
      // Check if context directory exists
      const contextPath = path.join(repoRoot, image.context);
      if (!fs.existsSync(contextPath)) {
        errors.push(`Image ${image.id}: context directory not found at ${image.context}`);
      }
    }

    if (typeof image.required !== 'boolean') {
      errors.push(`Image ${image.id}: missing or invalid "required" field (must be boolean)`);
    }

    if (!image.taskDefContainerName || typeof image.taskDefContainerName !== 'string') {
      errors.push(`Image ${image.id}: missing or invalid "taskDefContainerName" field`);
    }
  }

  return errors;
}

function validateEcrRepositories(manifest: ImageManifest): string[] {
  const errors: string[] = [];

  // Check that all image names have corresponding ECR repositories
  const imageNames = new Set(manifest.images.map(img => img.name));
  const ecrRepos = new Set(manifest.ecrRepositories);

  for (const imageName of imageNames) {
    if (!ecrRepos.has(imageName)) {
      errors.push(`Image ${imageName} has no corresponding ECR repository in ecrRepositories list`);
    }
  }

  // Check for ECR repositories without images (warning, not error)
  for (const repo of manifest.ecrRepositories) {
    if (!imageNames.has(repo)) {
      console.warn(`⚠️  Warning: ECR repository ${repo} has no corresponding image definition`);
    }
  }

  return errors;
}

function validateTagging(manifest: ImageManifest): string[] {
  const errors: string[] = [];

  if (!manifest.tagging.strategy) {
    errors.push('Missing tagging.strategy field');
  }

  if (!manifest.tagging.prefixes) {
    errors.push('Missing tagging.prefixes field');
  } else {
    if (!manifest.tagging.prefixes.production) {
      errors.push('Missing tagging.prefixes.production field');
    }
    if (!manifest.tagging.prefixes.staging) {
      errors.push('Missing tagging.prefixes.staging field');
    }
  }

  if (!manifest.tagging.alwaysTag || !Array.isArray(manifest.tagging.alwaysTag)) {
    errors.push('Missing or invalid tagging.alwaysTag field (must be array)');
  } else if (manifest.tagging.alwaysTag.length === 0) {
    errors.push('tagging.alwaysTag array is empty');
  }

  return errors;
}

function main() {
  console.log('🔍 Image Manifest Validator (E7.0.2)\n');

  // Determine repo root (script is in scripts/, manifest is at repo root)
  const repoRoot = path.join(__dirname, '..');
  const manifestPath = path.join(repoRoot, 'images-manifest.json');

  console.log(`📋 Loading manifest: ${manifestPath}`);
  const manifest = loadManifest(manifestPath);

  console.log(`✓ Manifest loaded (version ${manifest.version})`);
  console.log(`✓ Contains ${manifest.images.length} image(s)\n`);

  // Run validations
  let allErrors: string[] = [];

  console.log('🔍 Validating manifest structure...');
  const structureErrors = validateManifestStructure(manifest);
  allErrors = allErrors.concat(structureErrors);
  if (structureErrors.length === 0) {
    console.log('  ✅ Structure valid');
  } else {
    console.error('  ❌ Structure validation failed');
    structureErrors.forEach(err => console.error(`    - ${err}`));
  }

  console.log('\n🔍 Validating image definitions...');
  const imageErrors = validateImages(manifest, repoRoot);
  allErrors = allErrors.concat(imageErrors);
  if (imageErrors.length === 0) {
    console.log('  ✅ All image definitions valid');
  } else {
    console.error('  ❌ Image validation failed');
    imageErrors.forEach(err => console.error(`    - ${err}`));
  }

  console.log('\n🔍 Validating ECR repositories...');
  const ecrErrors = validateEcrRepositories(manifest);
  allErrors = allErrors.concat(ecrErrors);
  if (ecrErrors.length === 0) {
    console.log('  ✅ ECR repositories consistent');
  } else {
    console.error('  ❌ ECR validation failed');
    ecrErrors.forEach(err => console.error(`    - ${err}`));
  }

  console.log('\n🔍 Validating tagging configuration...');
  const taggingErrors = validateTagging(manifest);
  allErrors = allErrors.concat(taggingErrors);
  if (taggingErrors.length === 0) {
    console.log('  ✅ Tagging configuration valid');
  } else {
    console.error('  ❌ Tagging validation failed');
    taggingErrors.forEach(err => console.error(`    - ${err}`));
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  if (allErrors.length === 0) {
    console.log('✅ VALIDATION PASSED - Manifest is complete and consistent');
    console.log('='.repeat(60));
    
    // Display summary
    console.log('\nManifest Summary:');
    console.log(`  Version: ${manifest.version}`);
    console.log(`  Images: ${manifest.images.length}`);
    manifest.images.forEach(img => {
      console.log(`    - ${img.id} (${img.name}) ${img.required ? '[REQUIRED]' : '[OPTIONAL]'}`);
    });
    console.log(`  ECR Repositories: ${manifest.ecrRepositories.length}`);
    console.log(`  Tagging Strategy: ${manifest.tagging.strategy}`);
    
    process.exit(0);
  } else {
    console.log(`❌ VALIDATION FAILED - ${allErrors.length} error(s) found`);
    console.log('='.repeat(60));
    console.log('\nFix the errors above and re-run validation.');
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { loadManifest, validateManifestStructure, validateImages, validateEcrRepositories, validateTagging };
