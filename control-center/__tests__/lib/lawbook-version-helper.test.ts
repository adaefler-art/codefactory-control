/**
 * Tests for Lawbook Version Helper (E79.3 / I793)
 * 
 * Tests systematic lawbookVersion enforcement across all operational artifacts.
 */

import {
  getActiveLawbookVersion,
  requireActiveLawbookVersion,
  attachLawbookVersion,
  clearLawbookVersionCache,
  getLawbookVersionCacheStats,
  LAWBOOK_NOT_CONFIGURED_ERROR,
} from '@/lib/lawbook-version-helper';
import { getPool } from '@/lib/db';
import {
  createLawbookVersion,
  activateLawbookVersion,
} from '@/lib/db/lawbook';
import { createMinimalLawbook } from '@/lawbook/schema';
import type { LawbookV1 } from '@/lawbook/schema';

const buildTestLawbook = (lawbookVersion: string): LawbookV1 =>
  createMinimalLawbook({ lawbookVersion });

const mockLawbookStore = new Map<string, LawbookV1>();
let activeLawbookId: string | null = null;

const resetLawbookStore = () => {
  mockLawbookStore.clear();
  activeLawbookId = null;
};

jest.mock('@/lib/db/lawbook', () => ({
  createLawbookVersion: jest.fn(async (lawbook: LawbookV1) => {
    const id = `${lawbook.lawbookVersion}-id`;
    if (!mockLawbookStore.has(id)) {
      mockLawbookStore.set(id, lawbook);
    }
    return {
      success: true,
      data: {
        id,
        lawbook_id: lawbook.lawbookId,
        lawbook_version: lawbook.lawbookVersion,
        lawbook_json: lawbook,
      },
      isExisting: false,
    };
  }),
  activateLawbookVersion: jest.fn(async (versionId: string) => {
    activeLawbookId = versionId;
    return {
      success: true,
      data: {
        id: versionId,
        lawbook_id: 'AFU9-LAWBOOK',
        active_lawbook_version_id: versionId,
      },
    };
  }),
  getActiveLawbook: jest.fn(async () => {
    if (!activeLawbookId) {
      return {
        success: false,
        notConfigured: true,
        error: 'No active lawbook configured',
      };
    }
    const lawbook = mockLawbookStore.get(activeLawbookId);
    if (!lawbook) {
      return {
        success: false,
        error: 'Active lawbook not found',
      };
    }
    return {
      success: true,
      data: {
        id: activeLawbookId,
        lawbook_id: lawbook.lawbookId,
        lawbook_version: lawbook.lawbookVersion,
        lawbook_json: lawbook,
      },
    };
  }),
}));

