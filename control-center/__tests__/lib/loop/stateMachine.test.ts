/**
 * Unit Tests: AFU-9 Loop State Machine v1 (E9.1-CTRL-4)
 * 
 * Tests the pure state machine resolver with spec-related logic and blocker codes.
 * 
 * @jest-environment node
 */

import {
  resolveNextStep,
  isValidTransition,
  getBlockerDescription,
  BlockerCode,
  LoopStep,
  IssueState,
  type IssueData,
  type DraftData,
} from '../../../src/lib/loop/stateMachine';

describe('E9.1-CTRL-4: Loop State Machine v1', () => {
  describe('resolveNextStep - S1 (Pick Issue)', () => {
    test('should allow S1 when issue is CREATED with GitHub link', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.CREATED,
        github_url: 'https://github.com/org/repo/issues/123',
      };

      const result = resolveNextStep(issue);

      expect(result.step).toBe(LoopStep.S1_PICK_ISSUE);
      expect(result.blocked).toBe(false);
      expect(result.blockerCode).toBeUndefined();
    });

    test('should block S1 with NO_GITHUB_LINK when URL is missing', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.CREATED,
        github_url: null,
      };

      const result = resolveNextStep(issue);

      expect(result.step).toBeNull();
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.NO_GITHUB_LINK);
      expect(result.blockerMessage).toContain('GitHub issue link');
    });

    test('should block S1 with NO_GITHUB_LINK when URL is empty string', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.CREATED,
        github_url: '   ',
      };

      const result = resolveNextStep(issue);

      expect(result.step).toBeNull();
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.NO_GITHUB_LINK);
    });
  });

  describe('resolveNextStep - S2 (Spec Ready)', () => {
    test('should return S1 when in CREATED state without draft (S1 takes priority)', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.CREATED,
        github_url: 'https://github.com/org/repo/issues/123',
        current_draft_id: null,
      };

      const result = resolveNextStep(issue, null);

      // When in CREATED with GitHub link but no draft, S1 is the next step
      expect(result.step).toBe(LoopStep.S1_PICK_ISSUE);
      expect(result.blocked).toBe(false);
    });

    test('should block S2 with NO_COMMITTED_DRAFT when draft is not validated', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.CREATED,
        github_url: 'https://github.com/org/repo/issues/123',
        current_draft_id: 'draft-123',
        handoff_state: 'NOT_SENT',
      };

      const draft: DraftData = {
        id: 'draft-123',
        last_validation_status: 'unknown',
        issue_json: { title: 'Test' },
      };

      const result = resolveNextStep(issue, draft);

      expect(result.step).toBeNull();
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.NO_COMMITTED_DRAFT);
      expect(result.blockerMessage).toContain('committed and validated');
    });

    test('should block S2 with DRAFT_INVALID when draft validation failed', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.CREATED,
        github_url: 'https://github.com/org/repo/issues/123',
        current_draft_id: 'draft-123',
        handoff_state: 'SYNCED',
      };

      const draft: DraftData = {
        id: 'draft-123',
        last_validation_status: 'invalid',
        issue_json: { title: 'Test' },
      };

      const result = resolveNextStep(issue, draft);

      expect(result.step).toBeNull();
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.DRAFT_INVALID);
      expect(result.blockerMessage).toContain('validation failed');
    });

    test('should allow S2 when draft is valid and handoff_state is SYNCED', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.CREATED,
        github_url: 'https://github.com/org/repo/issues/123',
        current_draft_id: 'draft-123',
        handoff_state: 'SYNCED',
      };

      const draft: DraftData = {
        id: 'draft-123',
        last_validation_status: 'valid',
        issue_json: { title: 'Test' },
      };

      const result = resolveNextStep(issue, draft);

      expect(result.step).toBe(LoopStep.S2_SPEC_READY);
      expect(result.blocked).toBe(false);
      expect(result.blockerCode).toBeUndefined();
    });

    test('should allow S2 when draft is valid and handoff_state is SYNCHRONIZED', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: 'DRAFT_READY',
        github_url: 'https://github.com/org/repo/issues/123',
        current_draft_id: 'draft-123',
        handoff_state: 'SYNCHRONIZED',
      };

      const draft: DraftData = {
        id: 'draft-123',
        last_validation_status: 'valid',
        issue_json: { title: 'Test' },
      };

      const result = resolveNextStep(issue, draft);

      expect(result.step).toBe(LoopStep.S2_SPEC_READY);
      expect(result.blocked).toBe(false);
    });

    test('should allow S2 when draft validation status is valid (no handoff check)', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: 'VERSION_COMMITTED',
        github_url: 'https://github.com/org/repo/issues/123',
        current_draft_id: 'draft-123',
        handoff_state: 'NOT_SENT',
      };

      const draft: DraftData = {
        id: 'draft-123',
        last_validation_status: 'valid',
        issue_json: { title: 'Test' },
      };

      const result = resolveNextStep(issue, draft);

      expect(result.step).toBe(LoopStep.S2_SPEC_READY);
      expect(result.blocked).toBe(false);
    });
  });

  describe('resolveNextStep - S3 (Implement Prep)', () => {
    test('should allow S3 when issue is in SPEC_READY state', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.SPEC_READY,
        github_url: 'https://github.com/org/repo/issues/123',
      };

      const result = resolveNextStep(issue);

      expect(result.step).toBe(LoopStep.S3_IMPLEMENT_PREP);
      expect(result.blocked).toBe(false);
      expect(result.blockerCode).toBeUndefined();
    });
  });

  describe('resolveNextStep - Terminal States', () => {
    const assertNextStep = (status: IssueState, expectedStep: LoopStep | null) => {
      const issue: IssueData = {
        id: 'test-id',
        status,
        github_url: 'https://github.com/org/repo/issues/123',
      };

      const result = resolveNextStep(issue);

      expect(result.step).toBe(expectedStep);
      expect(result.blocked).toBe(false);
    };

    test('should return verify gate step for DONE state', () => {
      assertNextStep(IssueState.DONE, LoopStep.S7_VERIFY_GATE);
    });

    test('should return no step for HOLD state', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.HOLD,
        github_url: 'https://github.com/org/repo/issues/123',
      };

      const result = resolveNextStep(issue);

      expect(result.step).toBeNull();
      expect(result.blocked).toBe(false);
      expect(result.blockerMessage).toContain('terminal state');
    });

    test('should allow S4 for IMPLEMENTING_PREP state', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.IMPLEMENTING_PREP,
        github_url: 'https://github.com/org/repo/issues/123',
      };

      const result = resolveNextStep(issue);

      expect(result.step).toBe(LoopStep.S4_REVIEW);
      expect(result.blocked).toBe(false);
      expect(result.blockerCode).toBeUndefined();
    });

    test('should return merge step for REVIEW_READY state', () => {
      assertNextStep(IssueState.REVIEW_READY, LoopStep.S5_MERGE);
    });
  });

  describe('resolveNextStep - Invalid States', () => {
    test('should return UNKNOWN_STATE for missing status', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: '',
      };

      const result = resolveNextStep(issue);

      expect(result.step).toBeNull();
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.UNKNOWN_STATE);
      expect(result.blockerMessage).toContain('missing or invalid');
    });

    test('should return UNKNOWN_STATE for unrecognized status', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: 'INVALID_STATUS',
      };

      const result = resolveNextStep(issue);

      expect(result.step).toBeNull();
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.UNKNOWN_STATE);
      expect(result.blockerMessage).toContain('Unknown issue status');
    });
  });

  describe('isValidTransition', () => {
    test('should allow CREATED → SPEC_READY transition', () => {
      expect(isValidTransition(IssueState.CREATED, IssueState.SPEC_READY)).toBe(true);
    });

    test('should allow SPEC_READY → IMPLEMENTING_PREP transition', () => {
      expect(isValidTransition(IssueState.SPEC_READY, IssueState.IMPLEMENTING_PREP)).toBe(
        true
      );
    });

    test('should allow IMPLEMENTING_PREP → REVIEW_READY transition', () => {
      expect(isValidTransition(IssueState.IMPLEMENTING_PREP, IssueState.REVIEW_READY)).toBe(
        true
      );
    });

    test('should allow REVIEW_READY → DONE transition', () => {
      expect(isValidTransition(IssueState.REVIEW_READY, IssueState.DONE)).toBe(true);
    });

    test('should allow any non-terminal → HOLD transition', () => {
      expect(isValidTransition(IssueState.CREATED, IssueState.HOLD)).toBe(true);
      expect(isValidTransition(IssueState.SPEC_READY, IssueState.HOLD)).toBe(true);
      expect(isValidTransition(IssueState.IMPLEMENTING_PREP, IssueState.HOLD)).toBe(true);
      expect(isValidTransition(IssueState.REVIEW_READY, IssueState.HOLD)).toBe(true);
    });

    test('should not allow self-transitions', () => {
      expect(isValidTransition(IssueState.CREATED, IssueState.CREATED)).toBe(false);
      expect(isValidTransition(IssueState.SPEC_READY, IssueState.SPEC_READY)).toBe(false);
    });

    test('should not allow transitions from terminal states', () => {
      expect(isValidTransition(IssueState.DONE, IssueState.CREATED)).toBe(false);
      expect(isValidTransition(IssueState.HOLD, IssueState.SPEC_READY)).toBe(false);
    });

    test('should not allow skipping states', () => {
      expect(isValidTransition(IssueState.CREATED, IssueState.IMPLEMENTING_PREP)).toBe(false);
      expect(isValidTransition(IssueState.CREATED, IssueState.DONE)).toBe(false);
    });
  });

  describe('getBlockerDescription', () => {
    test('should return description for NO_GITHUB_LINK', () => {
      const desc = getBlockerDescription(BlockerCode.NO_GITHUB_LINK);
      expect(desc).toContain('GitHub issue');
    });

    test('should return description for NO_DRAFT', () => {
      const desc = getBlockerDescription(BlockerCode.NO_DRAFT);
      expect(desc).toContain('specification draft');
    });

    test('should return description for NO_COMMITTED_DRAFT', () => {
      const desc = getBlockerDescription(BlockerCode.NO_COMMITTED_DRAFT);
      expect(desc).toContain('committed and versioned');
    });

    test('should return description for DRAFT_INVALID', () => {
      const desc = getBlockerDescription(BlockerCode.DRAFT_INVALID);
      expect(desc).toContain('validation failed');
    });

    test('should return description for LOCKED', () => {
      const desc = getBlockerDescription(BlockerCode.LOCKED);
      expect(desc).toContain('locked');
    });

    test('should return description for UNKNOWN_STATE', () => {
      const desc = getBlockerDescription(BlockerCode.UNKNOWN_STATE);
      expect(desc).toContain('unknown or invalid state');
    });

    test('should return description for INVARIANT_VIOLATION', () => {
      const desc = getBlockerDescription(BlockerCode.INVARIANT_VIOLATION);
      expect(desc).toContain('invariant violated');
    });
  });

  describe('Determinism and Purity', () => {
    test('should return same result for same inputs (deterministic)', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.CREATED,
        github_url: 'https://github.com/org/repo/issues/123',
      };

      const result1 = resolveNextStep(issue);
      const result2 = resolveNextStep(issue);

      expect(result1).toEqual(result2);
    });

    test('should not modify input data (pure function)', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.CREATED,
        github_url: 'https://github.com/org/repo/issues/123',
      };

      const draft: DraftData = {
        id: 'draft-123',
        last_validation_status: 'valid',
      };

      const issueCopy = { ...issue };
      const draftCopy = { ...draft };

      resolveNextStep(issue, draft);

      expect(issue).toEqual(issueCopy);
      expect(draft).toEqual(draftCopy);
    });

    test('should handle null draft gracefully', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.SPEC_READY,
      };

      const result = resolveNextStep(issue, null);

      expect(result.step).toBe(LoopStep.S3_IMPLEMENT_PREP);
      expect(result.blocked).toBe(false);
    });

    test('should handle undefined draft gracefully', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.SPEC_READY,
      };

      const result = resolveNextStep(issue, undefined);

      expect(result.step).toBe(LoopStep.S3_IMPLEMENT_PREP);
      expect(result.blocked).toBe(false);
    });
  });

  describe('Spec-Specific Cases (Contract Validation)', () => {
    test('CASE 1: CREATED + no GitHub link → NO_GITHUB_LINK', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.CREATED,
        github_url: null,
      };

      const result = resolveNextStep(issue);

      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.NO_GITHUB_LINK);
      expect(result.step).toBeNull();
    });

    test('CASE 2: CREATED + GitHub link + no draft → S1 available', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.CREATED,
        github_url: 'https://github.com/org/repo/issues/123',
        current_draft_id: null,
      };

      const result = resolveNextStep(issue, null);

      // S1 is available in this state (pick issue), not blocked
      expect(result.blocked).toBe(false);
      expect(result.step).toBe(LoopStep.S1_PICK_ISSUE);
    });

    test('CASE 3: CREATED + draft not committed → NO_COMMITTED_DRAFT', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.CREATED,
        github_url: 'https://github.com/org/repo/issues/123',
        current_draft_id: 'draft-123',
        handoff_state: 'NOT_SENT',
      };

      const draft: DraftData = {
        id: 'draft-123',
        last_validation_status: 'unknown',
      };

      const result = resolveNextStep(issue, draft);

      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.NO_COMMITTED_DRAFT);
      expect(result.step).toBeNull();
    });

    test('CASE 4: CREATED + draft invalid → DRAFT_INVALID', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.CREATED,
        github_url: 'https://github.com/org/repo/issues/123',
        current_draft_id: 'draft-123',
        handoff_state: 'SYNCED',
      };

      const draft: DraftData = {
        id: 'draft-123',
        last_validation_status: 'invalid',
      };

      const result = resolveNextStep(issue, draft);

      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.DRAFT_INVALID);
      expect(result.step).toBeNull();
    });

    test('CASE 5: CREATED + valid draft → S2_SPEC_READY available', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.CREATED,
        github_url: 'https://github.com/org/repo/issues/123',
        current_draft_id: 'draft-123',
        handoff_state: 'SYNCED',
      };

      const draft: DraftData = {
        id: 'draft-123',
        last_validation_status: 'valid',
      };

      const result = resolveNextStep(issue, draft);

      expect(result.blocked).toBe(false);
      expect(result.step).toBe(LoopStep.S2_SPEC_READY);
      expect(result.blockerCode).toBeUndefined();
    });

    test('CASE 6: SPEC_READY → S3_IMPLEMENT_PREP available', () => {
      const issue: IssueData = {
        id: 'test-id',
        status: IssueState.SPEC_READY,
        github_url: 'https://github.com/org/repo/issues/123',
      };

      const result = resolveNextStep(issue);

      expect(result.blocked).toBe(false);
      expect(result.step).toBe(LoopStep.S3_IMPLEMENT_PREP);
      expect(result.blockerCode).toBeUndefined();
    });
  });
});
