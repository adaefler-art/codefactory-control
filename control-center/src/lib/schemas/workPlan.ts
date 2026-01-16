/**
 * Work Plan Schema v1
 * 
 * V09-I04: WorkPlanV1: Freies Plan-Artefakt (ohne Draft)
 * 
 * Free-form planning artifact for INTENT sessions - an intermediate stage
 * between casual conversation and formal draft creation. Allows "free thinking"
 * without committing to structured issue/CR format.
 * 
 * NON-NEGOTIABLES:
 * - Deterministic hash (same content → same hash)
 * - Bounded arrays and strings (prevent abuse)
 * - No secrets/PHI in content
 * - Strict schema validation
 * - Empty state: null + reason (not an error)
 */

import { z } from 'zod';
import { createHash } from 'crypto';

/**
 * Active Work Plan Schema Versions
 */
export const ACTIVE_WORK_PLAN_VERSIONS = ['1.0.0'] as const;

/**
 * Allowed version type for Zod validation
 */
type AllowedWorkPlanVersion = typeof ACTIVE_WORK_PLAN_VERSIONS[number];

/**
 * Work Plan Version
 * Current version: 1.0.0
 */
export const WORK_PLAN_VERSION: AllowedWorkPlanVersion = '1.0.0';

/**
 * Bounded string for plan content
 * Max 5000 chars to prevent abuse while allowing sufficient planning space
 */
const BoundedPlanString = z.string().min(1).max(5000);

/**
 * Bounded array for lists
 * Max 50 items to prevent abuse
 */
const BoundedPlanArray = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.array(itemSchema).max(50);

/**
 * Work Plan Goal Item
 */
export const WorkPlanGoalSchema = z.object({
  id: z.string().uuid(),
  text: BoundedPlanString,
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  completed: z.boolean().default(false),
}).strict();

export type WorkPlanGoal = z.infer<typeof WorkPlanGoalSchema>;

/**
 * Work Plan Todo Item
 */
export const WorkPlanTodoSchema = z.object({
  id: z.string().uuid(),
  text: BoundedPlanString,
  completed: z.boolean().default(false),
  assignedGoalId: z.string().uuid().optional(),
}).strict();

export type WorkPlanTodo = z.infer<typeof WorkPlanTodoSchema>;

/**
 * Work Plan Option (alternative approaches)
 */
export const WorkPlanOptionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: BoundedPlanString,
  pros: BoundedPlanArray(z.string().max(500)),
  cons: BoundedPlanArray(z.string().max(500)),
}).strict();

export type WorkPlanOption = z.infer<typeof WorkPlanOptionSchema>;

/**
 * Work Plan Content Schema V1
 * 
 * Represents the core planning content:
 * - goals: High-level objectives
 * - context: Background information, constraints, requirements
 * - options: Alternative approaches or solutions being considered
 * - todos: Actionable steps
 * - notes: Free-form additional notes
 */
export const WorkPlanContentV1Schema = z.object({
  goals: BoundedPlanArray(WorkPlanGoalSchema).default([]),
  context: BoundedPlanString.optional(),
  options: BoundedPlanArray(WorkPlanOptionSchema).default([]),
  todos: BoundedPlanArray(WorkPlanTodoSchema).default([]),
  notes: BoundedPlanString.optional(),
}).strict();

export type WorkPlanContentV1 = z.infer<typeof WorkPlanContentV1Schema>;

/**
 * Work Plan Response Schema V1
 * 
 * Full work plan with metadata for GET responses
 */
export const WorkPlanResponseV1Schema = z.object({
  version: z.enum(ACTIVE_WORK_PLAN_VERSIONS as unknown as [string, ...string[]]),
  exists: z.boolean(),
  reason: z.string().optional(), // e.g., "NO_PLAN" when exists: false
  content: WorkPlanContentV1Schema.optional(),
  contentHash: z.string().optional(), // SHA-256 hash (first 12 chars)
  updatedAt: z.string().datetime().optional(),
}).strict();

export type WorkPlanResponseV1 = z.infer<typeof WorkPlanResponseV1Schema>;

/**
 * Work Plan Update Request Schema
 * Input validation for PUT requests
 */
export const WorkPlanUpdateRequestSchema = z.object({
  content: WorkPlanContentV1Schema,
}).strict();

export type WorkPlanUpdateRequest = z.infer<typeof WorkPlanUpdateRequestSchema>;

/**
 * Create an empty work plan response (no plan exists)
 */
export function createEmptyWorkPlanResponse(): WorkPlanResponseV1 {
  return {
    version: WORK_PLAN_VERSION,
    exists: false,
    reason: 'NO_PLAN',
  };
}

/**
 * Normalize and hash work plan content for deterministic comparison
 * 
 * @param content - Work plan content
 * @returns SHA-256 hash of normalized JSON
 */
export function hashWorkPlanContent(content: WorkPlanContentV1): string {
  // Normalize: deterministic JSON stringification with sorted keys at all levels
  const normalized = JSON.stringify(content, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Sort object keys for deterministic output
      const sorted: Record<string, unknown> = {};
      Object.keys(value).sort().forEach(k => {
        sorted[k] = value[k];
      });
      return sorted;
    }
    return value;
  });
  
  // SHA-256 hash
  const hash = createHash('sha256').update(normalized, 'utf8').digest('hex');
  
  return hash;
}

/**
 * Create a work plan response from database data
 * 
 * @param plan - Work plan data from DB
 * @returns WorkPlanResponseV1
 */
export function createWorkPlanResponse(plan: {
  content_json: unknown;
  content_hash: string;
  updated_at: string;
  schema_version: string;
}): WorkPlanResponseV1 {
  // Parse and validate content
  const parseResult = WorkPlanContentV1Schema.safeParse(plan.content_json);
  
  if (!parseResult.success) {
    // If stored content is invalid, return empty state
    // This should not happen in practice due to validation on PUT
    console.error('[WorkPlan] Invalid content in database:', parseResult.error);
    return createEmptyWorkPlanResponse();
  }
  
  return {
    version: plan.schema_version as AllowedWorkPlanVersion,
    exists: true,
    content: parseResult.data,
    contentHash: plan.content_hash.substring(0, 12), // First 12 chars for display
    updatedAt: plan.updated_at,
  };
}

/**
 * Validate that work plan content does not contain secrets or sensitive data
 * 
 * Basic heuristic checks - not comprehensive but catches common patterns
 * 
 * @param content - Work plan content
 * @returns true if validation passes, error message if fails
 */
export function validateNoSecrets(content: WorkPlanContentV1): true | string {
  const contentStr = JSON.stringify(content).toLowerCase();
  
  // Common secret patterns
  const secretPatterns = [
    /api[_-]?key/i,
    /secret[_-]?key/i,
    /password/i,
    /bearer\s+[a-z0-9_-]+/i,
    /token[_-]?key/i,
    /private[_-]?key/i,
    /aws[_-]?secret/i,
    /access[_-]?key[_-]?id/i,
  ];
  
  for (const pattern of secretPatterns) {
    if (pattern.test(contentStr)) {
      return `Content may contain secrets (matched pattern: ${pattern.source})`;
    }
  }
  
  return true;
}