describe('Lawbook Version Helper (E79.3 / I793)', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearLawbookVersionCache();
    resetLawbookStore();
    jest.clearAllMocks();
  });

  describe('getActiveLawbookVersion', () => {
    it('should return active lawbook version when configured', async () => {
      const pool = getPool();
      
      // Create a test lawbook
      const testLawbook = buildTestLawbook('v2025.01.05-test');

      const createResult = await createLawbookVersion(testLawbook, 'admin', pool);
      expect(createResult.success).toBe(true);
      expect(createResult.data).toBeDefined();

      const activateResult = await activateLawbookVersion(
        createResult.data!.id,
        'admin',
        pool
      );
      expect(activateResult.success).toBe(true);

      // Get active lawbook version
      const version = await getActiveLawbookVersion(pool);
      
      expect(version).toBe('v2025.01.05-test');
    });

    it('should return null when no active lawbook configured', async () => {
      const pool = getPool();
      
      // Don't create or activate any lawbook
      const version = await getActiveLawbookVersion(pool);
      
      expect(version).toBeNull();
    });

    it('should cache the result for performance', async () => {
      const pool = getPool();
      
      // Create and activate a lawbook
      const testLawbook = buildTestLawbook('v2025.01.05-cached');

      const createResult = await createLawbookVersion(testLawbook, 'admin', pool);
      await activateLawbookVersion(createResult.data!.id, 'admin', pool);

      // First call - should fetch from database
      const version1 = await getActiveLawbookVersion(pool);
      expect(version1).toBe('v2025.01.05-cached');
      
      // Check cache stats
      const stats1 = getLawbookVersionCacheStats();
      expect(stats1.cached).toBe(true);
      expect(stats1.version).toBe('v2025.01.05-cached');
      
      // Second call - should use cache
      const version2 = await getActiveLawbookVersion(pool);
      expect(version2).toBe('v2025.01.05-cached');
      
      // Cache should still be valid
      const stats2 = getLawbookVersionCacheStats();
      expect(stats2.cached).toBe(true);
      expect(stats2.age).toBeLessThan(60000); // Less than 60 seconds
    });

    it('should refresh cache after TTL expires', async () => {
      const pool = getPool();
      
      // Create and activate a lawbook
      const testLawbook = buildTestLawbook('v2025.01.05-ttl-test');

      const createResult = await createLawbookVersion(testLawbook, 'admin', pool);
      await activateLawbookVersion(createResult.data!.id, 'admin', pool);

      // First call
      await getActiveLawbookVersion(pool);
      
      // Clear cache to simulate TTL expiration
      clearLawbookVersionCache();
      
      // Second call should fetch fresh data
      const version = await getActiveLawbookVersion(pool);
      expect(version).toBe('v2025.01.05-ttl-test');
    });
  });

  describe('requireActiveLawbookVersion', () => {
    it('should return active lawbook version when configured', async () => {
      const pool = getPool();
      
      // Create and activate a lawbook
      const testLawbook = buildTestLawbook('v2025.01.05-required');

      const createResult = await createLawbookVersion(testLawbook, 'admin', pool);
      await activateLawbookVersion(createResult.data!.id, 'admin', pool);

      // Require active lawbook version
      const version = await requireActiveLawbookVersion(pool);
      
      expect(version).toBe('v2025.01.05-required');
    });

    it('should throw LAWBOOK_NOT_CONFIGURED when no active lawbook', async () => {
      const pool = getPool();
      
      // Don't create or activate any lawbook
      await expect(async () => {
        await requireActiveLawbookVersion(pool);
      }).rejects.toThrow();

      try {
        await requireActiveLawbookVersion(pool);
      } catch (error: any) {
        expect(error.code).toBe(LAWBOOK_NOT_CONFIGURED_ERROR);
        expect(error.message).toContain('No active lawbook configured');
      }
    });

    it('should enforce fail-closed behavior for gating operations', async () => {
      const pool = getPool();
      
      // Simulate a gating operation that requires lawbook
      const executeGatedOperation = async () => {
        const lawbookVersion = await requireActiveLawbookVersion(pool);
        
        // This should only execute if lawbook is configured
        return {
          success: true,
          lawbookVersion,
        };
      };

      // Should fail when no lawbook configured
      await expect(executeGatedOperation()).rejects.toThrow();
    });
  });

  describe('attachLawbookVersion', () => {
    it('should attach lawbookVersion to object when configured', async () => {
      const pool = getPool();
      
      // Create and activate a lawbook
      const testLawbook = buildTestLawbook('v2025.01.05-attach');

      const createResult = await createLawbookVersion(testLawbook, 'admin', pool);
      await activateLawbookVersion(createResult.data!.id, 'admin', pool);

      // Attach lawbookVersion to object
      const obj = { name: 'test', value: 42 };
      const withVersion = await attachLawbookVersion(obj, pool);
      
      expect(withVersion.name).toBe('test');
      expect(withVersion.value).toBe(42);
      expect(withVersion.lawbookVersion).toBe('v2025.01.05-attach');
    });

    it('should attach null lawbookVersion when not configured', async () => {
      const pool = getPool();
      
      // Don't create or activate any lawbook
      const obj = { name: 'test', value: 42 };
      const withVersion = await attachLawbookVersion(obj, pool);
      
      expect(withVersion.name).toBe('test');
      expect(withVersion.value).toBe(42);
      expect(withVersion.lawbookVersion).toBeNull();
    });

    it('should not modify object if lawbookVersion already present', async () => {
      const pool = getPool();
      
      const obj = { 
        name: 'test', 
        value: 42,
        lawbookVersion: 'existing-version'
      };
      const withVersion = await attachLawbookVersion(obj, pool);
      
      expect(withVersion).toBe(obj);
      expect(withVersion.lawbookVersion).toBe('existing-version');
    });
  });

  describe('Cache Management', () => {
    it('should clear cache when requested', () => {
      clearLawbookVersionCache();
      
      const stats = getLawbookVersionCacheStats();
      expect(stats.cached).toBe(false);
      expect(stats.version).toBeNull();
      expect(stats.age).toBeNull();
      expect(stats.lawbookId).toBeNull();
    });

    it('should provide accurate cache statistics', async () => {
      const pool = getPool();
      
      // Create and activate a lawbook
      const testLawbook = buildTestLawbook('v2025.01.05-stats');

      const createResult = await createLawbookVersion(testLawbook, 'admin', pool);
      await activateLawbookVersion(createResult.data!.id, 'admin', pool);

      // Get version to populate cache
      await getActiveLawbookVersion(pool);
      
      const stats = getLawbookVersionCacheStats();
      expect(stats.cached).toBe(true);
      expect(stats.version).toBe('v2025.01.05-stats');
      expect(stats.lawbookId).toBe('AFU9-LAWBOOK');
      expect(stats.age).toBeGreaterThanOrEqual(0);
      expect(stats.age).toBeLessThan(1000); // Should be very recent
    });

    it('should invalidate cache after activation to prevent stale versions', async () => {
      const pool = getPool();
      
      // Create and activate first lawbook version
      const lawbook1 = buildTestLawbook('v1.0.0');

      const createResult1 = await createLawbookVersion(lawbook1, 'admin', pool);
      await activateLawbookVersion(createResult1.data!.id, 'admin', pool);

      // Fetch and cache v1.0.0
      const version1 = await getActiveLawbookVersion(pool);
      expect(version1).toBe('v1.0.0');

      // Cache should be populated
      let stats = getLawbookVersionCacheStats();
      expect(stats.cached).toBe(true);
      expect(stats.version).toBe('v1.0.0');

      // Create and activate second lawbook version
      const lawbook2 = buildTestLawbook('v2.0.0');

      const createResult2 = await createLawbookVersion(lawbook2, 'admin', pool);
      await activateLawbookVersion(createResult2.data!.id, 'admin', pool);

      // Invalidate cache (simulating what activate route does)
      clearLawbookVersionCache('AFU9-LAWBOOK');

      // Cache should be cleared
      stats = getLawbookVersionCacheStats();
      expect(stats.cached).toBe(false);

      // Next fetch should get v2.0.0, not cached v1.0.0
      const version2 = await getActiveLawbookVersion(pool);
      expect(version2).toBe('v2.0.0');

      // Verify cache now has v2.0.0
      stats = getLawbookVersionCacheStats();
      expect(stats.cached).toBe(true);
      expect(stats.version).toBe('v2.0.0');
    });

    it('should support forceRefresh parameter to bypass cache', async () => {
      const pool = getPool();
      
      // Create and activate a lawbook
      const testLawbook = buildTestLawbook('v1.0.0-force');

      const createResult = await createLawbookVersion(testLawbook, 'admin', pool);
      await activateLawbookVersion(createResult.data!.id, 'admin', pool);

      // First call - populates cache
      const version1 = await getActiveLawbookVersion(pool);
      expect(version1).toBe('v1.0.0-force');

      // Second call with forceRefresh=true should bypass cache
      const version2 = await getActiveLawbookVersion(pool, 'AFU9-LAWBOOK', true);
      expect(version2).toBe('v1.0.0-force');
    });
  });

  describe('Integration Scenarios', () => {
    it('should support determinism gate scenario (E64.2)', async () => {
      const pool = getPool();
      
      // Create and activate a lawbook
      const testLawbook = buildTestLawbook('v2025.01.05-determinism');

      const createResult = await createLawbookVersion(testLawbook, 'admin', pool);
      await activateLawbookVersion(createResult.data!.id, 'admin', pool);

      // Simulate determinism gate check
      const lawbookVersion = await requireActiveLawbookVersion(pool);
      
      const determinismReport = {
        buildId: 'build-123',
        inputsHash: 'abc123',
        outputsHash: 'def456',
        reproducible: true,
        lawbookVersion,
      };

      expect(determinismReport.lawbookVersion).toBe('v2025.01.05-determinism');
    });

    it('should support passive incident ingestion scenario (E76.*)', async () => {
      const pool = getPool();
      
      // Simulate incident ingestion without lawbook configured
      const lawbookVersion = await getActiveLawbookVersion(pool);
      
      const incident = {
        incident_key: 'test-incident-123',
        severity: 'YELLOW' as const,
        title: 'Test incident',
        lawbookVersion, // Will be null
      };

      expect(incident.lawbookVersion).toBeNull();
      
      // Now activate a lawbook and ingest another incident
      const testLawbook = buildTestLawbook('v2025.01.05-incident');

      const createResult = await createLawbookVersion(testLawbook, 'admin', pool);
      await activateLawbookVersion(createResult.data!.id, 'admin', pool);
      
      clearLawbookVersionCache(); // Clear cache to fetch new version
      
      const lawbookVersion2 = await getActiveLawbookVersion(pool);
      
      const incident2 = {
        incident_key: 'test-incident-456',
        severity: 'RED' as const,
        title: 'Test incident 2',
        lawbookVersion: lawbookVersion2,
      };

      expect(incident2.lawbookVersion).toBe('v2025.01.05-incident');
    });

    it('should support remediation execution scenario (E77.*)', async () => {
      const pool = getPool();
      
      // Remediation requires lawbook - should fail if not configured
      await expect(async () => {
        await requireActiveLawbookVersion(pool);
      }).rejects.toThrow();

      // Configure lawbook and retry
      const testLawbook = buildTestLawbook('v2025.01.05-remediation');

      const createResult = await createLawbookVersion(testLawbook, 'admin', pool);
      await activateLawbookVersion(createResult.data!.id, 'admin', pool);
      
      clearLawbookVersionCache();
      
      const lawbookVersion = await requireActiveLawbookVersion(pool);
      
      const remediationRun = {
        run_key: 'test-run-123',
        playbook_id: 'restart-service',
        lawbook_version: lawbookVersion,
      };

      expect(remediationRun.lawbook_version).toBe('v2025.01.05-remediation');
    });
  });
});
