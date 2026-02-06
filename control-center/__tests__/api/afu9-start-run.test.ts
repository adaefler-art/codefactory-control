/**
 * I201.4: Start Run Endpoint Tests
 * 
 * Tests for POST /api/afu9/issues/:issueId/runs/start endpoint
 * 
 * Validates:
 * - Run creation with correct status and timestamps
 * - Issue state transition CREATED → IMPLEMENTING
 * - RUN_STARTED timeline event logging
 * - Error handling for non-existent issues
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as startRun } from '../../app/api/afu9/issues/[id]/runs/start/route';
import { Afu9IssueStatus } from '../../src/lib/contracts/afu9Issue';
import { resolveIssueIdentifier } from '../../app/api/issues/_shared';

const mockRunsDAO = {
  createRun: jest.fn(),
  updateRunStatus: jest.fn(),
};

const mockIssue = {
  id: 'test-issue-123',
  title: 'Test Issue',
  status: Afu9IssueStatus.CREATED,
  created_at: new Date(),
  updated_at: new Date(),
};

const mockGetAfu9IssueById = jest.fn();
const mockGetAfu9IssueByPublicId = jest.fn();
const mockUpdateAfu9Issue = jest.fn();
const mockLogTimelineEvent = jest.fn();

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(() => ({
      query: jest.fn(),
      release: jest.fn(),
    })),
  })),
}));

// Mock RunsDAO
jest.mock('../../src/lib/db/afu9Runs', () => ({
  getRunsDAO: jest.fn(() => mockRunsDAO),
}));

// Mock afu9Issues
jest.mock('../../src/lib/db/afu9Issues', () => ({
  getAfu9IssueById: (...args: unknown[]) => mockGetAfu9IssueById(...args),
  getAfu9IssueByPublicId: (...args: unknown[]) => mockGetAfu9IssueByPublicId(...args),
  updateAfu9Issue: (...args: unknown[]) => mockUpdateAfu9Issue(...args),
}));

jest.mock('../../app/api/issues/_shared', () => {
  const actual = jest.requireActual('../../app/api/issues/_shared');
  return {
    ...actual,
    resolveIssueIdentifier: jest.fn(),
  };
});

// Mock issueTimeline
jest.mock('../../src/lib/db/issueTimeline', () => ({
  logTimelineEvent: (...args: unknown[]) => mockLogTimelineEvent(...args),
}));

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-run-id-123'),
}));

describe('POST /api/afu9/issues/:issueId/runs/start', () => {
  const mockResolveIssueIdentifier = resolveIssueIdentifier as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveIssueIdentifier.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: mockIssue.id,
      issue: mockIssue,
      source: 'control',
    });
    mockRunsDAO.createRun.mockResolvedValue(undefined);
    mockRunsDAO.updateRunStatus.mockResolvedValue(undefined);
    mockUpdateAfu9Issue.mockResolvedValue({ success: true });
    mockLogTimelineEvent.mockResolvedValue({ success: true });
  });

  test('creates run with status=RUNNING', async () => {
    mockGetAfu9IssueById.mockResolvedValue({
      success: true,
      data: mockIssue,
    });

    const request = new NextRequest('http://localhost/api/afu9/issues/test-issue-123/runs/start', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: 'test-issue-123' });
    const response = await startRun(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.runId).toBe('mock-run-id-123');
    expect(body.issueId).toBe('test-issue-123');
    expect(body.status).toBe('RUNNING');
    expect(body.createdAt).toBeDefined();
    expect(body.startedAt).toBeDefined();

    // Verify run was created with QUEUED then updated to RUNNING
    expect(mockRunsDAO.createRun).toHaveBeenCalledWith(
      'mock-run-id-123',
      expect.objectContaining({
        title: expect.stringContaining('Test Issue'),
        runtime: 'afu9',
        steps: expect.any(Array),
      }),
      'test-issue-123',
      undefined,
      undefined
    );

    expect(mockRunsDAO.updateRunStatus).toHaveBeenCalledWith(
      'mock-run-id-123',
      'RUNNING',
      expect.any(Date),
      undefined
    );
  });

  test('transitions issue from CREATED to IMPLEMENTING', async () => {
    mockGetAfu9IssueById.mockResolvedValue({
      success: true,
      data: mockIssue,
    });

    const request = new NextRequest('http://localhost/api/afu9/issues/test-issue-123/runs/start', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: 'test-issue-123' });
    await startRun(request, { params });

    expect(mockUpdateAfu9Issue).toHaveBeenCalledWith(
      expect.anything(),
      'test-issue-123',
      expect.objectContaining({
        status: Afu9IssueStatus.IMPLEMENTING,
        execution_state: 'RUNNING',
        execution_started_at: expect.any(String),
      })
    );
  });

  test('logs RUN_STARTED timeline event with runId', async () => {
    mockGetAfu9IssueById.mockResolvedValue({
      success: true,
      data: mockIssue,
    });

    const request = new NextRequest('http://localhost/api/afu9/issues/test-issue-123/runs/start', {
      method: 'POST',
      body: JSON.stringify({ type: 'automated' }),
    });
    const params = Promise.resolve({ id: 'test-issue-123' });
    await startRun(request, { params });

    expect(mockLogTimelineEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        issue_id: 'test-issue-123',
        event_type: 'RUN_STARTED',
        event_data: expect.objectContaining({
          runId: 'mock-run-id-123',
          type: 'automated',
          status: 'RUNNING',
        }),
        actor: 'system',
        actor_type: 'system',
      })
    );
  });

  test('returns 404 for non-existent issue', async () => {
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

    const request = new NextRequest('http://localhost/api/afu9/issues/non-existent/runs/start', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: 'non-existent' });
    const response = await startRun(request, { params });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      errorCode: 'issue_not_found',
      issueId: 'non-existent',
    });
  });

  test('does not transition issue if already IMPLEMENTING', async () => {
    const implementingIssue = {
      ...mockIssue,
      status: Afu9IssueStatus.IMPLEMENTING,
    };

    mockGetAfu9IssueById.mockResolvedValue({
      success: true,
      data: implementingIssue,
    });

    const request = new NextRequest('http://localhost/api/afu9/issues/test-issue-123/runs/start', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: 'test-issue-123' });
    await startRun(request, { params });

    // Should NOT call updateAfu9Issue since issue is already IMPLEMENTING
    expect(mockUpdateAfu9Issue).not.toHaveBeenCalled();

    // But should still create run and log timeline event
    expect(mockRunsDAO.createRun).toHaveBeenCalled();
    expect(mockLogTimelineEvent).toHaveBeenCalled();
  });

  test('uses default type "manual" when not provided', async () => {
    mockGetAfu9IssueById.mockResolvedValue({
      success: true,
      data: mockIssue,
    });

    const request = new NextRequest('http://localhost/api/afu9/issues/test-issue-123/runs/start', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: 'test-issue-123' });
    const response = await startRun(request, { params });
    const body = await response.json();

    expect(body.type).toBe('manual');
    expect(mockLogTimelineEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event_data: expect.objectContaining({
          type: 'manual',
        }),
      })
    );
  });

  test('accepts shortId and resolves to UUID', async () => {
    const shortId = 'a1b2c3d4';
    const resolvedUuid = 'a1b2c3d4-5678-4abc-9def-0123456789ab';
    const resolvedIssue = {
      ...mockIssue,
      id: resolvedUuid,
    };

    mockResolveIssueIdentifier.mockResolvedValue({
      ok: true,
      type: 'shortid',
      uuid: resolvedUuid,
      shortId,
      issue: resolvedIssue,
      source: 'control',
    });

    const request = new NextRequest(`http://localhost/api/afu9/issues/${shortId}/runs/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: shortId });
    const response = await startRun(request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.issueId).toBe(resolvedUuid);
    expect(mockResolveIssueIdentifier).toHaveBeenCalledWith(shortId, expect.any(String));
    expect(mockRunsDAO.createRun).toHaveBeenCalledWith(
      'mock-run-id-123',
      expect.anything(),
      resolvedUuid,
      undefined,
      undefined
    );
  });
});
