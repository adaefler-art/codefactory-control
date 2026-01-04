/**
 * Outcome Records Contract Schema (E78.2 / I782)
 * 
 * Defines types and contracts for outcome records with auto-postmortem generation:
 * - Evidence-based postmortem artifacts
 * - Deterministic generation (same inputs → same hash)
 * - Measurable outcomes tracking
 * - No secrets, only pointers + hashes
 * 
 * MUST be kept in sync with database/migrations/045_outcome_records.sql
 */

import { z } from 'zod';

// ========================================
// Enums and Constants
// ========================================

export const OUTCOME_ENTITY_TYPES = ['incident', 'remediation_run'] as const;
export const OUTCOME_STATUSES = ['RECORDED'] as const;

export type OutcomeEntityType = typeof OUTCOME_ENTITY_TYPES[number];
export type OutcomeStatus = typeof OUTCOME_STATUSES[number];

// Postmortem schema version
export const POSTMORTEM_VERSION = '0.7.0' as const;

// ========================================
// Postmortem JSON Schema v0.7.0
// ========================================

/**
 * Evidence reference in postmortem
 */
export const PostmortemEvidenceRefSchema = z.object({
  kind: z.string(),
  ref: z.record(z.string(), z.any()),
  hash: z.string().optional().nullable(),
});

export type PostmortemEvidenceRef = z.infer<typeof PostmortemEvidenceRefSchema>;

/**
 * Attempted playbook in postmortem
 */
export const PostmortemPlaybookAttemptSchema = z.object({
  playbookId: z.string(),
  status: z.enum(['PLANNED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED']),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional().nullable(),
  verificationHash: z.string().optional().nullable(),
});

export type PostmortemPlaybookAttempt = z.infer<typeof PostmortemPlaybookAttemptSchema>;

/**
 * Postmortem JSON Schema v0.7.0
 * 
 * Evidence-based postmortem artifact:
 * - Only facts backed by stored evidence
 * - Unknowns when evidence is insufficient
 * - Deterministic output (same inputs → same hash)
 */
export const PostmortemV0_7_0Schema = z.object({
  // Schema version
  version: z.literal(POSTMORTEM_VERSION),
  generatedAt: z.string().datetime(),
  
  // Incident metadata
  incident: z.object({
    id: z.string().uuid(),
    key: z.string(),
    severity: z.enum(['YELLOW', 'RED']),
    category: z.string().optional().nullable(),
    openedAt: z.string().datetime(),
    closedAt: z.string().datetime().optional().nullable(),
  }),
  
  // Detection information
  detection: z.object({
    signalKinds: z.array(z.string()),
    primaryEvidence: PostmortemEvidenceRefSchema,
  }),
  
  // Impact summary (evidence-backed only)
  impact: z.object({
    summary: z.string(), // Short, evidence-backed summary
    durationMinutes: z.number().optional().nullable(), // Only if resolvable
  }),
  
  // Remediation attempts
  remediation: z.object({
    attemptedPlaybooks: z.array(PostmortemPlaybookAttemptSchema),
  }),
  
  // Verification results
  verification: z.object({
    result: z.enum(['PASS', 'FAIL', 'UNKNOWN']),
    reportHash: z.string().optional().nullable(),
  }),
  
  // Outcome
  outcome: z.object({
    resolved: z.boolean(),
    mttrMinutes: z.number().optional().nullable(),
    autoFixed: z.boolean(),
  }),
  
  // Learnings (facts + unknowns)
  learnings: z.object({
    facts: z.array(z.string()), // Extracted facts only
    unknowns: z.array(z.string()), // What we could not determine
  }),
  
  // References
  references: z.object({
    used_sources_hashes: z.array(z.string()),
    pointers: z.array(PostmortemEvidenceRefSchema),
  }),
});

export type PostmortemV0_7_0 = z.infer<typeof PostmortemV0_7_0Schema>;

// ========================================
// Outcome Record Schemas
// ========================================

/**
 * Metrics JSON schema
 * Captures measurable outcome deltas
 */
export const MetricsJsonSchema = z.object({
  mttr_hours: z.number().optional().nullable(),
  incidents_open: z.number().int().optional(), // Delta: -1 for closed, +1 for opened
  auto_fixed: z.boolean().optional(),
  playbooks_attempted: z.number().int().optional(),
  playbooks_succeeded: z.number().int().optional(),
});

