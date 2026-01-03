/**
 * Remediation Playbook Contract Schema (E77.1 / I771)
 * 
 * Defines types and contracts for the remediation playbook framework:
 * - Safe, guardrailed actions in response to Incidents
 * - Strict idempotency via run_key
 * - Evidence gating (require specific evidence before running)
 * - Lawbook gating (deny-by-default)
 * - Full audit trail (planned → executed → verified)
 * 
 * MUST be kept in sync with database/migrations/038_remediation_playbooks.sql
 */

import { z } from 'zod';
import { ClassificationCategory } from './incident';

// ========================================
// Enums and Constants
// ========================================

export const REMEDIATION_RUN_STATUSES = [
  'PLANNED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
] as const;

export const REMEDIATION_STEP_STATUSES = [
  'PLANNED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
] as const;

export const ACTION_TYPES = [
  'RESTART_SERVICE',
  'ROLLBACK_DEPLOY',
  'SCALE_UP',
  'SCALE_DOWN',
  'DRAIN_TASKS',
  'NOTIFY_SLACK',
  'CREATE_ISSUE',
  'RUN_VERIFICATION',
] as const;

export type RemediationRunStatus = typeof REMEDIATION_RUN_STATUSES[number];
export type RemediationStepStatus = typeof REMEDIATION_STEP_STATUSES[number];
export type ActionType = typeof ACTION_TYPES[number];

// ========================================
// Evidence Predicate Schemas
// ========================================

/**
 * Evidence predicate for gating
 * Checks if required evidence exists before allowing playbook execution
 */
export const EvidencePredicateSchema = z.object({
  kind: z.enum(['runner', 'ecs', 'alb', 'http', 'verification', 'deploy_status', 'log_pointer', 'github_run']),
  requiredFields: z.array(z.string()).optional(), // e.g., ["ref.reportHash", "sha256"]
});

export type EvidencePredicate = z.infer<typeof EvidencePredicateSchema>;

// ========================================
// Step Definition Schemas
// ========================================

/**
 * Step input schema (Zod schema for step inputs)
 * Each step type can define its own input requirements
 */
export const StepInputSchemaSchema = z.record(z.string(), z.any());

export type StepInputSchemaType = z.infer<typeof StepInputSchemaSchema>;

/**
 * Step Context - runtime context available to steps
 */
export const StepContextSchema = z.object({
  incidentId: z.string().uuid(),
  incidentKey: z.string(),
  runId: z.string().uuid(),
  lawbookVersion: z.string(),
  evidence: z.array(z.record(z.string(), z.any())),
  inputs: z.record(z.string(), z.any()),
});

export type StepContext = z.infer<typeof StepContextSchema>;

/**
 * Step Result - returned by execute function
 */
export const StepResultSchema = z.object({
  success: z.boolean(),
  output: z.record(z.string(), z.any()).optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.string().optional(),
  }).optional(),
});

export type StepResult = z.infer<typeof StepResultSchema>;

/**
 * Step Definition - defines a single remediation step
 */
export const StepDefinitionSchema = z.object({
  stepId: z.string().min(1),
  actionType: z.enum(ACTION_TYPES),
  description: z.string(),
  inputsSchema: StepInputSchemaSchema.optional(),
  // Note: execute function is not serializable, handled at runtime
  // Note: idempotencyKeyFn is not serializable, handled at runtime
});

export type StepDefinition = z.infer<typeof StepDefinitionSchema>;

// ========================================
// Playbook Definition Schemas
// ========================================

/**
 * Post-verification config (references E65.2)
 */
export const PostVerifyConfigSchema = z.object({
  type: z.literal('E65.2'), // Reference to verification playbook
  params: z.record(z.string(), z.any()).optional(),
});

export type PostVerifyConfig = z.infer<typeof PostVerifyConfigSchema>;

/**
 * Playbook Definition - defines a complete remediation playbook
 */
export const PlaybookDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.string(),
  title: z.string(),
  applicableCategories: z.array(z.string()), // Incident.category[]
  requiredEvidence: z.array(EvidencePredicateSchema),
  steps: z.array(StepDefinitionSchema).min(1), // Must have at least one step
  postVerify: PostVerifyConfigSchema.optional(),
});

export type PlaybookDefinition = z.infer<typeof PlaybookDefinitionSchema>;

// ========================================
// Runtime Schemas (Database)
// ========================================

/**
 * Remediation Run Input
 */
export const RemediationRunInputSchema = z.object({
  run_key: z.string().min(1),
  incident_id: z.string().uuid(),
  playbook_id: z.string(),
  playbook_version: z.string(),
  status: z.enum(REMEDIATION_RUN_STATUSES).default('PLANNED'),
  planned_json: z.record(z.string(), z.any()).optional(),
  result_json: z.record(z.string(), z.any()).optional(),
  lawbook_version: z.string(),
  inputs_hash: z.string(),
});

export type RemediationRunInput = z.infer<typeof RemediationRunInputSchema>;

/**
 * Remediation Run Schema (DB row)
 */
export const RemediationRunSchema = z.object({
  id: z.string().uuid(),
  run_key: z.string(),
  incident_id: z.string().uuid(),
  playbook_id: z.string(),
  playbook_version: z.string(),
  status: z.enum(REMEDIATION_RUN_STATUSES),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  planned_json: z.record(z.string(), z.any()).nullable(),
  result_json: z.record(z.string(), z.any()).nullable(),
  lawbook_version: z.string(),
  inputs_hash: z.string(),
});

