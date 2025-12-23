/**
 * Tests for Policy Manager
 * 
 * Tests policy snapshot creation and management for workflow executions
 */

import { Pool } from 'pg';
import {
  createPolicySnapshotForExecution,
  ensurePolicySnapshotForExecution,
  getPolicySnapshotForExecution,
} from '../../src/lib/policy-manager';
import * as verdictEngine from '@codefactory/verdict-engine';

// Mock the verdict-engine module
jest.mock('@codefactory/verdict-engine');

// Mock the logger
jest.mock('../../src/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Policy Manager', () => {
  let mockPool: jest.Mocked<Pool>;
  const mockExecutionId = 'exec-123-456';
  const mockSnapshotId = 'snapshot-789';
  const mockPolicyVersion = 'v1.0.0';

  beforeEach(() => {
    // Create mock pool
    mockPool = {
      query: jest.fn(),
    } as any;

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('createPolicySnapshotForExecution', () => {
    it('should create a policy snapshot for an execution', async () => {
      // Mock storePolicySnapshot to return a snapshot
      const mockSnapshot = {
        id: mockSnapshotId,
        version: mockPolicyVersion,
        policies: {},
        created_at: new Date().toISOString(),
      };

      (verdictEngine.storePolicySnapshot as jest.Mock).mockResolvedValue(mockSnapshot);

      const result = await createPolicySnapshotForExecution(mockPool, mockExecutionId);

      expect(result).toBe(mockSnapshotId);
      expect(verdictEngine.storePolicySnapshot).toHaveBeenCalledWith(
        mockPool,
        expect.objectContaining({
          version: mockPolicyVersion,
          policies: expect.any(Object),
          metadata: expect.objectContaining({
            execution_id: mockExecutionId,
          }),
        })
      );
    });

    it('should throw error if snapshot creation fails', async () => {
      (verdictEngine.storePolicySnapshot as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      await expect(
        createPolicySnapshotForExecution(mockPool, mockExecutionId)
      ).rejects.toThrow('Database error');
    });
  });

  describe('ensurePolicySnapshotForExecution', () => {
    it('should create a new policy snapshot', async () => {
      const mockSnapshot = {
        id: mockSnapshotId,
        version: mockPolicyVersion,
        policies: {},
        created_at: new Date().toISOString(),
      };

      (verdictEngine.getLatestPolicySnapshot as jest.Mock).mockResolvedValue(null);
      (verdictEngine.storePolicySnapshot as jest.Mock).mockResolvedValue(mockSnapshot);

      const result = await ensurePolicySnapshotForExecution(mockPool, mockExecutionId);

      expect(result).toBe(mockSnapshotId);
    });

    it('should handle errors gracefully', async () => {
      (verdictEngine.storePolicySnapshot as jest.Mock).mockRejectedValue(
        new Error('DB connection failed')
      );

      await expect(
        ensurePolicySnapshotForExecution(mockPool, mockExecutionId)
      ).rejects.toThrow('DB connection failed');
    });
  });

  describe('getPolicySnapshotForExecution', () => {
    it('should return policy snapshot for an execution', async () => {
      const mockSnapshot = {
        id: mockSnapshotId,
        version: mockPolicyVersion,
        policies: { classification_rules: [] },
        created_at: new Date().toISOString(),
        metadata: {},
      };

      // Mock workflow_executions query
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ policy_snapshot_id: mockSnapshotId }],
        } as any)
        // Mock policy_snapshots query
        .mockResolvedValueOnce({
          rows: [
            {
              id: mockSnapshot.id,
              version: mockSnapshot.version,
              policies: mockSnapshot.policies,
              created_at: new Date(),
              metadata: mockSnapshot.metadata,
            },
          ],
        } as any);

      const result = await getPolicySnapshotForExecution(mockPool, mockExecutionId);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(mockSnapshotId);
      expect(result?.version).toBe(mockPolicyVersion);
    });

    it('should return null if execution has no policy snapshot', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ policy_snapshot_id: null }],
      } as any);

      const result = await getPolicySnapshotForExecution(mockPool, mockExecutionId);

      expect(result).toBeNull();
    });

    it('should return null if execution not found', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
      } as any);

      const result = await getPolicySnapshotForExecution(mockPool, mockExecutionId);

      expect(result).toBeNull();
    });

    it('should handle errors and return null', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      const result = await getPolicySnapshotForExecution(mockPool, mockExecutionId);

      expect(result).toBeNull();
    });
  });
});
