/**
 * Issue Timeline Contract Schema
 * 
 * Defines contracts for issue_timeline table operations.
 * Tracks lifecycle events for AFU-9 Issues.
 * 
 * AFU-9 Issue Lifecycle: Issue → CR → Publish → GH Mirror → CP Assign → Timeline/Evidence
 */

/**
 * Issue Timeline Event Type enum
 */
export enum IssueTimelineEventType {
  ISSUE_CREATED = 'ISSUE_CREATED',
  DRAFT_COMMITTED = 'DRAFT_COMMITTED',
  CR_BOUND = 'CR_BOUND',
  CR_UNBOUND = 'CR_UNBOUND',
  PUBLISHING_STARTED = 'PUBLISHING_STARTED',
  PUBLISHED = 'PUBLISHED',
  PUBLISH_FAILED = 'PUBLISH_FAILED',
  GITHUB_MIRRORED = 'GITHUB_MIRRORED',
  CP_ASSIGNED = 'CP_ASSIGNED',
  CP_UNASSIGNED = 'CP_UNASSIGNED',
  STATE_TRANSITION = 'STATE_TRANSITION',
  STATE_CHANGED = 'STATE_CHANGED', // I201.3: Minimal event contract
  FIELD_UPDATED = 'FIELD_UPDATED',
  ERROR_OCCURRED = 'ERROR_OCCURRED',
  RUN_STARTED = 'RUN_STARTED', // I201.3: Minimal event contract
  VERDICT_SET = 'VERDICT_SET', // I201.3: Minimal event contract
  EVIDENCE_LINKED = 'EVIDENCE_LINKED', // I201.3: Minimal event contract (optional)
}

/**
 * Actor Type enum
 */
export enum ActorType {
  SYSTEM = 'system',
  USER = 'user',
  AGENT = 'agent',
}

/**
 * Issue Timeline Event Row
 * Represents a row from the issue_timeline table
 */
export interface IssueTimelineEventRow {
  id: string;
  issue_id: string;
  event_type: IssueTimelineEventType;
  event_data: Record<string, unknown>;
  actor: string | null;
  actor_type: ActorType | null;
  created_at: string;
}

/**
 * Issue Timeline Event Input
 * For creating new timeline events
 */
export interface IssueTimelineEventInput {
  issue_id: string;
  event_type: IssueTimelineEventType;
  event_data?: Record<string, unknown>;
  actor?: string;
  actor_type?: ActorType;
}

/**
 * Type guard for IssueTimelineEventType
 */
export function isValidTimelineEventType(type: string): type is IssueTimelineEventType {
  return Object.values(IssueTimelineEventType).includes(type as IssueTimelineEventType);
}

/**
 * Type guard for ActorType
 */
export function isValidActorType(type: string): type is ActorType {
  return Object.values(ActorType).includes(type as ActorType);
}

/**
 * Validate timeline event input
 */
export function validateTimelineEventInput(input: unknown): { valid: boolean; error?: string } {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Input must be an object' };
  }

  const data = input as Record<string, unknown>;

  if (!data.issue_id || typeof data.issue_id !== 'string') {
    return { valid: false, error: 'issue_id is required and must be a string (UUID)' };
  }

  if (!data.event_type || typeof data.event_type !== 'string' || !isValidTimelineEventType(data.event_type)) {
    return { valid: false, error: `event_type must be one of: ${Object.values(IssueTimelineEventType).join(', ')}` };
  }

  if (data.event_data !== undefined && (typeof data.event_data !== 'object' || Array.isArray(data.event_data))) {
    return { valid: false, error: 'event_data must be an object if provided' };
  }

  if (data.actor !== undefined && data.actor !== null && typeof data.actor !== 'string') {
    return { valid: false, error: 'actor must be a string if provided' };
  }

  if (data.actor_type !== undefined && data.actor_type !== null) {
    if (typeof data.actor_type !== 'string' || !isValidActorType(data.actor_type)) {
      return { valid: false, error: `actor_type must be one of: ${Object.values(ActorType).join(', ')}` };
    }
  }

  return { valid: true };
}
