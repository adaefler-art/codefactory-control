/**
 * Build Determinism Module
 * 
 * Ensures reproducible builds by tracking inputs, computing checksums,
 * and validating that identical inputs produce identical outputs.
 * 
 * Key Features:
 * - Content-based hashing of build inputs (source code, dependencies, config)
 * - Build manifest generation and validation
 * - Artifact caching and retrieval
 * - Determinism verification
 */

import { createHash } from 'crypto';
import { logger } from './logger';

/**
 * Build input sources that affect the output
 */
export interface BuildInputs {
  /** Source code files with their content hashes */
  sourceFiles: Record<string, string>;
  
  /** Dependencies with exact versions */
  dependencies: Record<string, string>;
  
  /** Environment variables that affect the build */
  environment: Record<string, string>;
  
  /** Build configuration */
  buildConfig: Record<string, any>;
  
  /** Timestamp (for tracking, not included in hash) */
  timestamp?: string;
}

/**
 * Build outputs with checksums
 */
export interface BuildOutputs {
  /** Artifact files with their content hashes */
  artifacts: Record<string, string>;
  
  /** Build logs hash */
  logsHash?: string;
  
  /** Success status */
  success: boolean;
  
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Build manifest containing all information for reproducibility
 */
export interface BuildManifest {
  /** Unique build ID */
  buildId: string;
  
  /** Build inputs with checksums */
  inputs: BuildInputs;
  
  /** Computed hash of all inputs (deterministic fingerprint) */
  inputsHash: string;
  
  /** Build outputs */
  outputs: BuildOutputs;
  
  /** Computed hash of all outputs */
  outputsHash: string;
  
  /** Build metadata */
  metadata: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
    reproducible: boolean;
  };

  /**
   * Active lawbook version at time of build (E79.3 / I793)
   * Null if no active lawbook configured
   */
  lawbookVersion?: string | null;
}

/**
 * Build cache entry
 */
export interface BuildCacheEntry {
  /** Input hash (cache key) */
  inputsHash: string;
  
  /** Output hash */
  outputsHash: string;
  
  /** Artifacts location */
  artifactsPath?: string;
  
  /** Last used timestamp */
  lastUsed: string;
  
  /** Number of times this cache was hit */
  hitCount: number;
}

/**
 * Compute a deterministic hash from an object
 * Recursively sorts keys to ensure consistent ordering
 */
