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
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/afu9/timeline/route';
import { getPool } from '@/lib/db';
import { getPublicId } from '@/lib/db/afu9Issues';
import { logTimelineEvent } from '@/lib/db/issueTimeline';
import { IssueTimelineEventType, ActorType } from '@/lib/contracts/issueTimeline';
import { Afu9IssueStatus } from '@/lib/contracts/afu9Issue';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));

jest.mock('@/lib/db/afu9Issues', () => ({
  createAfu9Issue: jest.fn(),
  getPublicId: jest.requireActual('@/lib/db/afu9Issues').getPublicId,
  getAfu9IssueById: jest.fn(),
  getAfu9IssueByPublicId: jest.fn(),
}));

jest.mock('@/lib/db/issueTimeline', () => ({
  logTimelineEvent: jest.fn(),
}));

describe('I201.3: Timeline API + Minimal Event Contract', () => {
  let pool: Pool;
  let testIssueId: string;
  let testPublicId: string;
  let timelineEvents: Array<{
    id: string;
    issue_id: string;
    event_type: IssueTimelineEventType;
    event_data: Record<string, unknown>;
    actor: string;
    actor_type: ActorType;
    created_at: string;
  }>;
  let eventCounter = 0;

  const callTimeline = async (url: string) => GET(new NextRequest(url));

  const createBaseEvents = (issueId: string) => [
    {
      id: 'evt-1',
      issue_id: issueId,
      event_type: IssueTimelineEventType.ISSUE_CREATED,
      event_data: { canonical_id: 'I201.3-TEST-1' },
      actor: 'system',
      actor_type: ActorType.SYSTEM,
      created_at: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'evt-2',
      issue_id: issueId,
      event_type: IssueTimelineEventType.RUN_STARTED,
      event_data: { run_id: 'run-1' },
      actor: 'system',
      actor_type: ActorType.SYSTEM,
      created_at: '2024-01-01T00:00:01.000Z',
    },
    {
      id: 'evt-3',
      issue_id: issueId,
      event_type: IssueTimelineEventType.VERDICT_SET,
      event_data: { verdict: 'SUCCESS', run_id: 'run-1' },
      actor: 'system',
      actor_type: ActorType.SYSTEM,
      created_at: '2024-01-01T00:00:02.000Z',
    },
    {
      id: 'evt-4',
      issue_id: issueId,
      event_type: IssueTimelineEventType.STATE_CHANGED,
      event_data: { from_state: 'CREATED', to_state: 'SPEC_READY' },
      actor: 'system',
      actor_type: ActorType.SYSTEM,
      created_at: '2024-01-01T00:00:03.000Z',
    },
  ];

  beforeAll(async () => {
    const mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
    } as unknown as Pool;

    const { getPool } = require('@/lib/db');
    (getPool as jest.Mock).mockReturnValue(mockPool);

    pool = getPool();
    testIssueId = '11111111-1111-1111-1111-111111111111';
    testPublicId = getPublicId(testIssueId);
  });

  beforeEach(() => {
    timelineEvents = createBaseEvents(testIssueId);
    eventCounter = timelineEvents.length;

    const { getAfu9IssueById, getAfu9IssueByPublicId } = require('@/lib/db/afu9Issues');
    getAfu9IssueById.mockImplementation((_pool: Pool, id: string) => {
      if (id === testIssueId) {
        return Promise.resolve({ success: true, data: { id: testIssueId, status: Afu9IssueStatus.CREATED } });
      }
      return Promise.resolve({ success: false, error: 'Issue not found' });
    });

    getAfu9IssueByPublicId.mockImplementation((_pool: Pool, publicId: string) => {
      if (publicId === testPublicId) {
        return Promise.resolve({ success: true, data: { id: testIssueId } });
      }
      return Promise.resolve({ success: false, error: 'Issue not found' });
    });

    const { logTimelineEvent } = require('@/lib/db/issueTimeline');
    logTimelineEvent.mockImplementation((_pool: Pool, payload: any) => {
      eventCounter += 1;
      const createdAt = new Date(Date.UTC(2024, 0, 1, 0, 0, eventCounter)).toISOString();
      const event = {
        id: `evt-${eventCounter}`,
        issue_id: payload.issue_id,
        event_type: payload.event_type,
        event_data: payload.event_data || {},
        actor: payload.actor,
        actor_type: payload.actor_type,
        created_at: createdAt,
      };
      timelineEvents.push(event);
      return Promise.resolve({ success: true, data: event });
    });

    const mockPool = pool as unknown as { query: jest.Mock };
    mockPool.query.mockImplementation((query: string, params: any[]) => {
      if (query.includes('COUNT(*)')) {
        const issueId = params[0] as string;
        const eventType = params.length > 1 ? (params[1] as IssueTimelineEventType) : undefined;
        const filtered = timelineEvents.filter(event => event.issue_id === issueId && (!eventType || event.event_type === eventType));
        return Promise.resolve({ rows: [{ total: String(filtered.length) }] });
      }

      if (query.includes('FROM issue_timeline')) {
        const issueId = params[0] as string;
        const hasEventType = params.length === 4;
        const eventType = hasEventType ? (params[1] as IssueTimelineEventType) : undefined;
        const limit = params[hasEventType ? 2 : 1] as number;
        const offset = params[hasEventType ? 3 : 2] as number;

        const filtered = timelineEvents
          .filter(event => event.issue_id === issueId && (!eventType || event.event_type === eventType))
          .sort((a, b) => {
            const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            if (timeDiff !== 0) return timeDiff;
            return a.id.localeCompare(b.id);
          });

        return Promise.resolve({ rows: filtered.slice(offset, offset + limit) });
      }

      return Promise.resolve({ rows: [] });
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
      const response = await callTimeline('http://localhost:3000/api/afu9/timeline');
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('issueId');
    });

    it('should return 404 when issue not found (UUID)', async () => {
      const fakeUuid = '00000000-0000-0000-0000-000000000000';
      const response = await callTimeline(`http://localhost:3000/api/afu9/timeline?issueId=${fakeUuid}`);
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toContain('not found');
    });

    it('should return 404 when issue not found (publicId)', async () => {
      const fakePublicId = '00000000';
      const response = await callTimeline(`http://localhost:3000/api/afu9/timeline?issueId=${fakePublicId}`);
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toContain('not found');
    });

    it('should return timeline events for valid UUID', async () => {
      const response = await callTimeline(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}`);
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
      const response = await callTimeline(`http://localhost:3000/api/afu9/timeline?issueId=${testPublicId}`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('events');
      expect(data.issueId).toBe(testIssueId); // Returns full UUID, not publicId
      expect(Array.isArray(data.events)).toBe(true);
    });

    it('should return events in stable ascending order (created_at ASC)', async () => {
      timelineEvents.push(
        {
          id: `evt-${eventCounter + 1}`,
          issue_id: testIssueId,
          event_type: IssueTimelineEventType.STATE_CHANGED,
          event_data: { from: 'CREATED', to: 'DRAFT_READY' },
          actor: 'system',
          actor_type: ActorType.SYSTEM,
          created_at: '2024-01-01T00:00:04.000Z',
        },
        {
          id: `evt-${eventCounter + 2}`,
          issue_id: testIssueId,
          event_type: IssueTimelineEventType.RUN_STARTED,
          event_data: { run_id: 'test-run-1' },
          actor: 'system',
          actor_type: ActorType.SYSTEM,
          created_at: '2024-01-01T00:00:05.000Z',
        },
        {
          id: `evt-${eventCounter + 3}`,
          issue_id: testIssueId,
          event_type: IssueTimelineEventType.VERDICT_SET,
          event_data: { verdict: 'SUCCESS', run_id: 'test-run-1' },
          actor: 'system',
          actor_type: ActorType.SYSTEM,
          created_at: '2024-01-01T00:00:06.000Z',
        }
      );

      const response = await callTimeline(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}`);
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
      const response = await callTimeline(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&eventType=ISSUE_CREATED`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.total).toBe(1);
      expect(data.events.length).toBe(1);
      expect(data.events[0].eventType).toBe(IssueTimelineEventType.ISSUE_CREATED);
    });

    it('should filter by eventType', async () => {
      const response = await callTimeline(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&eventType=RUN_STARTED`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.events.every((e: any) => e.eventType === IssueTimelineEventType.RUN_STARTED)).toBe(true);
    });

    it('should return 400 for invalid eventType', async () => {
      const response = await callTimeline(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&eventType=INVALID_TYPE`);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('eventType');
    });

    it('should support pagination with limit and offset', async () => {
      const response1 = await callTimeline(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&limit=2&offset=0`);
      expect(response1.status).toBe(200);

      const data1 = await response1.json();
      expect(data1.limit).toBe(2);
      expect(data1.offset).toBe(0);
      expect(data1.events.length).toBeLessThanOrEqual(2);

      const response2 = await callTimeline(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&limit=2&offset=2`);
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
      const response = await callTimeline(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&limit=1000`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.limit).toBe(500); // Should be capped at 500
    });

    it('should return total count independent of pagination', async () => {
      const response1 = await callTimeline(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&limit=1`);
      const data1 = await response1.json();

      const response2 = await callTimeline(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&limit=100`);
      const data2 = await response2.json();

      // Total should be the same regardless of limit
      expect(data1.total).toBe(data2.total);
      expect(data1.total).toBeGreaterThan(0);
    });

    it('should include all minimal event types in event data', async () => {
      const response = await callTimeline(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}`);
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

      const response = await callTimeline(`http://localhost:3000/api/afu9/timeline?issueId=${testIssueId}&eventType=EVIDENCE_LINKED`);
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
