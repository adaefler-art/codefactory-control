/**
 * Build Determinism Module Tests
 * 
 * Tests for EPIC 5: Autonomous Build-Test-Deploy Loop
 * Issue 5.1: Deterministic Build Graphs
 */

import {
  computeHash,
  computeInputsHash,
  computeOutputsHash,
  createBuildManifest,
  validateReproducibility,
  BuildDeterminismTracker,
  BuildInputs,
  BuildOutputs,
} from '../../src/lib/build-determinism';

describe('Build Determinism Module', () => {
  describe('computeHash', () => {
    it('should produce consistent hashes for identical objects', () => {
      const obj1 = { a: 1, b: 2, c: 3 };
      const obj2 = { a: 1, b: 2, c: 3 };
      
      expect(computeHash(obj1)).toBe(computeHash(obj2));
    });
    
    it('should produce consistent hashes regardless of key order', () => {
      const obj1 = { a: 1, b: 2, c: 3 };
      const obj2 = { c: 3, a: 1, b: 2 };
      
      expect(computeHash(obj1)).toBe(computeHash(obj2));
    });
    
    it('should produce different hashes for different objects', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { a: 1, b: 3 };
      
      expect(computeHash(obj1)).not.toBe(computeHash(obj2));
    });
    
    it('should handle nested objects', () => {
      const obj1 = { a: { b: { c: 1 } } };
      const obj2 = { a: { b: { c: 1 } } };
      
      expect(computeHash(obj1)).toBe(computeHash(obj2));
    });
  });
  
  describe('computeInputsHash', () => {
    it('should exclude timestamp from hash computation', () => {
      const inputs1: BuildInputs = {
        sourceFiles: { 'test.ts': 'abc123' },
        dependencies: { 'react': '19.0.0' },
        environment: { 'NODE_ENV': 'production' },
        buildConfig: { mode: 'production' },
        timestamp: '2025-01-01T00:00:00Z',
      };
      
      const inputs2: BuildInputs = {
        sourceFiles: { 'test.ts': 'abc123' },
        dependencies: { 'react': '19.0.0' },
        environment: { 'NODE_ENV': 'production' },
        buildConfig: { mode: 'production' },
        timestamp: '2025-01-02T00:00:00Z', // Different timestamp
      };
      
      // Same hash despite different timestamps
      expect(computeInputsHash(inputs1)).toBe(computeInputsHash(inputs2));
    });
    
    it('should produce different hashes for different inputs', () => {
      const inputs1: BuildInputs = {
        sourceFiles: { 'test.ts': 'abc123' },
        dependencies: { 'react': '19.0.0' },
        environment: {},
        buildConfig: {},
      };
      
      const inputs2: BuildInputs = {
        sourceFiles: { 'test.ts': 'def456' }, // Different source
        dependencies: { 'react': '19.0.0' },
        environment: {},
        buildConfig: {},
      };
      
      expect(computeInputsHash(inputs1)).not.toBe(computeInputsHash(inputs2));
    });
  });
  
  describe('computeOutputsHash', () => {
    it('should hash only artifacts and success status', () => {
      const outputs1: BuildOutputs = {
        artifacts: { 'bundle.js': 'xyz789' },
        success: true,
        durationMs: 1000,
      };
      
      const outputs2: BuildOutputs = {
        artifacts: { 'bundle.js': 'xyz789' },
        success: true,
        durationMs: 2000, // Different duration
      };
      
      // Same hash despite different duration
      expect(computeOutputsHash(outputs1)).toBe(computeOutputsHash(outputs2));
    });
  });
  
  describe('createBuildManifest', () => {
    it('should create a valid build manifest', () => {
      const buildId = 'build-123';
      const inputs: BuildInputs = {
        sourceFiles: { 'test.ts': 'abc123' },
        dependencies: { 'react': '19.0.0' },
        environment: {},
        buildConfig: {},
      };
      const outputs: BuildOutputs = {
        artifacts: { 'bundle.js': 'xyz789' },
        success: true,
        durationMs: 1000,
      };
      const startedAt = new Date('2025-01-01T00:00:00Z');
      const completedAt = new Date('2025-01-01T00:00:01Z');
      
      const manifest = createBuildManifest(
        buildId,
        inputs,
        outputs,
        startedAt,
        completedAt
      );
      
      expect(manifest.buildId).toBe(buildId);
      expect(manifest.inputs).toBe(inputs);
      expect(manifest.outputs).toBe(outputs);
      expect(manifest.inputsHash).toBeTruthy();
      expect(manifest.outputsHash).toBeTruthy();
      expect(manifest.metadata.durationMs).toBe(1000);
    });
  });
  
  describe('validateReproducibility', () => {
    it('should validate that same inputs produce same outputs', () => {
      const inputs: BuildInputs = {
        sourceFiles: { 'test.ts': 'abc123' },
        dependencies: { 'react': '19.0.0' },
        environment: {},
        buildConfig: {},
      };
      const outputs: BuildOutputs = {
        artifacts: { 'bundle.js': 'xyz789' },
        success: true,
        durationMs: 1000,
      };
      
      const manifest1 = createBuildManifest(
        'build-1',
        inputs,
        outputs,
        new Date(),
        new Date()
      );
      
      const manifest2 = createBuildManifest(
        'build-2',
        inputs,
        outputs,
        new Date(),
        new Date()
      );
      
      expect(validateReproducibility(manifest1, manifest2)).toBe(true);
    });
    
    it('should detect non-deterministic builds', () => {
      const inputs: BuildInputs = {
        sourceFiles: { 'test.ts': 'abc123' },
        dependencies: { 'react': '19.0.0' },
        environment: {},
        buildConfig: {},
      };
      
      const outputs1: BuildOutputs = {
        artifacts: { 'bundle.js': 'xyz789' },
        success: true,
        durationMs: 1000,
      };
      
      const outputs2: BuildOutputs = {
        artifacts: { 'bundle.js': 'different123' }, // Different output!
        success: true,
        durationMs: 1000,
      };
      
      const manifest1 = createBuildManifest(
        'build-1',
        inputs,
        outputs1,
        new Date(),
        new Date()
      );
      
      const manifest2 = createBuildManifest(
        'build-2',
        inputs,
        outputs2,
        new Date(),
        new Date()
      );
      
      expect(validateReproducibility(manifest1, manifest2)).toBe(false);
    });
  });
  
  describe('BuildDeterminismTracker', () => {
    let tracker: BuildDeterminismTracker;
    
    beforeEach(() => {
      tracker = new BuildDeterminismTracker();
    });
    
    it('should register builds', () => {
      const manifest = createBuildManifest(
        'build-1',
        {
          sourceFiles: { 'test.ts': 'abc123' },
          dependencies: {},
          environment: {},
          buildConfig: {},
        },
        {
          artifacts: { 'bundle.js': 'xyz789' },
          success: true,
          durationMs: 1000,
        },
        new Date(),
        new Date()
      );
      
      tracker.registerBuild(manifest);
      
      const stats = tracker.getStatistics();
      expect(stats.totalBuilds).toBe(1);
      expect(stats.uniqueInputs).toBe(1);
    });
    
    it('should track cache hits', () => {
      const inputsHash = 'test-hash-123';
      const outputsHash = 'output-hash-456';
      
      // Store in cache
      tracker.cacheBuild(inputsHash, outputsHash);
      
      // Retrieve from cache
      const cached1 = tracker.getCachedBuild(inputsHash);
      expect(cached1).not.toBeNull();
      expect(cached1?.hitCount).toBe(1);
      
      const cached2 = tracker.getCachedBuild(inputsHash);
      expect(cached2?.hitCount).toBe(2);
    });
    
    it('should calculate determinism score correctly', () => {
      const inputs: BuildInputs = {
        sourceFiles: { 'test.ts': 'abc123' },
        dependencies: {},
        environment: {},
        buildConfig: {},
      };
      
      const outputs: BuildOutputs = {
        artifacts: { 'bundle.js': 'xyz789' },
        success: true,
        durationMs: 1000,
      };
      
      // Register two builds with same inputs and same outputs
      const manifest1 = createBuildManifest('build-1', inputs, outputs, new Date(), new Date());
      const manifest2 = createBuildManifest('build-2', inputs, outputs, new Date(), new Date());
      
      tracker.registerBuild(manifest1);
      tracker.registerBuild(manifest2);
      
      const stats = tracker.getStatistics();
      expect(stats.determinismScore).toBe(100); // Perfect determinism
    });
    
    it('should detect non-deterministic builds in score', () => {
      const inputs: BuildInputs = {
        sourceFiles: { 'test.ts': 'abc123' },
        dependencies: {},
        environment: {},
        buildConfig: {},
      };
      
      const outputs1: BuildOutputs = {
        artifacts: { 'bundle.js': 'xyz789' },
        success: true,
        durationMs: 1000,
      };
      
      const outputs2: BuildOutputs = {
        artifacts: { 'bundle.js': 'different123' }, // Different!
        success: true,
        durationMs: 1000,
      };
      
      const manifest1 = createBuildManifest('build-1', inputs, outputs1, new Date(), new Date());
      const manifest2 = createBuildManifest('build-2', inputs, outputs2, new Date(), new Date());
      
      tracker.registerBuild(manifest1);
      tracker.registerBuild(manifest2);
      
      const stats = tracker.getStatistics();
      expect(stats.determinismScore).toBe(0); // Non-deterministic
    });
    
    it('should calculate cache hit rate', () => {
      const hash1 = 'hash-1';
      const hash2 = 'hash-2';
      
      tracker.cacheBuild(hash1, 'output-1');
      tracker.cacheBuild(hash2, 'output-2');
      
      // Hit cache multiple times
      tracker.getCachedBuild(hash1);
      tracker.getCachedBuild(hash1);
      tracker.getCachedBuild(hash2);
      
      const stats = tracker.getStatistics();
      // 3 hits out of 5 attempts (2 additions + 3 hits) = 60%
      expect(stats.cacheHitRate).toBe(60);
    });
  });
});
