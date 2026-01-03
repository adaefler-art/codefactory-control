/**
 * Incident Contract Schema (E76.1 / I761)
 * 
 * Defines types and contracts for the canonical incident schema:
 * - Self-debugging incidents with sources + evidence + classification
 * - Idempotent ingestion via incident_key
 * - Lifecycle status tracking (OPEN → ACKED → MITIGATED → CLOSED)
 * - Evidence-first: references + hashes, not secrets
 * - Lawbook version transparency
 * 
 * MUST be kept in sync with database/migrations/037_incidents_schema.sql
 */

import { z } from 'zod';

// ========================================
// Enums and Constants
// ========================================

export const INCIDENT_SEVERITIES = ['YELLOW', 'RED'] as const;
export const INCIDENT_STATUSES = ['OPEN', 'ACKED', 'MITIGATED', 'CLOSED'] as const;
export const EVIDENCE_KINDS = [
  'runner',
  'ecs',
  'alb',
  'http',
  'verification',
  'deploy_status',
  'log_pointer',
  'github_run',
] as const;
export const LINK_TYPES = [
  'TRIGGERED_BY',
  'RELATED_TO',
  'CAUSED_BY',
  'REMEDIATED_BY',
] as const;
export const EVENT_TYPES = [
  'CREATED',
  'UPDATED',
  'CLASSIFIED',
  'REMEDIATION_STARTED',
  'REMEDIATION_DONE',
  'CLOSED',
] as const;

export type IncidentSeverity = typeof INCIDENT_SEVERITIES[number];
export type IncidentStatus = typeof INCIDENT_STATUSES[number];
export type EvidenceKind = typeof EVIDENCE_KINDS[number];
export type LinkType = typeof LINK_TYPES[number];
export type EventType = typeof EVENT_TYPES[number];

// ========================================
// Source Primary Schemas
// ========================================

/**
 * Primary source signal reference
 * Identifies what triggered the incident
 */
export const SourcePrimarySchema = z.object({
  kind: z.enum(['deploy_status', 'verification', 'ecs_event', 'runner']),
  ref: z.record(z.string(), z.any()),
});

export type SourcePrimary = z.infer<typeof SourcePrimarySchema>;

// ========================================
// Incident Schemas
// ========================================

/**
 * Incident Input Schema
 * For creating/upserting incidents
 */
export const IncidentInputSchema = z.object({
  incident_key: z.string().min(1),
  severity: z.enum(INCIDENT_SEVERITIES),
  status: z.enum(INCIDENT_STATUSES).default('OPEN'),
  title: z.string().min(1),
  summary: z.string().optional().nullable(),
  classification: z.record(z.string(), z.any()).optional().nullable(),
  lawbook_version: z.string().optional().nullable(),
  source_primary: SourcePrimarySchema,
  tags: z.array(z.string()).default([]),
  first_seen_at: z.string().datetime().optional(),
  last_seen_at: z.string().datetime().optional(),
});

/**
 * Incident Schema (DB row)
 */
export const IncidentSchema = z.object({
  id: z.string().uuid(),
  incident_key: z.string(),
  severity: z.enum(INCIDENT_SEVERITIES),
  status: z.enum(INCIDENT_STATUSES),
  title: z.string(),
  summary: z.string().nullable(),
  classification: z.record(z.string(), z.any()).nullable(),
  lawbook_version: z.string().nullable(),
  source_primary: SourcePrimarySchema,
  tags: z.array(z.string()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  first_seen_at: z.string().datetime(),
  last_seen_at: z.string().datetime(),
});

export type IncidentInput = z.infer<typeof IncidentInputSchema>;
export type Incident = z.infer<typeof IncidentSchema>;

// ========================================
// Evidence Schemas
// ========================================

/**
 * Evidence Input Schema
 * For adding evidence to incidents
 */
export const EvidenceInputSchema = z.object({
  incident_id: z.string().uuid(),
  kind: z.enum(EVIDENCE_KINDS),
  ref: z.record(z.string(), z.any()),
  sha256: z.string().optional().nullable(),
});

/**
 * Evidence Schema (DB row)
 */
export const EvidenceSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  kind: z.enum(EVIDENCE_KINDS),
  ref: z.record(z.string(), z.any()),
  sha256: z.string().nullable(),
  created_at: z.string().datetime(),
});

