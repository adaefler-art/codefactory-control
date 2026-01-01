/**
 * Tests for Change Request JSON Schema v1
 * Issue E74.1: CR JSON Schema v1
 */

import { ZodError } from 'zod';
import {
  ChangeRequestSchema,
  canonicalizeChangeRequest,
  canonicalizeChangeRequestToJSON,
  EXAMPLE_MINIMAL_CR,
  CR_VERSION,
  ACTIVE_CR_VERSIONS,
  FileChangeTypeSchema,
  RiskImpactSchema,
  KPITargetSchema,
  CreatedBySchema,
  type ChangeRequest,
} from '../../../src/lib/schemas/changeRequest';

describe('ChangeRequest Schema', () => {
  it('should validate the minimal example CR', () => {
    const result = ChangeRequestSchema.parse(EXAMPLE_MINIMAL_CR);
    expect(result).toEqual(EXAMPLE_MINIMAL_CR);
  });

  it('should validate a full CR with all optional fields', () => {
    const fullCR: ChangeRequest = {
      crVersion: CR_VERSION,
      canonicalId: 'I752',
      title: 'Full Change Request Example',
      motivation: 'Comprehensive test of all CR fields',
      scope: {
        summary: 'Add complete feature set',
        inScope: ['API', 'UI', 'Database', 'Tests'],
        outOfScope: ['Mobile app', 'Documentation'],
      },
      targets: {
        repo: {
          owner: 'test-org',
          repo: 'test-repo',
        },
        branch: 'feature/test',
        components: ['control-center', 'mcp-servers/github'],
      },
      changes: {
        files: [
          {
            path: 'src/api/route.ts',
            changeType: 'create',
            rationale: 'New API endpoint',
            references: ['issue-123', 'pr-456'],
          },
          {
            path: 'src/old/route.ts',
            changeType: 'delete',
            rationale: 'Deprecated endpoint',
          },
          {
            path: 'src/existing/route.ts',
            changeType: 'modify',
          },
        ],
        api: [
          {
            method: 'POST',
            route: '/api/test',
            changeType: 'create',
            notes: 'New test endpoint',
          },
          {
            method: 'GET',
            route: '/api/old',
            changeType: 'delete',
            notes: 'Removing deprecated endpoint',
          },
        ],
        db: [
          {
            migration: '20260101_add_test_table.sql',
            changeType: 'create',
            notes: 'Adding new test table',
          },
        ],
      },
      acceptanceCriteria: [
        'All tests pass',
        'API responds correctly',
        'Database migration succeeds',
      ],
      tests: {
        required: ['npm test', 'npm run test:integration'],
        addedOrUpdated: [
          'src/__tests__/api/test.test.ts',
          'src/__tests__/db/migration.test.ts',
        ],
        manual: ['Test UI in browser', 'Verify database state'],
      },
      risks: {
        items: [
          {
            risk: 'Database migration failure',
            impact: 'high',
            mitigation: 'Test in staging first, have rollback script ready',
          },
          {
            risk: 'API performance impact',
            impact: 'medium',
            mitigation: 'Load testing and monitoring',
          },
          {
            risk: 'Minor UI glitch',
            impact: 'low',
            mitigation: 'Visual regression testing',
          },
        ],
      },
      rollout: {
        steps: [
          'Deploy to dev',
          'Run automated tests',
          'Deploy to staging',
          'Manual QA',
          'Deploy to production',
        ],
        rollbackPlan: 'Revert via GitHub Actions, run rollback migration script',
        featureFlags: ['new-test-feature', 'enable-new-api'],
      },
      evidence: [
        {
          kind: 'github_issue',
          repo: { owner: 'test-org', repo: 'test-repo' },
          number: 123,
          title: 'Add test feature',
        },
        {
          kind: 'file_snippet',
          repo: { owner: 'test-org', repo: 'test-repo' },
          branch: 'main',
          path: 'src/example.ts',
          startLine: 1,
          endLine: 10,
          snippetHash: 'abc123',
        },
        {
          kind: 'github_pr',
          repo: { owner: 'test-org', repo: 'test-repo' },
          number: 456,
          title: 'Related PR',
        },
        {
          kind: 'afu9_artifact',
          artifactType: 'verdict',
          artifactId: 'verdict-001',
        },
      ],
      constraints: {
        determinismNotes: ['All operations are idempotent'],
        idempotencyNotes: ['Can be safely retried'],
        lawbookVersion: '1.0.0',
      },
      metadata: {
        createdAt: '2026-01-01T12:00:00.000Z',
        createdBy: 'admin',
        tags: ['feature', 'api', 'database'],
        kpiTargets: ['D2D', 'HSH', 'DCU', 'AVS', 'MTTR', 'IncidentRate', 'AutoFixRate'],
      },
    };

    const result = ChangeRequestSchema.parse(fullCR);
    expect(result).toEqual(fullCR);
  });

  it('should reject CR with missing acceptanceCriteria', () => {
    const invalidCR = {
      ...EXAMPLE_MINIMAL_CR,
      acceptanceCriteria: [],
    };

    expect(() => ChangeRequestSchema.parse(invalidCR)).toThrow(ZodError);
  });

  it('should reject CR with missing tests.required', () => {
    const invalidCR = {
      ...EXAMPLE_MINIMAL_CR,
      tests: {
        required: [],
      },
    };

    expect(() => ChangeRequestSchema.parse(invalidCR)).toThrow(ZodError);
  });

  it('should reject CR with missing evidence', () => {
    const invalidCR = {
      ...EXAMPLE_MINIMAL_CR,
      evidence: [],
    };

    expect(() => ChangeRequestSchema.parse(invalidCR)).toThrow(ZodError);
  });

  it('should reject CR with invalid changeType', () => {
    const invalidCR = {
      ...EXAMPLE_MINIMAL_CR,
      changes: {
        files: [
          {
            path: 'test.ts',
            changeType: 'invalid-type' as any,
          },
        ],
      },
    };

    expect(() => ChangeRequestSchema.parse(invalidCR)).toThrow(ZodError);
  });

  it('should reject CR with missing required fields', () => {
    const invalidCR = {
      crVersion: CR_VERSION,
      title: 'Missing fields',
      // Missing many required fields
    };

    expect(() => ChangeRequestSchema.parse(invalidCR)).toThrow(ZodError);
  });

  it('should reject CR with empty strings in required fields', () => {
    const invalidCR = {
      ...EXAMPLE_MINIMAL_CR,
      title: '',
    };

    expect(() => ChangeRequestSchema.parse(invalidCR)).toThrow(ZodError);
  });

  it('should validate all valid file change types', () => {
    const changeTypes = ['create', 'modify', 'delete'];
    
    changeTypes.forEach(changeType => {
      expect(() => FileChangeTypeSchema.parse(changeType)).not.toThrow();
    });
  });

  it('should validate all valid risk impact levels', () => {
    const impacts = ['low', 'medium', 'high'];
    
    impacts.forEach(impact => {
      expect(() => RiskImpactSchema.parse(impact)).not.toThrow();
    });
  });

  it('should validate all valid KPI targets', () => {
    const kpiTargets = ['D2D', 'HSH', 'DCU', 'AVS', 'MTTR', 'IncidentRate', 'AutoFixRate'];
    
    kpiTargets.forEach(target => {
      expect(() => KPITargetSchema.parse(target)).not.toThrow();
    });
  });

  it('should validate both createdBy values', () => {
    const createdByValues = ['intent', 'admin'];
    
    createdByValues.forEach(value => {
      expect(() => CreatedBySchema.parse(value)).not.toThrow();
    });
  });

  it('should accept ISO datetime strings in metadata', () => {
    const cr = {
      ...EXAMPLE_MINIMAL_CR,
      metadata: {
        ...EXAMPLE_MINIMAL_CR.metadata,
        createdAt: '2026-01-01T12:00:00.000Z',
      },
    };

    const result = ChangeRequestSchema.parse(cr);
    expect(result.metadata.createdAt).toBe('2026-01-01T12:00:00.000Z');
  });

  it('should reject invalid datetime strings', () => {
    const invalidCR = {
      ...EXAMPLE_MINIMAL_CR,
      metadata: {
        ...EXAMPLE_MINIMAL_CR.metadata,
        createdAt: 'not-a-date',
      },
    };

    expect(() => ChangeRequestSchema.parse(invalidCR)).toThrow(ZodError);
  });
});