export function computeHash(data: any): string {
  // Recursively sort keys for deterministic serialization
  const sortObject = (obj: any): any => {
    if (obj === null || obj === undefined) {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(sortObject);
    }
    if (typeof obj === 'object') {
      return Object.keys(obj)
        .sort()
        .reduce((result, key) => {
          result[key] = sortObject(obj[key]);
          return result;
        }, {} as any);
    }
    return obj;
  };
  
  const normalized = JSON.stringify(sortObject(data));
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Compute hash of build inputs (excluding timestamp)
 */
export function computeInputsHash(inputs: BuildInputs): string {
  // Create a copy without timestamp to ensure determinism
  const { timestamp, ...deterministicInputs } = inputs;
  return computeHash(deterministicInputs);
}

/**
 * Compute hash of build outputs
 */
export function computeOutputsHash(outputs: BuildOutputs): string {
  // Only hash the artifacts and success status, not duration
  return computeHash({
    artifacts: outputs.artifacts,
    success: outputs.success,
  });
}

/**
 * Create a build manifest
 */
export function createBuildManifest(
  buildId: string,
  inputs: BuildInputs,
  outputs: BuildOutputs,
  startedAt: Date,
  completedAt: Date
): BuildManifest {
  const inputsHash = computeInputsHash(inputs);
  const outputsHash = computeOutputsHash(outputs);
  
  return {
    buildId,
    inputs,
    inputsHash,
    outputs,
    outputsHash,
    metadata: {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      reproducible: true, // Will be validated separately
    },
  };
}

/**
 * Validate build reproducibility by comparing two manifests
 * Returns true if identical inputs produced identical outputs
 */
export function validateReproducibility(
  manifest1: BuildManifest,
  manifest2: BuildManifest
): boolean {
  // Same inputs should produce same outputs
  if (manifest1.inputsHash === manifest2.inputsHash) {
    return manifest1.outputsHash === manifest2.outputsHash;
  }
  
  // Different inputs expected to produce different outputs
  return true;
}

/**
 * Build Determinism Tracker
 * Tracks build history and validates reproducibility
 */
export class BuildDeterminismTracker {
  private manifests: Map<string, BuildManifest> = new Map();
  private inputHashToBuilds: Map<string, string[]> = new Map();
  private cache: Map<string, BuildCacheEntry> = new Map();
  
  /**
   * Register a build manifest
   */
  registerBuild(manifest: BuildManifest): void {
    this.manifests.set(manifest.buildId, manifest);
    
    // Track builds by input hash
    const builds = this.inputHashToBuilds.get(manifest.inputsHash) || [];
    builds.push(manifest.buildId);
    this.inputHashToBuilds.set(manifest.inputsHash, builds);
    
    logger.debug('Registered build manifest', {
      buildId: manifest.buildId,
      inputsHash: manifest.inputsHash,
      outputsHash: manifest.outputsHash,
    }, 'BuildDeterminism');
  }
  
  /**
   * Check if we can reuse a cached build for given inputs
   */
  getCachedBuild(inputsHash: string): BuildCacheEntry | null {
    const cached = this.cache.get(inputsHash);
    if (cached) {
      cached.hitCount++;
      cached.lastUsed = new Date().toISOString();
      logger.debug('Build cache hit', {
        inputsHash,
        hitCount: cached.hitCount,
      }, 'BuildDeterminism');
      return cached;
    }
    
    logger.debug('Build cache miss', { inputsHash }, 'BuildDeterminism');
    return null;
  }
  
  /**
   * Store build outputs in cache
   */
  cacheBuild(
    inputsHash: string,
    outputsHash: string,
    artifactsPath?: string
  ): void {
    this.cache.set(inputsHash, {
      inputsHash,
      outputsHash,
      artifactsPath,
      lastUsed: new Date().toISOString(),
      hitCount: 0,
    });
    
    logger.debug('Cached build outputs', {
      inputsHash,
      outputsHash,
    }, 'BuildDeterminism');
  }
  
  /**
   * Calculate build determinism score (0-100)
   * Score is the percentage of input hashes where all builds produced identical outputs
   */
  calculateDeterminismScore(): number {
    let totalInputHashes = 0;
    let deterministicInputHashes = 0;
    
    for (const [inputsHash, buildIds] of this.inputHashToBuilds.entries()) {
      totalInputHashes++;
      
      // Get all manifests for this input hash
      const manifests = buildIds
        .map(id => this.manifests.get(id))
        .filter((m): m is BuildManifest => m !== undefined);
      
      if (manifests.length < 2) {
        // Single build, assume deterministic
        deterministicInputHashes++;
        continue;
      }
      
      // Check if all outputs match
      const outputHashes = new Set(manifests.map(m => m.outputsHash));
      if (outputHashes.size === 1) {
        deterministicInputHashes++;
      } else {
        logger.warn('Non-deterministic build detected', {
          inputsHash,
          outputHashes: Array.from(outputHashes),
          buildIds,
        }, 'BuildDeterminism');
      }
    }
    
    if (totalInputHashes === 0) return 100;
    return (deterministicInputHashes / totalInputHashes) * 100;
  }
  
  /**
   * Get statistics about builds
   */
  getStatistics() {
    return {
      totalBuilds: this.manifests.size,
      uniqueInputs: this.inputHashToBuilds.size,
      cacheSize: this.cache.size,
      determinismScore: this.calculateDeterminismScore(),
      cacheHitRate: this.calculateCacheHitRate(),
    };
  }
  
  /**
   * Calculate cache hit rate
   */
  private calculateCacheHitRate(): number {
    const entries = Array.from(this.cache.values());
    if (entries.length === 0) return 0;
    
    const totalHits = entries.reduce((sum, e) => sum + e.hitCount, 0);
    const totalAttempts = totalHits + entries.length; // Each entry was added once
    
    return totalAttempts > 0 ? (totalHits / totalAttempts) * 100 : 0;
  }
  
  /**
   * Clear old cache entries (older than specified days)
   */
  cleanCache(maxAgeDays: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    const cutoffTime = cutoffDate.toISOString();
    
    let removedCount = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastUsed < cutoffTime) {
        this.cache.delete(key);
        removedCount++;
      }
    }
    
    logger.info('Cleaned build cache', {
      removedCount,
      remainingCount: this.cache.size,
      maxAgeDays,
    }, 'BuildDeterminism');
    
    return removedCount;
  }
}

// Singleton instance
let trackerInstance: BuildDeterminismTracker | null = null;

/**
 * Get the global build determinism tracker
 */
export function getBuildDeterminismTracker(): BuildDeterminismTracker {
  if (!trackerInstance) {
    trackerInstance = new BuildDeterminismTracker();
  }
  return trackerInstance;
}
