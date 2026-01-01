/**
 * Integration Test: CR Versioning Flow
 * Issue E74.4: CR Versioning + Diff
 * 
 * Tests the complete flow of CR versioning:
 * 1. Commit a CR version
 * 2. List versions
 * 3. Retrieve specific version
 * 4. Compute diff between versions
 */

import { Pool } from 'pg';
import {
  commitCrVersion,
  listCrVersions,
  getCrVersion,
  getLatestCrVersion,
} from '@/lib/db/intentCrVersions';
import { computeCrDiff } from '@/lib/utils/crDiff';
import { EXAMPLE_MINIMAL_CR } from '@/lib/schemas/changeRequest';

// Mock pool for integration testing
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

describe('CR Versioning Integration Flow', () => {
  const sessionId = 'session-integration-test';
  const userId = 'user-integration-test';

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(mockClient);
  });

  it('should handle complete versioning workflow', async () => {
    // Step 1: Commit first version
    const version1 = {
      id: 'v1-id',
      session_id: sessionId,
      created_at: new Date('2024-01-01'),
      cr_json: EXAMPLE_MINIMAL_CR,
      cr_hash: 'hash1',
      cr_version: 1,
    };

    // Mock commit flow for version 1
    mockQuery.mockResolvedValueOnce({}); // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [{ id: sessionId }] }); // session check
    mockQuery.mockResolvedValueOnce({ rows: [] }); // hash check (new)
    mockQuery.mockResolvedValueOnce({ rows: [{ next_version: 1 }] }); // get next version
    mockQuery.mockResolvedValueOnce({ rows: [version1] }); // insert version
    mockQuery.mockResolvedValueOnce({}); // update latest pointer
    mockQuery.mockResolvedValueOnce({}); // COMMIT

    const commit1 = await commitCrVersion(mockPool, sessionId, userId, EXAMPLE_MINIMAL_CR);

    expect(commit1.success).toBe(true);
    if (commit1.success) {
      expect(commit1.isNew).toBe(true);
      expect(commit1.data.cr_version).toBe(1);
    }

    // Step 2: Commit modified version
    const modifiedCr = {
      ...EXAMPLE_MINIMAL_CR,
      title: 'Modified Title',
    };

    const version2 = {
      id: 'v2-id',
      session_id: sessionId,
      created_at: new Date('2024-01-02'),
      cr_json: modifiedCr,
      cr_hash: 'hash2',
      cr_version: 2,
    };

    // Mock commit flow for version 2
    mockQuery.mockResolvedValueOnce({}); // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [{ id: sessionId }] }); // session check
    mockQuery.mockResolvedValueOnce({ rows: [] }); // hash check (new)
    mockQuery.mockResolvedValueOnce({ rows: [{ next_version: 2 }] }); // get next version
    mockQuery.mockResolvedValueOnce({ rows: [version2] }); // insert version
    mockQuery.mockResolvedValueOnce({}); // update latest pointer
    mockQuery.mockResolvedValueOnce({}); // COMMIT

    const commit2 = await commitCrVersion(mockPool, sessionId, userId, modifiedCr);

    expect(commit2.success).toBe(true);
    if (commit2.success) {
      expect(commit2.isNew).toBe(true);
      expect(commit2.data.cr_version).toBe(2);
    }

    // Step 3: Commit same CR again (idempotency test)
    // Mock commit flow for duplicate
    mockQuery.mockResolvedValueOnce({}); // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [{ id: sessionId }] }); // session check
    mockQuery.mockResolvedValueOnce({ rows: [version2] }); // hash check (exists!)
    mockQuery.mockResolvedValueOnce({}); // COMMIT

    const commit3 = await commitCrVersion(mockPool, sessionId, userId, modifiedCr);

    expect(commit3.success).toBe(true);
    if (commit3.success) {
      expect(commit3.isNew).toBe(false);
      expect(commit3.data.id).toBe(version2.id);
    }

    // Step 4: List versions
    mockQuery.mockResolvedValueOnce({ rows: [{ id: sessionId }] }); // session check
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'v2-id',
          session_id: sessionId,
          created_at: new Date('2024-01-02'),
          cr_hash: 'hash2',
          cr_version: 2,
        },
        {
          id: 'v1-id',
          session_id: sessionId,
          created_at: new Date('2024-01-01'),
          cr_hash: 'hash1',
          cr_version: 1,
        },
      ],
    });

    const list = await listCrVersions(mockPool, sessionId, userId);

    expect(list.success).toBe(true);
    if (list.success) {
      expect(list.data.length).toBe(2);
      expect(list.data[0].cr_version).toBe(2); // Newest first
      expect(list.data[1].cr_version).toBe(1);
    }

    // Step 5: Get specific version
    mockQuery.mockResolvedValueOnce({ rows: [version1] });

    const get1 = await getCrVersion(mockPool, 'v1-id');

    expect(get1.success).toBe(true);
    if (get1.success) {
      expect(get1.data.cr_version).toBe(1);
      expect(get1.data.cr_json).toBeDefined();
    }

    // Step 6: Get latest version
    mockQuery.mockResolvedValueOnce({ rows: [{ id: sessionId }] }); // session check
    mockQuery.mockResolvedValueOnce({ rows: [version2] }); // latest query

    const latest = await getLatestCrVersion(mockPool, sessionId, userId);

    expect(latest.success).toBe(true);
    if (latest.success) {
      expect(latest.data?.cr_version).toBe(2);
    }

    // Step 7: Compute diff between versions
    const diff = computeCrDiff(version1, version2);

    expect(diff.from.version).toBe(1);
    expect(diff.to.version).toBe(2);
    expect(diff.operations.length).toBeGreaterThan(0);

    const titleChange = diff.operations.find(op => op.path === '/title');
    expect(titleChange).toBeDefined();
    expect(titleChange?.op).toBe('replace');
  });

  it('should enforce immutability - same hash returns same version', async () => {
    const existingVersion = {
      id: 'existing-v-id',
      session_id: sessionId,
      created_at: new Date(),
      cr_json: EXAMPLE_MINIMAL_CR,
      cr_hash: 'same-hash',
      cr_version: 5,
    };

    // First call
    mockQuery.mockResolvedValueOnce({}); // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [{ id: sessionId }] }); // session check
    mockQuery.mockResolvedValueOnce({ rows: [existingVersion] }); // hash exists
    mockQuery.mockResolvedValueOnce({}); // COMMIT

    const commit1 = await commitCrVersion(mockPool, sessionId, userId, EXAMPLE_MINIMAL_CR);

    // Second call
    mockQuery.mockResolvedValueOnce({}); // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [{ id: sessionId }] }); // session check
    mockQuery.mockResolvedValueOnce({ rows: [existingVersion] }); // hash exists
    mockQuery.mockResolvedValueOnce({}); // COMMIT

    const commit2 = await commitCrVersion(mockPool, sessionId, userId, EXAMPLE_MINIMAL_CR);

    expect(commit1.success).toBe(true);
    expect(commit2.success).toBe(true);

    if (commit1.success && commit2.success) {
      expect(commit1.isNew).toBe(false);
      expect(commit2.isNew).toBe(false);
      expect(commit1.data.id).toBe(commit2.data.id);
      expect(commit1.data.cr_version).toBe(commit2.data.cr_version);
    }
  });

  it('should handle version numbering correctly across multiple commits', async () => {
    const versions = [1, 2, 3, 4, 5].map(v => ({
      id: `v${v}-id`,
      session_id: sessionId,
      created_at: new Date(`2024-01-0${v}`),
      cr_json: { ...EXAMPLE_MINIMAL_CR, version: v },
      cr_hash: `hash${v}`,
      cr_version: v,
    }));

    // Commit 5 different versions
    for (let i = 0; i < 5; i++) {
      mockQuery.mockResolvedValueOnce({}); // BEGIN
      mockQuery.mockResolvedValueOnce({ rows: [{ id: sessionId }] }); // session check
      mockQuery.mockResolvedValueOnce({ rows: [] }); // hash check (new)
      mockQuery.mockResolvedValueOnce({ rows: [{ next_version: i + 1 }] }); // next version
      mockQuery.mockResolvedValueOnce({ rows: [versions[i]] }); // insert
      mockQuery.mockResolvedValueOnce({}); // update latest
      mockQuery.mockResolvedValueOnce({}); // COMMIT

      const result = await commitCrVersion(
        mockPool,
        sessionId,
        userId,
        { ...EXAMPLE_MINIMAL_CR, version: i + 1 }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cr_version).toBe(i + 1);
      }
    }
  });
});
