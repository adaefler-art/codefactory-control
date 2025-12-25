/**
 * AFU9 Issue Contract Tests
 * 
 * Validates the contract schema for afu9_issues table.
 * Ensures proper validation of required fields, enums, and length constraints.
 * 
 * @jest-environment node
 */

import {
  validateAfu9IssueInput,
  sanitizeAfu9IssueInput,
  AFU9_ISSUE_CONSTRAINTS,
  Afu9IssueInput,
  Afu9IssueStatus,
  Afu9HandoffState,
  Afu9IssuePriority,
  isValidStatus,
  isValidHandoffState,
  isValidPriority,
} from '../../../src/lib/contracts/afu9Issue';

describe('AFU9 Issue Contract', () => {
  describe('Type Guards', () => {
    test('isValidStatus accepts valid statuses', () => {
      expect(isValidStatus('CREATED')).toBe(true);
      expect(isValidStatus('SPEC_READY')).toBe(true);
      expect(isValidStatus('IMPLEMENTING')).toBe(true);
      expect(isValidStatus('ACTIVE')).toBe(true);
      expect(isValidStatus('BLOCKED')).toBe(true);
      expect(isValidStatus('DONE')).toBe(true);
      expect(isValidStatus('FAILED')).toBe(true);
    });

    test('isValidStatus rejects invalid statuses', () => {
      expect(isValidStatus('INVALID')).toBe(false);
      expect(isValidStatus('active')).toBe(false);
      expect(isValidStatus('')).toBe(false);
    });

    test('isValidHandoffState accepts valid states', () => {
      expect(isValidHandoffState('NOT_SENT')).toBe(true);
      expect(isValidHandoffState('SENT')).toBe(true);
      expect(isValidHandoffState('SYNCED')).toBe(true);
      expect(isValidHandoffState('FAILED')).toBe(true);
    });

    test('isValidHandoffState rejects invalid states', () => {
      expect(isValidHandoffState('INVALID')).toBe(false);
      expect(isValidHandoffState('sent')).toBe(false);
      expect(isValidHandoffState('')).toBe(false);
    });

    test('isValidPriority accepts valid priorities', () => {
      expect(isValidPriority('P0')).toBe(true);
      expect(isValidPriority('P1')).toBe(true);
      expect(isValidPriority('P2')).toBe(true);
    });

    test('isValidPriority rejects invalid priorities', () => {
      expect(isValidPriority('P3')).toBe(false);
      expect(isValidPriority('p0')).toBe(false);
      expect(isValidPriority('HIGH')).toBe(false);
    });
  });

  describe('validateAfu9IssueInput', () => {
    test('accepts valid minimal input', () => {
      const input = {
        title: 'Test issue',
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('accepts valid complete input', () => {
      const input = {
        title: 'Test issue',
        body: 'This is a test issue',
        status: Afu9IssueStatus.CREATED,
        labels: ['bug', 'priority'],
        priority: Afu9IssuePriority.P1,
        assignee: 'agent-1',
        source: 'afu9',
        handoff_state: Afu9HandoffState.NOT_SENT,
        github_issue_number: null,
        github_url: null,
        last_error: null,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('rejects non-object input', () => {
      const result = validateAfu9IssueInput('not an object');

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('input');
      expect(result.errors[0].message).toContain('must be an object');
    });

    test('rejects null input', () => {
      const result = validateAfu9IssueInput(null);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('input');
    });

    test('rejects missing title', () => {
      const input = {
        body: 'Test body',
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'title')).toBe(true);
    });

    test('rejects empty title', () => {
      const input = {
        title: '',
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'title')).toBe(true);
    });

    test('rejects whitespace-only title', () => {
      const input = {
        title: '   ',
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'title')).toBe(true);
    });

    test('rejects title exceeding max length', () => {
      const input = {
        title: 'a'.repeat(AFU9_ISSUE_CONSTRAINTS.title + 1),
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'title' && e.message.includes('exceeds'))).toBe(
        true
      );
    });

    test('accepts null body', () => {
      const input = {
        title: 'Test',
        body: null,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(true);
    });

    test('rejects non-string body', () => {
      const input = {
        title: 'Test',
        body: 123 as any,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'body')).toBe(true);
    });

    test('accepts valid status', () => {
      const input = {
        title: 'Test',
        status: Afu9IssueStatus.ACTIVE,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(true);
    });

    test('rejects invalid status', () => {
      const input = {
        title: 'Test',
        status: 'INVALID' as any,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'status')).toBe(true);
    });

    test('accepts valid labels array', () => {
      const input = {
        title: 'Test',
        labels: ['bug', 'feature', 'urgent'],
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(true);
    });

    test('rejects non-array labels', () => {
      const input = {
        title: 'Test',
        labels: 'bug' as any,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'labels')).toBe(true);
    });

    test('rejects labels with non-string elements', () => {
      const input = {
        title: 'Test',
        labels: ['bug', 123, 'feature'] as any,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'labels')).toBe(true);
    });

    test('accepts null priority', () => {
      const input = {
        title: 'Test',
        priority: null,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(true);
    });

    test('accepts valid priority', () => {
      const input = {
        title: 'Test',
        priority: Afu9IssuePriority.P0,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(true);
    });

    test('rejects invalid priority', () => {
      const input = {
        title: 'Test',
        priority: 'P3' as any,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'priority')).toBe(true);
    });

    test('accepts null assignee', () => {
      const input = {
        title: 'Test',
        assignee: null,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(true);
    });

    test('rejects assignee exceeding max length', () => {
      const input = {
        title: 'Test',
        assignee: 'a'.repeat(AFU9_ISSUE_CONSTRAINTS.assignee + 1),
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === 'assignee' && e.message.includes('exceeds'))
      ).toBe(true);
    });

    test('accepts source as afu9', () => {
      const input = {
        title: 'Test',
        source: 'afu9',
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(true);
    });

    test('rejects source other than afu9', () => {
      const input = {
        title: 'Test',
        source: 'github',
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'source')).toBe(true);
    });

    test('accepts valid handoff_state', () => {
      const input = {
        title: 'Test',
        handoff_state: Afu9HandoffState.SYNCED,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(true);
    });

    test('rejects invalid handoff_state', () => {
      const input = {
        title: 'Test',
        handoff_state: 'INVALID' as any,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'handoff_state')).toBe(true);
    });

    test('accepts valid github_issue_number', () => {
      const input = {
        title: 'Test',
        github_issue_number: 123,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(true);
    });

    test('accepts null github_issue_number', () => {
      const input = {
        title: 'Test',
        github_issue_number: null,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(true);
    });

    test('rejects negative github_issue_number', () => {
      const input = {
        title: 'Test',
        github_issue_number: -1,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'github_issue_number')).toBe(true);
    });

    test('rejects zero github_issue_number', () => {
      const input = {
        title: 'Test',
        github_issue_number: 0,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'github_issue_number')).toBe(true);
    });

    test('accepts null github_url', () => {
      const input = {
        title: 'Test',
        github_url: null,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(true);
    });

    test('rejects github_url exceeding max length', () => {
      const input = {
        title: 'Test',
        github_url: 'https://github.com/' + 'a'.repeat(AFU9_ISSUE_CONSTRAINTS.github_url),
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === 'github_url' && e.message.includes('exceeds'))
      ).toBe(true);
    });

    test('accepts null last_error', () => {
      const input = {
        title: 'Test',
        last_error: null,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(true);
    });

    test('rejects non-string last_error', () => {
      const input = {
        title: 'Test',
        last_error: 123 as any,
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'last_error')).toBe(true);
    });

    test('validates at exact max lengths (boundary test)', () => {
      const input = {
        title: 'a'.repeat(AFU9_ISSUE_CONSTRAINTS.title),
        assignee: 'b'.repeat(AFU9_ISSUE_CONSTRAINTS.assignee),
        github_url: 'c'.repeat(AFU9_ISSUE_CONSTRAINTS.github_url),
      };

      const result = validateAfu9IssueInput(input);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('sanitizeAfu9IssueInput', () => {
    test('trims whitespace from title', () => {
      const input: Afu9IssueInput = {
        title: '  Test issue  ',
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.title).toBe('Test issue');
    });

    test('clamps title to max length', () => {
      const input: Afu9IssueInput = {
        title: 'a'.repeat(AFU9_ISSUE_CONSTRAINTS.title + 10),
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.title).toHaveLength(AFU9_ISSUE_CONSTRAINTS.title);
    });

    test('trims whitespace from body', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
        body: '  Body content  ',
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.body).toBe('Body content');
    });

    test('handles undefined body', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.body).toBeNull();
    });

    test('handles null body', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
        body: null,
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.body).toBeNull();
    });

    test('sets default status to CREATED', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.status).toBe(Afu9IssueStatus.CREATED);
    });

    test('preserves provided status', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
        status: Afu9IssueStatus.ACTIVE,
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.status).toBe(Afu9IssueStatus.ACTIVE);
    });

    test('sets default labels to empty array', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.labels).toEqual([]);
    });

    test('preserves provided labels', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
        labels: ['bug', 'feature'],
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.labels).toEqual(['bug', 'feature']);
    });

    test('handles undefined priority', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.priority).toBeNull();
    });

    test('preserves provided priority', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
        priority: Afu9IssuePriority.P1,
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.priority).toBe(Afu9IssuePriority.P1);
    });

    test('trims whitespace from assignee', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
        assignee: '  agent-1  ',
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.assignee).toBe('agent-1');
    });

    test('clamps assignee to max length', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
        assignee: 'a'.repeat(AFU9_ISSUE_CONSTRAINTS.assignee + 10),
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.assignee).toHaveLength(AFU9_ISSUE_CONSTRAINTS.assignee);
    });

    test('handles null assignee', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
        assignee: null,
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.assignee).toBeNull();
    });

    test('always sets source to afu9', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.source).toBe('afu9');
    });

    test('sets default handoff_state to NOT_SENT', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.handoff_state).toBe(Afu9HandoffState.NOT_SENT);
    });

    test('preserves provided handoff_state', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
        handoff_state: Afu9HandoffState.SYNCED,
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.handoff_state).toBe(Afu9HandoffState.SYNCED);
    });

    test('handles undefined github_issue_number', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.github_issue_number).toBeNull();
    });

    test('preserves provided github_issue_number', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
        github_issue_number: 123,
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.github_issue_number).toBe(123);
    });

    test('trims whitespace from github_url', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
        github_url: '  https://github.com/org/repo/issues/123  ',
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.github_url).toBe('https://github.com/org/repo/issues/123');
    });

    test('clamps github_url to max length', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
        github_url: 'https://github.com/' + 'a'.repeat(AFU9_ISSUE_CONSTRAINTS.github_url),
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.github_url!.length).toBeLessThanOrEqual(AFU9_ISSUE_CONSTRAINTS.github_url);
    });

    test('handles null github_url', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
        github_url: null,
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.github_url).toBeNull();
    });

    test('trims whitespace from last_error', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
        last_error: '  Error message  ',
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.last_error).toBe('Error message');
    });

    test('handles null last_error', () => {
      const input: Afu9IssueInput = {
        title: 'Test',
        last_error: null,
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.last_error).toBeNull();
    });

    test('throws error if title is missing (not validated)', () => {
      const input: Afu9IssueInput = {
        title: '',
      };

      expect(() => sanitizeAfu9IssueInput(input)).toThrow('Title is required');
    });

    test('preserves valid complete input (except whitespace)', () => {
      const input: Afu9IssueInput = {
        title: 'Test issue',
        body: 'Test body',
        status: Afu9IssueStatus.ACTIVE,
        labels: ['bug'],
        priority: Afu9IssuePriority.P1,
        assignee: 'agent-1',
        handoff_state: Afu9HandoffState.SYNCED,
        github_issue_number: 123,
        github_url: 'https://github.com/org/repo/issues/123',
        last_error: null,
      };

      const result = sanitizeAfu9IssueInput(input);

      expect(result.title).toBe('Test issue');
      expect(result.body).toBe('Test body');
      expect(result.status).toBe(Afu9IssueStatus.ACTIVE);
      expect(result.labels).toEqual(['bug']);
      expect(result.priority).toBe(Afu9IssuePriority.P1);
      expect(result.assignee).toBe('agent-1');
      expect(result.source).toBe('afu9');
      expect(result.handoff_state).toBe(Afu9HandoffState.SYNCED);
      expect(result.github_issue_number).toBe(123);
      expect(result.github_url).toBe('https://github.com/org/repo/issues/123');
      expect(result.last_error).toBeNull();
    });
  });
});
