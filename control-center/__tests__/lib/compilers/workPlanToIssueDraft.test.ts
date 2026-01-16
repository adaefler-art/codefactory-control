/**
 * Tests for Work Plan to Issue Draft Compiler
 * V09-I05: Compile Plan → Draft (Deterministischer Compiler)
 */

import { describe, test, expect } from '@jest/globals';
import { compileWorkPlanToIssueDraftV1 } from '@/lib/compilers/workPlanToIssueDraft';
import type { WorkPlanContentV1 } from '@/lib/schemas/workPlan';
import { validateIssueDraft } from '@/lib/schemas/issueDraft';

describe('compileWorkPlanToIssueDraftV1', () => {
  describe('Deterministic Compilation', () => {
    test('same plan produces same draft (golden test)', () => {
      const plan: WorkPlanContentV1 = {
        goals: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            text: 'Implement feature X',
            priority: 'HIGH',
            completed: false,
          },
        ],
        context: 'Build epic:E81 for v0.8 layer:B',
        todos: [],
        options: [],
      };

      const result1 = compileWorkPlanToIssueDraftV1(plan);
      const result2 = compileWorkPlanToIssueDraftV1(plan);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      if (result1.success && result2.success) {
        expect(result1.draft).toEqual(result2.draft);
        expect(result1.bodyHash).toEqual(result2.bodyHash);
      }
    });

    test('stable ordering for goals by priority then text', () => {
      const plan: WorkPlanContentV1 = {
        goals: [
          { id: '1', text: 'Z task', priority: 'LOW', completed: false },
          { id: '2', text: 'A task', priority: 'HIGH', completed: false },
          { id: '3', text: 'M task', priority: 'MEDIUM', completed: false },
          { id: '4', text: 'B task', priority: 'HIGH', completed: false },
        ],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);

      if (result.success) {
        // Body should have HIGH priority goals first, sorted alphabetically
        expect(result.draft.body).toContain('A task (HIGH)');
        expect(result.draft.body.indexOf('A task')).toBeLessThan(result.draft.body.indexOf('B task'));
        expect(result.draft.body.indexOf('B task')).toBeLessThan(result.draft.body.indexOf('M task'));
        expect(result.draft.body.indexOf('M task')).toBeLessThan(result.draft.body.indexOf('Z task'));
      }
    });

    test('stable ordering for todos alphabetically', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        todos: [
          { id: '1', text: 'Z task', completed: false },
          { id: '2', text: 'A task', completed: false },
          { id: '3', text: 'M task', completed: false },
        ],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);

      if (result.success) {
        // Body should have todos sorted alphabetically
        expect(result.draft.body.indexOf('A task')).toBeLessThan(result.draft.body.indexOf('M task'));
        expect(result.draft.body.indexOf('M task')).toBeLessThan(result.draft.body.indexOf('Z task'));
      }
    });

    test('stable ordering for options by title', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        todos: [],
        options: [
          { id: '1', title: 'Option Z', description: 'Description Z', pros: [], cons: [] },
          { id: '2', title: 'Option A', description: 'Description A', pros: [], cons: [] },
          { id: '3', title: 'Option M', description: 'Description M', pros: [], cons: [] },
        ],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);

      if (result.success) {
        // Body should have options sorted by title
        expect(result.draft.body.indexOf('Option A')).toBeLessThan(result.draft.body.indexOf('Option M'));
        expect(result.draft.body.indexOf('Option M')).toBeLessThan(result.draft.body.indexOf('Option Z'));
      }
    });
  });

  describe('Title Derivation', () => {
    test('uses first goal text as title', () => {
      const plan: WorkPlanContentV1 = {
        goals: [
          { id: '1', text: 'Main goal here', completed: false },
          { id: '2', text: 'Secondary goal', completed: false },
        ],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.title).toBe('Main goal here');
      }
    });

    test('uses context first line if no goals', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        context: 'Implement authentication system\nWith OAuth support',
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.title).toBe('Implement authentication system');
      }
    });

    test('uses placeholder if no goals or context', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.title).toBe('Work Plan: [Untitled]');
      }
    });

    test('truncates title to 200 chars', () => {
      const longText = 'A'.repeat(250);
      const plan: WorkPlanContentV1 = {
        goals: [{ id: '1', text: longText, completed: false }],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.title.length).toBeLessThanOrEqual(200);
        expect(result.draft.title).toContain('...');
      }
    });
  });

  describe('Canonical ID Derivation', () => {
    test('derives canonical ID from context (I8xx pattern)', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        context: 'This is for I811 issue',
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.canonicalId).toBe('I811');
      }
    });

    test('derives canonical ID from context (E81.x pattern)', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        context: 'Working on E81.5 epic',
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.canonicalId).toBe('E81.5');
      }
    });

    test('derives canonical ID from goal text', () => {
      const plan: WorkPlanContentV1 = {
        goals: [{ id: '1', text: 'Complete I812 implementation', completed: false }],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.canonicalId).toBe('I812');
      }
    });

    test('uses placeholder CID:TBD if no ID found', () => {
      const plan: WorkPlanContentV1 = {
        goals: [{ id: '1', text: 'Some task', completed: false }],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.canonicalId).toBe('CID:TBD');
      }
    });

    test('no randomness in placeholder ID', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        todos: [],
        options: [],
      };

      const result1 = compileWorkPlanToIssueDraftV1(plan);
      const result2 = compileWorkPlanToIssueDraftV1(plan);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      if (result1.success && result2.success) {
        expect(result1.draft.canonicalId).toBe(result2.draft.canonicalId);
        expect(result1.draft.canonicalId).toBe('CID:TBD');
      }
    });
  });

  describe('Labels Derivation', () => {
    test('always includes from-work-plan label', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.labels).toContain('from-work-plan');
      }
    });

    test('extracts epic labels from context', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        context: 'Part of epic:E81 and epic E82',
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.labels).toContain('epic:E81');
        expect(result.draft.labels).toContain('epic:E82');
      }
    });

    test('extracts version labels from context', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        context: 'For v0.8 release',
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.labels).toContain('v0.8');
      }
    });

    test('extracts layer labels from context', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        context: 'layer:B component',
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.labels).toContain('layer:B');
      }
    });

    test('labels are sorted and deduped', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        context: 'epic:E81 v0.8 layer:B epic:E81',
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        // Check no duplicates
        const labelSet = new Set(result.draft.labels);
        expect(result.draft.labels.length).toBe(labelSet.size);

        // Check sorted
        const sorted = [...result.draft.labels].sort((a, b) => a.localeCompare(b));
        expect(result.draft.labels).toEqual(sorted);
      }
    });
  });

  describe('Acceptance Criteria Derivation', () => {
    test('uses high priority goals as acceptance criteria', () => {
      const plan: WorkPlanContentV1 = {
        goals: [
          { id: '1', text: 'High priority goal', priority: 'HIGH', completed: false },
          { id: '2', text: 'Low priority goal', priority: 'LOW', completed: false },
        ],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.acceptanceCriteria).toContain('High priority goal');
        expect(result.draft.acceptanceCriteria).not.toContain('Low priority goal');
      }
    });

    test('uses all goals if no high priority goals', () => {
      const plan: WorkPlanContentV1 = {
        goals: [
          { id: '1', text: 'Goal A', completed: false },
          { id: '2', text: 'Goal B', completed: false },
        ],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.acceptanceCriteria).toContain('Goal A');
        expect(result.draft.acceptanceCriteria).toContain('Goal B');
      }
    });

    test('uses default criterion if no goals', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.acceptanceCriteria).toContain('Complete all tasks from work plan');
      }
    });

    test('caps at 20 acceptance criteria', () => {
      const goals = Array.from({ length: 30 }, (_, i) => ({
        id: `${i}`,
        text: `Goal ${i}`,
        completed: false,
      }));

      const plan: WorkPlanContentV1 = { goals, todos: [], options: [] };
      const result = compileWorkPlanToIssueDraftV1(plan);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.acceptanceCriteria.length).toBeLessThanOrEqual(20);
      }
    });
  });

  describe('Priority Derivation', () => {
    test('derives P1 from HIGH priority goals', () => {
      const plan: WorkPlanContentV1 = {
        goals: [{ id: '1', text: 'Task', priority: 'HIGH', completed: false }],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.priority).toBe('P1');
      }
    });

    test('derives P1 from MEDIUM priority goals', () => {
      const plan: WorkPlanContentV1 = {
        goals: [{ id: '1', text: 'Task', priority: 'MEDIUM', completed: false }],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.priority).toBe('P1');
      }
    });

    test('defaults to P2 if no goals', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.draft.priority).toBe('P2');
      }
    });
  });

  describe('Output Validation', () => {
    test('compiled draft passes IssueDraft schema validation', () => {
      const plan: WorkPlanContentV1 = {
        goals: [{ id: '1', text: 'Implement feature', priority: 'HIGH', completed: false }],
        context: 'For epic:E81 v0.8',
        todos: [{ id: '2', text: 'Write tests', completed: false }],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);

      if (result.success) {
        const validation = validateIssueDraft(result.draft);
        expect(validation.success).toBe(true);
      }
    });

    test('body hash is deterministic', () => {
      const plan: WorkPlanContentV1 = {
        goals: [{ id: '1', text: 'Test', completed: false }],
        todos: [],
        options: [],
      };

      const result1 = compileWorkPlanToIssueDraftV1(plan);
      const result2 = compileWorkPlanToIssueDraftV1(plan);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      if (result1.success && result2.success) {
        expect(result1.bodyHash).toBe(result2.bodyHash);
        expect(result1.bodyHash.length).toBe(12); // First 12 chars of SHA-256
      }
    });
  });

  describe('Body Content', () => {
    test('includes all sections in stable order', () => {
      const plan: WorkPlanContentV1 = {
        goals: [{ id: '1', text: 'Goal 1', completed: false }],
        context: 'Context text',
        todos: [{ id: '2', text: 'Todo 1', completed: false }],
        options: [{ id: '3', title: 'Option A', description: 'Desc', pros: [], cons: [] }],
        notes: 'Additional notes',
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);

      if (result.success) {
        const { body } = result.draft;
        
        // Check sections appear in order
        const contextPos = body.indexOf('## Context');
        const goalsPos = body.indexOf('## Goals');
        const optionsPos = body.indexOf('## Options Considered');
        const todosPos = body.indexOf('## Tasks');
        const notesPos = body.indexOf('## Additional Notes');

        expect(contextPos).toBeGreaterThan(-1);
        expect(goalsPos).toBeGreaterThan(contextPos);
        expect(optionsPos).toBeGreaterThan(goalsPos);
        expect(todosPos).toBeGreaterThan(optionsPos);
        expect(notesPos).toBeGreaterThan(todosPos);
      }
    });

    test('body includes canonical ID marker', () => {
      const plan: WorkPlanContentV1 = {
        goals: [{ id: '1', text: 'Test', completed: false }],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.draft.body).toContain('Canonical-ID:');
      }
    });

    test('minimum body length is met', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.draft.body.length).toBeGreaterThanOrEqual(10);
      }
    });
  });

  describe('Dependencies Derivation', () => {
    test('extracts dependencies from context', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        context: 'Depends on I811 and E81.2',
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.draft.dependsOn).toContain('I811');
        expect(result.draft.dependsOn).toContain('E81.2');
      }
    });

    test('does not include self in dependencies', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        context: 'I811 depends on I812',
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);

      if (result.success) {
        // Canonical ID is I811 (first match)
        expect(result.draft.canonicalId).toBe('I811');
        // Dependencies should not include itself
        expect(result.draft.dependsOn).not.toContain('I811');
        expect(result.draft.dependsOn).toContain('I812');
      }
    });
  });

  describe('Guards', () => {
    test('always sets guards to development with prodBlocked true', () => {
      const plan: WorkPlanContentV1 = {
        goals: [{ id: '1', text: 'Test', completed: false }],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.draft.guards.env).toBe('development');
        expect(result.draft.guards.prodBlocked).toBe(true);
      }
    });
  });

  describe('Verification', () => {
    test('uses default verification if no commands in context', () => {
      const plan: WorkPlanContentV1 = {
        goals: [{ id: '1', text: 'Test', completed: false }],
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.draft.verify.commands).toContain('npm run repo:verify');
        expect(result.draft.verify.expected).toContain('All checks pass');
      }
    });

    test('extracts verification commands from context', () => {
      const plan: WorkPlanContentV1 = {
        goals: [],
        context: 'Verify with: `npm test`',
        todos: [],
        options: [],
      };

      const result = compileWorkPlanToIssueDraftV1(plan);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.draft.verify.commands).toContain('npm test');
      }
    });
  });
});