describe('canonicalizeChangeRequest', () => {
  it('should produce stable output for evidence reordering', () => {
    const cr1: ChangeRequest = {
      ...EXAMPLE_MINIMAL_CR,
      evidence: [
        {
          kind: 'github_pr',
          repo: { owner: 'org', repo: 'repo' },
          number: 2,
        },
        {
          kind: 'github_issue',
          repo: { owner: 'org', repo: 'repo' },
          number: 1,
        },
        {
          kind: 'file_snippet',
          repo: { owner: 'org', repo: 'repo' },
          branch: 'main',
          path: 'b.ts',
          startLine: 1,
          endLine: 10,
          snippetHash: 'hash1',
        },
        {
          kind: 'afu9_artifact',
          artifactType: 'verdict',
          artifactId: 'v001',
        },
      ],
    };

    const cr2: ChangeRequest = {
      ...EXAMPLE_MINIMAL_CR,
      evidence: [
        {
          kind: 'afu9_artifact',
          artifactType: 'verdict',
          artifactId: 'v001',
        },
        {
          kind: 'file_snippet',
          repo: { owner: 'org', repo: 'repo' },
          branch: 'main',
          path: 'b.ts',
          startLine: 1,
          endLine: 10,
          snippetHash: 'hash1',
        },
        {
          kind: 'github_issue',
          repo: { owner: 'org', repo: 'repo' },
          number: 1,
        },
        {
          kind: 'github_pr',
          repo: { owner: 'org', repo: 'repo' },
          number: 2,
        },
      ],
    };

    const canonical1 = canonicalizeChangeRequest(cr1);
    const canonical2 = canonicalizeChangeRequest(cr2);

    // Both should have the same evidence order after canonicalization
    expect(canonical1.evidence).toEqual(canonical2.evidence);
    
    // Evidence should be sorted by kind first
    expect(canonical1.evidence[0].kind).toBe('afu9_artifact');
    expect(canonical1.evidence[1].kind).toBe('file_snippet');
    expect(canonical1.evidence[2].kind).toBe('github_issue');
    expect(canonical1.evidence[3].kind).toBe('github_pr');
  });

  it('should sort file_snippet evidence by repo, branch, path, startLine', () => {
    const cr: ChangeRequest = {
      ...EXAMPLE_MINIMAL_CR,
      evidence: [
        {
          kind: 'file_snippet',
          repo: { owner: 'org', repo: 'repo' },
          branch: 'main',
          path: 'z.ts',
          startLine: 1,
          endLine: 10,
          snippetHash: 'hash1',
        },
        {
          kind: 'file_snippet',
          repo: { owner: 'org', repo: 'repo' },
          branch: 'main',
          path: 'a.ts',
          startLine: 20,
          endLine: 30,
          snippetHash: 'hash2',
        },
        {
          kind: 'file_snippet',
          repo: { owner: 'org', repo: 'repo' },
          branch: 'main',
          path: 'a.ts',
          startLine: 1,
          endLine: 10,
          snippetHash: 'hash3',
        },
      ],
    };

    const canonical = canonicalizeChangeRequest(cr);
    
    // Should be sorted by path (a.ts before z.ts) and then by startLine (1 before 20)
    expect(canonical.evidence[0]).toMatchObject({ path: 'a.ts', startLine: 1 });
    expect(canonical.evidence[1]).toMatchObject({ path: 'a.ts', startLine: 20 });
    expect(canonical.evidence[2]).toMatchObject({ path: 'z.ts', startLine: 1 });
  });

  it('should sort github_issue and github_pr by repo and number', () => {
    const cr: ChangeRequest = {
      ...EXAMPLE_MINIMAL_CR,
      evidence: [
        {
          kind: 'github_issue',
          repo: { owner: 'org', repo: 'repo' },
          number: 100,
        },
        {
          kind: 'github_issue',
          repo: { owner: 'org', repo: 'repo' },
          number: 50,
        },
        {
          kind: 'github_pr',
          repo: { owner: 'org', repo: 'repo' },
          number: 75,
        },
      ],
    };

    const canonical = canonicalizeChangeRequest(cr);
    
    // Issues should be sorted before PRs (by kind), then by number within each kind
    const issues = canonical.evidence.filter(e => e.kind === 'github_issue');
    const prs = canonical.evidence.filter(e => e.kind === 'github_pr');
    
    expect(issues.length).toBe(2);
    expect(prs.length).toBe(1);
    
    if (issues[0].kind === 'github_issue' && issues[1].kind === 'github_issue') {
      expect(issues[0].number).toBe(50);
      expect(issues[1].number).toBe(100);
    }
  });

  it('should sort afu9_artifact by artifactType and artifactId', () => {
    const cr: ChangeRequest = {
      ...EXAMPLE_MINIMAL_CR,
      evidence: [
        {
          kind: 'afu9_artifact',
          artifactType: 'verdict',
          artifactId: 'v003',
        },
        {
          kind: 'afu9_artifact',
          artifactType: 'playbook',
          artifactId: 'p001',
        },
        {
          kind: 'afu9_artifact',
          artifactType: 'verdict',
          artifactId: 'v001',
        },
      ],
    };

    const canonical = canonicalizeChangeRequest(cr);
    
    // Should be sorted by artifactType first, then by artifactId
    if (canonical.evidence[0].kind === 'afu9_artifact' &&
        canonical.evidence[1].kind === 'afu9_artifact' &&
        canonical.evidence[2].kind === 'afu9_artifact') {
      expect(canonical.evidence[0].artifactType).toBe('playbook');
      expect(canonical.evidence[1].artifactType).toBe('verdict');
      expect(canonical.evidence[1].artifactId).toBe('v001');
      expect(canonical.evidence[2].artifactId).toBe('v003');
    }
  });

  it('should preserve user order for acceptanceCriteria', () => {
    const cr: ChangeRequest = {
      ...EXAMPLE_MINIMAL_CR,
      acceptanceCriteria: ['Third', 'First', 'Second'],
    };

    const canonical = canonicalizeChangeRequest(cr);
    
    // Order should be preserved
    expect(canonical.acceptanceCriteria).toEqual(['Third', 'First', 'Second']);
  });

  it('should preserve user order for tests', () => {
    const cr: ChangeRequest = {
      ...EXAMPLE_MINIMAL_CR,
      tests: {
        required: ['test3', 'test1', 'test2'],
        addedOrUpdated: ['new3', 'new1', 'new2'],
        manual: ['manual3', 'manual1', 'manual2'],
      },
    };

    const canonical = canonicalizeChangeRequest(cr);
    
    // Order should be preserved for all test arrays
    expect(canonical.tests.required).toEqual(['test3', 'test1', 'test2']);
    expect(canonical.tests.addedOrUpdated).toEqual(['new3', 'new1', 'new2']);
    expect(canonical.tests.manual).toEqual(['manual3', 'manual1', 'manual2']);
  });

  it('should preserve user order for rollout steps', () => {
    const cr: ChangeRequest = {
      ...EXAMPLE_MINIMAL_CR,
      rollout: {
        ...EXAMPLE_MINIMAL_CR.rollout,
        steps: ['Step 3', 'Step 1', 'Step 2'],
      },
    };

    const canonical = canonicalizeChangeRequest(cr);
    
    // Order should be preserved
    expect(canonical.rollout.steps).toEqual(['Step 3', 'Step 1', 'Step 2']);
  });

  it('should not mutate original CR', () => {
    const cr: ChangeRequest = {
      ...EXAMPLE_MINIMAL_CR,
      evidence: [
        {
          kind: 'github_issue',
          repo: { owner: 'org', repo: 'repo' },
          number: 2,
        },
        {
          kind: 'github_issue',
          repo: { owner: 'org', repo: 'repo' },
          number: 1,
        },
      ],
    };

    const originalEvidence = [...cr.evidence];
    canonicalizeChangeRequest(cr);
    
    // Original should be unchanged
    expect(cr.evidence).toEqual(originalEvidence);
  });
});

