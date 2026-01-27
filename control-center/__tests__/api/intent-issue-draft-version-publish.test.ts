/**
 * Tests for IssueDraft Version Publish API Route (E89.6)
 * 
 * Tests guard order: 401 → 409 → 403 → 404/400/500
 */

import { POST } from '@/api/intent/sessions/[id]/issue-draft/versions/publish/route';
import { NextRequest } from 'next/server';

// Mock dependencies
jest.mock('@/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('@/lib/github/issue-draft-version-publisher', () => ({
  publishIssueDraftVersionBatch: jest.fn(),
}));

jest.mock('@/lib/utils/deployment-env', () => ({
  getDeploymentEnv: jest.fn(() => 'development'),
}));

describe('POST /api/intent/sessions/[id]/issue-draft/versions/publish', () => {
  const mockContext = {
    params: Promise.resolve({ id: 'test-session-id' }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment variables
    process.env.ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED = 'true';
    delete process.env.AFU9_ADMIN_SUBS;
    process.env.ENVIRONMENT = 'development';
    const { getDeploymentEnv } = require('@/lib/utils/deployment-env');
    getDeploymentEnv.mockReturnValue('development');
  });

  afterEach(() => {
    delete process.env.ENVIRONMENT;
  });

  describe('Guard 1: Authentication (401)', () => {
    it('should return 401 when x-afu9-sub header is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/intent/sessions/test/issue-draft/versions/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          version_id: 'version-123',
        }),
      });

      const response = await POST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 when x-afu9-sub header is empty', async () => {
      const request = new NextRequest('http://localhost:3000/api/intent/sessions/test/issue-draft/versions/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-afu9-sub': '',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          version_id: 'version-123',
        }),
      });

      const response = await POST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Guard 2: Production block (409)', () => {
    beforeEach(() => {
      process.env.ENVIRONMENT = 'production';
    });

    afterEach(() => {
      process.env.ENVIRONMENT = 'development';
    });

    it('should return 409 in production when publishing not enabled', async () => {
      const { getDeploymentEnv } = require('@/lib/utils/deployment-env');
      getDeploymentEnv.mockReturnValue('production');
      delete process.env.ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED;
      
      const request = new NextRequest('http://localhost:3000/api/intent/sessions/test/issue-draft/versions/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-afu9-sub': 'user-123',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          version_id: 'version-123',
        }),
      });

      const response = await POST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.code).toBe('PUBLISHING_DISABLED');
    });

    it('should allow publishing in production when enabled', async () => {
      const { getDeploymentEnv } = require('@/lib/utils/deployment-env');
      getDeploymentEnv.mockReturnValue('production');
      process.env.ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED = 'true';
      process.env.AFU9_ADMIN_SUBS = 'user-123';
      
      const { publishIssueDraftVersionBatch } = require('@/lib/github/issue-draft-version-publisher');
      publishIssueDraftVersionBatch.mockResolvedValue({
        success: true,
        data: {
          batch_id: 'batch-123',
          summary: { total: 1, created: 1, updated: 0, skipped: 0, failed: 0 },
          items: [],
          links: { batch_id: 'batch-123', request_id: 'req-123' },
        },
      });
      
      const request = new NextRequest('http://localhost:3000/api/intent/sessions/test/issue-draft/versions/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-afu9-sub': 'user-123',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          version_id: 'version-123',
        }),
      });

      const response = await POST(request, mockContext);

      expect(response.status).toBe(200);
    });
  });

  describe('Guard 3: Admin check (403)', () => {
    it('should return 403 when AFU9_ADMIN_SUBS is not configured', async () => {
      const request = new NextRequest('http://localhost:3000/api/intent/sessions/test/issue-draft/versions/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-afu9-sub': 'user-123',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          version_id: 'version-123',
        }),
      });

      const response = await POST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.code).toBe('FORBIDDEN');
    });

    it('should return 403 when user is not in admin allowlist', async () => {
      process.env.AFU9_ADMIN_SUBS = 'admin-user-1,admin-user-2';
      
      const request = new NextRequest('http://localhost:3000/api/intent/sessions/test/issue-draft/versions/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-afu9-sub': 'user-123',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          version_id: 'version-123',
        }),
      });

      const response = await POST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.code).toBe('FORBIDDEN');
    });

    it('should allow access when user is in admin allowlist', async () => {
      process.env.AFU9_ADMIN_SUBS = 'admin-user-1,user-123,admin-user-2';
      
      const { publishIssueDraftVersionBatch } = require('@/lib/github/issue-draft-version-publisher');
      publishIssueDraftVersionBatch.mockResolvedValue({
        success: true,
        data: {
          batch_id: 'batch-123',
          summary: { total: 1, created: 1, updated: 0, skipped: 0, failed: 0 },
          items: [],
          links: { batch_id: 'batch-123', request_id: 'req-123' },
        },
      });
      
      const request = new NextRequest('http://localhost:3000/api/intent/sessions/test/issue-draft/versions/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-afu9-sub': 'user-123',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          version_id: 'version-123',
        }),
      });

      const response = await POST(request, mockContext);

      expect(response.status).toBe(200);
    });
  });

  describe('Request validation (400)', () => {
    beforeEach(() => {
      process.env.AFU9_ADMIN_SUBS = 'user-123';
    });

    it('should return 400 when body is not valid JSON', async () => {
      const request = new NextRequest('http://localhost:3000/api/intent/sessions/test/issue-draft/versions/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-afu9-sub': 'user-123',
        },
        body: 'invalid json',
      });

      const response = await POST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(400);
    });

    it('should return 400 when owner is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/intent/sessions/test/issue-draft/versions/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-afu9-sub': 'user-123',
        },
        body: JSON.stringify({
          repo: 'test-repo',
          version_id: 'version-123',
        }),
      });

      const response = await POST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.details).toContain('owner');
    });

    it('should return 400 when repo is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/intent/sessions/test/issue-draft/versions/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-afu9-sub': 'user-123',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          version_id: 'version-123',
        }),
      });

      const response = await POST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.details).toContain('repo');
    });

    it('should return 400 when both version_id and issue_set_id are missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/intent/sessions/test/issue-draft/versions/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-afu9-sub': 'user-123',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
        }),
      });

      const response = await POST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.details).toContain('version_id');
    });

    it('should return 400 when owner format is invalid', async () => {
      const request = new NextRequest('http://localhost:3000/api/intent/sessions/test/issue-draft/versions/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-afu9-sub': 'user-123',
        },
        body: JSON.stringify({
          owner: 'invalid@owner',
          repo: 'test-repo',
          version_id: 'version-123',
        }),
      });

      const response = await POST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('format');
    });
  });

  describe('Success response (200)', () => {
    beforeEach(() => {
      process.env.AFU9_ADMIN_SUBS = 'user-123';
    });

    it('should return 200 with batch result on success', async () => {
      const { publishIssueDraftVersionBatch } = require('@/lib/github/issue-draft-version-publisher');
      publishIssueDraftVersionBatch.mockResolvedValue({
        success: true,
        data: {
          batch_id: 'batch-123',
          summary: {
            total: 2,
            created: 1,
            updated: 1,
            skipped: 0,
            failed: 0,
          },
          items: [
            {
              canonical_id: 'E89.1',
              action: 'created',
              status: 'success',
              github_issue_number: 100,
              github_issue_url: 'https://github.com/test/repo/issues/100',
            },
            {
              canonical_id: 'E89.2',
              action: 'updated',
              status: 'success',
              github_issue_number: 101,
              github_issue_url: 'https://github.com/test/repo/issues/101',
            },
          ],
          links: {
            batch_id: 'batch-123',
            request_id: 'req-123',
          },
        },
      });
      
      const request = new NextRequest('http://localhost:3000/api/intent/sessions/test/issue-draft/versions/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-afu9-sub': 'user-123',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          version_id: 'version-123',
        }),
      });

      const response = await POST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.batch_id).toBe('batch-123');
      expect(data.summary.total).toBe(2);
      expect(data.items).toHaveLength(2);
    });

    it('should include warnings when batch is clamped', async () => {
      const { publishIssueDraftVersionBatch } = require('@/lib/github/issue-draft-version-publisher');
      publishIssueDraftVersionBatch.mockResolvedValue({
        success: true,
        data: {
          batch_id: 'batch-123',
          summary: { total: 25, created: 25, updated: 0, skipped: 0, failed: 0 },
          items: [],
          links: { batch_id: 'batch-123', request_id: 'req-123' },
          warnings: ['Batch size clamped from 30 to 25 issues.'],
        },
      });
      
      const request = new NextRequest('http://localhost:3000/api/intent/sessions/test/issue-draft/versions/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-afu9-sub': 'user-123',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          issue_set_id: 'set-123',
        }),
      });

      const response = await POST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.warnings).toBeDefined();
      expect(data.warnings).toHaveLength(1);
    });
  });
});
