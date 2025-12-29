/**
 * Unit tests for status mapping utility
 * Issue: E62.1 - Issue Liste: Filter, Sort, Labels, Status
 * Issue: E62.1 (Fix) - Transition-aware status dropdown
 */

import {
  mapToCanonicalStatus,
  isLegacyStatus,
  getCanonicalStatuses,
  getAllowedNextStates,
  getSelectableStates,
  LegacyStatus,
} from '../../src/lib/utils/status-mapping';
import { Afu9IssueStatus } from '../../src/lib/contracts/afu9Issue';

describe('status-mapping utility', () => {
  describe('mapToCanonicalStatus', () => {
    it('should map ACTIVE to SPEC_READY', () => {
      expect(mapToCanonicalStatus('ACTIVE')).toBe(Afu9IssueStatus.SPEC_READY);
    });

    it('should map BLOCKED to HOLD', () => {
      expect(mapToCanonicalStatus('BLOCKED')).toBe(Afu9IssueStatus.HOLD);
    });

    it('should map FAILED to HOLD', () => {
      expect(mapToCanonicalStatus('FAILED')).toBe(Afu9IssueStatus.HOLD);
    });

    it('should return canonical statuses unchanged', () => {
      expect(mapToCanonicalStatus('CREATED')).toBe(Afu9IssueStatus.CREATED);
      expect(mapToCanonicalStatus('SPEC_READY')).toBe(Afu9IssueStatus.SPEC_READY);
      expect(mapToCanonicalStatus('IMPLEMENTING')).toBe(Afu9IssueStatus.IMPLEMENTING);
      expect(mapToCanonicalStatus('VERIFIED')).toBe(Afu9IssueStatus.VERIFIED);
      expect(mapToCanonicalStatus('MERGE_READY')).toBe(Afu9IssueStatus.MERGE_READY);
      expect(mapToCanonicalStatus('DONE')).toBe(Afu9IssueStatus.DONE);
      expect(mapToCanonicalStatus('HOLD')).toBe(Afu9IssueStatus.HOLD);
      expect(mapToCanonicalStatus('KILLED')).toBe(Afu9IssueStatus.KILLED);
    });

    it('should default unknown statuses to CREATED', () => {
      expect(mapToCanonicalStatus('UNKNOWN')).toBe(Afu9IssueStatus.CREATED);
      expect(mapToCanonicalStatus('INVALID')).toBe(Afu9IssueStatus.CREATED);
    });
  });

  describe('isLegacyStatus', () => {
    it('should return true for legacy statuses', () => {
      expect(isLegacyStatus('ACTIVE')).toBe(true);
      expect(isLegacyStatus('BLOCKED')).toBe(true);
      expect(isLegacyStatus('FAILED')).toBe(true);
    });

    it('should return false for canonical statuses', () => {
      expect(isLegacyStatus('CREATED')).toBe(false);
      expect(isLegacyStatus('SPEC_READY')).toBe(false);
      expect(isLegacyStatus('IMPLEMENTING')).toBe(false);
      expect(isLegacyStatus('VERIFIED')).toBe(false);
      expect(isLegacyStatus('MERGE_READY')).toBe(false);
      expect(isLegacyStatus('DONE')).toBe(false);
      expect(isLegacyStatus('HOLD')).toBe(false);
      expect(isLegacyStatus('KILLED')).toBe(false);
    });

    it('should return false for unknown statuses', () => {
      expect(isLegacyStatus('UNKNOWN')).toBe(false);
    });
  });

  describe('getCanonicalStatuses', () => {
    it('should return all canonical statuses', () => {
      const statuses = getCanonicalStatuses();
      expect(statuses).toContain(Afu9IssueStatus.CREATED);
      expect(statuses).toContain(Afu9IssueStatus.SPEC_READY);
      expect(statuses).toContain(Afu9IssueStatus.IMPLEMENTING);
      expect(statuses).toContain(Afu9IssueStatus.VERIFIED);
      expect(statuses).toContain(Afu9IssueStatus.MERGE_READY);
      expect(statuses).toContain(Afu9IssueStatus.DONE);
      expect(statuses).toContain(Afu9IssueStatus.HOLD);
      expect(statuses).toContain(Afu9IssueStatus.KILLED);
    });

    it('should not return legacy statuses', () => {
      const statuses = getCanonicalStatuses();
      expect(statuses).not.toContain(LegacyStatus.ACTIVE);
      expect(statuses).not.toContain(LegacyStatus.BLOCKED);
      expect(statuses).not.toContain(LegacyStatus.FAILED);
    });

    it('should return exactly 8 statuses', () => {
      const statuses = getCanonicalStatuses();
      expect(statuses).toHaveLength(8);
    });
  });

  describe('getAllowedNextStates', () => {
    it('should return allowed transitions for IMPLEMENTING', () => {
      const allowed = getAllowedNextStates('IMPLEMENTING');
      expect(allowed).toContain(Afu9IssueStatus.VERIFIED);
      expect(allowed).toContain(Afu9IssueStatus.SPEC_READY); // Can go back
      expect(allowed).toContain(Afu9IssueStatus.HOLD);
      expect(allowed).toContain(Afu9IssueStatus.KILLED);
      expect(allowed).not.toContain(Afu9IssueStatus.DONE); // Cannot skip VERIFIED
      expect(allowed).not.toContain(Afu9IssueStatus.MERGE_READY); // Cannot skip VERIFIED
    });

    it('should return allowed transitions for VERIFIED', () => {
      const allowed = getAllowedNextStates('VERIFIED');
      expect(allowed).toContain(Afu9IssueStatus.MERGE_READY);
      expect(allowed).toContain(Afu9IssueStatus.IMPLEMENTING); // Can go back
      expect(allowed).toContain(Afu9IssueStatus.HOLD);
      expect(allowed).toContain(Afu9IssueStatus.KILLED);
      expect(allowed).not.toContain(Afu9IssueStatus.DONE); // Cannot skip MERGE_READY
    });

    it('should return allowed transitions for CREATED', () => {
      const allowed = getAllowedNextStates('CREATED');
      expect(allowed).toContain(Afu9IssueStatus.SPEC_READY);
      expect(allowed).toContain(Afu9IssueStatus.HOLD);
      expect(allowed).toContain(Afu9IssueStatus.KILLED);
      expect(allowed).not.toContain(Afu9IssueStatus.IMPLEMENTING); // Must go through SPEC_READY
    });

    it('should return empty array for DONE (terminal state)', () => {
      const allowed = getAllowedNextStates('DONE');
      expect(allowed).toHaveLength(0);
    });

    it('should return empty array for KILLED (terminal state)', () => {
      const allowed = getAllowedNextStates('KILLED');
      expect(allowed).toHaveLength(0);
    });

    it('should handle legacy status by mapping to canonical first', () => {
      // ACTIVE maps to SPEC_READY, which can go to IMPLEMENTING, HOLD, KILLED
      const allowed = getAllowedNextStates('ACTIVE');
      expect(allowed).toContain(Afu9IssueStatus.IMPLEMENTING);
      expect(allowed).toContain(Afu9IssueStatus.HOLD);
      expect(allowed).toContain(Afu9IssueStatus.KILLED);
    });
  });

  describe('getSelectableStates', () => {
    it('should include current state and allowed next states', () => {
      const selectable = getSelectableStates('IMPLEMENTING');
      expect(selectable).toContain(Afu9IssueStatus.IMPLEMENTING); // Current
      expect(selectable).toContain(Afu9IssueStatus.VERIFIED); // Allowed next
      expect(selectable).toContain(Afu9IssueStatus.SPEC_READY); // Allowed next (back)
      expect(selectable).toContain(Afu9IssueStatus.HOLD); // Allowed next
      expect(selectable).toContain(Afu9IssueStatus.KILLED); // Allowed next
    });

    it('should only include current state for terminal states', () => {
      const selectableDone = getSelectableStates('DONE');
      expect(selectableDone).toContain(Afu9IssueStatus.DONE);
      expect(selectableDone).toHaveLength(1);

      const selectableKilled = getSelectableStates('KILLED');
      expect(selectableKilled).toContain(Afu9IssueStatus.KILLED);
      expect(selectableKilled).toHaveLength(1);
    });

    it('should map legacy status to canonical before getting selectable states', () => {
      // ACTIVE maps to SPEC_READY
      const selectable = getSelectableStates('ACTIVE');
      expect(selectable).toContain(Afu9IssueStatus.SPEC_READY); // Current (mapped)
      expect(selectable).toContain(Afu9IssueStatus.IMPLEMENTING); // Allowed next
      expect(selectable).not.toContain('ACTIVE' as any); // No legacy in output
    });

    it('should not have duplicates', () => {
      const selectable = getSelectableStates('HOLD');
      const unique = new Set(selectable);
      expect(selectable.length).toBe(unique.size);
    });
  });
});
