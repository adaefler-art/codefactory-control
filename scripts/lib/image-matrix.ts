/**
 * Shared Image Matrix Utilities (E7.0.2 Hardening)
 * 
 * Single source of truth for tag computation, environment normalization,
 * and image reference generation. Used by:
 * - Pre-deploy gate
 * - Post-deploy verification
 * - Workflow (via exported functions)
 * - CDK (future: if TaskDef generation moves to code)
 */

export type DeployEnvironment = 'production' | 'staging';

export interface ImageManifest {
  version: string;
  metadata: {
    description: string;
    purpose: string;
  };
  images: ImageDefinition[];
  ecrRepositories: string[];
  tagging: TaggingStrategy;
}

export interface ImageDefinition {
  id: string;
  name: string;
  dockerfile: string;
  context: string;
  buildArgs?: string[];
  required: boolean;
  taskDefContainerName: string;
  healthCheck?: string;
  conditionalOn?: {
    environments?: DeployEnvironment[];
    feature?: string;
  };
}

export interface TaggingStrategy {
  strategy: string;
  prefixes: {
    production: string;
    staging: string;
  };
  alwaysTag: string[];
}

export interface ImageReference {
  id: string;
  name: string;
  tag: string;
  fullUri?: string;
}

/**
 * Normalize environment input to canonical value.
 * Accepts common aliases to avoid brittle exact-string matching.
 */
export function normalizeEnvironment(input: string): DeployEnvironment {
  const normalized = input.toLowerCase().trim();
  
  // Production aliases
  if (normalized === 'production' || normalized === 'prod') {
    return 'production';
  }
  
  // Staging aliases
  if (normalized === 'staging' || normalized === 'stage') {
    return 'staging';
  }
  
  throw new Error(
    `Invalid DEPLOY_ENV: "${input}". Must be one of: production, prod, staging, stage`
  );
}

/**
 * Get tag prefix for environment from manifest.
 */
export function getTagPrefix(manifest: ImageManifest, env: DeployEnvironment): string {
  return manifest.tagging.prefixes[env];
}

/**
 * Compute a single image tag for the given environment and git SHA.
 * Uses the full_sha pattern for primary tag (most specific).
 * 
 * For deterministic deployments, we use the full SHA tag as the primary reference.
 */
export function computeImageTag(
  manifest: ImageManifest,
  env: DeployEnvironment,
  gitSha: string
): string {
  const prefix = getTagPrefix(manifest, env);
  const shortSha = gitSha.substring(0, 7);
  
  // Use full_sha pattern for primary tag (most specific)
  let fullShaPattern: string | undefined;
  for (const pattern of manifest.tagging.alwaysTag) {
    if (pattern.indexOf('{full_sha}') !== -1) {
      fullShaPattern = pattern;
      break;
    }
  }
  
  if (!fullShaPattern) {
    throw new Error('Manifest must include a {full_sha} tag pattern');
  }
  
  return fullShaPattern
    .replace('{prefix}', prefix)
    .replace('{full_sha}', gitSha)
    .replace('{short_sha}', shortSha);
}

/**
 * Generate ALL tag variants for an image (full_sha, short_sha, latest).
 * Used by build step to tag images with multiple aliases.
 */
export function generateAllTags(
  manifest: ImageManifest,
  env: DeployEnvironment,
  gitSha: string
): string[] {
  const prefix = getTagPrefix(manifest, env);
  const shortSha = gitSha.substring(0, 7);
  
  return manifest.tagging.alwaysTag.map((pattern: string) => {
    return pattern
      .replace('{prefix}', prefix)
      .replace('{full_sha}', gitSha)
      .replace('{short_sha}', shortSha);
  });
}

/**
 * Build full image URI with registry, repository, and tag.
 */
export function buildImageUri(
  ecrRegistry: string,
  repositoryName: string,
  tag: string
): string {
  return `${ecrRegistry}/${repositoryName}:${tag}`;
}

/**
 * Get expected image reference for a specific image definition.
 * Returns the primary tag (full SHA) for deterministic verification.
 */
export function expectedImageRef(
  manifest: ImageManifest,
  imageDef: ImageDefinition,
  env: DeployEnvironment,
  gitSha: string
): ImageReference {
  const tag = computeImageTag(manifest, env, gitSha);
  
  return {
    id: imageDef.id,
    name: imageDef.name,
    tag,
  };
}

/**
 * Check if an image should be included in a deploy based on conditions.
 */
export function shouldIncludeImage(
  imageDef: ImageDefinition,
  env: DeployEnvironment,
  features?: Record<string, boolean>
): boolean {
  // Always include if unconditionally required
  if (imageDef.required && !imageDef.conditionalOn) {
    return true;
  }
  
  // Check environment condition
  if (imageDef.conditionalOn?.environments) {
    let envMatches = false;
    for (const allowedEnv of imageDef.conditionalOn.environments) {
      if (allowedEnv === env) {
        envMatches = true;
        break;
      }
    }
    if (!envMatches) {
      return false;
    }
  }
  
  // Check feature flag condition
  if (imageDef.conditionalOn?.feature && features) {
    return features[imageDef.conditionalOn.feature] === true;
  }
  
  // Include required images by default
  return imageDef.required;
}

/**
 * Get all images that should be included in a deploy.
 * Filters based on environment and feature flags.
 */
export function getDeployImages(
  manifest: ImageManifest,
  env: DeployEnvironment,
  features?: Record<string, boolean>
): ImageDefinition[] {
  return manifest.images.filter(img => shouldIncludeImage(img, env, features));
}

/**
 * Parse ECR image URI into components.
 * Format: account.dkr.ecr.region.amazonaws.com/repo-name:tag
 */
export function parseImageUri(imageUri: string): {
  registry: string;
  repository: string;
  tag: string;
} {
  const parts = imageUri.split(':');
  if (parts.length !== 2) {
    throw new Error(
      `Invalid image URI format: ${imageUri} (expected format: registry/repo:tag)`
    );
  }
  
  const tag = parts[1];
  const repoFullPath = parts[0];
  const repoParts = repoFullPath.split('/');
  
  if (repoParts.length < 2) {
    throw new Error(
      `Invalid repository path in image URI: ${imageUri} ` +
      `(expected format: registry/repo:tag, got ${repoParts.length} parts)`
    );
  }
  
  const registry = repoParts[0];
  const repository = repoParts.slice(1).join('/');
  
  if (!repository) {
    throw new Error(`Could not extract repository name from image URI: ${imageUri}`);
  }
  
  return { registry, repository, tag };
}