export type EvidenceInput = z.infer<typeof EvidenceInputSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;

// ========================================
// Link Schemas
// ========================================

/**
 * Link Input Schema
 * For linking incidents to timeline nodes
 */
export const LinkInputSchema = z.object({
  incident_id: z.string().uuid(),
  timeline_node_id: z.string().uuid(),
  link_type: z.enum(LINK_TYPES),
});

/**
 * Link Schema (DB row)
 */
export const LinkSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  timeline_node_id: z.string().uuid(),
  link_type: z.enum(LINK_TYPES),
  created_at: z.string().datetime(),
});

export type LinkInput = z.infer<typeof LinkInputSchema>;
export type Link = z.infer<typeof LinkSchema>;

// ========================================
// Event Schemas
// ========================================

/**
 * Event Input Schema
 * For creating incident events
 */
export const EventInputSchema = z.object({
  incident_id: z.string().uuid(),
  event_type: z.enum(EVENT_TYPES),
  payload: z.record(z.string(), z.any()).default({}),
});

/**
 * Event Schema (DB row)
 */
export const EventSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  event_type: z.enum(EVENT_TYPES),
  payload: z.record(z.string(), z.any()),
  created_at: z.string().datetime(),
});

export type EventInput = z.infer<typeof EventInputSchema>;
export type Event = z.infer<typeof EventSchema>;

// ========================================
// Query Filters
// ========================================

/**
 * Filter for listing incidents
 */
export const IncidentFilterSchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  limit: z.number().int().positive().max(1000).default(100),
  offset: z.number().int().nonnegative().default(0),
});

export type IncidentFilter = z.infer<typeof IncidentFilterSchema>;

// ========================================
// Helper Functions
// ========================================

/**
 * Generate incident_key for deploy_status signal
 * Format: deploy_status:<env>:<deployId>:<statusAt>
 */
export function generateDeployStatusIncidentKey(
  env: string,
  deployId: string,
  statusAt: string
): string {
  return `deploy_status:${env}:${deployId}:${statusAt}`;
}

/**
 * Generate incident_key for verification signal
 * Format: verification:<deployId>:<reportHash>
 */
export function generateVerificationIncidentKey(
  deployId: string,
  reportHash: string
): string {
  return `verification:${deployId}:${reportHash}`;
}

/**
 * Generate incident_key for ECS stopped task
 * Format: ecs_stopped:<cluster>:<taskArn>:<stoppedAt>
 */
export function generateEcsStoppedIncidentKey(
  cluster: string,
  taskArn: string,
  stoppedAt: string
): string {
  return `ecs_stopped:${cluster}:${taskArn}:${stoppedAt}`;
}

/**
 * Generate incident_key for runner failure
 * Format: runner:<runId>:<stepName>:<conclusion>
 */
export function generateRunnerIncidentKey(
  runId: string,
  stepName: string,
  conclusion: string
): string {
  return `runner:${runId}:${stepName}:${conclusion}`;
}

/**
 * Validate incident input
 */
export function validateIncidentInput(input: unknown): {
  success: boolean;
  data?: IncidentInput;
  error?: string;
} {
  try {
    const data = IncidentInputSchema.parse(input);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}

/**
 * Validate evidence input
 */
export function validateEvidenceInput(input: unknown): {
  success: boolean;
  data?: EvidenceInput;
  error?: string;
} {
  try {
    const data = EvidenceInputSchema.parse(input);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}

/**
 * Check if severity is valid
 */
export function isValidSeverity(severity: unknown): severity is IncidentSeverity {
  return INCIDENT_SEVERITIES.includes(severity as IncidentSeverity);
}

/**
 * Check if status is valid
 */
export function isValidStatus(status: unknown): status is IncidentStatus {
  return INCIDENT_STATUSES.includes(status as IncidentStatus);
}

/**
 * Map deploy status to incident severity
 * GREEN → no incident
 * YELLOW → YELLOW incident
 * RED → RED incident
 */
export function mapDeployStatusToSeverity(deployStatus: 'GREEN' | 'YELLOW' | 'RED'): IncidentSeverity | null {
  if (deployStatus === 'GREEN') return null;
  return deployStatus; // YELLOW or RED
}
