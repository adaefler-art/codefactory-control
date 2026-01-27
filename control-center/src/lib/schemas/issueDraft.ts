/**
 * Issue Draft Schema v1
 * 
 * Defines the deterministic contract for INTENT-generated issue drafts.
 * Issue E81.1: Issue Draft Schema v1 + Validator (Zod) + Examples
 * 
 * NON-NEGOTIABLES:
 * - Deterministic, strict schema with versioning
 * - Canonical ID format validation (I8xx, E81.x, CID: marker)
 * - Labels deduplication and stable lexicographic sort
 * - Bounded strings/arrays (DoS-safe)
 * - Deterministic error ordering (lexicographic by path)
 * - No secrets or unbounded inputs
 */

import { z } from 'zod';

/**
 * Active Issue Draft Schema Versions
 * 
 * Registry of allowed schema versions for governance-grade immutability.
 */
export const ACTIVE_ISSUE_DRAFT_VERSIONS = ['1.0'] as const;

/**
 * Allowed version type for Zod validation
 */
type AllowedIssueDraftVersion = typeof ACTIVE_ISSUE_DRAFT_VERSIONS[number];

/**
 * Issue Draft Version
 * Current version: 1.0
 */
export const ISSUE_DRAFT_VERSION: AllowedIssueDraftVersion = '1.0';

/**
 * Issue type
 */
export const IssueTypeSchema = z.enum(['epic', 'issue']);
export type IssueType = z.infer<typeof IssueTypeSchema>;

/**
 * Priority levels
 */
export const PrioritySchema = z.enum(['P0', 'P1', 'P2']);
export type Priority = z.infer<typeof PrioritySchema>;

/**
 * Environment guard types
 */
export const EnvironmentSchema = z.enum(['staging', 'development']);
export type Environment = z.infer<typeof EnvironmentSchema>;

/**
 * KPI DCU values
 */
export const KpiDcuSchema = z.union([
  z.literal(0.5),
  z.literal(1),
  z.literal(2),
]);
export type KpiDcu = z.infer<typeof KpiDcuSchema>;

/**
 * KPI configuration
 */
export const KpiSchema = z.object({
  dcu: KpiDcuSchema.optional(),
  intent: z.string().max(200).optional(),
}).strict();
export type Kpi = z.infer<typeof KpiSchema>;

/**
 * Guards configuration
 */
export const GuardsSchema = z.object({
  env: EnvironmentSchema,
  prodBlocked: z.literal(true),
}).strict();
export type Guards = z.infer<typeof GuardsSchema>;

/**
 * Verification configuration
 */
export const VerifySchema = z.object({
  commands: z.array(z.string().min(1).max(500)).min(1).max(10),
  expected: z.array(z.string().min(1).max(500)).min(1).max(10),
}).strict();
export type Verify = z.infer<typeof VerifySchema>;

/**
 * Canonical ID format patterns
 * 
 * Supported formats:
 * - I8xx (e.g., I811, I812)
 * - E81.x (e.g., E81.1, E81.2)
 * - CID:<identifier> (e.g., CID:E81.1, CID:I811)
 */
const CANONICAL_ID_PATTERN = /^(I8\d{2}|E81\.\d+|CID:(I8\d{2}|E81\.\d+|TBD))$/;

/**
 * Canonical ID validator with format enforcement
 */
export const CanonicalIdSchema = z.string()
  .min(1, 'Canonical ID is required')
  .max(50, 'Canonical ID must not exceed 50 characters')
  .refine(
    (val) => CANONICAL_ID_PATTERN.test(val),
    {
      message: 'Canonical ID must match format: I8xx, E81.x, or CID:<identifier>',
    }
  );

/**
 * Complete Issue Draft Schema v1
 * 
 * Enforces:
 * - Version pinning
 * - Minimum string lengths for title and body
 * - Canonical ID format validation
 * - Array bounds (DoS-safe)
 * - String length limits (DoS-safe)
 * - Strict mode: no additional properties allowed
 */
