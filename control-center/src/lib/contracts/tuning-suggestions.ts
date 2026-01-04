/**
 * Tuning Suggestions Contract Schema (E78.3 / I783)
 * 
 * Defines types and contracts for tuning suggestions:
 * - Evidence-based suggestions for playbooks/rules/guardrails
 * - Deterministic generation (same inputs → same hash)
 * - Transparent references to supporting outcomes/KPIs
 * - No automatic application (suggestions only)
 * 
 * MUST be kept in sync with database/migrations/046_tuning_suggestions.sql
 */

import { z } from 'zod';
import { createHash } from 'crypto';

// ========================================
// Enums and Constants
// ========================================

export const SUGGESTION_TYPES = [
  'PLAYBOOK_TUNING',
  'CLASSIFIER_RULE',
  'EVIDENCE_GAP',
  'GUARDRAIL',
] as const;

export const SUGGESTION_CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export const SUGGESTION_STATUSES = ['PROPOSED'] as const;

export type SuggestionType = typeof SUGGESTION_TYPES[number];
export type SuggestionConfidence = typeof SUGGESTION_CONFIDENCE_LEVELS[number];
export type SuggestionStatus = typeof SUGGESTION_STATUSES[number];

// Suggestion schema version
export const TUNING_SUGGESTION_VERSION = '0.7.0' as const;

// ========================================
// References Schema
// ========================================

/**
 * Evidence references supporting a suggestion
 */
export const SuggestionReferencesSchema = z.object({
  // Outcome record IDs that support this suggestion
  outcomeIds: z.array(z.string().uuid()).optional().default([]),
  
  // Incident IDs referenced
  incidentIds: z.array(z.string().uuid()).optional().default([]),
  
  // KPI window references (for aggregate data)
  kpiWindowRefs: z.array(z.object({
    window: z.string(),
    windowStart: z.string().datetime(),
    windowEnd: z.string().datetime(),
    kpiName: z.string(),
  })).optional().default([]),
  
  // Evidence hashes referenced
  evidenceHashes: z.array(z.string()).optional().default([]),
});

export type SuggestionReferences = z.infer<typeof SuggestionReferencesSchema>;

// ========================================
// Tuning Suggestion Schema v0.7.0
// ========================================

/**
 * Tuning Suggestion JSON Schema v0.7.0
 * 
 * Evidence-based suggestion for improvements:
 * - Deterministic output (same inputs → same hash)
 * - Transparent references to supporting data
 * - Conservative: prefer collecting more evidence over risky actions
 */
export const TuningSuggestionV0_7_0Schema = z.object({
  // Schema version
  version: z.literal(TUNING_SUGGESTION_VERSION),
  generatedAt: z.string().datetime(),
  
  // Suggestion identification
  suggestionId: z.string(), // Stable hash of suggestion content
  
  // Suggestion type
  type: z.enum(SUGGESTION_TYPES),
  
  // Suggestion content
  title: z.string(),
  rationale: z.string(),
  
  // Proposed change (textual or structured)
  proposedChange: z.union([
    z.string(),
    z.record(z.string(), z.any()),
  ]),
  
  // Expected impact
  expectedImpact: z.string(), // e.g., "Reduce MTTR by 15%", "Reduce UNKNOWN classifications by 20%"
  
  // Confidence level
  confidence: z.enum(SUGGESTION_CONFIDENCE_LEVELS),
  
  // Supporting references
  references: SuggestionReferencesSchema,
  
  // Status (future: accepted, rejected, etc.)
  status: z.enum(SUGGESTION_STATUSES).default('PROPOSED'),
});

export type TuningSuggestionV0_7_0 = z.infer<typeof TuningSuggestionV0_7_0Schema>;

// ========================================
// Tuning Suggestion Record Schemas
// ========================================

/**
 * Input schema for creating a tuning suggestion
 */
export const TuningSuggestionInputSchema = z.object({
  window: z.string(),
  window_start: z.string().datetime(),
  window_end: z.string().datetime(),
  suggestion_json: TuningSuggestionV0_7_0Schema,
  suggestion_hash: z.string(),
});

export type TuningSuggestionInput = z.infer<typeof TuningSuggestionInputSchema>;

/**
 * Tuning Suggestion Record Schema (DB row)
 */
export const TuningSuggestionRecordSchema = z.object({
  id: z.string().uuid(),
  window: z.string(),
  window_start: z.string().datetime(),
  window_end: z.string().datetime(),
  suggestion_hash: z.string(),
  suggestion_json: TuningSuggestionV0_7_0Schema,
  created_at: z.string().datetime(),
});

export type TuningSuggestionRecord = z.infer<typeof TuningSuggestionRecordSchema>;

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
 * Compute suggestion hash (SHA-256 of stable JSON)
 * Ensures same inputs → same hash
 * 
 * Note: excludes generatedAt and suggestionId from hash computation
 * to ensure deterministic hashing based on content only
 */
export function computeSuggestionHash(suggestion: TuningSuggestionV0_7_0): string {
  // Create a copy without generatedAt and suggestionId for hashing
  const { generatedAt, suggestionId, ...hashableContent } = suggestion;
  const stableJson = stableStringify(hashableContent);
  return createHash('sha256').update(stableJson).digest('hex');
}

/**
 * Compute suggestion ID (first 16 chars of hash)
 * Shorter, stable identifier for suggestions
 */
export function computeSuggestionId(suggestion: TuningSuggestionV0_7_0): string {
  const hash = computeSuggestionHash(suggestion);
  return hash.substring(0, 16);
}

/**
 * Validate tuning suggestion JSON
 */
export function validateTuningSuggestion(data: unknown): {
  success: boolean;
  data?: TuningSuggestionV0_7_0;
  error?: string;
} {
  try {
    const result = TuningSuggestionV0_7_0Schema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}

/**
 * Validate tuning suggestion input
 */
export function validateTuningSuggestionInput(data: unknown): {
  success: boolean;
  data?: TuningSuggestionInput;
  error?: string;
} {
  try {
    const result = TuningSuggestionInputSchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}
