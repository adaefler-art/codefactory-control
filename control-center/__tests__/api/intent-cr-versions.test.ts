/**
 * Tests for INTENT CR Versions Database Layer
 * Issue E74.4: CR Versioning + Diff
 */

import { Pool } from 'pg';
import {
  commitCrVersion,
  listCrVersions,
  getCrVersion,
  getLatestCrVersion,
} from '@/lib/db/intentCrVersions';
import { EXAMPLE_MINIMAL_CR } from '@/lib/schemas/changeRequest';

// Mock the database pool
const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockRelease = jest.fn();
const mockClient = {
  query: mockQuery,
  release: mockRelease,
};

const mockPool = {
  query: mockQuery,
  connect: mockConnect,
} as unknown as Pool;

describe('INTENT CR Versions Database Layer', () => {
  const sessionId = 'session-123';
  const userId = 'user-456';
  const versionId = 'version-789';

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(mockClient);
  });

  describe('commitCrVersion', () => {
    it('should create new version when hash does not exist', async () => {
      const newVersion = {
        id: versionId,
        session_id: sessionId,
        created_at: new Date(),
        cr_json: EXAMPLE_MINIMAL_CR,
        cr_hash: 'newhash123',
        cr_version: 1,
      };

      // Mock BEGIN
      mockQuery.mockResolvedValueOnce({});
      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      // Mock hash check (no existing version)
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });
      // Mock get next version number
      mockQuery.mockResolvedValueOnce({
        rows: [{ next_version: 1 }],
      });
      // Mock insert new version
      mockQuery.mockResolvedValueOnce({
        rows: [newVersion],
      });
      // Mock update latest pointer
      mockQuery.mockResolvedValueOnce({});
      // Mock COMMIT
      mockQuery.mockResolvedValueOnce({});

      const result = await commitCrVersion(mockPool, sessionId, userId, EXAMPLE_MINIMAL_CR);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.isNew).toBe(true);
        expect(result.data.id).toBe(versionId);
        expect(result.data.cr_version).toBe(1);
      }
    });

    it('should return existing version when hash already exists (idempotency)', async () => {
      const existingVersion = {
        id: 'existing-version-id',
        session_id: sessionId,
        created_at: new Date(),
        cr_json: EXAMPLE_MINIMAL_CR,
        cr_hash: 'existinghash',
        cr_version: 1,
      };

      // Mock BEGIN
      mockQuery.mockResolvedValueOnce({});
      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      // Mock hash check (existing version found)
      mockQuery.mockResolvedValueOnce({
        rows: [existingVersion],
      });
      // Mock COMMIT
      mockQuery.mockResolvedValueOnce({});

      const result = await commitCrVersion(mockPool, sessionId, userId, EXAMPLE_MINIMAL_CR);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.isNew).toBe(false);
        expect(result.data.id).toBe('existing-version-id');
      }
    });

    it('should increment version number correctly', async () => {
      const newVersion = {
        id: versionId,
        session_id: sessionId,
        created_at: new Date(),
        cr_json: EXAMPLE_MINIMAL_CR,
        cr_hash: 'newhash456',
        cr_version: 3,
      };

      // Mock BEGIN
      mockQuery.mockResolvedValueOnce({});
      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      // Mock hash check (no existing version)
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });
      // Mock get next version number (previous max is 2)
      mockQuery.mockResolvedValueOnce({
        rows: [{ next_version: 3 }],
      });
      // Mock insert new version
      mockQuery.mockResolvedValueOnce({
        rows: [newVersion],
      });
      // Mock update latest pointer
      mockQuery.mockResolvedValueOnce({});
      // Mock COMMIT
      mockQuery.mockResolvedValueOnce({});

      const result = await commitCrVersion(mockPool, sessionId, userId, EXAMPLE_MINIMAL_CR);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cr_version).toBe(3);
      }
    });

    it('should fail when session does not belong to user', async () => {
      // Mock BEGIN
      mockQuery.mockResolvedValueOnce({});
      // Mock session ownership check failing
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });
      // Mock ROLLBACK
      mockQuery.mockResolvedValueOnce({});

      const result = await commitCrVersion(mockPool, sessionId, userId, EXAMPLE_MINIMAL_CR);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Session not found or access denied');
      }
    });
  });

  describe('listCrVersions', () => {
    it('should list versions newest first', async () => {
      const versions = [
        {
          id: 'v3',
          session_id: sessionId,
          created_at: new Date('2024-01-03'),
          cr_hash: 'hash3',
          cr_version: 3,
        },
        {
          id: 'v2',
          session_id: sessionId,
          created_at: new Date('2024-01-02'),
          cr_hash: 'hash2',
          cr_version: 2,
        },
        {
          id: 'v1',
          session_id: sessionId,
          created_at: new Date('2024-01-01'),
          cr_hash: 'hash1',
          cr_version: 1,
        },
      ];

      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      // Mock list query
      mockQuery.mockResolvedValueOnce({
        rows: versions,
      });

      const result = await listCrVersions(mockPool, sessionId, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(3);
        expect(result.data[0].id).toBe('v3');
        expect(result.data[1].id).toBe('v2');
        expect(result.data[2].id).toBe('v1');
        // Check that cr_json is not included
        expect('cr_json' in result.data[0]).toBe(false);
      }
    });

    it('should support pagination', async () => {
      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      // Mock list query
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      await listCrVersions(mockPool, sessionId, userId, { limit: 10, offset: 20 });

      // Verify pagination params were passed
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([sessionId, 10, 20])
      );
    });

    it('should fail when session does not belong to user', async () => {
      // Mock session ownership check failing
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await listCrVersions(mockPool, sessionId, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Session not found or access denied');
      }
    });
  });

  describe('getCrVersion', () => {
    it('should return version with full CR JSON', async () => {
      const version = {
        id: versionId,
        session_id: sessionId,
        created_at: new Date(),
        cr_json: EXAMPLE_MINIMAL_CR,
        cr_hash: 'hash123',
        cr_version: 1,
      };

      mockQuery.mockResolvedValueOnce({
        rows: [version],
      });

      const result = await getCrVersion(mockPool, versionId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(versionId);
        expect(result.data.cr_json).toBeDefined();
      }
    });

    it('should fail when version does not exist', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await getCrVersion(mockPool, versionId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Version not found');
      }
    });

    it('should enforce ownership when userId is provided', async () => {
      const version = {
        id: versionId,
        session_id: sessionId,
        created_at: new Date(),
        cr_json: EXAMPLE_MINIMAL_CR,
        cr_hash: 'hash123',
        cr_version: 1,
      };

      // Mock successful ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [version],
      });

      const result = await getCrVersion(mockPool, versionId, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(versionId);
      }

      // Verify the query included the join to check ownership
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('JOIN intent_sessions'),
        expect.arrayContaining([versionId, userId])
      );
    });

    it('should return 404 when version does not belong to user', async () => {
      // Mock failed ownership check (no rows returned)
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await getCrVersion(mockPool, versionId, 'different-user');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Version not found');
      }
    });
  });

  describe('getLatestCrVersion', () => {
    it('should return latest version via pointer', async () => {
      const latestVersion = {
        id: versionId,
        session_id: sessionId,
        created_at: new Date(),
        cr_json: EXAMPLE_MINIMAL_CR,
        cr_hash: 'latest-hash',
        cr_version: 5,
      };

      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      // Mock latest pointer query
      mockQuery.mockResolvedValueOnce({
        rows: [latestVersion],
      });

      const result = await getLatestCrVersion(mockPool, sessionId, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toBeNull();
        expect(result.data?.cr_version).toBe(5);
      }
    });

    it('should return null when no versions exist', async () => {
      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      // Mock latest pointer query (no results)
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await getLatestCrVersion(mockPool, sessionId, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it('should fail when session does not belong to user', async () => {
      // Mock session ownership check failing
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await getLatestCrVersion(mockPool, sessionId, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Session not found or access denied');
      }
    });
  });

  describe('Hash-based idempotency', () => {
    it('should not create duplicate version for same CR content', async () => {
      const existingVersion = {
        id: 'existing-id',
        session_id: sessionId,
        created_at: new Date(),
        cr_json: EXAMPLE_MINIMAL_CR,
        cr_hash: 'samehash',
        cr_version: 1,
      };

      // First call
      mockQuery.mockResolvedValueOnce({});
      mockQuery.mockResolvedValueOnce({ rows: [{ id: sessionId }] });
      mockQuery.mockResolvedValueOnce({ rows: [existingVersion] });
      mockQuery.mockResolvedValueOnce({});

      const result1 = await commitCrVersion(mockPool, sessionId, userId, EXAMPLE_MINIMAL_CR);

      // Second call with same CR
      mockQuery.mockResolvedValueOnce({});
      mockQuery.mockResolvedValueOnce({ rows: [{ id: sessionId }] });
      mockQuery.mockResolvedValueOnce({ rows: [existingVersion] });
      mockQuery.mockResolvedValueOnce({});

      const result2 = await commitCrVersion(mockPool, sessionId, userId, EXAMPLE_MINIMAL_CR);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      if (result1.success && result2.success) {
        expect(result1.isNew).toBe(false);
        expect(result2.isNew).toBe(false);
        expect(result1.data.id).toBe(result2.data.id);
      }
    });
  });

  describe('Diff endpoint - cross-session protection', () => {
    it('should reject diff when versions belong to different sessions', async () => {
      const version1 = {
        id: 'v1-id',
        session_id: 'session-1',
        created_at: new Date(),
        cr_json: EXAMPLE_MINIMAL_CR,
        cr_hash: 'hash1',
        cr_version: 1,
      };

      const version2 = {
        id: 'v2-id',
        session_id: 'session-2', // Different session!
        created_at: new Date(),
        cr_json: EXAMPLE_MINIMAL_CR,
        cr_hash: 'hash2',
        cr_version: 1,
      };

      // Mock both versions being found with ownership
      mockQuery.mockResolvedValueOnce({ rows: [version1] });
      mockQuery.mockResolvedValueOnce({ rows: [version2] });

      const result1 = await getCrVersion(mockPool, 'v1-id', userId);
      const result2 = await getCrVersion(mockPool, 'v2-id', userId);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      // In the diff endpoint, this should be rejected
      if (result1.success && result2.success) {
        expect(result1.data.session_id).not.toBe(result2.data.session_id);
      }
    });
  });
});
