/**
 * Tests for E72.3: AFU-9 Run Ingestion API Route
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// Define error classes for testing
class RunNotFoundError extends Error {
  code = 'RUN_NOT_FOUND';
  details: any;
  constructor(runId: string) {
    super(`Run not found: ${runId}`);
    this.details = { runId };
  }
}

class AFU9IngestionError extends Error {
  code: string;
  details: any;
  constructor(message: string, code: string, details: any = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// Mock the ingestRun module before importing the route
const mockIngestRun = jest.fn();

jest.mock('@/lib/afu9-ingestion', () => ({
  ingestRun: mockIngestRun,
}));

jest.mock('@/lib/afu9-ingestion/types', () => ({
  RunNotFoundError,
  AFU9IngestionError,
}));

// Mock the database pool
const mockGetPool = jest.fn();
jest.mock('@/lib/db', () => ({
  getPool: mockGetPool,
}));

describe('E72.3: AFU-9 Run Ingestion API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPool.mockReturnValue({} as any); // Mock pool object
  });

  const getRoute = () => {
    return require('../../app/api/integrations/afu9/ingest/run/route').POST;
  };

  describe('POST /api/integrations/afu9/ingest/run - Success', () => {
    it('should ingest a run successfully', async () => {
      const mockResult = {
        nodeId: 'node-uuid-run',
        naturalKey: 'afu9:run:run:test-run-123',
        isNew: true,
        source_system: 'afu9',
        source_type: 'run',
        source_id: 'run:test-run-123',
        runId: 'test-run-123',
        stepNodeIds: ['node-uuid-step-1', 'node-uuid-step-2'],
        artifactNodeIds: ['node-uuid-artifact-1'],
        edgeIds: ['edge-uuid-1', 'edge-uuid-2', 'edge-uuid-3'],
      };

      mockIngestRun.mockResolvedValue(mockResult);

      const request = new NextRequest('http://localhost:3000/api/integrations/afu9/ingest/run', {
        method: 'POST',
        body: JSON.stringify({
          runId: 'test-run-123',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.data).toMatchObject({
        nodesUpserted: 4, // 1 run + 2 steps + 1 artifact
        edgesUpserted: 3, // 3 edges
        sourceRefs: 4, // 1 run + 2 steps + 1 artifact
        nodeId: 'node-uuid-run',
        naturalKey: 'afu9:run:run:test-run-123',
        isNew: true,
        runId: 'test-run-123',
      });
      expect(data.data.ingestedAt).toBeDefined();
      expect(data.data.stepNodeIds).toHaveLength(2);
      expect(data.data.artifactNodeIds).toHaveLength(1);
      expect(data.data.edgeIds).toHaveLength(3);

      // Verify ingestRun was called with correct params
      expect(mockIngestRun).toHaveBeenCalledWith(
        { runId: 'test-run-123' },
        expect.anything()
      );
    });

    it('should handle existing run (isNew: false) - idempotency test', async () => {
      const mockResult = {
        nodeId: 'node-uuid-run-existing',
        naturalKey: 'afu9:run:run:existing-run',
        isNew: false,
        source_system: 'afu9',
        source_type: 'run',
        source_id: 'run:existing-run',
        runId: 'existing-run',
        stepNodeIds: ['node-uuid-step-1'],
        artifactNodeIds: [],
        edgeIds: ['edge-uuid-1'],
      };

      mockIngestRun.mockResolvedValue(mockResult);

      const request = new NextRequest('http://localhost:3000/api/integrations/afu9/ingest/run', {
        method: 'POST',
        body: JSON.stringify({
          runId: 'existing-run',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.data.isNew).toBe(false);
      expect(data.data.nodeId).toBe('node-uuid-run-existing');
      expect(data.data.nodesUpserted).toBe(2); // 1 run + 1 step
      expect(data.data.edgesUpserted).toBe(1); // 1 edge
    });

    it('should handle run with no steps or artifacts', async () => {
      const mockResult = {
        nodeId: 'node-uuid-run-minimal',
        naturalKey: 'afu9:run:run:minimal-run',
        isNew: true,
        source_system: 'afu9',
        source_type: 'run',
        source_id: 'run:minimal-run',
        runId: 'minimal-run',
        stepNodeIds: [],
        artifactNodeIds: [],
        edgeIds: [],
      };

      mockIngestRun.mockResolvedValue(mockResult);

      const request = new NextRequest('http://localhost:3000/api/integrations/afu9/ingest/run', {
        method: 'POST',
        body: JSON.stringify({
          runId: 'minimal-run',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.data.nodesUpserted).toBe(1); // Only the run node
      expect(data.data.edgesUpserted).toBe(0); // No edges
      expect(data.data.sourceRefs).toBe(1); // Only run source
    });
  });

  describe('POST /api/integrations/afu9/ingest/run - Validation Errors', () => {
    it('should return 400 for missing runId', async () => {
      const request = new NextRequest('http://localhost:3000/api/integrations/afu9/ingest/run', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('INVALID_PARAMS');
      expect(data.error.message).toContain('Invalid request parameters');
    });

    it('should return 400 for empty runId', async () => {
      const request = new NextRequest('http://localhost:3000/api/integrations/afu9/ingest/run', {
        method: 'POST',
        body: JSON.stringify({
          runId: '',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('INVALID_PARAMS');
    });

    it('should return 400 for non-string runId', async () => {
      const request = new NextRequest('http://localhost:3000/api/integrations/afu9/ingest/run', {
        method: 'POST',
        body: JSON.stringify({
          runId: 123,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('INVALID_PARAMS');
    });

    it('should return 400 for extra fields in request body', async () => {
      const request = new NextRequest('http://localhost:3000/api/integrations/afu9/ingest/run', {
        method: 'POST',
        body: JSON.stringify({
          runId: 'test-run',
          extraField: 'should-not-be-here',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('INVALID_PARAMS');
    });
  });

  describe('POST /api/integrations/afu9/ingest/run - Run Not Found', () => {
    it('should return 404 when run does not exist', async () => {
      mockIngestRun.mockRejectedValue(new RunNotFoundError('nonexistent-run'));

      const request = new NextRequest('http://localhost:3000/api/integrations/afu9/ingest/run', {
        method: 'POST',
        body: JSON.stringify({
          runId: 'nonexistent-run',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('RUN_NOT_FOUND');
      expect(data.error.message).toContain('not found');
      expect(data.error.details.runId).toBe('nonexistent-run');
    });
  });

  describe('POST /api/integrations/afu9/ingest/run - Database Errors', () => {
    it('should return 502 for database errors', async () => {
      mockIngestRun.mockRejectedValue(
        new AFU9IngestionError('Database connection failed', 'DB_ERROR', {
          error: 'Connection timeout',
        })
      );

      const request = new NextRequest('http://localhost:3000/api/integrations/afu9/ingest/run', {
        method: 'POST',
        body: JSON.stringify({
          runId: 'test-run',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(502);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('DB_ERROR');
      expect(data.error.message).toContain('Database connection failed');
    });

    it('should return 502 for ingestion failures', async () => {
      mockIngestRun.mockRejectedValue(
        new AFU9IngestionError('Failed to ingest run', 'INGESTION_FAILED', {
          runId: 'test-run',
        })
      );

      const request = new NextRequest('http://localhost:3000/api/integrations/afu9/ingest/run', {
        method: 'POST',
        body: JSON.stringify({
          runId: 'test-run',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(502);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('INGESTION_FAILED');
      expect(data.error.message).toContain('Failed to ingest run');
    });
  });
});
