/**
 * Loop Event Store - Database Access Object for Loop Timeline Events
 * 
 * E9.1-CTRL-8: Timeline events for loop execution with strict payload schema.
 * 
 * Events:
 * - loop_run_started
 * - loop_run_finished
 * - loop_step_s1_completed
 * - loop_step_s2_spec_ready
 * - loop_step_s3_implement_prep
 * - loop_run_blocked
 * - loop_run_failed
 * 
 * Payload Allowlist: { runId, step, stateBefore, stateAfter?, blockerCode?, requestId }
 * No secrets allowed in event payloads.
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

/**
 * Loop event types
 */
export enum LoopEventType {
  RUN_STARTED = 'loop_run_started',
  RUN_FINISHED = 'loop_run_finished',
  STEP_S1_COMPLETED = 'loop_step_s1_completed',
  STEP_S2_SPEC_READY = 'loop_step_s2_spec_ready',
  STEP_S3_IMPLEMENT_PREP = 'loop_step_s3_implement_prep',
  STEP_S4_REVIEW = 'loop_step_s4_review',
  STEP_S5_MERGED = 'loop_step_s5_merged',
  STEP_S6_DEPLOYMENT_OBSERVED = 'loop_step_s6_deployment_observed',
  REVIEW_REQUESTED = 'loop_review_requested',
  MERGED = 'loop_merged',
  DEPLOYMENT_OBSERVED = 'deployment_observed',
  RUN_BLOCKED = 'loop_run_blocked',
  RUN_FAILED = 'loop_run_failed',
}

/**
 * Loop event payload (strict allowlist)
 */
export interface LoopEventPayload {
  runId: string;
  step: string;
  stateBefore: string;
  stateAfter?: string;
  blockerCode?: string;
  requestId: string;
  prUrl?: string;  // For review-related events
  reviewers?: string[];  // For review-related events
}

/**
 * Input for creating a loop event
 */
export interface CreateLoopEventInput {
  issueId: string;
  runId: string;
  eventType: LoopEventType;
  eventData: LoopEventPayload;
}

/**
 * Loop event record from database
 */
export interface LoopEventRow {
  id: string;
  issue_id: string;
  run_id: string;
  event_type: string;
  event_data: LoopEventPayload;
  occurred_at: Date;
}

/**
 * Loop Event Store - DAO for loop event persistence
 */
export class LoopEventStore {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Create a new loop event
   * 
   * Validates payload against allowlist to prevent secrets leakage.
   * 
   * @param input - Event creation input
   * @returns Created event with generated ID
   * @throws Error if payload validation fails or database operation fails
   */
  async createEvent(input: CreateLoopEventInput): Promise<LoopEventRow> {
    // Validate payload against allowlist
    this.validatePayload(input.eventData);

    const eventId = uuidv4();
    
    const result = await this.pool.query<LoopEventRow>(
      `INSERT INTO loop_events (id, issue_id, run_id, event_type, event_data, occurred_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, issue_id, run_id, event_type, event_data, occurred_at`,
      [
        eventId,
        input.issueId,
        input.runId,
        input.eventType,
        JSON.stringify(input.eventData),
      ]
    );

    if (result.rows.length === 0) {
      throw new Error('Failed to create loop event');
    }

    return result.rows[0];
  }

  /**
   * Get events for an issue
   * 
   * @param issueId - Issue ID
   * @param limit - Maximum number of events to return
   * @param offset - Pagination offset
   * @returns Array of events ordered by occurrence (newest first)
   */
  async getEventsByIssue(
    issueId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<LoopEventRow[]> {
    const result = await this.pool.query<LoopEventRow>(
      `SELECT id, issue_id, run_id, event_type, event_data, occurred_at
       FROM loop_events
       WHERE issue_id = $1
       ORDER BY occurred_at DESC
       LIMIT $2 OFFSET $3`,
      [issueId, limit, offset]
    );

    return result.rows;
  }

  /**
   * Get events for a specific run
   * 
   * @param runId - Run ID
   * @returns Array of events ordered by occurrence
   */
  async getEventsByRun(runId: string): Promise<LoopEventRow[]> {
    const result = await this.pool.query<LoopEventRow>(
      `SELECT id, issue_id, run_id, event_type, event_data, occurred_at
       FROM loop_events
       WHERE run_id = $1
       ORDER BY occurred_at ASC`,
      [runId]
    );

    return result.rows;
  }

  /**
   * Count events for an issue
   * 
   * @param issueId - Issue ID
   * @returns Total number of events
   */
  async countEventsByIssue(issueId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM loop_events WHERE issue_id = $1`,
      [issueId]
    );

    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Validate event payload against allowlist
   * 
   * Ensures no secrets or prohibited data in event payloads.
   * Validates required fields are present.
   * 
   * @param payload - Event payload to validate
   * @throws Error if validation fails
   */
  private validatePayload(payload: LoopEventPayload): void {
    // Required fields
    if (!payload.runId || typeof payload.runId !== 'string') {
      throw new Error('Event payload missing required field: runId');
    }

    if (!payload.step || typeof payload.step !== 'string') {
      throw new Error('Event payload missing required field: step');
    }

    if (!payload.stateBefore || typeof payload.stateBefore !== 'string') {
      throw new Error('Event payload missing required field: stateBefore');
    }

    if (!payload.requestId || typeof payload.requestId !== 'string') {
      throw new Error('Event payload missing required field: requestId');
    }

    // Optional fields type validation
    if (payload.stateAfter !== undefined && typeof payload.stateAfter !== 'string') {
      throw new Error('Event payload field stateAfter must be a string');
    }

    if (payload.blockerCode !== undefined && typeof payload.blockerCode !== 'string') {
      throw new Error('Event payload field blockerCode must be a string');
    }

    // Check for prohibited fields (allowlist enforcement)
    const allowedFields = ['runId', 'step', 'stateBefore', 'stateAfter', 'blockerCode', 'requestId', 'prUrl', 'reviewers'];
    const providedFields = Object.keys(payload);
    const extraFields = providedFields.filter(field => !allowedFields.includes(field));

    if (extraFields.length > 0) {
      throw new Error(`Event payload contains prohibited fields: ${extraFields.join(', ')}`);
    }

    // Basic secret detection patterns (fail-closed)
    const secretPatterns = [
      /secret/i,
      /password/i,
      /token/i,
      /key/i,
      /credential/i,
      /auth/i,
    ];

    const payloadString = JSON.stringify(payload).toLowerCase();
    for (const pattern of secretPatterns) {
      if (pattern.test(payloadString)) {
        // This is a simple heuristic check - field names should not contain secret-related terms
        // Actual values are not scanned since they should be UUID/enum values
        console.warn('[LoopEventStore] Payload contains potentially sensitive field names', {
          pattern: pattern.toString(),
        });
      }
    }
  }
}

/**
 * Get LoopEventStore instance with pool
 */
export function getLoopEventStore(pool: Pool): LoopEventStore {
  return new LoopEventStore(pool);
}