export const IssueDraftSchema = z.object({
  issueDraftVersion: z.enum(ACTIVE_ISSUE_DRAFT_VERSIONS as unknown as [string, ...string[]]),
  title: z.string().min(1, 'Title is required').max(200, 'Title must not exceed 200 characters'),
  body: z.string().min(10, 'Body must be at least 10 characters').max(10000, 'Body must not exceed 10000 characters'),
  type: IssueTypeSchema,
  canonicalId: CanonicalIdSchema,
  labels: z.array(z.string().min(1).max(100)).max(50),
  dependsOn: z.array(CanonicalIdSchema).max(20),
  priority: PrioritySchema,
  kpi: KpiSchema.optional(),
  acceptanceCriteria: z.array(z.string().min(1).max(1000)).min(1, 'At least one acceptance criterion is required').max(20),
  verify: VerifySchema,
  guards: GuardsSchema,
}).strict();

export type IssueDraft = z.infer<typeof IssueDraftSchema>;

/**
 * Normalize an issue draft for deterministic processing
 * 
 * Rules:
 * - Trim all string fields
 * - Deduplicate labels (case-sensitive)
 * - Sort labels lexicographically (stable sort)
 * - Deduplicate dependsOn array
 * - Sort dependsOn array lexicographically
 * - Preserve order of acceptanceCriteria (user intent matters)
 * - Preserve order of verify arrays (execution order matters)
 * 
 * @param draft - Raw issue draft
 * @returns Normalized issue draft
 */
export function normalizeIssueDraft(draft: IssueDraft): IssueDraft {
  // Deduplicate and sort labels
  const uniqueLabels = Array.from(new Set(draft.labels.map(l => l.trim()).filter(Boolean)));
  const sortedLabels = uniqueLabels.sort((a, b) => a.localeCompare(b));

  // Deduplicate and sort dependsOn
  const uniqueDependsOn = Array.from(new Set(draft.dependsOn.map(d => d.trim()).filter(Boolean)));
  const sortedDependsOn = uniqueDependsOn.sort((a, b) => a.localeCompare(b));

  return {
    ...draft,
    title: draft.title.trim(),
    body: draft.body.trim(),
    canonicalId: draft.canonicalId.trim(),
    labels: sortedLabels,
    dependsOn: sortedDependsOn,
    acceptanceCriteria: draft.acceptanceCriteria.map(ac => ac.trim()),
    verify: {
      commands: draft.verify.commands.map(c => c.trim()),
      expected: draft.verify.expected.map(e => e.trim()),
    },
    kpi: draft.kpi ? {
      ...draft.kpi,
      intent: draft.kpi.intent?.trim(),
    } : undefined,
  };
}

/**
 * Validate and normalize an issue draft
 * 
 * Performs:
 * 1. Schema validation (Zod strict mode)
 * 2. Normalization (dedup, sort, trim)
 * 3. Re-validation of normalized result
 * 
 * Returns deterministic error format:
 * - Errors sorted by path (lexicographic)
 * - Bounded error count (max 100 errors)
 * - No internal stack traces
 * 
 * @param data - Raw issue draft data
 * @returns Validation result with normalized draft or errors
 */
