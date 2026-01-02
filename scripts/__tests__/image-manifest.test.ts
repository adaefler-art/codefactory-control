/**
 * Tests for Image Manifest Validation (E7.0.2)
 */

import * as path from 'path';
import {
  loadManifest,
  validateManifestStructure,
  validateImages,
  validateEcrRepositories,
  validateTagging
} from '../validate-image-manifest';

describe('Image Manifest Validation', () => {
  const repoRoot = path.join(__dirname, '../..');
  const manifestPath = path.join(repoRoot, 'images-manifest.json');

  describe('loadManifest', () => {
    it('should load the manifest successfully', () => {
      const manifest = loadManifest(manifestPath);
      expect(manifest).toBeDefined();
      expect(manifest.version).toBeDefined();
      expect(manifest.images).toBeDefined();
    });

    it('should have correct version format', () => {
      const manifest = loadManifest(manifestPath);
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('validateManifestStructure', () => {
    it('should validate structure without errors', () => {
      const manifest = loadManifest(manifestPath);
      const errors = validateManifestStructure(manifest);
      expect(errors).toEqual([]);
    });

    it('should detect missing version', () => {
      const invalidManifest: any = {
        metadata: {},
        images: [],
        ecrRepositories: [],
        tagging: {}
      };
      const errors = validateManifestStructure(invalidManifest);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('version'))).toBe(true);
    });

    it('should detect missing images array', () => {
      const invalidManifest: any = {
        version: '1.0.0',
        metadata: {},
        ecrRepositories: [],
        tagging: {}
      };
      const errors = validateManifestStructure(invalidManifest);
      expect(errors.some(e => e.includes('images'))).toBe(true);
    });
  });

  describe('validateImages', () => {
    it('should validate all images without errors', () => {
      const manifest = loadManifest(manifestPath);
      const errors = validateImages(manifest, repoRoot);
      expect(errors).toEqual([]);
    });

    it('should check that all Dockerfiles exist', () => {
      const manifest = loadManifest(manifestPath);
      for (const image of manifest.images) {
        const dockerfilePath = path.join(repoRoot, image.dockerfile);
        const fs = require('fs');
        expect(fs.existsSync(dockerfilePath)).toBe(true);
      }
    });

    it('should check that all context directories exist', () => {
      const manifest = loadManifest(manifestPath);
      for (const image of manifest.images) {
        const contextPath = path.join(repoRoot, image.context);
        const fs = require('fs');
        expect(fs.existsSync(contextPath)).toBe(true);
      }
    });

    it('should validate required field types', () => {
      const manifest = loadManifest(manifestPath);
      for (const image of manifest.images) {
        expect(typeof image.id).toBe('string');
        expect(typeof image.name).toBe('string');
        expect(typeof image.dockerfile).toBe('string');
        expect(typeof image.context).toBe('string');
        expect(typeof image.required).toBe('boolean');
        expect(typeof image.taskDefContainerName).toBe('string');
      }
    });
  });

  describe('validateEcrRepositories', () => {
    it('should validate ECR repositories without errors', () => {
      const manifest = loadManifest(manifestPath);
      const errors = validateEcrRepositories(manifest);
      expect(errors).toEqual([]);
    });

    it('should ensure all images have ECR repositories', () => {
      const manifest = loadManifest(manifestPath);
      const imageNames = manifest.images.map(img => img.name);
      const ecrRepos = manifest.ecrRepositories;
      
      for (const imageName of imageNames) {
        expect(ecrRepos).toContain(imageName);
      }
    });
  });

  describe('validateTagging', () => {
    it('should validate tagging configuration without errors', () => {
      const manifest = loadManifest(manifestPath);
      const errors = validateTagging(manifest);
      expect(errors).toEqual([]);
    });

    it('should have required tagging fields', () => {
      const manifest = loadManifest(manifestPath);
      expect(manifest.tagging.strategy).toBeDefined();
      expect(manifest.tagging.prefixes).toBeDefined();
      expect(manifest.tagging.prefixes.production).toBeDefined();
      expect(manifest.tagging.prefixes.staging).toBeDefined();
      expect(manifest.tagging.alwaysTag).toBeDefined();
      expect(Array.isArray(manifest.tagging.alwaysTag)).toBe(true);
    });

    it('should have at least one tag pattern', () => {
      const manifest = loadManifest(manifestPath);
      expect(manifest.tagging.alwaysTag.length).toBeGreaterThan(0);
    });
  });

  describe('Manifest Content', () => {
    it('should define exactly 4 images', () => {
      const manifest = loadManifest(manifestPath);
      expect(manifest.images.length).toBe(4);
    });

    it('should include control-center image', () => {
      const manifest = loadManifest(manifestPath);
      const controlCenter = manifest.images.find(img => img.id === 'control-center');
      expect(controlCenter).toBeDefined();
      expect(controlCenter?.name).toBe('afu9/control-center');
      expect(controlCenter?.required).toBe(true);
    });

    it('should include all MCP server images', () => {
      const manifest = loadManifest(manifestPath);
      const mcpServers = ['mcp-github', 'mcp-deploy', 'mcp-observability'];
      
      for (const serverId of mcpServers) {
        const server = manifest.images.find(img => img.id === serverId);
        expect(server).toBeDefined();
        expect(server?.required).toBe(true);
      }
    });

    it('should use git-sha tagging strategy', () => {
      const manifest = loadManifest(manifestPath);
      expect(manifest.tagging.strategy).toBe('git-sha');
    });

    it('should have prod and stage prefixes', () => {
      const manifest = loadManifest(manifestPath);
      expect(manifest.tagging.prefixes.production).toBe('prod');
      expect(manifest.tagging.prefixes.staging).toBe('stage');
    });
  });
});
