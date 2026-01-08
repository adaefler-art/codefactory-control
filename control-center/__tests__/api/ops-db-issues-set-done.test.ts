/**
 * Package 3: Tests - Ops DB Issues Set Done API
 * 
 * Purpose: Prove guard ordering (AUTH -> ENV -> ADMIN -> DB)
 * Prove NO DB calls in blocked paths (production/unknown/non-admin)
 */

import { NextRequest } from 'next/server';

// Mock dependencies BEFORE imports
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/utils/deployment-env', () => ({
  getDeploymentEnv: jest.fn(() => 'staging'),
  isProduction: jest.fn(() => false),
}));

import { GET as previewGet } from '../../app/api/ops/db/issues/preview-set-done/route';
import { POST as executePost } from '../../app/api/ops/db/issues/set-done/route';
import { getPool } from '../../src/lib/db';
import { getDeploymentEnv, isProduction } from '../../src/lib/utils/deployment-env';

const mockPool = getPool as jest.MockedFunction<typeof getPool>;
const mockGetDeploymentEnv = getDeploymentEnv as jest.MockedFunction<typeof getDeploymentEnv>;
const mockIsProduction = isProduction as jest.MockedFunction<typeof isProduction>;

describe('Ops DB Issues - Guard Ordering', () => {
  let mockQuery: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery = jest.fn();
    mockPool.mockReturnValue({ query: mockQuery } as any);
    mockGetDeploymentEnv.mockReturnValue('staging');
    mockIsProduction.mockReturnValue(false);
    process.env.AFU9_ADMIN_SUBS = 'admin-sub-123';
  });

  afterEach(() => {
    delete process.env.AFU9_ADMIN_SUBS;
  });

  describe('GUARD 1: AUTH (401-first)', () => {
    it('[PREVIEW] returns 401 when x-afu9-sub header missing - NO DB calls', async () => {
      const request = new NextRequest('http://localhost/api/ops/db/issues/preview-set-done', {
        method: 'GET',
      });
      
      const response = await previewGet(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.code).toBe('MISSING_AUTH');
      expect(mockQuery).not.toHaveBeenCalled(); // NO DB CALLS
    });

    it('[EXECUTE] returns 401 when x-afu9-sub header missing - NO DB calls', async () => {
      const request = new NextRequest('http://localhost/api/ops/db/issues/set-done', {
        method: 'POST',
        body: JSON.stringify({ confirm: 'CONFIRM' }),
      });

      const response = await executePost(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.code).toBe('MISSING_AUTH');
      expect(mockQuery).not.toHaveBeenCalled(); // NO DB CALLS
    });
  });

  describe('GUARD 2: ENV (409 for production/unknown)', () => {
    it('[PREVIEW] returns 409 PROD_DISABLED in production - NO DB calls', async () => {
      mockGetDeploymentEnv.mockReturnValue('production');

      const request = new NextRequest('http://localhost/api/ops/db/issues/preview-set-done', {
        method: 'GET',
        headers: { 'x-afu9-sub': 'admin-sub-123' },
      });

      const response = await previewGet(request);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.code).toBe('PROD_DISABLED');
      expect(data.environment).toBe('production');
      expect(mockQuery).not.toHaveBeenCalled(); // NO DB CALLS
    });

    it('[PREVIEW] returns 409 ENV_DISABLED for unknown environment - NO DB calls', async () => {
      mockGetDeploymentEnv.mockReturnValue('unknown');

      const request = new NextRequest('http://localhost/api/ops/db/issues/preview-set-done', {
        method: 'GET',
        headers: { 'x-afu9-sub': 'admin-sub-123' },
      });

      const response = await previewGet(request);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.code).toBe('ENV_DISABLED');
      expect(data.environment).toBe('unknown');
      expect(mockQuery).not.toHaveBeenCalled(); // NO DB CALLS
    });

    it('[EXECUTE] returns 409 PROD_DISABLED in production - NO DB calls', async () => {
      mockGetDeploymentEnv.mockReturnValue('production');

      const request = new NextRequest('http://localhost/api/ops/db/issues/set-done', {
        method: 'POST',
        headers: { 'x-afu9-sub': 'admin-sub-123' },
        body: JSON.stringify({ confirm: 'CONFIRM' }),
      });

      const response = await executePost(request);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.code).toBe('PROD_DISABLED');
      expect(mockQuery).not.toHaveBeenCalled(); // NO DB CALLS
    });
  });

  describe('GUARD 3: ADMIN (403)', () => {
    it('[PREVIEW] returns 403 when sub not in AFU9_ADMIN_SUBS - NO DB calls', async () => {
      const request = new NextRequest('http://localhost/api/ops/db/issues/preview-set-done', {
        method: 'GET',
        headers: { 'x-afu9-sub': 'non-admin-sub' },
      });

      const response = await previewGet(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.code).toBe('NOT_ADMIN');
      expect(mockQuery).not.toHaveBeenCalled(); // NO DB CALLS
    });

    it('[EXECUTE] returns 403 when sub not in AFU9_ADMIN_SUBS - NO DB calls', async () => {
      const request = new NextRequest('http://localhost/api/ops/db/issues/set-done', {
        method: 'POST',
        headers: { 'x-afu9-sub': 'non-admin-sub' },
        body: JSON.stringify({ confirm: 'CONFIRM' }),
      });

      const response = await executePost(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.code).toBe('NOT_ADMIN');
      expect(mockQuery).not.toHaveBeenCalled(); // NO DB CALLS
    });
  });

  describe('GUARD 4: Validation', () => {
    it('[EXECUTE] returns 400 when confirm is not CONFIRM', async () => {
      const request = new NextRequest('http://localhost/api/ops/db/issues/set-done', {
        method: 'POST',
        headers: { 'x-afu9-sub': 'admin-sub-123' },
        body: JSON.stringify({ confirm: 'wrong' }),
      });

      const response = await executePost(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('VALIDATION_ERROR');
      expect(mockQuery).not.toHaveBeenCalled(); // NO DB CALLS before validation passes
    });

    it('[PREVIEW] returns 400 for invalid range (min > max)', async () => {
      const request = new NextRequest(
        'http://localhost/api/ops/db/issues/preview-set-done?githubIssueMin=100&githubIssueMax=50',
        {
          method: 'GET',
          headers: { 'x-afu9-sub': 'admin-sub-123' },
        }
      );

      const response = await previewGet(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('INVALID_RANGE');
      expect(mockQuery).not.toHaveBeenCalled(); // NO DB CALLS
    });
  });

  describe('Success Cases (after all guards pass)', () => {
    it('[PREVIEW] returns 200 with deterministic ordering', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { status: 'CREATED', count: '5' },
            { status: 'DONE', count: '100' },
            { status: 'SPEC_READY', count: '3' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ affected_count: '8' }],
        })
        .mockResolvedValueOnce({
          rows: [
            { id: 'id-1', github_issue_number: 70, title: 'Issue 70', status: 'CREATED' },
            { id: 'id-2', github_issue_number: 71, title: 'Issue 71', status: 'SPEC_READY' },
          ],
        });

      const request = new NextRequest('http://localhost/api/ops/db/issues/preview-set-done?statuses=CREATED,SPEC_READY', {
        method: 'GET',
        headers: { 'x-afu9-sub': 'admin-sub-123' },
      });

      const response = await previewGet(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.requestId).toBeDefined();
      expect(data.affectedCount).toBe(8);
      expect(data.sampleRows).toHaveLength(2);
      expect(data.sampleRows[0].githubIssueNumber).toBe(70);
      expect(mockQuery).toHaveBeenCalledTimes(3); // DB calls ONLY after all guards pass
    });

    it('[EXECUTE] returns 200 and creates audit record', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { id: 'id-1', github_issue_number: 70, title: 'Issue 70', status: 'DONE' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ total_updated: '1' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'audit-id' }],
        });

      const request = new NextRequest('http://localhost/api/ops/db/issues/set-done', {
        method: 'POST',
        headers: { 'x-afu9-sub': 'admin-sub-123' },
        body: JSON.stringify({ confirm: 'CONFIRM', statuses: ['CREATED'] }),
      });

      const response = await executePost(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.result.updatedCount).toBe(1);
      expect(mockQuery).toHaveBeenCalledTimes(3); // UPDATE + COUNT + AUDIT
      
      // Verify audit insert
      const auditCall = mockQuery.mock.calls[2];
      expect(auditCall[0]).toContain('INSERT INTO ops_admin_actions');
      expect(auditCall[1][2]).toBe('ISSUES_SET_DONE');
    });
  });
});