export function validateIssueDraft(data: unknown): {
  success: true;
  data: IssueDraft;
} | {
  success: false;
  errors: Array<{ path: string; message: string }>;
} {
  // First validation pass
  const parseResult = IssueDraftSchema.safeParse(data);
  
  if (!parseResult.success) {
    // Convert Zod errors to deterministic format
    const zodIssues = parseResult.error?.issues || [];
    const errors = zodIssues
      .map(err => ({
        path: err.path.join('.') || 'root',
        message: err.message,
      }))
      // Sort by path for deterministic ordering
      .sort((a, b) => a.path.localeCompare(b.path))
      // Bound error count (DoS-safe)
      .slice(0, 100);
    
    return {
      success: false,
      errors,
    };
  }

  // Normalize the draft
  const normalized = normalizeIssueDraft(parseResult.data);

  // Re-validate normalized result (should always pass, but safety check)
  const revalidate = IssueDraftSchema.safeParse(normalized);
  
  if (!revalidate.success) {
    // This should never happen, but handle gracefully
    const zodIssues = revalidate.error?.issues || [];
    const errors = zodIssues
      .map(err => ({
        path: err.path.join('.') || 'root',
        message: `Normalization error: ${err.message}`,
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 100);
    
    return {
      success: false,
      errors,
    };
  }

  return {
    success: true,
    data: normalized,
  };
}

/**
 * Example: Minimal valid Issue Draft
 * 
 * This example demonstrates the minimum required fields
 * for a valid issue draft.
 */
export const EXAMPLE_MINIMAL_ISSUE_DRAFT: IssueDraft = {
  issueDraftVersion: ISSUE_DRAFT_VERSION,
  title: 'E81.1: Issue Draft Schema v1',
  body: `Canonical-ID: E81.1

Implement the Issue Draft Schema v1 with Zod validation.

## Problem
INTENT fails on incomplete objects due to missing required fields.

## Acceptance Criteria
- Schema validates all required fields
- Canonical ID format is enforced
- Labels are deduplicated and sorted`,
  type: 'issue',
  canonicalId: 'E81.1',
  labels: ['v0.8', 'epic:E81', 'layer:B', 'intent', 'schema'],
  dependsOn: [],
  priority: 'P1',
  acceptanceCriteria: [
    'Zod schema defined with strict mode',
    'Validator returns deterministic errors',
    'Labels deduped and sorted',
  ],
  verify: {
    commands: ['npm --prefix control-center test -- __tests__/lib/schemas/issue-draft-schema.test.ts'],
    expected: ['Tests pass'],
  },
  guards: {
    env: 'development',
    prodBlocked: true,
  },
};

/**
 * Example: Full Issue Draft with all optional fields
 * 
 * This example demonstrates all available fields including
 * optional KPI configuration.
 */
export const EXAMPLE_FULL_ISSUE_DRAFT: IssueDraft = {
  issueDraftVersion: ISSUE_DRAFT_VERSION,
  title: 'E81.2: Issue Renderer Integration',
  body: `Canonical-ID: E81.2

Integrate Issue Draft Schema with GitHub Issue Renderer.

## Problem
Issue drafts need to be rendered as GitHub issues.

## Solution
Use the schema to validate drafts before rendering.

## Acceptance Criteria
- Drafts validate before rendering
- Rendered issues include all metadata
- CID marker is included in body`,
  type: 'issue',
  canonicalId: 'E81.2',
  labels: ['v0.8', 'epic:E81', 'layer:B', 'intent', 'integration'],
  dependsOn: ['E81.1'],
  priority: 'P1',
  kpi: {
    dcu: 1,
    intent: 'Reduce issue creation errors by 80%',
  },
  acceptanceCriteria: [
    'Schema validation integrated',
    'Errors surface to INTENT',
    'Rendered issues conform to schema',
    'CID marker present in all issues',
  ],
  verify: {
    commands: [
      'npm --prefix control-center test -- __tests__/lib/github-issue-renderer.test.ts',
      'npm run repo:verify',
    ],
    expected: [
      'All tests pass',
      'No validation errors',
    ],
  },
  guards: {
    env: 'staging',
    prodBlocked: true,
  },
};

/**
 * Few-shot examples for INTENT tool descriptions
 * 
 * These examples can be used in tool descriptions to help
 * INTENT understand the expected format without dumping
 * the full schema into environment variables.
 */
export const FEW_SHOT_EXAMPLES = {
  minimal: EXAMPLE_MINIMAL_ISSUE_DRAFT,
  full: EXAMPLE_FULL_ISSUE_DRAFT,
};

/**
 * Tool description snippet for INTENT
 * 
 * Use this in tool descriptions to provide context without
 * exposing the full schema implementation.
 */
export const TOOL_DESCRIPTION_SNIPPET = `
Issue Draft Format:
- version: "1.0"
- title: string (1-200 chars)
- body: string (10-10000 chars, must contain Canonical-ID marker)
- type: "epic" | "issue"
- canonicalId: format I8xx, E81.x, or CID:<id>
- labels: string[] (auto-sorted, deduped)
- dependsOn: canonicalId[] (auto-sorted, deduped)
- priority: "P0" | "P1" | "P2"
- acceptanceCriteria: string[] (1-20 items)
- verify: { commands: string[], expected: string[] }
- guards: { env: "staging"|"development", prodBlocked: true }
- kpi: { dcu?: 0.5|1|2, intent?: string } (optional)

Example canonicalId values: "I811", "E81.1", "CID:E81.1"
`.trim();
