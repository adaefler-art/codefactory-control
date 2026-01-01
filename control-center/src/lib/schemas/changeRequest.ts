/**
 * Change Request (CR) JSON Schema v1
 * 
 * Defines the deterministic contract that turns INTENT conversation into implementable work.
 * Issue E74.1: ChangeRequest JSON Schema v1
 * 
 * NON-NEGOTIABLES:
 * - Deterministic, strict schema with versioning
 * - Must include Canonical ID, Acceptance Criteria, Tests, Risks, Rollout, and Evidence
 * - Evidence requirement: at least 1 evidence entry (enforced by validator)
 * - No scope creep into GitHub issue creation (that's E75.*)
 */

import { z } from 'zod';
import { UsedSourcesSchema } from './usedSources';

/**
 * Active Change Request Schema Versions
 * 
 * Registry of allowed schema versions for governance-grade immutability.
 */
export const ACTIVE_CR_VERSIONS = ['0.7.0'] as const;

/**
 * Allowed version type for Zod validation
 */
type AllowedCRVersion = typeof ACTIVE_CR_VERSIONS[number];

/**
 * Change Request Version
 * Current version: 0.7.0
 */
export const CR_VERSION: AllowedCRVersion = '0.7.0';

/**
 * Repository reference for targets
 */
export const CRRepoRefSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

export type CRRepoRef = z.infer<typeof CRRepoRefSchema>;

/**
 * Scope definition
 */
export const CRScopeSchema = z.object({
  summary: z.string().min(1),
  inScope: z.array(z.string()),
  outOfScope: z.array(z.string()),
});

export type CRScope = z.infer<typeof CRScopeSchema>;

/**
 * Target definition (repo, branch, components)
 */
export const CRTargetsSchema = z.object({
  repo: CRRepoRefSchema,
  branch: z.string().min(1),
  components: z.array(z.string()).optional(),
});

export type CRTargets = z.infer<typeof CRTargetsSchema>;

/**
 * File change type
 */
export const FileChangeTypeSchema = z.enum(['create', 'modify', 'delete']);

export type FileChangeType = z.infer<typeof FileChangeTypeSchema>;

/**
 * File change definition
 */
export const CRFileChangeSchema = z.object({
  path: z.string().min(1),
  changeType: FileChangeTypeSchema,
  rationale: z.string().optional(),
  references: z.array(z.string()).optional(),
});

export type CRFileChange = z.infer<typeof CRFileChangeSchema>;

/**
 * API change definition
 */
export const CRAPIChangeSchema = z.object({
  method: z.string().min(1),
  route: z.string().min(1),
  changeType: z.string().min(1),
  notes: z.string().optional(),
});

export type CRAPIChange = z.infer<typeof CRAPIChangeSchema>;

/**
 * Database change definition
 */
export const CRDBChangeSchema = z.object({
  migration: z.string().optional(),
  changeType: z.string().min(1),
  notes: z.string().optional(),
});

export type CRDBChange = z.infer<typeof CRDBChangeSchema>;

/**
 * Changes definition (files, API, DB)
 */
export const CRChangesSchema = z.object({
  files: z.array(CRFileChangeSchema),
  api: z.array(CRAPIChangeSchema).optional(),
  db: z.array(CRDBChangeSchema).optional(),
});

export type CRChanges = z.infer<typeof CRChangesSchema>;

/**
 * Tests definition
 */
export const CRTestsSchema = z.object({
  required: z.array(z.string()).min(1, 'At least one required test must be specified'),
  addedOrUpdated: z.array(z.string()).optional(),
  manual: z.array(z.string()).optional(),
});

export type CRTests = z.infer<typeof CRTestsSchema>;

/**
 * Risk impact level
 */
export const RiskImpactSchema = z.enum(['low', 'medium', 'high']);

export type RiskImpact = z.infer<typeof RiskImpactSchema>;

/**
 * Risk item definition
 */
