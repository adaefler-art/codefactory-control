/**
 * Lawbook Schema v1 (E79.1 / I791)
 * 
 * Versioned, immutable, auditable guardrails/rules document ("Lawbook")
 * with deny-by-default semantics and deterministic hashing.
 * 
 * Features:
 * - Immutable versions (never change once published)
 * - Deterministic serialization + hashing (same content → same hash)
 * - Active pointer for current enforcement version
 * - Comprehensive enforcement rules for gates and playbooks
 */

import { z } from 'zod';

// ========================================
// Lawbook Schema v0.7.0
// ========================================

/**
 * Schema version for lawbook document structure
 */
export const LAWBOOK_SCHEMA_VERSION = '0.7.0';

/**
 * GitHub configuration section
 */
export const LawbookGitHubSchema = z.object({
  allowedRepos: z.array(z.string()).optional(),
}).strict();

/**
 * Determinism enforcement section
 */
export const LawbookDeterminismSchema = z.object({
  requireDeterminismGate: z.boolean(),
  requirePostDeployVerification: z.boolean(),
}).strict();

/**
 * Remediation configuration section
 */
export const LawbookRemediationSchema = z.object({
  enabled: z.boolean(),
  allowedPlaybooks: z.array(z.string()),
  allowedActions: z.array(z.string()),
  maxRunsPerIncident: z.number().int().positive().optional(),
  cooldownMinutes: z.number().int().positive().optional(),
}).strict();

/**
 * Stop conditions configuration section (E84.4)
 * Rules to prevent infinite loops in automated reruns
 */
export const LawbookStopRulesSchema = z.object({
  // Maximum reruns per individual job
  maxRerunsPerJob: z.number().int().positive().default(2),
  
  // Maximum total reruns across all jobs in a PR
  maxTotalRerunsPerPr: z.number().int().positive().default(5),
  
  // Maximum wait time for checks to turn green (in minutes)
  maxWaitMinutesForGreen: z.number().int().positive().optional(),
  
  // Cooldown period between rerun attempts (in minutes)
  cooldownMinutes: z.number().int().positive().default(5),
  
  // Failure classes that should immediately block reruns
  blockOnFailureClasses: z.array(z.string()).default([
    'build deterministic',
    'lint error',
    'syntax error',
  ]),
  
  // Number of cycles with no signal change before triggering HOLD
  noSignalChangeThreshold: z.number().int().positive().default(2),
}).strict();

/**
 * Evidence requirements section
 */
export const LawbookEvidenceSchema = z.object({
  requiredKindsByCategory: z.record(z.string(), z.array(z.string())).optional(),
  maxEvidenceItems: z.number().int().positive().optional(),
}).strict();

/**
 * Enforcement configuration section
 */
export const LawbookEnforcementSchema = z.object({
  requiredFields: z.array(z.string()),
  strictMode: z.boolean(),
}).strict();

/**
 * UI configuration section
 */
export const LawbookUISchema = z.object({
  displayName: z.string().optional(),
}).strict();

/**
 * Complete Lawbook Document Schema v0.7.0
 */
export const LawbookV1Schema = z.object({
  version: z.literal('0.7.0'),
  lawbookId: z.string().min(1),
  lawbookVersion: z.string().min(1),
  createdAt: z.string().datetime(), // ISO 8601 datetime
  createdBy: z.enum(['admin', 'system']),
  notes: z.string().optional(),
  github: LawbookGitHubSchema,
  determinism: LawbookDeterminismSchema,
  remediation: LawbookRemediationSchema,
  stopRules: LawbookStopRulesSchema.optional(), // E84.4: Stop conditions
  evidence: LawbookEvidenceSchema,
  enforcement: LawbookEnforcementSchema,
  ui: LawbookUISchema,
}).strict();

// ========================================
// TypeScript Types
// ========================================

export type LawbookGitHub = z.infer<typeof LawbookGitHubSchema>;
export type LawbookDeterminism = z.infer<typeof LawbookDeterminismSchema>;
export type LawbookRemediation = z.infer<typeof LawbookRemediationSchema>;
export type LawbookStopRules = z.infer<typeof LawbookStopRulesSchema>;
export type LawbookEvidence = z.infer<typeof LawbookEvidenceSchema>;
export type LawbookEnforcement = z.infer<typeof LawbookEnforcementSchema>;
export type LawbookUI = z.infer<typeof LawbookUISchema>;
export type LawbookV1 = z.infer<typeof LawbookV1Schema>;

