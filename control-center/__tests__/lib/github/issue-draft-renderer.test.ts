/**
 * Tests for IssueDraft GitHub Issue Renderer (E82.1)
 */

import {
  renderIssueDraftAsIssue,
  generateLabelsForIssueDraft,
  mergeLabelsForIssueDraftUpdate,
} from '../../../src/lib/github/issue-draft-renderer';
import { EXAMPLE_MINIMAL_ISSUE_DRAFT, EXAMPLE_FULL_ISSUE_DRAFT } from '../../../src/lib/schemas/issueDraft';
import type { IssueDraft } from '../../../src/lib/schemas/issueDraft';

describe('IssueDraft Renderer', () => {
  describe('renderIssueDraftAsIssue', () => {
    it('should render minimal issue draft with all required sections', () => {
      const result = renderIssueDraftAsIssue(EXAMPLE_MINIMAL_ISSUE_DRAFT);

      // Check title
      expect(result.title).toBe(EXAMPLE_MINIMAL_ISSUE_DRAFT.title);

      // Check body contains canonical ID marker
      expect(result.body).toContain(`Canonical-ID: ${EXAMPLE_MINIMAL_ISSUE_DRAFT.canonicalId}`);

      // Check body contains main sections
      expect(result.body).toContain('## Metadata');
      expect(result.body).toContain('## Acceptance Criteria');
      expect(result.body).toContain('## Verification');
      expect(result.body).toContain('## Guards');

      // Check body contains metadata values
      expect(result.body).toContain(`**Type:** ${EXAMPLE_MINIMAL_ISSUE_DRAFT.type}`);
      expect(result.body).toContain(`**Priority:** ${EXAMPLE_MINIMAL_ISSUE_DRAFT.priority}`);

      // Check rendered hash is present
      expect(result.renderedHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should render full issue draft with optional sections', () => {
      const result = renderIssueDraftAsIssue(EXAMPLE_FULL_ISSUE_DRAFT);

      // Check optional sections are included
      expect(result.body).toContain('## Dependencies');
      expect(result.body).toContain('## KPI');

      // Check KPI values
      expect(result.body).toContain(`**DCU:** ${EXAMPLE_FULL_ISSUE_DRAFT.kpi?.dcu}`);
      expect(result.body).toContain(`**Intent:** ${EXAMPLE_FULL_ISSUE_DRAFT.kpi?.intent}`);

      // Check dependencies
      EXAMPLE_FULL_ISSUE_DRAFT.dependsOn.forEach(dep => {
        expect(result.body).toContain(dep);
      });
    });

    it('should produce deterministic output for same input', () => {
      const result1 = renderIssueDraftAsIssue(EXAMPLE_MINIMAL_ISSUE_DRAFT);
      const result2 = renderIssueDraftAsIssue(EXAMPLE_MINIMAL_ISSUE_DRAFT);

      expect(result1.title).toBe(result2.title);
      expect(result1.body).toBe(result2.body);
      expect(result1.renderedHash).toBe(result2.renderedHash);
    });

    it('should include all acceptance criteria in order', () => {
      const result = renderIssueDraftAsIssue(EXAMPLE_MINIMAL_ISSUE_DRAFT);

      EXAMPLE_MINIMAL_ISSUE_DRAFT.acceptanceCriteria.forEach((criterion, index) => {
        expect(result.body).toContain(`${index + 1}. ${criterion}`);
      });
    });

    it('should include all verification commands and expected results', () => {
      const result = renderIssueDraftAsIssue(EXAMPLE_MINIMAL_ISSUE_DRAFT);

      EXAMPLE_MINIMAL_ISSUE_DRAFT.verify.commands.forEach(cmd => {
        expect(result.body).toContain(cmd);
      });

      EXAMPLE_MINIMAL_ISSUE_DRAFT.verify.expected.forEach(exp => {
        expect(result.body).toContain(exp);
      });
    });

    it('should include guards section', () => {
      const result = renderIssueDraftAsIssue(EXAMPLE_MINIMAL_ISSUE_DRAFT);

      expect(result.body).toContain(`**Environment:** ${EXAMPLE_MINIMAL_ISSUE_DRAFT.guards.env}`);
      expect(result.body).toContain('**Production Blocked:** Yes');
    });
  });

  describe('generateLabelsForIssueDraft', () => {
    it('should return all labels from draft', () => {
      const labels = generateLabelsForIssueDraft(EXAMPLE_MINIMAL_ISSUE_DRAFT);

      expect(labels).toEqual(EXAMPLE_MINIMAL_ISSUE_DRAFT.labels);
    });

    it('should preserve label order (already normalized)', () => {
      const labels = generateLabelsForIssueDraft(EXAMPLE_FULL_ISSUE_DRAFT);

      // Labels should be sorted (already normalized by schema)
      const sorted = [...labels].sort((a, b) => a.localeCompare(b));
      expect(labels).toEqual(sorted);
    });
  });

  describe('mergeLabelsForIssueDraftUpdate', () => {
    it('should merge draft labels with existing non-managed labels', () => {
      const existingLabels = ['v0.8', 'epic:E81', 'custom-label', 'status:in-progress'];
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        labels: ['v0.9', 'epic:E82', 'layer:A'],
      };

      const merged = mergeLabelsForIssueDraftUpdate(existingLabels, draft);

      // Should include all draft labels
      expect(merged).toContain('v0.9');
      expect(merged).toContain('epic:E82');
      expect(merged).toContain('layer:A');

      // Should preserve non-managed labels
      expect(merged).toContain('custom-label');
      expect(merged).toContain('status:in-progress');

      // Should NOT include old managed labels that are not in draft
      expect(merged).not.toContain('v0.8');
      expect(merged).not.toContain('epic:E81');

      // Should be sorted
      const sorted = [...merged].sort((a, b) => a.localeCompare(b));
      expect(merged).toEqual(sorted);
    });

    it('should handle empty existing labels', () => {
      const existingLabels: string[] = [];
      const merged = mergeLabelsForIssueDraftUpdate(existingLabels, EXAMPLE_MINIMAL_ISSUE_DRAFT);

      expect(merged).toEqual(EXAMPLE_MINIMAL_ISSUE_DRAFT.labels);
    });

    it('should deduplicate labels', () => {
      const existingLabels = ['v0.8', 'custom-label'];
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        labels: ['v0.8', 'layer:B'],
      };

      const merged = mergeLabelsForIssueDraftUpdate(existingLabels, draft);

      // v0.8 should appear only once
      const v08Count = merged.filter(label => label === 'v0.8').length;
      expect(v08Count).toBe(1);
    });
  });
});
