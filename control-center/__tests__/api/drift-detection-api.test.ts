/**
 * Integration Tests: Drift Detection API
 * E85.4: Drift Detection + Repair Suggestions
 */

import { NextRequest } from 'next/server';
import { GET as detectDrift } from '../../app/api/drift/detect/[issueId]/route';
import { GET as getAudit } from '../../app/api/drift/audit/[issueId]/route';

// Mock dependencies
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({})),
}));

jest.mock('../../src/lib/github', () => ({
  getOctokit: jest.fn(() => ({
    rest: {
      issues: {
        get: jest.fn(),
      },
      pulls: {
        get: jest.fn(),
        listReviews: jest.fn(),
      },
      checks: {
        listForRef: jest.fn(),
      },
    },
  })),
}));

jest.mock('../../src/lib/db/afu9Issues');
jest.mock('../../src/lib/db/driftDetection');

describe('Drift Detection API', () => {
  describe('GET /api/drift/detect/:issueId', () => {
    it('should return 404 when issue not found', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: false,
        error: 'Issue not found',
      });

      const request = new NextRequest('http://localhost/api/drift/detect/test-id');
      const response = await detectDrift(request, { params: { issueId: 'test-id' } });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Issue not found');
    });

    it('should return 400 when issue has no GitHub metadata', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'test-id',
          status: 'CREATED',
          // No GitHub metadata
        },
      });

      const request = new NextRequest('http://localhost/api/drift/detect/test-id');
      const response = await detectDrift(request, { params: { issueId: 'test-id' } });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain('does not have GitHub metadata');
    });

    it('should detect drift and return results', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      const { saveDriftDetection } = require('../../src/lib/db/driftDetection');
      
      // Reset mocks
      jest.clearAllMocks();

      // Create mock octokit
      const mockOctokit = {
        rest: {
          issues: {
            get: jest.fn().mockResolvedValue({
              data: {
                number: 123,
                state: 'closed',
                labels: [{ name: 'status:merge-ready' }],
                updated_at: '2025-01-01T00:00:00Z',
                pull_request: {
                  url: 'https://api.github.com/repos/owner/repo/pulls/123',
                },
              },
            }),
          },
          pulls: {
            get: jest.fn().mockResolvedValue({
              data: {
                number: 123,
                state: 'closed',
                merged: true,
                head: { sha: 'abc123' },
              },
            }),
            listReviews: jest.fn().mockResolvedValue({ data: [] }),
          },
          checks: {
            listForRef: jest.fn().mockResolvedValue({
              data: { total_count: 0, check_runs: [] },
            }),
          },
        },
      };

      // Mock getOctokit
      const { getOctokit } = require('../../src/lib/github');
      getOctokit.mockReturnValue(mockOctokit);

      // Mock AFU-9 issue
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'test-id',
          status: 'MERGE_READY',
          github_owner: 'owner',
          github_repo: 'repo',
          github_issue_number: 123,
        },
      });

      // Mock save
      saveDriftDetection.mockResolvedValue({
        success: true,
        data: 'detection-id',
      });

      const request = new NextRequest('http://localhost/api/drift/detect/test-id');
      const response = await detectDrift(request, { params: { issueId: 'test-id' } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.drift_detected).toBe(true);
      expect(body.data.issue_id).toBe('test-id');
    });

    it('should support dry_run mode', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      const { saveDriftDetection } = require('../../src/lib/db/driftDetection');

      jest.clearAllMocks();

      // Create mock octokit
      const mockOctokit = {
        rest: {
          issues: {
            get: jest.fn().mockResolvedValue({
              data: {
                number: 123,
                state: 'closed',
                labels: [{ name: 'status:done' }],
                updated_at: '2025-01-01T00:00:00Z',
              },
            }),
          },
          pulls: {
            get: jest.fn(),
            listReviews: jest.fn(),
          },
          checks: {
            listForRef: jest.fn(),
          },
        },
      };

      const { getOctokit } = require('../../src/lib/github');
      getOctokit.mockReturnValue(mockOctokit);

      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: {
          id: 'test-id',
          status: 'DONE',
          github_owner: 'owner',
          github_repo: 'repo',
          github_issue_number: 123,
        },
      });

      saveDriftDetection.mockClear();

      const request = new NextRequest('http://localhost/api/drift/detect/test-id?dry_run=true');
      const response = await detectDrift(request, { params: { issueId: 'test-id' } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.dry_run).toBe(true);
      
      // Verify no database save in dry-run mode
      expect(saveDriftDetection).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/drift/audit/:issueId', () => {
    it('should return audit trail for issue', async () => {
      const { getDriftAuditTrail } = require('../../src/lib/db/driftDetection');

      getDriftAuditTrail.mockResolvedValue({
        success: true,
        data: {
          detections: [
            {
              id: 'detection-1',
              issue_id: 'test-id',
              drift_detected: true,
              detected_at: '2025-01-01T00:00:00Z',
            },
          ],
          resolutions: [
            {
              id: 'resolution-1',
              drift_detection_id: 'detection-1',
              applied_by: 'user@example.com',
              applied_at: '2025-01-01T01:00:00Z',
            },
          ],
        },
      });

      const request = new NextRequest('http://localhost/api/drift/audit/test-id');
      const response = await getAudit(request, { params: { issueId: 'test-id' } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.detections).toHaveLength(1);
      expect(body.data.resolutions).toHaveLength(1);
    });

    it('should handle database errors gracefully', async () => {
      const { getDriftAuditTrail } = require('../../src/lib/db/driftDetection');

      getDriftAuditTrail.mockResolvedValue({
        success: false,
        error: 'Database connection error',
      });

      const request = new NextRequest('http://localhost/api/drift/audit/test-id');
      const response = await getAudit(request, { params: { issueId: 'test-id' } });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error).toContain('Database connection error');
    });
  });
});