// ========================================
// Canonicalization & Hashing
// ========================================

/**
 * Canonical JSON serialization for deterministic hashing
 * - Stable key ordering (sorted)
 * - Deterministic array ordering where semantically appropriate
 * - No whitespace variations
 */
export function canonicalizeLawbook(lawbook: LawbookV1): string {
  // Sort all arrays that are sets (order doesn't matter semantically)
  const normalized: LawbookV1 = {
    ...lawbook,
    github: {
      ...lawbook.github,
      allowedRepos: lawbook.github.allowedRepos?.slice().sort(),
    },
    remediation: {
      ...lawbook.remediation,
      allowedPlaybooks: lawbook.remediation.allowedPlaybooks.slice().sort(),
      allowedActions: lawbook.remediation.allowedActions.slice().sort(),
    },
    stopRules: lawbook.stopRules ? {
      ...lawbook.stopRules,
      blockOnFailureClasses: lawbook.stopRules.blockOnFailureClasses?.slice().sort(),
    } : undefined,
    enforcement: {
      ...lawbook.enforcement,
      requiredFields: lawbook.enforcement.requiredFields.slice().sort(),
    },
  };

  // Use stable stringify (sorted keys)
  return stableStringify(normalized);
}

/**
 * Stable stringify with sorted keys (recursive)
 */
function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (v: any): any => {
    if (v === null) return null;
    if (typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(normalize);

    if (seen.has(v)) throw new Error('Cannot stableStringify cyclic structure');
    seen.add(v);

    const keys = Object.keys(v).sort();
    const out: Record<string, any> = {};
    for (const k of keys) out[k] = normalize(v[k]);
    return out;
  };

  return JSON.stringify(normalize(value));
}

/**
 * Compute SHA-256 hash of canonicalized lawbook
 */
export function computeLawbookHash(lawbook: LawbookV1): string {
  const canonical = canonicalizeLawbook(lawbook);
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ========================================
// Validation & Parsing
// ========================================

/**
 * Parse and validate lawbook JSON
 * Throws ZodError if invalid
 */
export function parseLawbook(data: unknown): LawbookV1 {
  return LawbookV1Schema.parse(data);
}

/**
 * Safe parse (returns success/error result)
 */
export function safeParseLawbook(data: unknown): z.SafeParseReturnType<unknown, LawbookV1> {
  return LawbookV1Schema.safeParse(data);
}

// ========================================
// Example Minimal Lawbook
// ========================================

/**
 * Creates a minimal valid lawbook for testing/bootstrapping
 */
export function createMinimalLawbook(overrides?: Partial<LawbookV1>): LawbookV1 {
  const now = new Date().toISOString();
  
  return {
    version: '0.7.0',
    lawbookId: 'AFU9-LAWBOOK',
    lawbookVersion: '2025-12-30.1',
    createdAt: now,
    createdBy: 'system',
    notes: 'Minimal lawbook for AFU-9 enforcement',
    github: {
      allowedRepos: [],
    },
    determinism: {
      requireDeterminismGate: true,
      requirePostDeployVerification: true,
    },
    remediation: {
      enabled: true,
      allowedPlaybooks: ['SAFE_RETRY_RUNNER', 'RERUN_VERIFICATION'],
      allowedActions: ['runner_dispatch', 'verification_run', 'ecs_force_new_deploy'],
      maxRunsPerIncident: 3,
      cooldownMinutes: 15,
    },
    stopRules: {
      maxRerunsPerJob: 2,
      maxTotalRerunsPerPr: 5,
      maxWaitMinutesForGreen: 60,
      cooldownMinutes: 5,
      blockOnFailureClasses: ['build deterministic', 'lint error', 'syntax error'],
      noSignalChangeThreshold: 2,
    },
    evidence: {
      requiredKindsByCategory: {},
      maxEvidenceItems: 100,
    },
    enforcement: {
      requiredFields: ['lawbookVersion'],
      strictMode: true,
    },
    ui: {
      displayName: 'AFU-9 Default Lawbook',
    },
    ...overrides,
  };
}