export type MetricsJson = z.infer<typeof MetricsJsonSchema>;

/**
 * Source refs schema
 * Links to source entities and evidence
 */
export const SourceRefsSchema = z.object({
  incidentId: z.string().uuid().optional().nullable(),
  remediationRunIds: z.array(z.string().uuid()).optional(),
  verificationReportHashes: z.array(z.string()).optional(),
  statusChanges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    at: z.string().datetime(),
  })).optional(),
});

export type SourceRefs = z.infer<typeof SourceRefsSchema>;

/**
 * Outcome Record Input Schema
 */
export const OutcomeRecordInputSchema = z.object({
  entity_type: z.enum(OUTCOME_ENTITY_TYPES),
  entity_id: z.string().uuid(),
  outcome_key: z.string().min(1),
  status: z.enum(OUTCOME_STATUSES).default('RECORDED'),
  metrics_json: MetricsJsonSchema.default({}),
  postmortem_json: PostmortemV0_7_0Schema,
  postmortem_hash: z.string(),
  lawbook_version: z.string().optional().nullable(),
  source_refs: SourceRefsSchema.default({}),
});

export type OutcomeRecordInput = z.infer<typeof OutcomeRecordInputSchema>;

/**
 * Outcome Record Schema (DB row)
 */
export const OutcomeRecordSchema = z.object({
  id: z.string().uuid(),
  entity_type: z.enum(OUTCOME_ENTITY_TYPES),
  entity_id: z.string().uuid(),
  created_at: z.string().datetime(),
  outcome_key: z.string(),
  status: z.enum(OUTCOME_STATUSES),
  metrics_json: MetricsJsonSchema,
  postmortem_json: PostmortemV0_7_0Schema,
  postmortem_hash: z.string(),
  lawbook_version: z.string().nullable(),
  source_refs: SourceRefsSchema,
});

export type OutcomeRecord = z.infer<typeof OutcomeRecordSchema>;

// ========================================
// Helper Functions
// ========================================

/**
 * Stable stringify for deterministic hashing
 * Recursively sorts object keys alphabetically
 */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (v: any): any => {
    if (v === null) return null;
    if (v === undefined) return null; // Treat undefined as null for stability
    if (typeof v !== 'object') return v;
    
    if (Array.isArray(v)) {
      return v.map(normalize);
    }

    // Circular reference detection
    if (seen.has(v)) {
      throw new Error('Cannot stableStringify cyclic structure');
    }
    seen.add(v);

    // Sort keys alphabetically for deterministic output
    const keys = Object.keys(v).sort();
    const out: Record<string, any> = {};
    for (const k of keys) {
      out[k] = normalize(v[k]);
    }
    return out;
  };

  return JSON.stringify(normalize(value));
}

/**
 * Compute postmortem hash (SHA-256 of stable JSON)
 * Ensures same inputs → same hash
 */
export function computePostmortemHash(postmortem: PostmortemV0_7_0): string {
  const crypto = require('crypto');
  const stableJson = stableStringify(postmortem);
  return crypto.createHash('sha256').update(stableJson).digest('hex');
}

/**
 * Generate outcome_key for incident
 * Format: incident:<incident_id>:<remediation_run_id?>:<pack_hash>
 */
export function generateIncidentOutcomeKey(
  incidentId: string,
  remediationRunId: string | null,
  packHash: string
): string {
  const runPart = remediationRunId || 'none';
  return `incident:${incidentId}:${runPart}:${packHash}`;
}

/**
 * Generate outcome_key for remediation_run
 * Format: remediation_run:<remediation_run_id>:<verification_hash?>
 */
export function generateRemediationRunOutcomeKey(
  remediationRunId: string,
  verificationHash: string | null
): string {
  const verifyPart = verificationHash || 'none';
  return `remediation_run:${remediationRunId}:${verifyPart}`;
}

/**
 * Validate postmortem JSON
 */
export function validatePostmortem(data: unknown): {
  success: boolean;
  data?: PostmortemV0_7_0;
  error?: string;
} {
  try {
    const result = PostmortemV0_7_0Schema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}

/**
 * Validate outcome record input
 */
export function validateOutcomeRecordInput(data: unknown): {
  success: boolean;
  data?: OutcomeRecordInput;
  error?: string;
} {
  try {
    const result = OutcomeRecordInputSchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}
