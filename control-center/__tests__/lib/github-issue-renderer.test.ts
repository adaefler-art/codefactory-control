/**
 * Tests for GitHub Issue Renderer (I752 / E75.2)
 * 
 * Tests deterministic rendering of CR → GitHub issue markdown
 * 
 * @jest-environment node
 */

import {
  renderCRAsIssue,
  generateLabelsForNewIssue,
  mergeLabelsForUpdate,
  REQUIRED_AFU9_LABELS,
  INITIAL_STATE_LABEL,
} from '../../src/lib/github/issue-renderer';
import type { ChangeRequest } from '../../src/lib/schemas/changeRequest';

describe('GitHub Issue Renderer', () => {
  // Sample CR for testing
  const sampleCR: ChangeRequest = {
    crVersion: '0.7.0',
    canonicalId: 'CR-2026-01-02-001',
    title: 'Test CR Implementation',
    motivation: 'This is a test change request to verify issue rendering.',
    scope: {
      summary: 'Implement test feature',
      inScope: ['Feature A', 'Feature B'],
      outOfScope: ['Feature C', 'Feature D'],
    },
    targets: {
      repo: {
        owner: 'adaefler-art',
        repo: 'codefactory-control',
      },
      branch: 'main',
      components: ['control-center'],
    },
    changes: {
      files: [
        {
          path: 'control-center/src/lib/test.ts',
          changeType: 'create',
          rationale: 'New test file',
        },
        {
          path: 'control-center/src/lib/existing.ts',
          changeType: 'modify',
        },
      ],
      api: [
        {
          method: 'POST',
          route: '/api/test',
          changeType: 'create',
          notes: 'New endpoint',
        },
      ],
      db: [
        {
          migration: '001_add_test_table.sql',
          changeType: 'create',
          notes: 'New table',
        },
      ],
    },
    acceptanceCriteria: [
      'Feature A works correctly',
      'Feature B integrates with A',
      'Tests pass',
    ],
    tests: {
      required: ['Unit tests for Feature A', 'Integration test for A+B'],
      addedOrUpdated: ['test/feature-a.test.ts', 'test/feature-b.test.ts'],
      manual: ['Manual verification of UI'],
    },
    risks: {
      items: [
        {
          risk: 'Breaking change',
          impact: 'medium',
          mitigation: 'Add feature flag',
        },
      ],
    },
    rollout: {
      steps: [
        'Deploy to staging',
        'Verify in staging',
        'Deploy to production',
      ],
      rollbackPlan: 'Revert deployment and restore previous version',
      featureFlags: ['test-feature-enabled'],
    },
    evidence: [
      {
        kind: 'file_snippet',
        repo: { owner: 'adaefler-art', repo: 'codefactory-control' },
        branch: 'main',
        path: 'control-center/src/lib/test.ts',
        startLine: 1,
        endLine: 10,
        snippetHash: 'abc123def456',
      },
      {
        kind: 'github_issue',
        repo: { owner: 'adaefler-art', repo: 'codefactory-control' },
        number: 742,
        title: 'Related issue',
      },
    ],
    constraints: {
      determinismNotes: ['Uses stable sorting'],
      idempotencyNotes: ['Repeated runs produce same result'],
      lawbookVersion: '0.7.0',
    },
    metadata: {
      createdAt: '2026-01-02T00:00:00Z',
      createdBy: 'intent',
      tags: ['feature', 'test'],
      kpiTargets: ['D2D', 'HSH'],
    },
  };

  describe('renderCRAsIssue', () => {
    test('generates title with canonical ID marker', () => {
      const result = renderCRAsIssue(sampleCR);
      
      expect(result.title).toBe('[CID:CR-2026-01-02-001] Test CR Implementation');
    });

    test('includes canonical ID marker in body', () => {
      const result = renderCRAsIssue(sampleCR);
      
      expect(result.body).toContain('Canonical-ID: CR-2026-01-02-001');
    });

    test('includes all required sections in correct order', () => {
      const result = renderCRAsIssue(sampleCR);
      
      const sections = [
        '**CR-Version:** 0.7.0',
        '## Motivation',
        '## Scope',
        '## Planned Changes',
        '## Acceptance Criteria',
        '## Tests',
        '## Risks',
        '## Rollout + Rollback',
        '## Evidence',
        '## Governance',
        '## Meta',
      ];
      
      for (const section of sections) {
        expect(result.body).toContain(section);
      }
    });

    test('renders motivation section correctly', () => {
      const result = renderCRAsIssue(sampleCR);
      
      expect(result.body).toContain('This is a test change request to verify issue rendering.');
    });

    test('renders scope section with in/out lists', () => {
      const result = renderCRAsIssue(sampleCR);
      
      expect(result.body).toContain('**In Scope:**');
      expect(result.body).toContain('- Feature A');
      expect(result.body).toContain('- Feature B');
      expect(result.body).toContain('**Out of Scope:**');
      expect(result.body).toContain('- Feature C');
    });

    test('renders file changes with change types', () => {
      const result = renderCRAsIssue(sampleCR);
      
      expect(result.body).toContain('**create**: `control-center/src/lib/test.ts` - New test file');
      expect(result.body).toContain('**modify**: `control-center/src/lib/existing.ts`');
    });

    test('renders API changes section', () => {
      const result = renderCRAsIssue(sampleCR);
      
      expect(result.body).toContain('### API Changes');
      expect(result.body).toContain('**create**: POST `/api/test` - New endpoint');
    });

    test('renders DB changes section', () => {
      const result = renderCRAsIssue(sampleCR);
      
      expect(result.body).toContain('### Database Changes');
      expect(result.body).toContain('**create** (`001_add_test_table.sql`) - New table');
    });

    test('renders acceptance criteria as numbered list', () => {
      const result = renderCRAsIssue(sampleCR);
      
      expect(result.body).toContain('1. Feature A works correctly');
      expect(result.body).toContain('2. Feature B integrates with A');
      expect(result.body).toContain('3. Tests pass');
    });

    test('renders all test sections', () => {
      const result = renderCRAsIssue(sampleCR);
      
      expect(result.body).toContain('### Required Tests');
      expect(result.body).toContain('- Unit tests for Feature A');
      expect(result.body).toContain('### Tests Added/Updated');
      expect(result.body).toContain('- test/feature-a.test.ts');
      expect(result.body).toContain('### Manual Tests');
      expect(result.body).toContain('- Manual verification of UI');
    });

    test('renders risks with impact and mitigation', () => {
      const result = renderCRAsIssue(sampleCR);
      
      expect(result.body).toContain('### Breaking change');
      expect(result.body).toContain('**Impact:** medium');
      expect(result.body).toContain('**Mitigation:** Add feature flag');
    });

    test('renders rollout steps and rollback plan', () => {
      const result = renderCRAsIssue(sampleCR);
      
      expect(result.body).toContain('### Rollout Steps');
      expect(result.body).toContain('1. Deploy to staging');
      expect(result.body).toContain('2. Verify in staging');
      expect(result.body).toContain('### Rollback Plan');
      expect(result.body).toContain('Revert deployment and restore previous version');
      expect(result.body).toContain('### Feature Flags');
      expect(result.body).toContain('`test-feature-enabled`');
    });

    test('renders evidence as compact references (no full content)', () => {
      const result = renderCRAsIssue(sampleCR);
      
      // Should include file snippet ref
      expect(result.body).toContain('**File:** `adaefler-art/codefactory-control`');
      expect(result.body).toContain('`control-center/src/lib/test.ts`');
      expect(result.body).toContain('(lines 1-10)');
      expect(result.body).toContain('[hash: `abc123def456...`]');
      
      // Should include GitHub issue ref
      expect(result.body).toContain('**Issue:** [#742]');
      expect(result.body).toContain('Related issue');
      
      // Should NOT include full snippet content
      expect(result.body).not.toContain('snippet:');
    });

    test('renders governance section with lawbook version', () => {
      const result = renderCRAsIssue(sampleCR);
      
      expect(result.body).toContain('**Lawbook Version:** 0.7.0');
      expect(result.body).toContain('**Determinism Notes:**');
      expect(result.body).toContain('- Uses stable sorting');
      expect(result.body).toContain('**Idempotency Notes:**');
      expect(result.body).toContain('- Repeated runs produce same result');
    });

    test('renders meta section with all metadata', () => {
      const result = renderCRAsIssue(sampleCR);
      
      expect(result.body).toContain('**Generated By:** INTENT');
      expect(result.body).toContain('**CR Version:** 0.7.0');
      expect(result.body).toContain('**Canonical ID:** CR-2026-01-02-001');
      expect(result.body).toContain('**Tags:** feature, test');
      expect(result.body).toContain('**KPI Targets:** D2D, HSH');
    });

    test('computes hash of rendered body', () => {
      const result = renderCRAsIssue(sampleCR);
      
      expect(result.renderedHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    });

    test('is deterministic - same CR produces same hash', () => {
      const result1 = renderCRAsIssue(sampleCR);
      const result2 = renderCRAsIssue(sampleCR);
      
      expect(result1.renderedHash).toBe(result2.renderedHash);
      expect(result1.body).toBe(result2.body);
      expect(result1.title).toBe(result2.title);
    });
  });

  describe('generateLabelsForNewIssue', () => {
    test('includes required AFU-9 labels', () => {
      const labels = generateLabelsForNewIssue(sampleCR);
      
      expect(labels).toContain('afu9');
      expect(labels).toContain('v0.7');
    });

    test('includes initial state label', () => {
      const labels = generateLabelsForNewIssue(sampleCR);
      
      expect(labels).toContain('state:CREATED');
    });

    test('includes KPI target labels', () => {
      const labels = generateLabelsForNewIssue(sampleCR);
      
      expect(labels).toContain('kpi:D2D');
      expect(labels).toContain('kpi:HSH');
    });

    test('includes valid tags as labels', () => {
      const labels = generateLabelsForNewIssue(sampleCR);
      
      expect(labels).toContain('feature');
      expect(labels).toContain('test');
    });

    test('returns deterministic sorted labels', () => {
      const labels1 = generateLabelsForNewIssue(sampleCR);
      const labels2 = generateLabelsForNewIssue(sampleCR);
      
      expect(labels1).toEqual(labels2);
      
      // Check that labels are sorted
      const sorted = [...labels1].sort();
      expect(labels1).toEqual(sorted);
    });

    test('excludes invalid tags (non-alphanumeric)', () => {
      const crWithInvalidTags: ChangeRequest = {
        ...sampleCR,
        metadata: {
          ...sampleCR.metadata,
          tags: ['valid-tag', 'invalid tag with spaces', 'valid2'],
        },
      };
      
      const labels = generateLabelsForNewIssue(crWithInvalidTags);
      
      expect(labels).toContain('valid-tag');
      expect(labels).toContain('valid2');
      expect(labels).not.toContain('invalid tag with spaces');
    });
  });

  describe('mergeLabelsForUpdate', () => {
    test('ensures required AFU-9 labels are present', () => {
      const existingLabels = ['custom-label'];
      const merged = mergeLabelsForUpdate(existingLabels, sampleCR);
      
      expect(merged).toContain('afu9');
      expect(merged).toContain('v0.7');
      expect(merged).toContain('custom-label');
    });

    test('preserves existing non-AFU labels', () => {
      const existingLabels = ['custom-1', 'custom-2', 'bug'];
      const merged = mergeLabelsForUpdate(existingLabels, sampleCR);
      
      expect(merged).toContain('custom-1');
      expect(merged).toContain('custom-2');
      expect(merged).toContain('bug');
    });

    test('adds KPI labels from CR', () => {
      const existingLabels = ['afu9', 'v0.7'];
      const merged = mergeLabelsForUpdate(existingLabels, sampleCR);
      
      expect(merged).toContain('kpi:D2D');
      expect(merged).toContain('kpi:HSH');
    });

    test('preserves existing state labels (does not change)', () => {
      const existingLabels = ['afu9', 'v0.7', 'state:IN_PROGRESS'];
      const merged = mergeLabelsForUpdate(existingLabels, sampleCR);
      
      expect(merged).toContain('state:IN_PROGRESS');
      expect(merged).not.toContain('state:CREATED');
    });

    test('does not add tags on update (only on create)', () => {
      const existingLabels = ['afu9', 'v0.7'];
      const merged = mergeLabelsForUpdate(existingLabels, sampleCR);
      
      // Tags should not be added on update
      expect(merged).not.toContain('feature');
      expect(merged).not.toContain('test');
    });

    test('returns deterministic sorted labels', () => {
      const existingLabels = ['z-label', 'a-label', 'afu9'];
      const merged1 = mergeLabelsForUpdate(existingLabels, sampleCR);
      const merged2 = mergeLabelsForUpdate(existingLabels, sampleCR);
      
      expect(merged1).toEqual(merged2);
      
      // Check that labels are sorted
      const sorted = [...merged1].sort();
      expect(merged1).toEqual(sorted);
    });

    test('deduplicates labels', () => {
      const existingLabels = ['afu9', 'v0.7', 'afu9']; // duplicate
      const merged = mergeLabelsForUpdate(existingLabels, sampleCR);
      
      const uniqueLabels = new Set(merged);
      expect(merged.length).toBe(uniqueLabels.size);
    });
  });
});
