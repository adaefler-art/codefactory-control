/**
 * Tests for INTENT Message Classifier
 * Issue: V09-I02: Tool Gating: Action-Gated Draft Ops (No Auto-Snap)
 */

import { describe, it, expect } from '@jest/globals';
import { classifyMessage, hasSoftDraftIndicators } from '@/lib/intent/message-classifier';

describe('Message Classifier', () => {
  describe('classifyMessage', () => {
    describe('draft_create action intents', () => {
      it('should detect "create draft now"', () => {
        const result = classifyMessage('create draft now');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_create');
        expect(result.confidence).toBe('high');
      });

      it('should detect "create the draft immediately"', () => {
        const result = classifyMessage('create the draft immediately');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_create');
      });

      it('should detect "make a draft now"', () => {
        const result = classifyMessage('make a draft now');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_create');
      });
    });

    describe('draft_update action intents', () => {
      it('should detect "update draft"', () => {
        const result = classifyMessage('update draft');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_update');
        expect(result.confidence).toBe('high');
      });

      it('should detect "update the issue draft"', () => {
        const result = classifyMessage('update the issue draft');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_update');
      });

      it('should detect "modify draft"', () => {
        const result = classifyMessage('modify draft');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_update');
      });

      it('should detect "patch the draft"', () => {
        const result = classifyMessage('patch the draft');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_update');
      });

      it('should detect "edit draft"', () => {
        const result = classifyMessage('edit draft');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_update');
      });

      it('should detect "apply patch"', () => {
        const result = classifyMessage('apply patch to the draft');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_update');
      });
    });

    describe('draft_commit action intents', () => {
      it('should detect "commit draft"', () => {
        const result = classifyMessage('commit draft');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_commit');
        expect(result.confidence).toBe('high');
      });

      it('should detect "commit the issue draft"', () => {
        const result = classifyMessage('commit the issue draft');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_commit');
      });

      it('should detect "save version"', () => {
        const result = classifyMessage('save version');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_commit');
      });
    });

    describe('draft_publish action intents', () => {
      it('should detect "publish draft"', () => {
        const result = classifyMessage('publish draft');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_publish');
        expect(result.confidence).toBe('high');
      });

      it('should detect "publish to github"', () => {
        const result = classifyMessage('publish to github');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_publish');
      });

      it('should detect "publish issue"', () => {
        const result = classifyMessage('publish issue');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_publish');
      });
    });

    describe('change request action intents', () => {
      it('should detect "save change request"', () => {
        const result = classifyMessage('save change request');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('cr_save');
      });

      it('should detect "save CR"', () => {
        const result = classifyMessage('save CR');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('cr_save');
      });

      it('should detect "publish change request"', () => {
        const result = classifyMessage('publish change request');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('cr_publish');
      });
    });

    describe('issue set action intents', () => {
      it('should detect "generate issue set"', () => {
        const result = classifyMessage('generate issue set');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('issue_set_generate');
      });

      it('should detect "commit issue set"', () => {
        const result = classifyMessage('commit issue set');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('issue_set_commit');
      });

      it('should detect "publish issue set"', () => {
        const result = classifyMessage('publish issue set');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('issue_set_publish');
      });
    });

    describe('non-action intents', () => {
      it('should NOT detect "what is a draft?"', () => {
        const result = classifyMessage('what is a draft?');
        expect(result.isActionIntent).toBe(false);
        expect(result.actionType).toBeUndefined();
      });

      it('should NOT detect "can you help me with an issue?"', () => {
        const result = classifyMessage('can you help me with an issue?');
        expect(result.isActionIntent).toBe(false);
      });

      it('should NOT detect "show me the draft"', () => {
        const result = classifyMessage('show me the draft');
        expect(result.isActionIntent).toBe(false);
      });

      it('should NOT detect "what should the issue look like?"', () => {
        const result = classifyMessage('what should the issue look like?');
        expect(result.isActionIntent).toBe(false);
      });

      it('should NOT detect "I want to make an issue"', () => {
        const result = classifyMessage('I want to make an issue');
        expect(result.isActionIntent).toBe(false);
      });

      it('should NOT detect "please create an issue"', () => {
        const result = classifyMessage('please create an issue');
        expect(result.isActionIntent).toBe(false);
      });

      it('should NOT detect empty message', () => {
        const result = classifyMessage('');
        expect(result.isActionIntent).toBe(false);
        expect(result.confidence).toBe('high');
      });

      it('should handle whitespace-only message', () => {
        const result = classifyMessage('   ');
        expect(result.isActionIntent).toBe(false);
      });
    });

    describe('case insensitivity', () => {
      it('should detect "UPDATE DRAFT" (uppercase)', () => {
        const result = classifyMessage('UPDATE DRAFT');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_update');
      });

      it('should detect "CoMmIt DrAfT" (mixed case)', () => {
        const result = classifyMessage('CoMmIt DrAfT');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_commit');
      });
    });

    describe('with additional context', () => {
      it('should detect action in longer message', () => {
        const result = classifyMessage('I need you to update draft with new acceptance criteria');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_update');
      });

      it('should detect action at end of message', () => {
        const result = classifyMessage('After reviewing the requirements, commit draft');
        expect(result.isActionIntent).toBe(true);
        expect(result.actionType).toBe('draft_commit');
      });
    });
  });

  describe('hasSoftDraftIndicators', () => {
    it('should detect "make an issue"', () => {
      expect(hasSoftDraftIndicators('make an issue')).toBe(true);
    });

    it('should detect "create the issue"', () => {
      expect(hasSoftDraftIndicators('create the issue')).toBe(true);
    });

    it('should detect "generate issue"', () => {
      expect(hasSoftDraftIndicators('generate issue')).toBe(true);
    });

    it('should NOT detect "what is an issue?"', () => {
      expect(hasSoftDraftIndicators('what is an issue?')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(hasSoftDraftIndicators('MAKE AN ISSUE')).toBe(true);
    });
  });
});
