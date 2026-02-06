/**
 * Verdict Endpoint Tests
 * 
 * I201.7: Verdict Endpoint + State Mapping (GREEN/HOLD/RED)
 * 
 * Tests the verdict endpoint for:
 * - POST /api/afu9/issues/:issueId/verdict
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as verdictHandler } from '../../app/api/afu9/issues/[id]/verdict/route';
import { Afu9IssueStatus } from '@/lib/contracts/afu9Issue';
import { Verdict } from '@/lib/contracts/verdict';
import { IssueTimelineEventType, ActorType } from '@/lib/contracts/issueTimeline';
import { resolveIssueIdentifier } from '../../app/api/issues/_shared';

const mockPool = {
  query: jest.fn(),
};

const mockIssueResult = {
  success: true,
  data: {
    id: 'test-issue-123',
    title: 'Test Issue',
    status: Afu9IssueStatus.IMPLEMENTING,
  },
};

const mockUpdateResult = {
  success: true,
};

const mockTimelineResult = {
  success: true,
  data: {
    id: 'event-123',
    issue_id: 'test-issue-123',
    event_type: IssueTimelineEventType.VERDICT_SET,
    created_at: new Date().toISOString(),
  },
};

// Mock the database module
jest.mock('@/lib/db', () => ({
  getPool: jest.fn(() => mockPool),
}));

// Mock database functions
jest.mock('@/lib/db/afu9Issues', () => ({
  getAfu9IssueById: jest.fn(),
  updateAfu9Issue: jest.fn(),
}));

jest.mock('@/lib/db/issueTimeline', () => ({
  logTimelineEvent: jest.fn(),
}));

jest.mock('../../app/api/issues/_shared', () => {
  const actual = jest.requireActual('../../app/api/issues/_shared');
  return {
    ...actual,
    resolveIssueIdentifier: jest.fn(),
  };
});

describe('POST /api/afu9/issues/:issueId/verdict', () => {
  const mockResolveIssueIdentifier = resolveIssueIdentifier as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveIssueIdentifier.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: 'test-issue-123',
      issue: { id: 'test-issue-123' },
      source: 'control',
    });
  });

  test('GREEN verdict transitions IMPLEMENTING to VERIFIED', async () => {
    const { getAfu9IssueById, updateAfu9Issue } = require('@/lib/db/afu9Issues');
    const { logTimelineEvent } = require('@/lib/db/issueTimeline');

    getAfu9IssueById.mockResolvedValue({
      ...mockIssueResult,
      data: { ...mockIssueResult.data, status: Afu9IssueStatus.IMPLEMENTING },
    });
    updateAfu9Issue.mockResolvedValue(mockUpdateResult);
    logTimelineEvent.mockResolvedValue(mockTimelineResult);

    const request = new NextRequest('http://localhost/api/afu9/issues/test-issue-123/verdict', {
      method: 'POST',
      body: JSON.stringify({ verdict: Verdict.GREEN }),
    });

    const response = await verdictHandler(request, {
      params: Promise.resolve({ id: 'test-issue-123' }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.verdict).toBe(Verdict.GREEN);
    expect(body.oldStatus).toBe(Afu9IssueStatus.IMPLEMENTING);
    expect(body.newStatus).toBe(Afu9IssueStatus.VERIFIED);
    expect(body.stateChanged).toBe(true);

    // Verify VERDICT_SET event was logged
    expect(logTimelineEvent).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({
        issue_id: 'test-issue-123',
        event_type: IssueTimelineEventType.VERDICT_SET,
        event_data: expect.objectContaining({
          verdict: Verdict.GREEN,
          oldStatus: Afu9IssueStatus.IMPLEMENTING,
          newStatus: Afu9IssueStatus.VERIFIED,
          stateChanged: true,
        }),
      })
    );

    // Verify STATE_CHANGED event was logged
    expect(logTimelineEvent).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({
        issue_id: 'test-issue-123',
        event_type: IssueTimelineEventType.STATE_CHANGED,
        event_data: expect.objectContaining({
          oldStatus: Afu9IssueStatus.IMPLEMENTING,
          newStatus: Afu9IssueStatus.VERIFIED,
          reason: 'verdict:GREEN',
        }),
      })
    );

    // Verify issue status was updated
    expect(updateAfu9Issue).toHaveBeenCalledWith(mockPool, 'test-issue-123', {
      status: Afu9IssueStatus.VERIFIED,
    });
  });

  test('GREEN verdict transitions VERIFIED to DONE', async () => {
    const { getAfu9IssueById, updateAfu9Issue } = require('@/lib/db/afu9Issues');
    const { logTimelineEvent } = require('@/lib/db/issueTimeline');

    getAfu9IssueById.mockResolvedValue({
      ...mockIssueResult,
      data: { ...mockIssueResult.data, status: Afu9IssueStatus.VERIFIED },
    });
    updateAfu9Issue.mockResolvedValue(mockUpdateResult);
    logTimelineEvent.mockResolvedValue(mockTimelineResult);

    const request = new NextRequest('http://localhost/api/afu9/issues/test-issue-123/verdict', {
      method: 'POST',
      body: JSON.stringify({ verdict: Verdict.GREEN }),
    });

    const response = await verdictHandler(request, {
      params: Promise.resolve({ id: 'test-issue-123' }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.oldStatus).toBe(Afu9IssueStatus.VERIFIED);
    expect(body.newStatus).toBe(Afu9IssueStatus.DONE);
    expect(body.stateChanged).toBe(true);
  });

  test('RED verdict transitions to HOLD', async () => {
    const { getAfu9IssueById, updateAfu9Issue } = require('@/lib/db/afu9Issues');
    const { logTimelineEvent } = require('@/lib/db/issueTimeline');

    getAfu9IssueById.mockResolvedValue({
      ...mockIssueResult,
      data: { ...mockIssueResult.data, status: Afu9IssueStatus.IMPLEMENTING },
    });
    updateAfu9Issue.mockResolvedValue(mockUpdateResult);
    logTimelineEvent.mockResolvedValue(mockTimelineResult);

    const request = new NextRequest('http://localhost/api/afu9/issues/test-issue-123/verdict', {
      method: 'POST',
      body: JSON.stringify({ verdict: Verdict.RED }),
    });

    const response = await verdictHandler(request, {
      params: Promise.resolve({ id: 'test-issue-123' }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.verdict).toBe(Verdict.RED);
    expect(body.oldStatus).toBe(Afu9IssueStatus.IMPLEMENTING);
    expect(body.newStatus).toBe(Afu9IssueStatus.HOLD);
    expect(body.stateChanged).toBe(true);

    expect(updateAfu9Issue).toHaveBeenCalledWith(mockPool, 'test-issue-123', {
      status: Afu9IssueStatus.HOLD,
    });
  });

  test('HOLD verdict transitions to HOLD', async () => {
    const { getAfu9IssueById, updateAfu9Issue } = require('@/lib/db/afu9Issues');
    const { logTimelineEvent } = require('@/lib/db/issueTimeline');

    getAfu9IssueById.mockResolvedValue({
      ...mockIssueResult,
      data: { ...mockIssueResult.data, status: Afu9IssueStatus.VERIFIED },
    });
    updateAfu9Issue.mockResolvedValue(mockUpdateResult);
    logTimelineEvent.mockResolvedValue(mockTimelineResult);

    const request = new NextRequest('http://localhost/api/afu9/issues/test-issue-123/verdict', {
      method: 'POST',
      body: JSON.stringify({ verdict: Verdict.HOLD }),
    });

    const response = await verdictHandler(request, {
      params: Promise.resolve({ id: 'test-issue-123' }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.verdict).toBe(Verdict.HOLD);
    expect(body.oldStatus).toBe(Afu9IssueStatus.VERIFIED);
    expect(body.newStatus).toBe(Afu9IssueStatus.HOLD);
    expect(body.stateChanged).toBe(true);
  });

  test('Idempotent: same verdict does not change state', async () => {
    const { getAfu9IssueById, updateAfu9Issue } = require('@/lib/db/afu9Issues');
    const { logTimelineEvent } = require('@/lib/db/issueTimeline');

    getAfu9IssueById.mockResolvedValue({
      ...mockIssueResult,
      data: { ...mockIssueResult.data, status: Afu9IssueStatus.HOLD },
    });
    logTimelineEvent.mockResolvedValue(mockTimelineResult);

    const request = new NextRequest('http://localhost/api/afu9/issues/test-issue-123/verdict', {
      method: 'POST',
      body: JSON.stringify({ verdict: Verdict.HOLD }),
    });

    const response = await verdictHandler(request, {
      params: Promise.resolve({ id: 'test-issue-123' }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.oldStatus).toBe(Afu9IssueStatus.HOLD);
    expect(body.newStatus).toBe(Afu9IssueStatus.HOLD);
    expect(body.stateChanged).toBe(false);

    // VERDICT_SET should still be logged
    expect(logTimelineEvent).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({
        event_type: IssueTimelineEventType.VERDICT_SET,
      })
    );

    // STATE_CHANGED should NOT be logged when state doesn't change
    expect(logTimelineEvent).not.toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({
        event_type: IssueTimelineEventType.STATE_CHANGED,
      })
    );

    // Issue should NOT be updated
    expect(updateAfu9Issue).not.toHaveBeenCalled();
  });

  test('Returns 404 when issue not found', async () => {
    mockResolveIssueIdentifier.mockResolvedValue({
      ok: false,
      status: 404,
      body: {
        errorCode: 'issue_not_found',
        issueId: 'non-existent',
        lookupStore: 'control',
        requestId: 'req-404',
      },
    });
    const { getAfu9IssueById } = require('@/lib/db/afu9Issues');

    getAfu9IssueById.mockResolvedValue({
      success: false,
      error: 'Issue not found',
    });

    const request = new NextRequest('http://localhost/api/afu9/issues/non-existent/verdict', {
      method: 'POST',
      body: JSON.stringify({ verdict: Verdict.GREEN }),
    });

    const response = await verdictHandler(request, {
      params: Promise.resolve({ id: 'non-existent' }),
    });

    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      errorCode: 'issue_not_found',
      issueId: 'non-existent',
    });
  });

  test('Returns 400 for invalid verdict', async () => {
    const request = new NextRequest('http://localhost/api/afu9/issues/test-issue-123/verdict', {
      method: 'POST',
      body: JSON.stringify({ verdict: 'INVALID' }),
    });

    const response = await verdictHandler(request, {
      params: Promise.resolve({ id: 'test-issue-123' }),
    });

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Invalid verdict');
  });

  test('Returns 400 for missing verdict', async () => {
    const request = new NextRequest('http://localhost/api/afu9/issues/test-issue-123/verdict', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await verdictHandler(request, {
      params: Promise.resolve({ id: 'test-issue-123' }),
    });

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Invalid verdict');
  });

  test('Returns 400 for invalid JSON body', async () => {
    const request = new NextRequest('http://localhost/api/afu9/issues/test-issue-123/verdict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json',
    });

    const response = await verdictHandler(request, {
      params: Promise.resolve({ id: 'test-issue-123' }),
    });

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Invalid request body');
  });

  test('GREEN verdict on non-advancing state stays in same state', async () => {
    const { getAfu9IssueById, updateAfu9Issue } = require('@/lib/db/afu9Issues');
    const { logTimelineEvent } = require('@/lib/db/issueTimeline');

    getAfu9IssueById.mockResolvedValue({
      ...mockIssueResult,
      data: { ...mockIssueResult.data, status: Afu9IssueStatus.CREATED },
    });
    logTimelineEvent.mockResolvedValue(mockTimelineResult);

    const request = new NextRequest('http://localhost/api/afu9/issues/test-issue-123/verdict', {
      method: 'POST',
      body: JSON.stringify({ verdict: Verdict.GREEN }),
    });

    const response = await verdictHandler(request, {
      params: Promise.resolve({ id: 'test-issue-123' }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.oldStatus).toBe(Afu9IssueStatus.CREATED);
    expect(body.newStatus).toBe(Afu9IssueStatus.CREATED);
    expect(body.stateChanged).toBe(false);

    // VERDICT_SET should be logged but no STATE_CHANGED
    expect(logTimelineEvent).toHaveBeenCalledTimes(1);
    expect(updateAfu9Issue).not.toHaveBeenCalled();
  });
});