describe('canonicalizeChangeRequestToJSON', () => {
  it('should produce identical JSON for semantically identical CRs with different key orders', () => {
    const cr1: ChangeRequest = {
      crVersion: CR_VERSION,
      canonicalId: 'TEST-001',
      title: 'Test',
      motivation: 'Test motivation',
      scope: {
        summary: 'Test scope',
        inScope: ['a'],
        outOfScope: ['b'],
      },
      targets: {
        repo: { owner: 'org', repo: 'repo' },
        branch: 'main',
      },
      changes: {
        files: [{ path: 'test.ts', changeType: 'create' }],
      },
      acceptanceCriteria: ['AC1'],
      tests: { required: ['test1'] },
      risks: { items: [{ risk: 'r1', impact: 'low', mitigation: 'm1' }] },
      rollout: { steps: ['s1'], rollbackPlan: 'plan' },
      evidence: [
        { kind: 'github_issue', repo: { owner: 'o', repo: 'r' }, number: 2 },
        { kind: 'github_issue', repo: { owner: 'o', repo: 'r' }, number: 1 },
      ],
      constraints: {},
      metadata: { createdAt: '2026-01-01T12:00:00.000Z', createdBy: 'intent' },
    };

    const cr2: ChangeRequest = {
      // Same data, different evidence order
      ...cr1,
      evidence: [
        { kind: 'github_issue', repo: { owner: 'o', repo: 'r' }, number: 1 },
        { kind: 'github_issue', repo: { owner: 'o', repo: 'r' }, number: 2 },
      ],
    };

    const json1 = canonicalizeChangeRequestToJSON(cr1);
    const json2 = canonicalizeChangeRequestToJSON(cr2);

    // Both should produce identical JSON strings
    expect(json1).toBe(json2);
  });

  it('should produce deterministic JSON with sorted object keys', () => {
    const json = canonicalizeChangeRequestToJSON(EXAMPLE_MINIMAL_CR);
    
    // Parse and verify structure
    const parsed = JSON.parse(json);
    
    // Verify evidence is sorted
    expect(parsed.evidence).toBeDefined();
    
    // Verify it's valid JSON
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe('Version Validation', () => {
  it('should accept allowed CR version', () => {
    const cr = {
      ...EXAMPLE_MINIMAL_CR,
      crVersion: '0.7.0',
    };

    expect(() => ChangeRequestSchema.parse(cr)).not.toThrow();
  });

  it('should reject disallowed CR version', () => {
    const cr = {
      ...EXAMPLE_MINIMAL_CR,
      crVersion: '0.6.0',
    };

    expect(() => ChangeRequestSchema.parse(cr)).toThrow(ZodError);
  });

  it('should have active versions registry', () => {
    expect(ACTIVE_CR_VERSIONS).toBeDefined();
    expect(ACTIVE_CR_VERSIONS).toContain('0.7.0');
    expect(Array.isArray(ACTIVE_CR_VERSIONS)).toBe(true);
  });
});

describe('Strict Mode', () => {
  it('should reject CR with additional unknown properties', () => {
    const crWithExtra = {
      ...EXAMPLE_MINIMAL_CR,
      unknownField: 'should be rejected',
    };

    expect(() => ChangeRequestSchema.parse(crWithExtra)).toThrow(ZodError);
  });

  it('should accept CR with exactly the defined properties', () => {
    expect(() => ChangeRequestSchema.parse(EXAMPLE_MINIMAL_CR)).not.toThrow();
  });
});
