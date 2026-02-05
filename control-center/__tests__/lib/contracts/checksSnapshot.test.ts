/**
 * Tests for Checks Snapshot Contracts
 * 
 * E9.3-CTRL-02: Checks Mirror
 */

import {
  CheckEntry,
  CheckStatus,
  CheckConclusion,
  ChecksSnapshotInput,
  calculateSnapshotHash,
  calculateChecksSummary,
  validateSnapshotInput,
  shouldBlockGate,
  getGateDecision,
} from '../../../src/lib/contracts/checksSnapshot';

describe('Checks Snapshot Contracts', () => {
  describe('calculateSnapshotHash', () => {
    it('should generate consistent hash for same inputs', () => {
      const checks: CheckEntry[] = [
        { name: 'test', status: 'completed', conclusion: 'success' },
        { name: 'build', status: 'completed', conclusion: 'success' },
      ];

      const hash1 = calculateSnapshotHash('owner', 'repo', 'abc123', checks);
      const hash2 = calculateSnapshotHash('owner', 'repo', 'abc123', checks);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 = 64 hex chars
    });

    it('should generate different hash for different checks', () => {
      const checks1: CheckEntry[] = [
        { name: 'test', status: 'completed', conclusion: 'success' },
      ];
      const checks2: CheckEntry[] = [
        { name: 'test', status: 'completed', conclusion: 'failure' },
      ];

      const hash1 = calculateSnapshotHash('owner', 'repo', 'abc123', checks1);
      const hash2 = calculateSnapshotHash('owner', 'repo', 'abc123', checks2);

      expect(hash1).not.toBe(hash2);
    });

    it('should normalize check order', () => {
      const checks1: CheckEntry[] = [
        { name: 'build', status: 'completed', conclusion: 'success' },
        { name: 'test', status: 'completed', conclusion: 'success' },
      ];
      const checks2: CheckEntry[] = [
        { name: 'test', status: 'completed', conclusion: 'success' },
        { name: 'build', status: 'completed', conclusion: 'success' },
      ];

      const hash1 = calculateSnapshotHash('owner', 'repo', 'abc123', checks1);
      const hash2 = calculateSnapshotHash('owner', 'repo', 'abc123', checks2);

      expect(hash1).toBe(hash2); // Same hash despite different order
    });

    it('should generate different hash for different ref', () => {
      const checks: CheckEntry[] = [
        { name: 'test', status: 'completed', conclusion: 'success' },
      ];

      const hash1 = calculateSnapshotHash('owner', 'repo', 'abc123', checks);
      const hash2 = calculateSnapshotHash('owner', 'repo', 'def456', checks);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('calculateChecksSummary', () => {
    it('should calculate summary for all successful checks', () => {
      const checks: CheckEntry[] = [
        { name: 'test', status: 'completed', conclusion: 'success' },
        { name: 'build', status: 'completed', conclusion: 'success' },
      ];

      const summary = calculateChecksSummary(checks);

      expect(summary).toEqual({
        total_checks: 2,
        failed_checks: 0,
        pending_checks: 0,
      });
    });

    it('should count failed checks', () => {
      const checks: CheckEntry[] = [
        { name: 'test', status: 'completed', conclusion: 'success' },
        { name: 'build', status: 'completed', conclusion: 'failure' },
      ];

      const summary = calculateChecksSummary(checks);

      expect(summary).toEqual({
        total_checks: 2,
        failed_checks: 1,
        pending_checks: 0,
      });
    });

    it('should count pending checks', () => {
      const checks: CheckEntry[] = [
        { name: 'test', status: 'in_progress', conclusion: null },
        { name: 'build', status: 'queued', conclusion: null },
      ];

      const summary = calculateChecksSummary(checks);

      expect(summary).toEqual({
        total_checks: 2,
        failed_checks: 0,
        pending_checks: 2,
      });
    });

    it('should handle mixed statuses', () => {
      const checks: CheckEntry[] = [
        { name: 'test', status: 'completed', conclusion: 'success' },
        { name: 'build', status: 'completed', conclusion: 'failure' },
        { name: 'lint', status: 'in_progress', conclusion: null },
        { name: 'e2e', status: 'completed', conclusion: 'neutral' },
      ];

      const summary = calculateChecksSummary(checks);

      expect(summary).toEqual({
        total_checks: 4,
        failed_checks: 1, // Only build failed
        pending_checks: 1, // lint in progress
      });
    });

    it('should not count skipped/neutral as failed', () => {
      const checks: CheckEntry[] = [
        { name: 'test', status: 'completed', conclusion: 'skipped' },
        { name: 'build', status: 'completed', conclusion: 'neutral' },
      ];

      const summary = calculateChecksSummary(checks);

      expect(summary.failed_checks).toBe(0);
    });
  });

  describe('validateSnapshotInput', () => {
    it('should validate correct input', () => {
      const input: ChecksSnapshotInput = {
        repo_owner: 'owner',
        repo_name: 'repo',
        ref: 'abc123',
        checks: [
          { name: 'test', status: 'completed', conclusion: 'success' },
        ],
      };

      const result = validateSnapshotInput(input);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual(input);
    });

    it('should reject missing required fields', () => {
      const input = {
        repo_owner: 'owner',
        // missing repo_name
        ref: 'abc123',
        checks: [],
      };

      const result = validateSnapshotInput(input);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('repo_name');
    });

    it('should reject invalid check status', () => {
      const input = {
        repo_owner: 'owner',
        repo_name: 'repo',
        ref: 'abc123',
        checks: [
          { name: 'test', status: 'invalid_status', conclusion: 'success' },
        ],
      };

      const result = validateSnapshotInput(input);

      expect(result.valid).toBe(false);
      expect(typeof result.error).toBe('string');
    });
  });

  describe('shouldBlockGate (fail-closed logic)', () => {
    it('should BLOCK when checks are pending', () => {
      const snapshot = {
        id: '1',
        run_id: null,
        issue_id: null,
        repo_owner: 'owner',
        repo_name: 'repo',
        ref: 'abc123',
        captured_at: '2026-02-04T00:00:00Z',
        checks: [],
        total_checks: 2,
        failed_checks: 0,
        pending_checks: 1, // At least one pending
        snapshot_hash: 'hash',
        request_id: null,
        created_at: '2026-02-04T00:00:00Z',
        updated_at: '2026-02-04T00:00:00Z',
      };

      expect(shouldBlockGate(snapshot)).toBe(true);
    });

    it('should BLOCK when checks failed', () => {
      const snapshot = {
        id: '1',
        run_id: null,
        issue_id: null,
        repo_owner: 'owner',
        repo_name: 'repo',
        ref: 'abc123',
        captured_at: '2026-02-04T00:00:00Z',
        checks: [],
        total_checks: 2,
        failed_checks: 1, // At least one failed
        pending_checks: 0,
        snapshot_hash: 'hash',
        request_id: null,
        created_at: '2026-02-04T00:00:00Z',
        updated_at: '2026-02-04T00:00:00Z',
      };

      expect(shouldBlockGate(snapshot)).toBe(true);
    });

    it('should PROCEED when all checks passed', () => {
      const snapshot = {
        id: '1',
        run_id: null,
        issue_id: null,
        repo_owner: 'owner',
        repo_name: 'repo',
        ref: 'abc123',
        captured_at: '2026-02-04T00:00:00Z',
        checks: [],
        total_checks: 2,
        failed_checks: 0,
        pending_checks: 0,
        snapshot_hash: 'hash',
        request_id: null,
        created_at: '2026-02-04T00:00:00Z',
        updated_at: '2026-02-04T00:00:00Z',
      };

      expect(shouldBlockGate(snapshot)).toBe(false);
    });
  });

  describe('getGateDecision', () => {
    it('should return BLOCK with reason for pending checks', () => {
      const snapshot = {
        id: '1',
        run_id: null,
        issue_id: null,
        repo_owner: 'owner',
        repo_name: 'repo',
        ref: 'abc123',
        captured_at: '2026-02-04T00:00:00Z',
        checks: [],
        total_checks: 3,
        failed_checks: 0,
        pending_checks: 2,
        snapshot_hash: 'hash',
        request_id: null,
        created_at: '2026-02-04T00:00:00Z',
        updated_at: '2026-02-04T00:00:00Z',
      };

      const decision = getGateDecision(snapshot);

      expect(decision.decision).toBe('BLOCK');
      expect(decision.reason).toContain('2 check(s) still pending');
    });

    it('should return BLOCK with reason for failed checks', () => {
      const snapshot = {
        id: '1',
        run_id: null,
        issue_id: null,
        repo_owner: 'owner',
        repo_name: 'repo',
        ref: 'abc123',
        captured_at: '2026-02-04T00:00:00Z',
        checks: [],
        total_checks: 3,
        failed_checks: 1,
        pending_checks: 0,
        snapshot_hash: 'hash',
        request_id: null,
        created_at: '2026-02-04T00:00:00Z',
        updated_at: '2026-02-04T00:00:00Z',
      };

      const decision = getGateDecision(snapshot);

      expect(decision.decision).toBe('BLOCK');
      expect(decision.reason).toContain('1 check(s) failed');
    });

    it('should return BLOCK for zero checks (fail-closed)', () => {
      const snapshot = {
        id: '1',
        run_id: null,
        issue_id: null,
        repo_owner: 'owner',
        repo_name: 'repo',
        ref: 'abc123',
        captured_at: '2026-02-04T00:00:00Z',
        checks: [],
        total_checks: 0,
        failed_checks: 0,
        pending_checks: 0,
        snapshot_hash: 'hash',
        request_id: null,
        created_at: '2026-02-04T00:00:00Z',
        updated_at: '2026-02-04T00:00:00Z',
      };

      const decision = getGateDecision(snapshot);

      expect(decision.decision).toBe('BLOCK');
      expect(decision.reason).toContain('No checks found');
    });

    it('should return PROCEED when all checks passed', () => {
      const snapshot = {
        id: '1',
        run_id: null,
        issue_id: null,
        repo_owner: 'owner',
        repo_name: 'repo',
        ref: 'abc123',
        captured_at: '2026-02-04T00:00:00Z',
        checks: [],
        total_checks: 5,
        failed_checks: 0,
        pending_checks: 0,
        snapshot_hash: 'hash',
        request_id: null,
        created_at: '2026-02-04T00:00:00Z',
        updated_at: '2026-02-04T00:00:00Z',
      };

      const decision = getGateDecision(snapshot);

      expect(decision.decision).toBe('PROCEED');
      expect(decision.reason).toContain('All 5 checks passed');
    });
  });
});