export const CRRiskItemSchema = z.object({
  risk: z.string().min(1),
  impact: RiskImpactSchema,
  mitigation: z.string().min(1),
});

export type CRRiskItem = z.infer<typeof CRRiskItemSchema>;

/**
 * Risks definition
 */
export const CRRisksSchema = z.object({
  items: z.array(CRRiskItemSchema),
});

export type CRRisks = z.infer<typeof CRRisksSchema>;

/**
 * Rollout definition
 */
export const CRRolloutSchema = z.object({
  steps: z.array(z.string()),
  rollbackPlan: z.string().min(1),
  featureFlags: z.array(z.string()).optional(),
});

export type CRRollout = z.infer<typeof CRRolloutSchema>;

/**
 * Constraints definition
 */
export const CRConstraintsSchema = z.object({
  determinismNotes: z.array(z.string()).optional(),
  idempotencyNotes: z.array(z.string()).optional(),
  lawbookVersion: z.string().nullable().optional(),
});

export type CRConstraints = z.infer<typeof CRConstraintsSchema>;

/**
 * KPI target types
 */
export const KPITargetSchema = z.enum([
  'D2D',
  'HSH',
  'DCU',
  'AVS',
  'MTTR',
  'IncidentRate',
  'AutoFixRate',
]);

export type KPITarget = z.infer<typeof KPITargetSchema>;

/**
 * Created by type
 */
export const CreatedBySchema = z.enum(['intent', 'admin']);

export type CreatedBy = z.infer<typeof CreatedBySchema>;

/**
 * Metadata definition
 */
export const CRMetadataSchema = z.object({
  createdAt: z.string().datetime(),
  createdBy: CreatedBySchema,
  tags: z.array(z.string()).optional(),
  kpiTargets: z.array(KPITargetSchema).optional(),
});

export type CRMetadata = z.infer<typeof CRMetadataSchema>;

/**
 * Complete Change Request Schema
 * 
 * Enforces:
 * - At least 1 acceptance criterion
 * - At least 1 required test
 * - At least 1 evidence entry
 * - Valid change types
 * - Strict mode: no additional properties allowed
 */
export const ChangeRequestSchema = z.object({
  crVersion: z.enum(ACTIVE_CR_VERSIONS as unknown as [string, ...string[]]),
  canonicalId: z.string().min(1),
  title: z.string().min(1),
  motivation: z.string().min(1),
  scope: CRScopeSchema,
  targets: CRTargetsSchema,
  changes: CRChangesSchema,
  acceptanceCriteria: z.array(z.string()).min(1, 'At least one acceptance criterion is required'),
  tests: CRTestsSchema,
  risks: CRRisksSchema,
  rollout: CRRolloutSchema,
  evidence: UsedSourcesSchema.min(1, 'At least one evidence entry is required'),
  constraints: CRConstraintsSchema,
  metadata: CRMetadataSchema,
}).strict();

export type ChangeRequest = z.infer<typeof ChangeRequestSchema>;

/**
 * Canonical JSON serialization helper
 * 
 * Rules:
 * - Keeps user-provided order for: acceptanceCriteria, tests.required, tests.addedOrUpdated,
 *   tests.manual, rollout.steps (order matters for these)
 * - Canonicalizes evidence ordering for deterministic hashing (sorted by kind, then by key fields)
 * - Stable object key ordering (alphabetical) for all objects recursively
 */
