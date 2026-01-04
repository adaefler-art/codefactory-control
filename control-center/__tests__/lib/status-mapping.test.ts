/**
 * Unit tests for status mapping utility
 * Issue: E62.1 - Issue Liste: Filter, Sort, Labels, Status
 * Issue: E62.1 (Fix) - Transition-aware status dropdown
 * Issue: E7_extra - GitHub Status Parity
 */

import {
  mapToCanonicalStatus,
  isLegacyStatus,
  getCanonicalStatuses,
  getAllowedNextStates,
  getSelectableStates,
  LegacyStatus,
  mapGitHubStatusToAfu9,
  extractGitHubStatus,
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

  describe('mapGitHubStatusToAfu9', () => {
    it('should map "Implementing" to IMPLEMENTING', () => {
      expect(mapGitHubStatusToAfu9('Implementing')).toBe(Afu9IssueStatus.IMPLEMENTING);
      expect(mapGitHubStatusToAfu9('implementing')).toBe(Afu9IssueStatus.IMPLEMENTING);
      expect(mapGitHubStatusToAfu9('In Progress')).toBe(Afu9IssueStatus.IMPLEMENTING);
      expect(mapGitHubStatusToAfu9('in_progress')).toBe(Afu9IssueStatus.IMPLEMENTING);
    });

    it('should map review states to MERGE_READY', () => {
      expect(mapGitHubStatusToAfu9('In Review')).toBe(Afu9IssueStatus.MERGE_READY);
      expect(mapGitHubStatusToAfu9('PR')).toBe(Afu9IssueStatus.MERGE_READY);
      expect(mapGitHubStatusToAfu9('Review')).toBe(Afu9IssueStatus.MERGE_READY);
      expect(mapGitHubStatusToAfu9('merge ready')).toBe(Afu9IssueStatus.MERGE_READY);
    });

    it('should map done states to DONE', () => {
      expect(mapGitHubStatusToAfu9('Done')).toBe(Afu9IssueStatus.DONE);
      expect(mapGitHubStatusToAfu9('done')).toBe(Afu9IssueStatus.DONE);
      expect(mapGitHubStatusToAfu9('Completed')).toBe(Afu9IssueStatus.DONE);
      expect(mapGitHubStatusToAfu9('Closed')).toBe(Afu9IssueStatus.DONE);
    });

    it('should map blocked states to HOLD', () => {
      expect(mapGitHubStatusToAfu9('Blocked')).toBe(Afu9IssueStatus.HOLD);
      expect(mapGitHubStatusToAfu9('Hold')).toBe(Afu9IssueStatus.HOLD);
      expect(mapGitHubStatusToAfu9('Waiting')).toBe(Afu9IssueStatus.HOLD);
      expect(mapGitHubStatusToAfu9('On Hold')).toBe(Afu9IssueStatus.HOLD);
    });

    it('should map spec ready states to SPEC_READY', () => {
      expect(mapGitHubStatusToAfu9('Spec Ready')).toBe(Afu9IssueStatus.SPEC_READY);
      expect(mapGitHubStatusToAfu9('Ready')).toBe(Afu9IssueStatus.SPEC_READY);
      expect(mapGitHubStatusToAfu9('To Do')).toBe(Afu9IssueStatus.SPEC_READY);
      expect(mapGitHubStatusToAfu9('todo')).toBe(Afu9IssueStatus.SPEC_READY);
    });

    it('should return null for unknown statuses (fail-closed)', () => {
      expect(mapGitHubStatusToAfu9('Unknown')).toBeNull();
      expect(mapGitHubStatusToAfu9('Invalid')).toBeNull();
      expect(mapGitHubStatusToAfu9('Something Else')).toBeNull();
    });

    it('should return null for null/undefined/empty input', () => {
      expect(mapGitHubStatusToAfu9(null)).toBeNull();
      expect(mapGitHubStatusToAfu9(undefined)).toBeNull();
      expect(mapGitHubStatusToAfu9('')).toBeNull();
      expect(mapGitHubStatusToAfu9('   ')).toBeNull();
    });

    it('should be case-insensitive', () => {
      expect(mapGitHubStatusToAfu9('IMPLEMENTING')).toBe(Afu9IssueStatus.IMPLEMENTING);
      expect(mapGitHubStatusToAfu9('implementing')).toBe(Afu9IssueStatus.IMPLEMENTING);
      expect(mapGitHubStatusToAfu9('ImPlEmEnTiNg')).toBe(Afu9IssueStatus.IMPLEMENTING);
    });

    it('should handle whitespace', () => {
      expect(mapGitHubStatusToAfu9('  Implementing  ')).toBe(Afu9IssueStatus.IMPLEMENTING);
      expect(mapGitHubStatusToAfu9(' Done ')).toBe(Afu9IssueStatus.DONE);
    });
  });

  describe('extractGitHubStatus', () => {
    it('should prioritize project status over labels and state', () => {
      const result = extractGitHubStatus(
        'Implementing',
        [{ name: 'status: done' }],
        'closed'
      );
      expect(result.raw).toBe('Implementing');
      expect(result.source).toBe('github_project');
    });

    it('should use label status if project status is missing', () => {
      const result = extractGitHubStatus(
        null,
        [{ name: 'status: implementing' }],
        'open'
      );
      expect(result.raw).toBe('implementing');
      expect(result.source).toBe('github_label');
    });

    it('should use issue state as fallback for closed issues', () => {
      const result = extractGitHubStatus(null, [], 'closed');
      expect(result.raw).toBe('closed');
      expect(result.source).toBe('github_state');
    });

    it('should return null for open issues without project/label status', () => {
      const result = extractGitHubStatus(null, [], 'open');
      expect(result.raw).toBeNull();
      expect(result.source).toBeNull();
    });

    it('should extract first matching status label', () => {
      const result = extractGitHubStatus(
        null,
        [
          { name: 'bug' },
          { name: 'status: implementing' },
          { name: 'status: done' },
        ],
        'open'
      );
      expect(result.raw).toBe('implementing');
      expect(result.source).toBe('github_label');
    });

    it('should handle labels without "status:" prefix', () => {
      const result = extractGitHubStatus(
        null,
        [{ name: 'bug' }, { name: 'enhancement' }],
        'open'
      );
      expect(result.raw).toBeNull();
      expect(result.source).toBeNull();
    });

    it('should handle empty labels array', () => {
      const result = extractGitHubStatus(null, [], 'open');
      expect(result.raw).toBeNull();
      expect(result.source).toBeNull();
    });

    it('should handle null/undefined labels', () => {
      const result1 = extractGitHubStatus(null, null, 'open');
      expect(result1.raw).toBeNull();
      expect(result1.source).toBeNull();

      const result2 = extractGitHubStatus(null, undefined, 'open');
      expect(result2.raw).toBeNull();
      expect(result2.source).toBeNull();
    });

    it('should trim whitespace from project status', () => {
      const result = extractGitHubStatus('  Implementing  ', [], 'open');
      expect(result.raw).toBe('Implementing');
      expect(result.source).toBe('github_project');
    });
  });
});
