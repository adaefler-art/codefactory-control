/**
 * AFU9 Evidence Refresh API Tests
 * 
 * Tests the evidence refresh endpoint for AFU9 runs:
 * - POST /api/afu9/runs/:runId/evidence/refresh
 * 
 * Reference: I201.6 (Evidence Link/Refresh)
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as evidenceRefresh } from '../../app/api/afu9/runs/[runId]/evidence/refresh/route';

const mockRunsDAO = {
  getRun: jest.fn(),
  updateEvidenceRef: jest.fn(),
};

const mockPool = {
  query: jest.fn(),
  connect: jest.fn(() => ({
    query: jest.fn(),
    release: jest.fn(),
  })),
};

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => mockPool),
}));

// Mock RunsDAO
jest.mock('../../src/lib/db/afu9Runs', () => ({
  getRunsDAO: jest.fn(() => mockRunsDAO),
}));

// Mock logTimelineEvent
jest.mock('../../src/lib/db/issueTimeline', () => ({
  logTimelineEvent: jest.fn(),
}));

describe('POST /api/afu9/runs/:runId/evidence/refresh', () => {
  const validRunId = 'run-123';
  const validUrl = 's3://bucket/evidence/run-123.json';
  const validHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const validVersion = '1.0';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('successfully refreshes evidence reference', async () => {
    const mockRun = {
      run: {
        id: validRunId,
        issue_id: 'issue-456',
        title: 'Test Run',
        status: 'SUCCEEDED',
        spec_json: { title: 'Test', runtime: 'dummy', steps: [] },
        evidence_url: null,
        evidence_hash: null,
        evidence_fetched_at: null,
        evidence_version: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
      },
      steps: [],
    };

    const mockUpdatedRun = {
      ...mockRun,
      run: {
        ...mockRun.run,
        evidence_url: validUrl,
        evidence_hash: validHash,
        evidence_fetched_at: new Date('2024-01-01T12:00:00Z'),
        evidence_version: validVersion,
      },
    };

    mockRunsDAO.getRun.mockResolvedValueOnce(mockRun);
    mockRunsDAO.getRun.mockResolvedValueOnce(mockUpdatedRun);
    mockRunsDAO.updateEvidenceRef.mockResolvedValue(undefined);

    const request = new NextRequest('http://localhost/api/afu9/runs/run-123/evidence/refresh', {
      method: 'POST',
      body: JSON.stringify({
        url: validUrl,
        evidenceHash: validHash,
        version: validVersion,
      }),
    });

    const response = await evidenceRefresh(request, {
      params: Promise.resolve({ runId: validRunId }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.runId).toBe(validRunId);
    expect(body.evidenceRef).toBeDefined();
    expect(body.evidenceRef.url).toBe(validUrl);
    expect(body.evidenceRef.evidenceHash).toBe(validHash);
    expect(body.evidenceRef.version).toBe(validVersion);
    expect(body.evidenceRef.fetchedAt).toBeDefined();

    expect(mockRunsDAO.updateEvidenceRef).toHaveBeenCalledWith(
      validRunId,
      validUrl,
      validHash,
      validVersion
    );
  });

  test('successfully refreshes evidence without version', async () => {
    const mockRun = {
      run: {
        id: validRunId,
        issue_id: 'issue-456',
        title: 'Test Run',
        status: 'SUCCEEDED',
        spec_json: { title: 'Test', runtime: 'dummy', steps: [] },
        evidence_url: null,
        evidence_hash: null,
        evidence_fetched_at: null,
        evidence_version: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
      },
      steps: [],
    };

    const mockUpdatedRun = {
      ...mockRun,
      run: {
        ...mockRun.run,
        evidence_url: validUrl,
        evidence_hash: validHash,
        evidence_fetched_at: new Date('2024-01-01T12:00:00Z'),
      },
    };

    mockRunsDAO.getRun.mockResolvedValueOnce(mockRun);
    mockRunsDAO.getRun.mockResolvedValueOnce(mockUpdatedRun);
    mockRunsDAO.updateEvidenceRef.mockResolvedValue(undefined);

    const request = new NextRequest('http://localhost/api/afu9/runs/run-123/evidence/refresh', {
      method: 'POST',
      body: JSON.stringify({
        url: validUrl,
        evidenceHash: validHash,
      }),
    });

    const response = await evidenceRefresh(request, {
      params: Promise.resolve({ runId: validRunId }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.runId).toBe(validRunId);
    expect(body.evidenceRef).toBeDefined();
    expect(body.evidenceRef.url).toBe(validUrl);
    expect(body.evidenceRef.evidenceHash).toBe(validHash);
    expect(body.evidenceRef.version).toBeUndefined();

    expect(mockRunsDAO.updateEvidenceRef).toHaveBeenCalledWith(
      validRunId,
      validUrl,
      validHash,
      undefined
    );
  });

  test('returns 404 when run not found', async () => {
    mockRunsDAO.getRun.mockResolvedValue(null);

    const request = new NextRequest('http://localhost/api/afu9/runs/nonexistent/evidence/refresh', {
      method: 'POST',
      body: JSON.stringify({
        url: validUrl,
        evidenceHash: validHash,
      }),
    });

    const response = await evidenceRefresh(request, {
      params: Promise.resolve({ runId: 'nonexistent' }),
    });

    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Run not found');
  });

  test('returns 400 when url is missing', async () => {
    const request = new NextRequest('http://localhost/api/afu9/runs/run-123/evidence/refresh', {
      method: 'POST',
      body: JSON.stringify({
        evidenceHash: validHash,
      }),
    });

    const response = await evidenceRefresh(request, {
      params: Promise.resolve({ runId: validRunId }),
    });

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request body');
  });

  test('returns 400 when evidenceHash is invalid', async () => {
    const request = new NextRequest('http://localhost/api/afu9/runs/run-123/evidence/refresh', {
      method: 'POST',
      body: JSON.stringify({
        url: validUrl,
        evidenceHash: 'tooshort',
      }),
    });

    const response = await evidenceRefresh(request, {
      params: Promise.resolve({ runId: validRunId }),
    });

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request body');
  });

  test('returns 400 when evidenceHash is missing', async () => {
    const request = new NextRequest('http://localhost/api/afu9/runs/run-123/evidence/refresh', {
      method: 'POST',
      body: JSON.stringify({
        url: validUrl,
      }),
    });

    const response = await evidenceRefresh(request, {
      params: Promise.resolve({ runId: validRunId }),
    });

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request body');
  });

  test('logs EVIDENCE_LINKED timeline event when run has issue_id', async () => {
    const { logTimelineEvent } = require('../../src/lib/db/issueTimeline');

    const mockRun = {
      run: {
        id: validRunId,
        issue_id: 'issue-456',
        title: 'Test Run',
        status: 'SUCCEEDED',
        spec_json: { title: 'Test', runtime: 'dummy', steps: [] },
        created_at: new Date('2024-01-01T00:00:00Z'),
      },
      steps: [],
    };

    const mockUpdatedRun = {
      ...mockRun,
      run: {
        ...mockRun.run,
        evidence_url: validUrl,
        evidence_hash: validHash,
        evidence_fetched_at: new Date('2024-01-01T12:00:00Z'),
      },
    };

    mockRunsDAO.getRun.mockResolvedValueOnce(mockRun);
    mockRunsDAO.getRun.mockResolvedValueOnce(mockUpdatedRun);
    mockRunsDAO.updateEvidenceRef.mockResolvedValue(undefined);

    const request = new NextRequest('http://localhost/api/afu9/runs/run-123/evidence/refresh', {
      method: 'POST',
      body: JSON.stringify({
        url: validUrl,
        evidenceHash: validHash,
      }),
    });

    await evidenceRefresh(request, {
      params: Promise.resolve({ runId: validRunId }),
    });

    expect(logTimelineEvent).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({
        issue_id: 'issue-456',
        event_type: 'EVIDENCE_LINKED',
        event_data: expect.objectContaining({
          runId: validRunId,
          evidenceHash: validHash,
          evidenceUrl: validUrl,
        }),
      })
    );
  });

  test('does not log timeline event when run has no issue_id', async () => {
    const { logTimelineEvent } = require('../../src/lib/db/issueTimeline');

    const mockRun = {
      run: {
        id: validRunId,
        issue_id: null,
        title: 'Test Run',
        status: 'SUCCEEDED',
        spec_json: { title: 'Test', runtime: 'dummy', steps: [] },
        created_at: new Date('2024-01-01T00:00:00Z'),
      },
      steps: [],
    };

    const mockUpdatedRun = {
      ...mockRun,
      run: {
        ...mockRun.run,
        evidence_url: validUrl,
        evidence_hash: validHash,
        evidence_fetched_at: new Date('2024-01-01T12:00:00Z'),
      },
    };

    mockRunsDAO.getRun.mockResolvedValueOnce(mockRun);
    mockRunsDAO.getRun.mockResolvedValueOnce(mockUpdatedRun);
    mockRunsDAO.updateEvidenceRef.mockResolvedValue(undefined);

    const request = new NextRequest('http://localhost/api/afu9/runs/run-123/evidence/refresh', {
      method: 'POST',
      body: JSON.stringify({
        url: validUrl,
        evidenceHash: validHash,
      }),
    });

    await evidenceRefresh(request, {
      params: Promise.resolve({ runId: validRunId }),
    });

    expect(logTimelineEvent).not.toHaveBeenCalled();
  });
});