export function canonicalizeChangeRequest(cr: ChangeRequest): ChangeRequest {
  // Sort evidence array for deterministic ordering
  const sortedEvidence = [...cr.evidence].sort((a, b) => {
    // First sort by kind
    if (a.kind !== b.kind) {
      return a.kind.localeCompare(b.kind);
    }
    
    // Then sort by kind-specific keys
    switch (a.kind) {
      case 'file_snippet':
        if (a.kind === 'file_snippet' && b.kind === 'file_snippet') {
          const repoCompare = `${a.repo.owner}/${a.repo.repo}`.localeCompare(`${b.repo.owner}/${b.repo.repo}`);
          if (repoCompare !== 0) return repoCompare;
          const branchCompare = a.branch.localeCompare(b.branch);
          if (branchCompare !== 0) return branchCompare;
          const pathCompare = a.path.localeCompare(b.path);
          if (pathCompare !== 0) return pathCompare;
          return a.startLine - b.startLine;
        }
        break;
      case 'github_issue':
      case 'github_pr':
        if ((a.kind === 'github_issue' || a.kind === 'github_pr') && 
            (b.kind === 'github_issue' || b.kind === 'github_pr')) {
          const repoCompare = `${a.repo.owner}/${a.repo.repo}`.localeCompare(`${b.repo.owner}/${b.repo.repo}`);
          if (repoCompare !== 0) return repoCompare;
          return a.number - b.number;
        }
        break;
      case 'afu9_artifact':
        if (a.kind === 'afu9_artifact' && b.kind === 'afu9_artifact') {
          const typeCompare = a.artifactType.localeCompare(b.artifactType);
          if (typeCompare !== 0) return typeCompare;
          return a.artifactId.localeCompare(b.artifactId);
        }
        break;
    }
    
    return 0;
  });

  // Return CR with sorted evidence and stable object key ordering
  // Note: TypeScript object spread preserves original key order, but for true canonical
  // serialization, use JSON.stringify with sorted keys when converting to string
  return {
    ...cr,
    evidence: sortedEvidence,
  };
}

/**
 * Serialize ChangeRequest to canonical JSON string
 * 
 * Produces deterministic JSON string with:
 * - Alphabetically sorted object keys (recursively)
 * - Sorted evidence array
 * - Preserved user order for AC, tests, rollout steps
 * 
 * Use this for hashing or deterministic comparison.
 */
export function canonicalizeChangeRequestToJSON(cr: ChangeRequest): string {
  const canonical = canonicalizeChangeRequest(cr);
  
  // Replacer function to sort object keys alphabetically
  return JSON.stringify(canonical, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Sort object keys alphabetically
      return Object.keys(value)
        .sort()
        .reduce((sorted: Record<string, unknown>, k) => {
          sorted[k] = value[k];
          return sorted;
        }, {});
    }
    return value;
  }, 2);
}

/**
 * Example minimal valid Change Request for documentation
 */
export const EXAMPLE_MINIMAL_CR: ChangeRequest = {
  crVersion: CR_VERSION,
  canonicalId: 'CR-2026-01-01-001',
  title: 'Example Change Request',
  motivation: 'Demonstrate minimal valid CR structure',
  scope: {
    summary: 'Add new API endpoint',
    inScope: ['API endpoint implementation', 'Unit tests'],
    outOfScope: ['UI changes', 'Database migrations'],
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
        path: 'control-center/src/app/api/example/route.ts',
        changeType: 'create',
        rationale: 'New API endpoint for example feature',
      },
    ],
  },
  acceptanceCriteria: [
    'API endpoint responds with 200 status',
    'Response includes required fields',
  ],
  tests: {
    required: ['npm test'],
  },
  risks: {
    items: [
      {
        risk: 'API performance degradation',
        impact: 'low',
        mitigation: 'Implement caching and rate limiting',
      },
    ],
  },
  rollout: {
    steps: [
      'Deploy to staging',
      'Run integration tests',
      'Deploy to production',
    ],
    rollbackPlan: 'Revert to previous deployment via GitHub Actions',
  },
  evidence: [
    {
      kind: 'github_issue',
      repo: {
        owner: 'adaefler-art',
        repo: 'codefactory-control',
      },
      number: 741,
      title: 'E74.1: CR JSON Schema v1',
    },
  ],
  constraints: {
    determinismNotes: ['Schema is deterministic and versioned'],
  },
  metadata: {
    createdAt: '2026-01-01T12:00:00.000Z',
    createdBy: 'intent',
    tags: ['api', 'example'],
    kpiTargets: ['D2D', 'AutoFixRate'],
  },
};
