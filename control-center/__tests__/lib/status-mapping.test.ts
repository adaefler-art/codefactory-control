/**
 * Unit tests for status mapping utility
 * Issue: E62.1 - Issue Liste: Filter, Sort, Labels, Status
 */

import {
  mapToCanonicalStatus,
  isLegacyStatus,
  getCanonicalStatuses,
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
});
