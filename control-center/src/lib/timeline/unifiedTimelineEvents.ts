/**
 * Unified Timeline Events Contract Schema (E87.3)
 * 
 * Defines contracts for unified_timeline_events table that consolidates all audit-worthy actions.
 * Ensures schema ↔ DAO ↔ API synchronization for the Unified Audit Trail.
 * 
 * MUST be kept in sync with database/migrations/069_unified_timeline_events.sql
 */

import { z } from 'zod';

// ========================================
// Enums and Constants
// ========================================

export const UNIFIED_EVENT_TYPES = [
  'approval_submitted',
  'approval_approved',
  'approval_denied',
  'approval_cancelled',
  'automation_policy_allowed',
  'automation_policy_denied',
  'pr_opened',
  'pr_merged',
  'pr_closed',
  'checks_rerun',
  'workflow_dispatched',
  'issue_published',
  'issue_updated',
  'deploy_executed',
  'rollback_executed',
] as const;

export const SUBJECT_TYPES = [
  'afu9_issue',
  'gh_issue',
  'pr',
  'workflow_run',
  'deployment',
] as const;

export type UnifiedEventType = typeof UNIFIED_EVENT_TYPES[number];
export type SubjectType = typeof SUBJECT_TYPES[number];

// ========================================
// Zod Schemas
// ========================================

/**
 * Unified Timeline Event Input Schema
 * For creating events (bounded sizes enforced)
 */
export const UnifiedTimelineEventInputSchema = z.object({
  event_type: z.enum(UNIFIED_EVENT_TYPES),
  timestamp: z.string().datetime().or(z.date()),
  actor: z.string().min(1).max(255),
  
  // Subject references (for filtering)
  session_id: z.string().max(255).optional().nullable(),
  canonical_id: z.string().max(255).optional().nullable(),
  gh_issue_number: z.number().int().positive().optional().nullable(),
  pr_number: z.number().int().positive().optional().nullable(),
  workflow_run_id: z.number().int().positive().optional().nullable(),
  
  // Target resource
  subject_type: z.enum(SUBJECT_TYPES),
  subject_identifier: z.string().min(1),
  
  // Request tracking
  request_id: z.string().min(1).max(255),
  
  // Evidence hashes
  lawbook_hash: z.string().length(64).optional().nullable(), // SHA-256 = 64 hex chars
  evidence_hash: z.string().length(64).optional().nullable(),
  context_pack_id: z.string().uuid().optional().nullable(),
  
  // Links (URLs, IDs)
  links: z.record(z.string(), z.string()).optional().default({}),
  
  // Summary (deterministic, bounded)
  summary: z.string().min(1).max(500), // Hard limit: 500 chars
  details: z.record(z.string(), z.any()).optional().default({}),
}).strict();

/**
 * Unified Timeline Event Schema (DB row)
 */
export const UnifiedTimelineEventSchema = z.object({
  id: z.string().uuid(),
  event_type: z.enum(UNIFIED_EVENT_TYPES),
  timestamp: z.string().datetime(),
  actor: z.string(),
  
  session_id: z.string().nullable(),
  canonical_id: z.string().nullable(),
  gh_issue_number: z.number().nullable(),
  pr_number: z.number().nullable(),
  workflow_run_id: z.number().nullable(),
  
  subject_type: z.enum(SUBJECT_TYPES),
  subject_identifier: z.string(),
  request_id: z.string(),
  
  lawbook_hash: z.string().nullable(),
  evidence_hash: z.string().nullable(),
  context_pack_id: z.string().nullable(),
  
  links: z.record(z.string(), z.string()),
  summary: z.string(),
  details: z.record(z.string(), z.any()),
  
  created_at: z.string().datetime(),
}).strict();

/**
 * Timeline Query Filter Schema
 */
export const TimelineQueryFilterSchema = z.object({
  session_id: z.string().optional(),
  canonical_id: z.string().optional(),
  gh_issue_number: z.number().int().positive().optional(),
  pr_number: z.number().int().positive().optional(),
  event_type: z.enum(UNIFIED_EVENT_TYPES).optional(),
  actor: z.string().optional(),
  subject_type: z.enum(SUBJECT_TYPES).optional(),
  
  // Pagination
  limit: z.number().int().min(1).max(1000).optional().default(100),
  offset: z.number().int().min(0).optional().default(0),
  
  // Time range
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
}).strict();