export type RemediationRun = z.infer<typeof RemediationRunSchema>;

/**
 * Remediation Step Input
 */
export const RemediationStepInputSchema = z.object({
  remediation_run_id: z.string().uuid(),
  step_id: z.string(),
  action_type: z.enum(ACTION_TYPES),
  status: z.enum(REMEDIATION_STEP_STATUSES).default('PLANNED'),
  idempotency_key: z.string().optional(),
  input_json: z.record(z.string(), z.any()).optional(),
  output_json: z.record(z.string(), z.any()).optional(),
  error_json: z.record(z.string(), z.any()).optional(),
});

export type RemediationStepInput = z.infer<typeof RemediationStepInputSchema>;

/**
 * Remediation Step Schema (DB row)
 */
export const RemediationStepSchema = z.object({
  id: z.string().uuid(),
  remediation_run_id: z.string().uuid(),
  step_id: z.string(),
  action_type: z.enum(ACTION_TYPES),
  status: z.enum(REMEDIATION_STEP_STATUSES),
  started_at: z.string().datetime().nullable(),
  finished_at: z.string().datetime().nullable(),
  idempotency_key: z.string().nullable(),
  input_json: z.record(z.string(), z.any()).nullable(),
  output_json: z.record(z.string(), z.any()).nullable(),
  error_json: z.record(z.string(), z.any()).nullable(),
});

export type RemediationStep = z.infer<typeof RemediationStepSchema>;

// ========================================
// Execution Result Schemas
// ========================================

/**
 * Planned Run - deterministic plan before execution
 */
export const PlannedRunSchema = z.object({
  playbookId: z.string(),
  playbookVersion: z.string(),
  steps: z.array(z.object({
    stepId: z.string(),
    actionType: z.enum(ACTION_TYPES),
    resolvedInputs: z.record(z.string(), z.any()),
  })),
  lawbookVersion: z.string(),
  inputsHash: z.string(),
});

export type PlannedRun = z.infer<typeof PlannedRunSchema>;

/**
 * Execute Playbook Request
 */
export const ExecutePlaybookRequestSchema = z.object({
  incidentId: z.string().uuid(),
  playbookId: z.string(),
  inputs: z.record(z.string(), z.any()).optional(),
});

export type ExecutePlaybookRequest = z.infer<typeof ExecutePlaybookRequestSchema>;

/**
 * Execute Playbook Response
 */
export const ExecutePlaybookResponseSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum(REMEDIATION_RUN_STATUSES),
  message: z.string().optional(),
  skipReason: z.string().optional(), // Set when status=SKIPPED
  planned: PlannedRunSchema.optional(),
  steps: z.array(RemediationStepSchema).optional(),
});

export type ExecutePlaybookResponse = z.infer<typeof ExecutePlaybookResponseSchema>;

// ========================================
// Helper Functions
// ========================================

/**
 * Compute run_key for idempotency
 * Format: <incident_key>:<playbook_id>:<inputs_hash>
 */
export function computeRunKey(
  incidentKey: string,
  playbookId: string,
  inputsHash: string
): string {
  return `${incidentKey}:${playbookId}:${inputsHash}`;
}

/**
 * Compute inputs hash (SHA-256 of stable JSON)
 */
export function computeInputsHash(inputs: Record<string, any>): string {
  const crypto = require('crypto');
  const stableJson = JSON.stringify(inputs, Object.keys(inputs).sort());
  return crypto.createHash('sha256').update(stableJson).digest('hex');
}

/**
 * Validate playbook definition
 */
export function validatePlaybookDefinition(data: unknown): {
  success: boolean;
  data?: PlaybookDefinition;
  error?: string;
} {
  try {
    const result = PlaybookDefinitionSchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}

/**
 * Check if evidence predicate is satisfied
 */
export function checkEvidencePredicate(
  predicate: EvidencePredicate,
  evidence: Array<{ kind: string; ref: Record<string, any>; sha256?: string | null }>
): boolean {
  // Find evidence matching the kind
  const matchingEvidence = evidence.filter(e => e.kind === predicate.kind);
  
  if (matchingEvidence.length === 0) {
    return false;
  }
  
  // If no required fields, just check kind existence
  if (!predicate.requiredFields || predicate.requiredFields.length === 0) {
    return true;
  }
  
  // Check if at least one evidence item has all required fields
  return matchingEvidence.some(ev => {
    return predicate.requiredFields!.every(field => {
      const parts = field.split('.');
      let value: any = ev;
      
      for (const part of parts) {
        if (value && typeof value === 'object' && part in value) {
          value = value[part];
        } else {
          return false;
        }
      }
      
      return value !== null && value !== undefined;
    });
  });
}

/**
 * Check if all evidence predicates are satisfied
 */
export function checkAllEvidencePredicates(
  predicates: EvidencePredicate[],
  evidence: Array<{ kind: string; ref: Record<string, any>; sha256?: string | null }>
): { satisfied: boolean; missing: EvidencePredicate[] } {
  const missing: EvidencePredicate[] = [];
  
  for (const predicate of predicates) {
    if (!checkEvidencePredicate(predicate, evidence)) {
      missing.push(predicate);
    }
  }
  
  return {
    satisfied: missing.length === 0,
    missing,
  };
}
