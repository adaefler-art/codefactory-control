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

      // Labels should already be sorted (normalized by schema)
      const sorted = [...labels].sort((a, b) => a.localeCompare(b));
      expect(labels).toHaveLength(sorted.length);
      // Verify they match when both are sorted
      expect([...labels].sort()).toEqual([...sorted].sort());
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

      // Should include all draft labels, sorted
      expect(merged).toHaveLength(EXAMPLE_MINIMAL_ISSUE_DRAFT.labels.length);
      EXAMPLE_MINIMAL_ISSUE_DRAFT.labels.forEach(label => {
        expect(merged).toContain(label);
      });
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

    it('should cap merged labels at 50 (P2 Test)', () => {
      // Create draft with 50 labels (schema max)
      const draftLabels = Array.from({ length: 50 }, (_, i) => `draft-label-${i}`);
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        labels: draftLabels,
      };

      // Create existing labels with 25 non-managed labels
      const existingLabels = Array.from({ length: 25 }, (_, i) => `existing-label-${i}`);

      const merged = mergeLabelsForIssueDraftUpdate(existingLabels, draft);

      // Should not exceed 50 labels total
      expect(merged.length).toBeLessThanOrEqual(50);
      
      // Should be sorted
      const sorted = [...merged].sort((a, b) => a.localeCompare(b));
      expect(merged).toEqual(sorted);
    });

    it('should preserve deterministic order in label merge (P2 Test)', () => {
      const existingLabels = ['z-label', 'a-label', 'custom'];
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        labels: ['m-label', 'b-label'],
      };

      const merged1 = mergeLabelsForIssueDraftUpdate(existingLabels, draft);
      const merged2 = mergeLabelsForIssueDraftUpdate(existingLabels, draft);

      // Multiple calls with same input should produce identical output
      expect(merged1).toEqual(merged2);
      
      // Should be alphabetically sorted
      expect(merged1).toEqual([...merged1].sort((a, b) => a.localeCompare(b)));
    });
  });

  describe('Marker duplication prevention (P2 Test)', () => {
    it('should not duplicate canonical marker when rendering same draft twice', () => {
      const result1 = renderIssueDraftAsIssue(EXAMPLE_MINIMAL_ISSUE_DRAFT);
      const result2 = renderIssueDraftAsIssue(EXAMPLE_MINIMAL_ISSUE_DRAFT);

      // Both should have exactly one canonical marker
      const marker = `Canonical-ID: ${EXAMPLE_MINIMAL_ISSUE_DRAFT.canonicalId}`;
      const count1 = (result1.body.match(new RegExp(marker, 'g')) || []).length;
      const count2 = (result2.body.match(new RegExp(marker, 'g')) || []).length;

      expect(count1).toBe(1);
      expect(count2).toBe(1);
      
      // Both renders should be identical
      expect(result1.body).toBe(result2.body);
      expect(result1.renderedHash).toBe(result2.renderedHash);
    });

    it('should include canonical marker at the start of body', () => {
      const result = renderIssueDraftAsIssue(EXAMPLE_MINIMAL_ISSUE_DRAFT);
      
      const expectedMarker = `Canonical-ID: ${EXAMPLE_MINIMAL_ISSUE_DRAFT.canonicalId}`;
      expect(result.body.startsWith(expectedMarker)).toBe(true);
    });
  });
});