// ========================================
// TypeScript Types
// ========================================

export type UnifiedTimelineEventInput = z.infer<typeof UnifiedTimelineEventInputSchema>;
export type UnifiedTimelineEvent = z.infer<typeof UnifiedTimelineEventSchema>;
export type TimelineQueryFilter = z.infer<typeof TimelineQueryFilterSchema>;

// ========================================
// Helper Functions
// ========================================

/**
 * Generate deterministic summary for approval events
 */
export function formatApprovalSummary(
  decision: 'approved' | 'denied' | 'cancelled',
  actionType: string,
  targetIdentifier: string,
  actor: string
): string {
  const verb = decision === 'approved' ? 'approved' : decision === 'denied' ? 'denied' : 'cancelled';
  return `${actor} ${verb} ${actionType} for ${targetIdentifier}`;
}

/**
 * Generate deterministic summary for policy events
 */
export function formatPolicySummary(
  decision: 'allowed' | 'denied',
  actionType: string,
  targetIdentifier: string,
  reason: string
): string {
  const verb = decision === 'allowed' ? 'allowed' : 'denied';
  return `Policy ${verb} ${actionType} for ${targetIdentifier}: ${reason}`.substring(0, 500);
}

/**
 * Generate deterministic summary for PR events
 */
export function formatPRSummary(
  eventType: string,
  prIdentifier: string,
  actor: string
): string {
  const action = eventType.replace('pr_', '');
  return `${actor} ${action} ${prIdentifier}`;
}

/**
 * Generate deterministic summary for issue publish events
 */
export function formatIssuePublishSummary(
  action: 'create' | 'update',
  issueIdentifier: string,
  canonicalId: string
): string {
  const verb = action === 'create' ? 'published' : 'updated';
  return `${verb} issue ${issueIdentifier} for ${canonicalId}`;
}

/**
 * Sanitize details object (remove secrets, enforce size limit)
 */
export function sanitizeDetails(details: Record<string, any>): Record<string, any> {
  const SENSITIVE_PATTERNS = [
    'password',
    'token',
    'secret',
    'api_key',
    'apikey',
    'private_key',
    'privatekey',
    'credential',
    'auth',
  ];
  
  const sanitized: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(details)) {
    // Skip sensitive keys (case-insensitive partial match)
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_PATTERNS.some(pattern => lowerKey.includes(pattern))) {
      continue;
    }
    
    // Truncate long strings
    if (typeof value === 'string' && value.length > 1000) {
      sanitized[key] = value.substring(0, 997) + '...';
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Validate timeline event input
 */
export function validateTimelineEventInput(input: unknown): {
  success: boolean;
  data?: UnifiedTimelineEventInput;
  error?: string;
} {
  try {
    const data = UnifiedTimelineEventInputSchema.parse(input);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}

/**
 * Build backlinks for AFU-9 ↔ GitHub cross-references
 */
export function buildBacklinks(params: {
  sessionId?: string | null;
  canonicalId?: string | null;
  ghIssueNumber?: number | null;
  prNumber?: number | null;
  owner?: string;
  repo?: string;
}): Record<string, string> {
  const links: Record<string, string> = {};
  
  if (params.sessionId) {
    links.afu9SessionUrl = `/intent/${params.sessionId}`;
  }
  
  if (params.canonicalId) {
    links.afu9IssueUrl = `/issues/${params.canonicalId}`;
  }
  
  if (params.ghIssueNumber && params.owner && params.repo) {
    links.ghIssueUrl = `https://github.com/${params.owner}/${params.repo}/issues/${params.ghIssueNumber}`;
  }
  
  if (params.prNumber && params.owner && params.repo) {
    links.ghPrUrl = `https://github.com/${params.owner}/${params.repo}/pull/${params.prNumber}`;
  }
  
  return links;
}
