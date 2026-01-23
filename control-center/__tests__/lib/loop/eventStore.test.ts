/**
 * Tests for Loop Event Store
 * 
 * E9.1-CTRL-8: Verify timeline events for loop execution
 */

import {
  LoopEventStore,
  getLoopEventStore,
  LoopEventType,
  LoopEventPayload,
} from '@/lib/loop/eventStore';
import { Pool } from 'pg';

// Mock pg Pool
jest.mock('pg', () => {
  const mPool = {
    query: jest.fn(),
  };
  return {
    Pool: jest.fn(() => mPool),
  };
});

describe('LoopEventStore', () => {
  let pool: Pool;
  let store: LoopEventStore;

  beforeEach(() => {
    pool = new Pool();
    store = getLoopEventStore(pool);
    jest.clearAllMocks();
  });

  describe('createEvent', () => {
    it('should create a loop_run_started event', async () => {
      const mockRow = {
        id: 'event-123',
        issue_id: 'AFU9-456',
        run_id: 'run-789',
        event_type: 'loop_run_started',
        event_data: {
          runId: 'run-789',
          step: 'S1_PICK_ISSUE',
          stateBefore: 'CREATED',
          requestId: 'req-abc',
        },
        occurred_at: new Date(),
      };

      (pool.query as jest.Mock).mockResolvedValue({ rows: [mockRow] });

      const result = await store.createEvent({
        issueId: 'AFU9-456',
        runId: 'run-789',
        eventType: LoopEventType.RUN_STARTED,
        eventData: {
          runId: 'run-789',
          step: 'S1_PICK_ISSUE',
          stateBefore: 'CREATED',
          requestId: 'req-abc',
        },
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO loop_events'),
        expect.arrayContaining([
          expect.any(String), // event id
          'AFU9-456',
          'run-789',
          'loop_run_started',
          expect.any(String), // JSON stringified event_data
        ])
      );
      expect(result.id).toBeDefined();
      expect(result.event_type).toBe('loop_run_started');
    });

    it('should create a loop_run_blocked event with blockerCode', async () => {
      const mockRow = {
        id: 'event-123',
        issue_id: 'AFU9-456',
        run_id: 'run-789',
        event_type: 'loop_run_blocked',
        event_data: {
          runId: 'run-789',
          step: 'S2_SPEC_READY',
          stateBefore: 'CREATED',
          blockerCode: 'NO_DRAFT',
          requestId: 'req-abc',
        },
        occurred_at: new Date(),
      };

      (pool.query as jest.Mock).mockResolvedValue({ rows: [mockRow] });

      const result = await store.createEvent({
        issueId: 'AFU9-456',
        runId: 'run-789',
        eventType: LoopEventType.RUN_BLOCKED,
        eventData: {
          runId: 'run-789',
          step: 'S2_SPEC_READY',
          stateBefore: 'CREATED',
          blockerCode: 'NO_DRAFT',
          requestId: 'req-abc',
        },
      });

      expect(result.event_data.blockerCode).toBe('NO_DRAFT');
    });

    it('should create a step completion event with stateAfter', async () => {
      const mockRow = {
        id: 'event-123',
        issue_id: 'AFU9-456',
        run_id: 'run-789',
        event_type: 'loop_step_s1_completed',
        event_data: {
          runId: 'run-789',
          step: 'S1_PICK_ISSUE',
          stateBefore: 'CREATED',
          stateAfter: 'CREATED',
          requestId: 'req-abc',
        },
        occurred_at: new Date(),
      };

      (pool.query as jest.Mock).mockResolvedValue({ rows: [mockRow] });

      const result = await store.createEvent({
        issueId: 'AFU9-456',
        runId: 'run-789',
        eventType: LoopEventType.STEP_S1_COMPLETED,
        eventData: {
          runId: 'run-789',
          step: 'S1_PICK_ISSUE',
          stateBefore: 'CREATED',
          stateAfter: 'CREATED',
          requestId: 'req-abc',
        },
      });

      expect(result.event_data.stateAfter).toBe('CREATED');
    });

    it('should reject payload with missing required fields', async () => {
      const invalidPayload = {
        step: 'S1_PICK_ISSUE',
        stateBefore: 'CREATED',
        requestId: 'req-abc',
        // Missing runId
      } as LoopEventPayload;

      await expect(
        store.createEvent({
          issueId: 'AFU9-456',
          runId: 'run-789',
          eventType: LoopEventType.RUN_STARTED,
          eventData: invalidPayload,
        })
      ).rejects.toThrow('Event payload missing required field: runId');
    });

    it('should reject payload with extra fields (allowlist enforcement)', async () => {
      const invalidPayload = {
        runId: 'run-789',
        step: 'S1_PICK_ISSUE',
        stateBefore: 'CREATED',
        requestId: 'req-abc',
        secretToken: 'should-not-be-here', // Prohibited field
      } as any;

      await expect(
        store.createEvent({
          issueId: 'AFU9-456',
          runId: 'run-789',
          eventType: LoopEventType.RUN_STARTED,
          eventData: invalidPayload,
        })
      ).rejects.toThrow('Event payload contains prohibited fields: secretToken');
    });
  });

  describe('getEventsByIssue', () => {
    it('should get events for an issue with pagination', async () => {
      const mockRows = [
        {
          id: 'event-1',
          issue_id: 'AFU9-456',
          run_id: 'run-789',
          event_type: 'loop_run_finished',
          event_data: {
            runId: 'run-789',
            step: 'S1_PICK_ISSUE',
            stateBefore: 'CREATED',
            stateAfter: 'CREATED',
            requestId: 'req-abc',
          },
          occurred_at: new Date('2026-01-23T12:00:00Z'),
        },
        {
          id: 'event-2',
          issue_id: 'AFU9-456',
          run_id: 'run-789',
          event_type: 'loop_run_started',
          event_data: {
            runId: 'run-789',
            step: 'S1_PICK_ISSUE',
            stateBefore: 'CREATED',
            requestId: 'req-abc',
          },
          occurred_at: new Date('2026-01-23T11:59:00Z'),
        },
      ];

      (pool.query as jest.Mock).mockResolvedValue({ rows: mockRows });

      const results = await store.getEventsByIssue('AFU9-456', 10, 0);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['AFU9-456', 10, 0]
      );
      expect(results).toHaveLength(2);
      expect(results[0].event_type).toBe('loop_run_finished');
      expect(results[1].event_type).toBe('loop_run_started');
    });
  });

  describe('getEventsByRun', () => {
    it('should get events for a specific run', async () => {
      const mockRows = [
        {
          id: 'event-1',
          issue_id: 'AFU9-456',
          run_id: 'run-789',
          event_type: 'loop_run_started',
          event_data: {
            runId: 'run-789',
            step: 'S1_PICK_ISSUE',
            stateBefore: 'CREATED',
            requestId: 'req-abc',
          },
          occurred_at: new Date('2026-01-23T11:59:00Z'),
        },
        {
          id: 'event-2',
          issue_id: 'AFU9-456',
          run_id: 'run-789',
          event_type: 'loop_run_finished',
          event_data: {
            runId: 'run-789',
            step: 'S1_PICK_ISSUE',
            stateBefore: 'CREATED',
            stateAfter: 'CREATED',
            requestId: 'req-abc',
          },
          occurred_at: new Date('2026-01-23T12:00:00Z'),
        },
      ];

      (pool.query as jest.Mock).mockResolvedValue({ rows: mockRows });

      const results = await store.getEventsByRun('run-789');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY occurred_at ASC'),
        ['run-789']
      );
      expect(results).toHaveLength(2);
      // Events should be in chronological order (ASC)
      expect(results[0].event_type).toBe('loop_run_started');
      expect(results[1].event_type).toBe('loop_run_finished');
    });
  });

  describe('countEventsByIssue', () => {
    it('should count events for an issue', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [{ count: '42' }] });

      const count = await store.countEventsByIssue('AFU9-456');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)'),
        ['AFU9-456']
      );
      expect(count).toBe(42);
    });

    it('should return 0 when no events exist', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      const count = await store.countEventsByIssue('AFU9-999');

      expect(count).toBe(0);
    });
  });

  describe('Acceptance Criteria', () => {
    it('should support all standard event types', () => {
      expect(LoopEventType.RUN_STARTED).toBe('loop_run_started');
      expect(LoopEventType.RUN_FINISHED).toBe('loop_run_finished');
      expect(LoopEventType.STEP_S1_COMPLETED).toBe('loop_step_s1_completed');
      expect(LoopEventType.STEP_S2_SPEC_READY).toBe('loop_step_s2_spec_ready');
      expect(LoopEventType.STEP_S3_IMPLEMENT_PREP).toBe('loop_step_s3_implement_prep');
      expect(LoopEventType.RUN_BLOCKED).toBe('loop_run_blocked');
      expect(LoopEventType.RUN_FAILED).toBe('loop_run_failed');
    });

    it('should enforce payload allowlist (no secrets)', async () => {
      // All allowed fields
      const validPayload: LoopEventPayload = {
        runId: 'run-123',
        step: 'S1_PICK_ISSUE',
        stateBefore: 'CREATED',
        stateAfter: 'CREATED',
        blockerCode: 'NO_GITHUB_LINK',
        requestId: 'req-abc',
      };

      const mockRow = {
        id: 'event-123',
        issue_id: 'AFU9-456',
        run_id: 'run-789',
        event_type: 'loop_run_started',
        event_data: validPayload,
        occurred_at: new Date(),
      };

      (pool.query as jest.Mock).mockResolvedValue({ rows: [mockRow] });

      const result = await store.createEvent({
        issueId: 'AFU9-456',
        runId: 'run-789',
        eventType: LoopEventType.RUN_STARTED,
        eventData: validPayload,
      });

      expect(result).toBeDefined();
    });
  });
});
