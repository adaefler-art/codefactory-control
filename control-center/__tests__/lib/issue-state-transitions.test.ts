/**
 * E61.1: Issue State Machine Transition Contract Tests
 * 
 * Tests the centralized transitionIssue function with:
 * - Allowed transitions (CREATED -> SPEC_READY)
 * - Forbidden transitions (CREATED -> DONE)
 * - Event logging for successful transitions
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import { Afu9IssueStatus } from '../../src/lib/contracts/afu9Issue';
import {
  transitionIssue,
  createAfu9Issue,
  getIssueEvents,
} from '../../src/lib/db/afu9Issues';

// Mock pool for testing
const mockPool = {
  connect: jest.fn(),
  query: jest.fn(),
  end: jest.fn(),
  on: jest.fn(),
} as unknown as Pool;

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

describe('E61.1: Issue State Machine Transitions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);
  });

  describe('Allowed Transitions', () => {
    test('should allow CREATED -> SPEC_READY transition', async () => {
      const issueId = 'test-issue-id';
      
      // Mock getAfu9IssueById (called internally by transitionIssue)
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.CREATED,
          title: 'Test Issue',
        }],
      });

      // Mock BEGIN transaction
      mockClient.query.mockResolvedValueOnce({});
      
      // Mock UPDATE query
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.SPEC_READY,
          title: 'Test Issue',
        }],
      });

      // Mock INSERT event query
      mockClient.query.mockResolvedValueOnce({});

      // Mock COMMIT
      mockClient.query.mockResolvedValueOnce({});

      const result = await transitionIssue(
        mockPool,
        issueId,
        Afu9IssueStatus.SPEC_READY,
        'test-user'
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe(Afu9IssueStatus.SPEC_READY);
      
      // Verify transaction was used
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      
      // Verify event was logged
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO afu9_issue_events'),
        expect.arrayContaining([
          issueId,
          'TRANSITION',
          Afu9IssueStatus.CREATED,
          Afu9IssueStatus.SPEC_READY,
          'test-user',
          expect.any(String),
        ])
      );
    });

    test('should allow SPEC_READY -> IMPLEMENTING transition', async () => {
      const issueId = 'test-issue-id';
      
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.SPEC_READY,
          title: 'Test Issue',
        }],
      });

      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.IMPLEMENTING,
        }],
      }); // UPDATE
      mockClient.query.mockResolvedValueOnce({}); // INSERT event
      mockClient.query.mockResolvedValueOnce({}); // COMMIT

      const result = await transitionIssue(
        mockPool,
        issueId,
        Afu9IssueStatus.IMPLEMENTING,
        'system'
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe(Afu9IssueStatus.IMPLEMENTING);
    });

    test('should allow IMPLEMENTING -> VERIFIED transition', async () => {
      const issueId = 'test-issue-id';
      
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.IMPLEMENTING,
          title: 'Test Issue',
        }],
      });

      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.VERIFIED,
        }],
      }); // UPDATE
      mockClient.query.mockResolvedValueOnce({}); // INSERT event
      mockClient.query.mockResolvedValueOnce({}); // COMMIT

      const result = await transitionIssue(
        mockPool,
        issueId,
        Afu9IssueStatus.VERIFIED,
        'system'
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe(Afu9IssueStatus.VERIFIED);
    });

    test('should allow backward transition IMPLEMENTING -> SPEC_READY', async () => {
      const issueId = 'test-issue-id';
      
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.IMPLEMENTING,
          title: 'Test Issue',
        }],
      });

      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.SPEC_READY,
        }],
      }); // UPDATE
      mockClient.query.mockResolvedValueOnce({}); // INSERT event
      mockClient.query.mockResolvedValueOnce({}); // COMMIT

      const result = await transitionIssue(
        mockPool,
        issueId,
        Afu9IssueStatus.SPEC_READY,
        'system'
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe(Afu9IssueStatus.SPEC_READY);
    });

    test('should allow transition to HOLD from any non-terminal state', async () => {
      const issueId = 'test-issue-id';
      
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.IMPLEMENTING,
          title: 'Test Issue',
        }],
      });

      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.HOLD,
        }],
      }); // UPDATE
      mockClient.query.mockResolvedValueOnce({}); // INSERT event
      mockClient.query.mockResolvedValueOnce({}); // COMMIT

      const result = await transitionIssue(
        mockPool,
        issueId,
        Afu9IssueStatus.HOLD,
        'user'
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe(Afu9IssueStatus.HOLD);
    });

    test('should allow transition to KILLED from any non-terminal state', async () => {
      const issueId = 'test-issue-id';
      
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.IMPLEMENTING,
          title: 'Test Issue',
        }],
      });

      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.KILLED,
        }],
      }); // UPDATE
      mockClient.query.mockResolvedValueOnce({}); // INSERT event
      mockClient.query.mockResolvedValueOnce({}); // COMMIT

      const result = await transitionIssue(
        mockPool,
        issueId,
        Afu9IssueStatus.KILLED,
        'user'
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe(Afu9IssueStatus.KILLED);
    });
  });

  describe('Forbidden Transitions', () => {
    test('should block CREATED -> DONE transition', async () => {
      const issueId = 'test-issue-id';
      
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.CREATED,
          title: 'Test Issue',
        }],
      });

      const result = await transitionIssue(
        mockPool,
        issueId,
        Afu9IssueStatus.DONE,
        'system'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid transition');
      expect(result.error).toContain('CREATED -> DONE');
      
      // Verify no transaction was started
      expect(mockClient.query).not.toHaveBeenCalledWith('BEGIN');
    });

    test('should block CREATED -> IMPLEMENTING transition (must go through SPEC_READY)', async () => {
      const issueId = 'test-issue-id';
      
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.CREATED,
          title: 'Test Issue',
        }],
      });

      const result = await transitionIssue(
        mockPool,
        issueId,
        Afu9IssueStatus.IMPLEMENTING,
        'system'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid transition');
      expect(result.error).toContain('CREATED -> IMPLEMENTING');
    });

    test('should block SPEC_READY -> VERIFIED transition (must go through IMPLEMENTING)', async () => {
      const issueId = 'test-issue-id';
      
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.SPEC_READY,
          title: 'Test Issue',
        }],
      });

      const result = await transitionIssue(
        mockPool,
        issueId,
        Afu9IssueStatus.VERIFIED,
        'system'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid transition');
    });

    test('should block transitions from DONE (terminal state)', async () => {
      const issueId = 'test-issue-id';
      
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.DONE,
          title: 'Test Issue',
        }],
      });

      const result = await transitionIssue(
        mockPool,
        issueId,
        Afu9IssueStatus.IMPLEMENTING,
        'system'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid transition');
      expect(result.error).toContain('DONE -> IMPLEMENTING');
    });

    test('should block transitions from KILLED (terminal state)', async () => {
      const issueId = 'test-issue-id';
      
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.KILLED,
          title: 'Test Issue',
        }],
      });

      const result = await transitionIssue(
        mockPool,
        issueId,
        Afu9IssueStatus.CREATED,
        'system'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid transition');
    });
  });

  describe('Event Logging', () => {
    test('should create exactly one issue_event for successful transition', async () => {
      const issueId = 'test-issue-id';
      
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.CREATED,
          title: 'Test Issue',
        }],
      });

      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.SPEC_READY,
        }],
      }); // UPDATE
      mockClient.query.mockResolvedValueOnce({}); // INSERT event
      mockClient.query.mockResolvedValueOnce({}); // COMMIT

      await transitionIssue(
        mockPool,
        issueId,
        Afu9IssueStatus.SPEC_READY,
        'test-user',
        { reason: 'spec completed' }
      );

      // Find the INSERT event call
      const insertEventCall = (mockClient.query as jest.Mock).mock.calls.find(
        call => call[0] && call[0].includes('INSERT INTO afu9_issue_events')
      );

      expect(insertEventCall).toBeDefined();
      expect(insertEventCall[1]).toEqual([
        issueId,
        'TRANSITION',
        Afu9IssueStatus.CREATED,
        Afu9IssueStatus.SPEC_READY,
        'test-user',
        JSON.stringify({ reason: 'spec completed' }),
      ]);
    });

    test('should not create event for failed transition', async () => {
      const issueId = 'test-issue-id';
      
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.CREATED,
          title: 'Test Issue',
        }],
      });

      await transitionIssue(
        mockPool,
        issueId,
        Afu9IssueStatus.DONE, // Invalid transition
        'system'
      );

      // No transaction should be started
      expect(mockClient.query).not.toHaveBeenCalled();
    });
  });

  describe('Atomicity', () => {
    test('should rollback transaction if event logging fails', async () => {
      const issueId = 'test-issue-id';
      
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.CREATED,
          title: 'Test Issue',
        }],
      });

      mockClient.query.mockResolvedValueOnce({}); // BEGIN
      mockClient.query.mockResolvedValueOnce({
        rows: [{
          id: issueId,
          status: Afu9IssueStatus.SPEC_READY,
        }],
      }); // UPDATE
      mockClient.query.mockRejectedValueOnce(new Error('Event insert failed')); // INSERT event fails

      const result = await transitionIssue(
        mockPool,
        issueId,
        Afu9IssueStatus.SPEC_READY,
        'system'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Event insert failed');
      
      // Verify rollback was called
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
