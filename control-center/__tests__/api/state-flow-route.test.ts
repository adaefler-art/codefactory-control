/**
 * Tests for GET /api/issues/[id]/state-flow
 * E85.3: State Flow Viewer API
 */

import { GET } from '../../app/api/issues/[id]/state-flow/route';
import { NextRequest } from 'next/server';

const mockQuery = jest.fn();

// Mock dependencies
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: mockQuery,
  })),
}));

jest.mock('../../src/lib/state-flow', () => ({
  computeStateFlow: jest.fn(() => ({
    currentState: 'IN_PROGRESS',
    isTerminal: false,
    nextStates: [],
    canTransition: true,
  })),
  getBlockersForDone: jest.fn(() => []),
}));

describe('GET /api/issues/[id]/state-flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 400 with INVALID_ISSUE_ID for invalid UUID', async () => {
    const request = new NextRequest('http://localhost/api/issues/not-a-uuid/state-flow');
    const params = Promise.resolve({ id: 'not-a-uuid' });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.errorCode).toBe('INVALID_ISSUE_ID');
    expect(data.error).toBe('Invalid issue ID format');
  });

  it('should return 400 with INVALID_ISSUE_ID for empty ID', async () => {
    const request = new NextRequest('http://localhost/api/issues//state-flow');
    const params = Promise.resolve({ id: '' });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.errorCode).toBe('INVALID_ISSUE_ID');
  });

  it('should return 404 for non-existent issue', async () => {
    const validUuid = 'a1234567-1234-4234-8234-123456789abc';
    const request = new NextRequest(`http://localhost/api/issues/${validUuid}/state-flow`);
    const params = Promise.resolve({ id: validUuid });

    mockQuery.mockResolvedValueOnce({ rows: [] });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Issue not found');
  });

  it('should return 200 with state flow data for valid issue', async () => {
    const validUuid = 'b1234567-1234-4234-8234-123456789abc';
    const request = new NextRequest(`http://localhost/api/issues/${validUuid}/state-flow`);
    const params = Promise.resolve({ id: validUuid });

    const mockIssue = {
      id: validUuid,
      status: 'IN_PROGRESS',
      github_issue_number: 123,
      github_url: 'https://github.com/test/repo/issues/123',
      handoff_state: 'READY',
      execution_state: 'RUNNING',
    };

    mockQuery.mockResolvedValueOnce({ rows: [mockIssue] });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.issueId).toBe(validUuid);
    expect(data.currentStatus).toBe('IN_PROGRESS');
    expect(data.stateFlow).toBeDefined();
    expect(data.blockersForDone).toBeDefined();
  });

  it('should pass validated UUID to database query', async () => {
    const validUuid = 'c1234567-1234-4234-8234-123456789abc';
    const request = new NextRequest(`http://localhost/api/issues/${validUuid}/state-flow`);
    const params = Promise.resolve({ id: validUuid });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: validUuid,
        status: 'CREATED',
        github_issue_number: null,
        github_url: null,
        handoff_state: null,
        execution_state: null,
      }],
    });

    await GET(request, { params });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      [validUuid]
    );
  });

  it('should have deterministic response payload structure', async () => {
    const validUuid = 'd1234567-1234-4234-8234-123456789abc';
    const request = new NextRequest(`http://localhost/api/issues/${validUuid}/state-flow`);
    const params = Promise.resolve({ id: validUuid });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: validUuid,
        status: 'IN_PROGRESS',
        github_issue_number: 42,
        github_url: 'https://github.com/test/repo/issues/42',
        handoff_state: 'READY',
        execution_state: 'DONE',
      }],
    });

    const response = await GET(request, { params });
    const data = await response.json();

    // Verify all expected keys are present
    const expectedKeys = ['issueId', 'currentStatus', 'githubIssueNumber', 'githubUrl', 'stateFlow', 'blockersForDone'];
    expect(Object.keys(data).sort()).toEqual(expectedKeys.sort());
  });
});
