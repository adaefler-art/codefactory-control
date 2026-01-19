/**
 * Tests for I201.3: Timeline API + Minimal Event Contract
 * 
 * Validates:
 * - Timeline read API with stable sort order (created_at ASC)
 * - ISSUE_CREATED event existence after I201.2
 * - Event type filtering
 * - Pagination
 * - UUID and publicId issue lookup
 */

import { Pool } from 'pg';
import { getPool } from '@/lib/db';
import { createAfu9Issue, getPublicId } from '@/lib/db/afu9Issues';
import { logTimelineEvent } from '@/lib/db/issueTimeline';
import { IssueTimelineEventType, ActorType } from '@/lib/contracts/issueTimeline';
import { Afu9IssueStatus } from '@/lib/contracts/afu9Issue';

describe('I201.3: Timeline API + Minimal Event Contract', () => {
  let pool: Pool;
  let testIssueId: string;
  let testPublicId: string;

  beforeAll(async () => {
    pool = getPool();

    // Create a test issue
    const issueResult = await createAfu9Issue(pool, {
      title: 'Test Issue for Timeline API',
      body: 'Test body',
      status: Afu9IssueStatus.CREATED,
      labels: ['test'],
      priority: 'P2',
      source: 'afu9',
      canonical_id: 'I201.3-TEST-' + Date.now(),
    });

    if (!issueResult.success || !issueResult.data) {
      throw new Error('Failed to create test issue');
    }

    testIssueId = issueResult.data.id;
    testPublicId = getPublicId(testIssueId);

    // Log ISSUE_CREATED event manually (in real code, this is done by ensureIssueForCommittedDraft)
    await logTimelineEvent(pool, {
      issue_id: testIssueId,
      event_type: IssueTimelineEventType.ISSUE_CREATED,
      event_data: { canonical_id: issueResult.data.canonical_id },
      actor: 'system',
      actor_type: ActorType.SYSTEM,
    });
  });

  afterAll(async () => {
    // Clean up test data
    if (testIssueId) {
      await pool.query('DELETE FROM issue_timeline WHERE issue_id = $1', [testIssueId]);
      await pool.query('DELETE FROM afu9_issues WHERE id = $1', [testIssueId]);
    }
  });

  describe('GET /api/afu9/timeline', () => {
    it('should return 400 when issueId is missing', async () => {
      const response = await fetch('http://localhost:3000/api/afu9/timeline');
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('issueId');
    });

    it('should return 404 when issue not found (UUID)', async () => {
      const fakeUuid = '00000000-0000-0000-0000-000000000000';
      const response = await fetch(`http://localhost:3000/api/afu9/timeline?issueId=${fakeUuid}`);
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toContain('not found');
    });

    it('should return 404 when issue not found (publicId)', async () => {
      const fakePublicId = '00000000';
      const response = await fetch(`http://localhost:3000/api/afu9/timeline?issueId=${fakePublicId}`);
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toContain('not found');
    });

    it('should return timeline events for valid UUID', async () => {
      const response = await fetch(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('events');
      expect(data).toHaveProperty('total');
      expect(data).toHaveProperty('limit');
      expect(data).toHaveProperty('offset');
      expect(data).toHaveProperty('issueId', testIssueId);
      expect(Array.isArray(data.events)).toBe(true);
    });

    it('should return timeline events for valid publicId', async () => {
      const response = await fetch(`http://localhost:3000/api/afu9/timeline?issueId=${testPublicId}`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('events');
      expect(data.issueId).toBe(testIssueId); // Returns full UUID, not publicId
      expect(Array.isArray(data.events)).toBe(true);
    });

    it('should return events in stable ascending order (created_at ASC)', async () => {
      // Add multiple events with explicit ordering using PostgreSQL's clock_timestamp()
      // to ensure different timestamps even if called in quick succession
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        // Insert events with explicit timing
        await client.query(
          `INSERT INTO issue_timeline (issue_id, event_type, event_data, actor, actor_type, created_at)
           VALUES ($1, $2, $3, $4, $5, clock_timestamp())`,
          [
            testIssueId,
            IssueTimelineEventType.STATE_CHANGED,
            JSON.stringify({ from: 'CREATED', to: 'DRAFT_READY' }),
            'system',
            ActorType.SYSTEM,
          ]
        );
        
        await client.query(
          `INSERT INTO issue_timeline (issue_id, event_type, event_data, actor, actor_type, created_at)
           VALUES ($1, $2, $3, $4, $5, clock_timestamp() + interval '1 millisecond')`,
          [
            testIssueId,
            IssueTimelineEventType.RUN_STARTED,
            JSON.stringify({ run_id: 'test-run-1' }),
            'system',
            ActorType.SYSTEM,
          ]
        );
        
        await client.query(
          `INSERT INTO issue_timeline (issue_id, event_type, event_data, actor, actor_type, created_at)
           VALUES ($1, $2, $3, $4, $5, clock_timestamp() + interval '2 milliseconds')`,
          [
            testIssueId,
            IssueTimelineEventType.VERDICT_SET,
            JSON.stringify({ verdict: 'SUCCESS', run_id: 'test-run-1' }),
            'system',
            ActorType.SYSTEM,
          ]
        );
        
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      const response = await fetch(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.events.length).toBeGreaterThanOrEqual(4);

      // Verify stable sort: created_at should be in ascending order
      for (let i = 1; i < data.events.length; i++) {
        const prevCreatedAt = new Date(data.events[i - 1].createdAt);
        const currCreatedAt = new Date(data.events[i].createdAt);
        expect(currCreatedAt.getTime()).toBeGreaterThanOrEqual(prevCreatedAt.getTime());
      }

      // Verify first event is ISSUE_CREATED
      expect(data.events[0].eventType).toBe(IssueTimelineEventType.ISSUE_CREATED);
    });

    it('should have exactly one ISSUE_CREATED event (I201.2 requirement)', async () => {
      const response = await fetch(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&eventType=ISSUE_CREATED`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.total).toBe(1);
      expect(data.events.length).toBe(1);
      expect(data.events[0].eventType).toBe(IssueTimelineEventType.ISSUE_CREATED);
    });

    it('should filter by eventType', async () => {
      const response = await fetch(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&eventType=RUN_STARTED`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.events.every((e: any) => e.eventType === IssueTimelineEventType.RUN_STARTED)).toBe(true);
    });

    it('should return 400 for invalid eventType', async () => {
      const response = await fetch(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&eventType=INVALID_TYPE`);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('eventType');
    });

    it('should support pagination with limit and offset', async () => {
      const response1 = await fetch(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&limit=2&offset=0`);
      expect(response1.status).toBe(200);

      const data1 = await response1.json();
      expect(data1.limit).toBe(2);
      expect(data1.offset).toBe(0);
      expect(data1.events.length).toBeLessThanOrEqual(2);

      const response2 = await fetch(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&limit=2&offset=2`);
      expect(response2.status).toBe(200);

      const data2 = await response2.json();
      expect(data2.limit).toBe(2);
      expect(data2.offset).toBe(2);

      // Ensure different pages return different events
      if (data1.events.length > 0 && data2.events.length > 0) {
        expect(data1.events[0].id).not.toBe(data2.events[0].id);
      }
    });

    it('should enforce max limit of 500', async () => {
      const response = await fetch(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&limit=1000`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.limit).toBe(500); // Should be capped at 500
    });

    it('should return total count independent of pagination', async () => {
      const response1 = await fetch(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&limit=1`);
      const data1 = await response1.json();

      const response2 = await fetch(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&limit=100`);
      const data2 = await response2.json();

      // Total should be the same regardless of limit
      expect(data1.total).toBe(data2.total);
      expect(data1.total).toBeGreaterThan(0);
    });

    it('should include all minimal event types in event data', async () => {
      const response = await fetch(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}`);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      // Verify that event objects have all required fields
      data.events.forEach((event: any) => {
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('issueId');
        expect(event).toHaveProperty('eventType');
        expect(event).toHaveProperty('eventData');
        expect(event).toHaveProperty('actor');
        expect(event).toHaveProperty('actorType');
        expect(event).toHaveProperty('createdAt');
      });
    });

    it('should support EVIDENCE_LINKED event type (optional)', async () => {
      await logTimelineEvent(pool, {
        issue_id: testIssueId,
        event_type: IssueTimelineEventType.EVIDENCE_LINKED,
        event_data: { evidence_id: 'test-evidence-1', evidence_type: 'PUBLISH_RECEIPT' },
        actor: 'system',
        actor_type: ActorType.SYSTEM,
      });

      const response = await fetch(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&eventType=EVIDENCE_LINKED`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.events.length).toBeGreaterThan(0);
      expect(data.events[0].eventType).toBe(IssueTimelineEventType.EVIDENCE_LINKED);
    });
  });

  describe('Timeline Event Logging', () => {
    it('should log RUN_STARTED event successfully', async () => {
      const result = await logTimelineEvent(pool, {
        issue_id: testIssueId,
        event_type: IssueTimelineEventType.RUN_STARTED,
        event_data: { run_id: 'test-run-2', playbook_id: 'test-playbook' },
        actor: 'runner-service',
        actor_type: ActorType.SYSTEM,
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('id');
      expect(result.data?.event_type).toBe(IssueTimelineEventType.RUN_STARTED);
    });

    it('should log VERDICT_SET event successfully', async () => {
      const result = await logTimelineEvent(pool, {
        issue_id: testIssueId,
        event_type: IssueTimelineEventType.VERDICT_SET,
        event_data: { verdict: 'FAILED', run_id: 'test-run-2', error: 'Test error' },
        actor: 'verdict-service',
        actor_type: ActorType.SYSTEM,
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('id');
      expect(result.data?.event_type).toBe(IssueTimelineEventType.VERDICT_SET);
    });

    it('should log STATE_CHANGED event successfully', async () => {
      const result = await logTimelineEvent(pool, {
        issue_id: testIssueId,
        event_type: IssueTimelineEventType.STATE_CHANGED,
        event_data: { from_state: 'CREATED', to_state: 'SPEC_READY', reason: 'Manual activation' },
        actor: 'test-user',
        actor_type: ActorType.USER,
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('id');
      expect(result.data?.event_type).toBe(IssueTimelineEventType.STATE_CHANGED);
    });
  });
});
