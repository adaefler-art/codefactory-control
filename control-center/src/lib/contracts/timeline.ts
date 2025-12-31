/**
 * Timeline/Linkage Model Contract Schema
 * 
 * Defines contracts for timeline_nodes, timeline_edges, timeline_events, and timeline_sources.
 * Ensures schema ↔ DAO ↔ API synchronization for the Timeline/Linkage Model (I721/E72.1).
 * 
 * MUST be kept in sync with database/migrations/029_timeline_linkage_model.sql
 */

import { z } from 'zod';

// ========================================
// Enums and Constants
// ========================================

export const SOURCE_SYSTEMS = ['github', 'afu9'] as const;
export const NODE_TYPES = ['ISSUE', 'PR', 'RUN', 'DEPLOY', 'VERDICT', 'ARTIFACT', 'COMMENT'] as const;
export const EDGE_TYPES = [
  'ISSUE_HAS_PR',
  'PR_HAS_RUN',
  'RUN_HAS_DEPLOY',
  'DEPLOY_HAS_VERDICT',
  'ISSUE_HAS_ARTIFACT',
  'PR_HAS_ARTIFACT',
  'RUN_HAS_ARTIFACT',
  'ISSUE_HAS_COMMENT',
  'PR_HAS_COMMENT',
] as const;
export const SOURCE_KINDS = ['github_api', 'github_web', 'afu9_db', 'artifact'] as const;

export type SourceSystem = typeof SOURCE_SYSTEMS[number];
export type NodeType = typeof NODE_TYPES[number];
export type EdgeType = typeof EDGE_TYPES[number];
export type SourceKind = typeof SOURCE_KINDS[number];

// ========================================
// Zod Schemas
// ========================================

/**
 * Timeline Node Input Schema
 * For creating/upserting nodes
 */
export const TimelineNodeInputSchema = z.object({
  source_system: z.enum(SOURCE_SYSTEMS),
  source_type: z.string().min(1),
  source_id: z.string().min(1),
  node_type: z.enum(NODE_TYPES),
  title: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
  payload_json: z.record(z.any()).optional(),
  lawbook_version: z.string().optional().nullable(),
});

/**
 * Timeline Node Schema (DB row)
 */
export const TimelineNodeSchema = z.object({
  id: z.string().uuid(),
  source_system: z.enum(SOURCE_SYSTEMS),
  source_type: z.string(),
  source_id: z.string(),
  node_type: z.enum(NODE_TYPES),
  title: z.string().nullable(),
  url: z.string().nullable(),
  payload_json: z.record(z.any()),
  lawbook_version: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

/**
 * Timeline Edge Input Schema
 * For creating edges
 */
export const TimelineEdgeInputSchema = z.object({
  from_node_id: z.string().uuid(),
  to_node_id: z.string().uuid(),
  edge_type: z.enum(EDGE_TYPES),
  payload_json: z.record(z.any()).optional(),
});

/**
 * Timeline Edge Schema (DB row)
 */
export const TimelineEdgeSchema = z.object({
  id: z.string().uuid(),
  from_node_id: z.string().uuid(),
  to_node_id: z.string().uuid(),
  edge_type: z.enum(EDGE_TYPES),
  payload_json: z.record(z.any()),
  created_at: z.string().datetime(),
});

/**
 * Timeline Event Input Schema
 * For creating events
 */
export const TimelineEventInputSchema = z.object({
  node_id: z.string().uuid(),
  event_type: z.string().min(1),
  occurred_at: z.string().datetime().or(z.date()),
  payload_json: z.record(z.any()).optional(),
  source_ref: z.string().optional().nullable(),
});

/**
 * Timeline Event Schema (DB row)
 */
export const TimelineEventSchema = z.object({
  id: z.string().uuid(),
  node_id: z.string().uuid(),
  event_type: z.string(),
  occurred_at: z.string().datetime(),
  payload_json: z.record(z.any()),
  source_ref: z.string().nullable(),
  created_at: z.string().datetime(),
});

/**
 * Timeline Source Input Schema
 * For creating source references
 */
export const TimelineSourceInputSchema = z.object({
  node_id: z.string().uuid(),
  source_kind: z.enum(SOURCE_KINDS),
  ref_json: z.record(z.any()),
  sha256: z.string().optional().nullable(),
  content_hash: z.string().optional().nullable(),
});

/**
 * Timeline Source Schema (DB row)
 */
export const TimelineSourceSchema = z.object({
  id: z.string().uuid(),
  node_id: z.string().uuid(),
  source_kind: z.enum(SOURCE_KINDS),
  ref_json: z.record(z.any()),
  sha256: z.string().nullable(),
  content_hash: z.string().nullable(),
  created_at: z.string().datetime(),
});

// ========================================
// TypeScript Types
// ========================================

export type TimelineNodeInput = z.infer<typeof TimelineNodeInputSchema>;
export type TimelineNode = z.infer<typeof TimelineNodeSchema>;
export type TimelineEdgeInput = z.infer<typeof TimelineEdgeInputSchema>;
export type TimelineEdge = z.infer<typeof TimelineEdgeSchema>;
export type TimelineEventInput = z.infer<typeof TimelineEventInputSchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type TimelineSourceInput = z.infer<typeof TimelineSourceInputSchema>;
export type TimelineSource = z.infer<typeof TimelineSourceSchema>;

// ========================================
// Helper Functions
// ========================================

/**
 * Generate natural key for a node
 * Format: ${source_system}:${source_type}:${source_id}
 */
export function generateNaturalKey(
  source_system: SourceSystem,
  source_type: string,
  source_id: string
): string {
  return `${source_system}:${source_type}:${source_id}`;
}

/**
 * Parse natural key into components
 */
export function parseNaturalKey(naturalKey: string): {
  source_system: string;
  source_type: string;
  source_id: string;
} | null {
  const parts = naturalKey.split(':');
  if (parts.length !== 3) {
    return null;
  }
  return {
    source_system: parts[0],
    source_type: parts[1],
    source_id: parts[2],
  };
}

/**
 * Validate timeline node input
 */
export function validateTimelineNodeInput(input: unknown): {
  success: boolean;
  data?: TimelineNodeInput;
  error?: string;
} {
  try {
    const data = TimelineNodeInputSchema.parse(input);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}

/**
 * Validate timeline edge input
 */
export function validateTimelineEdgeInput(input: unknown): {
  success: boolean;
  data?: TimelineEdgeInput;
  error?: string;
} {
  try {
    const data = TimelineEdgeInputSchema.parse(input);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}

/**
 * Validate timeline event input
 */
export function validateTimelineEventInput(input: unknown): {
  success: boolean;
  data?: TimelineEventInput;
  error?: string;
} {
  try {
    const data = TimelineEventInputSchema.parse(input);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}
