/**
 * Tests for Shared Image Matrix Utilities (E7.0.2 Hardening)
 */

import {
  normalizeEnvironment,
  computeImageTag,
  generateAllTags,
  getDeployImages,
  shouldIncludeImage,
  parseImageUri,
  type ImageManifest,
  type ImageDefinition,
  type DeployEnvironment
} from '../lib/image-matrix';

describe('Image Matrix Utilities', () => {
  const mockManifest: ImageManifest = {
    version: '1.0.0',
    metadata: {
      description: 'Test manifest',
      purpose: 'Testing'
    },
    images: [
      {
        id: 'test-image',
        name: 'afu9/test-image',
        dockerfile: 'test/Dockerfile',
        context: 'test',
        required: true,
        taskDefContainerName: 'test-container'
      },
      {
        id: 'optional-image',
        name: 'afu9/optional-image',
        dockerfile: 'optional/Dockerfile',
        context: 'optional',
        required: false,
        taskDefContainerName: 'optional-container',
        conditionalOn: {
          environments: ['production']
        }
      }
    ],
    ecrRepositories: ['afu9/test-image', 'afu9/optional-image'],
    tagging: {
      strategy: 'git-sha',
      prefixes: {
        production: 'prod',
        staging: 'stage'
      },
      alwaysTag: [
        '{prefix}-{full_sha}',
        '{prefix}-{short_sha}',
        '{prefix}-latest'
      ]
    }
  };

  describe('normalizeEnvironment', () => {
    it('should normalize "production" to production', () => {
      expect(normalizeEnvironment('production')).toBe('production');
    });

    it('should normalize "prod" to production', () => {
      expect(normalizeEnvironment('prod')).toBe('production');
    });

    it('should normalize "PRODUCTION" to production', () => {
      expect(normalizeEnvironment('PRODUCTION')).toBe('production');
    });

    it('should normalize "staging" to staging', () => {
      expect(normalizeEnvironment('staging')).toBe('staging');
    });

    it('should normalize "stage" to staging', () => {
      expect(normalizeEnvironment('stage')).toBe('staging');
    });

    it('should normalize "STAGING" to staging', () => {
      expect(normalizeEnvironment('STAGING')).toBe('staging');
    });

    it('should reject invalid environment names', () => {
      expect(() => normalizeEnvironment('development')).toThrow();
      expect(() => normalizeEnvironment('test')).toThrow();
      expect(() => normalizeEnvironment('')).toThrow();
    });
  });

  describe('computeImageTag', () => {
    const gitSha = 'abc1234567890def1234567890abcdef12345678';

    it('should compute production tag with full SHA', () => {
      const tag = computeImageTag(mockManifest, 'production', gitSha);
      expect(tag).toBe('prod-abc1234567890def1234567890abcdef12345678');
    });

    it('should compute staging tag with full SHA', () => {
      const tag = computeImageTag(mockManifest, 'staging', gitSha);
      expect(tag).toBe('stage-abc1234567890def1234567890abcdef12345678');
    });
  });

  describe('generateAllTags', () => {
    const gitSha = 'abc1234567890def1234567890abcdef12345678';

    it('should generate all tag variants for production', () => {
      const tags = generateAllTags(mockManifest, 'production', gitSha);
      expect(tags).toHaveLength(3);
      expect(tags).toContain('prod-abc1234567890def1234567890abcdef12345678');
      expect(tags).toContain('prod-abc1234');
      expect(tags).toContain('prod-latest');
    });

    it('should generate all tag variants for staging', () => {
      const tags = generateAllTags(mockManifest, 'staging', gitSha);
      expect(tags).toHaveLength(3);
      expect(tags).toContain('stage-abc1234567890def1234567890abcdef12345678');
      expect(tags).toContain('stage-abc1234');
      expect(tags).toContain('stage-latest');
    });
  });

  describe('shouldIncludeImage', () => {
    const unconditionalImage: ImageDefinition = {
      id: 'always',
      name: 'afu9/always',
      dockerfile: 'always/Dockerfile',
      context: 'always',
      required: true,
      taskDefContainerName: 'always-container'
    };

    const prodOnlyImage: ImageDefinition = {
      id: 'prod-only',
      name: 'afu9/prod-only',
      dockerfile: 'prod/Dockerfile',
      context: 'prod',
      required: true,
      taskDefContainerName: 'prod-container',
      conditionalOn: {
        environments: ['production']
      }
    };

    it('should include unconditionally required images', () => {
      expect(shouldIncludeImage(unconditionalImage, 'production')).toBe(true);
      expect(shouldIncludeImage(unconditionalImage, 'staging')).toBe(true);
    });

    it('should include images only in their target environments', () => {
      expect(shouldIncludeImage(prodOnlyImage, 'production')).toBe(true);
      expect(shouldIncludeImage(prodOnlyImage, 'staging')).toBe(false);
    });

    it('should respect feature flags', () => {
      const featureImage: ImageDefinition = {
        id: 'feature',
        name: 'afu9/feature',
        dockerfile: 'feature/Dockerfile',
        context: 'feature',
        required: true,
        taskDefContainerName: 'feature-container',
        conditionalOn: {
          feature: 'enableDatabase'
        }
      };

      expect(shouldIncludeImage(featureImage, 'production', { enableDatabase: true })).toBe(true);
      expect(shouldIncludeImage(featureImage, 'production', { enableDatabase: false })).toBe(false);
      expect(shouldIncludeImage(featureImage, 'production', {})).toBe(false);
    });
  });

  describe('getDeployImages', () => {
    it('should return all unconditional images for production', () => {
      const images = getDeployImages(mockManifest, 'production');
      expect(images).toHaveLength(2);
      expect(images.map(img => img.id)).toContain('test-image');
      expect(images.map(img => img.id)).toContain('optional-image');
    });

    it('should filter out production-only images for staging', () => {
      const images = getDeployImages(mockManifest, 'staging');
      expect(images).toHaveLength(1);
      expect(images[0].id).toBe('test-image');
    });
  });

  describe('parseImageUri', () => {
    it('should parse valid ECR image URI', () => {
      const uri = '313095875771.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:prod-abc1234';
      const parsed = parseImageUri(uri);
      
      expect(parsed.registry).toBe('313095875771.dkr.ecr.eu-central-1.amazonaws.com');
      expect(parsed.repository).toBe('afu9/control-center');
      expect(parsed.tag).toBe('prod-abc1234');
    });

    it('should parse multi-part repository names', () => {
      const uri = '313095875771.dkr.ecr.eu-central-1.amazonaws.com/org/team/app:v1.0';
      const parsed = parseImageUri(uri);
      
      expect(parsed.repository).toBe('org/team/app');
      expect(parsed.tag).toBe('v1.0');
    });

    it('should throw on invalid URI format', () => {
      expect(() => parseImageUri('invalid')).toThrow('Invalid image URI format');
      expect(() => parseImageUri('no-tag-here')).toThrow('Invalid image URI format');
    });

    it('should throw on missing repository', () => {
      expect(() => parseImageUri('registry:tag')).toThrow('Invalid repository path');
    });
  });
});
