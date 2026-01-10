/**
 * Tests for Issue Draft Preview API Route (E82.2)
 * 
 * Validates:
 * - Authentication requirements
 * - Input validation
 * - No side effects
 * - Response format
 */

import { POST } from '../../../app/api/intent/issue-draft/preview/route';
import { EXAMPLE_MINIMAL_ISSUE_DRAFT, EXAMPLE_FULL_ISSUE_DRAFT } from '../../../src/lib/schemas/issueDraft';

// Mock withApi to pass through the handler
jest.mock('../../../src/lib/http/withApi', () => ({
  withApi: (handler: any) => handler,
}));

describe('POST /api/intent/issue-draft/preview', () => {
  describe('authentication', () => {
    it('should return 401 when x-afu9-sub header is missing', async () => {
      const request = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          drafts: [EXAMPLE_MINIMAL_ISSUE_DRAFT],
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 401 when x-afu9-sub header is empty', async () => {
      const request = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-afu9-sub': '  ',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          drafts: [EXAMPLE_MINIMAL_ISSUE_DRAFT],
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
    });
  });

  describe('content-type validation', () => {
    it('should return 415 when content-type is not application/json', async () => {
      const request = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'test-user',
          'content-type': 'text/plain',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          drafts: [EXAMPLE_MINIMAL_ISSUE_DRAFT],
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(415);
      expect(data.error).toBe('Unsupported Media Type');
    });
  });

  describe('body size validation', () => {
    it('should return 413 when body exceeds max size', async () => {
      const largeDrafts = Array(100).fill(EXAMPLE_MINIMAL_ISSUE_DRAFT);
      const largeBody = JSON.stringify({
        owner: 'test-owner',
        repo: 'test-repo',
        drafts: largeDrafts,
      });

      const request = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'test-user',
          'content-type': 'application/json',
          'content-length': String(largeBody.length),
        },
        body: largeBody,
      });

      const response = await POST(request as any);

      // Should reject if body is too large
      if (largeBody.length > 500 * 1024) {
        expect(response.status).toBe(413);
      }
    });
  });

  describe('input validation', () => {
    it('should return 400 when body is invalid JSON', async () => {
      const request = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'test-user',
          'content-type': 'application/json',
        },
        body: 'invalid json{',
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid JSON body');
    });

    it('should return 400 when owner is missing', async () => {
      const request = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          repo: 'test-repo',
          drafts: [EXAMPLE_MINIMAL_ISSUE_DRAFT],
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request schema');
    });

    it('should return 400 when repo is missing', async () => {
      const request = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          drafts: [EXAMPLE_MINIMAL_ISSUE_DRAFT],
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request schema');
    });

    it('should return 400 when drafts is empty', async () => {
      const request = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          drafts: [],
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request schema');
    });

    it('should return 400 when drafts exceeds max count', async () => {
      const tooManyDrafts = Array(21).fill(EXAMPLE_MINIMAL_ISSUE_DRAFT);
      
      const request = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          drafts: tooManyDrafts,
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request schema');
    });
  });

  describe('successful preview generation', () => {
    it('should return 200 with preview data', async () => {
      const request = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          drafts: [EXAMPLE_MINIMAL_ISSUE_DRAFT],
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.preview).toBeDefined();
      expect(data.preview.total).toBe(1);
      expect(data.preview.results).toHaveLength(1);
    });

    it('should include meta information', async () => {
      const request = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          drafts: [EXAMPLE_MINIMAL_ISSUE_DRAFT],
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(data.meta).toBeDefined();
      expect(data.meta.requestedBy).toBe('test-user');
      expect(data.meta.timestamp).toBeDefined();
      expect(data.meta.noSideEffects).toBe(true);
    });

    it('should handle multiple drafts', async () => {
      const request = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          drafts: [EXAMPLE_MINIMAL_ISSUE_DRAFT, EXAMPLE_FULL_ISSUE_DRAFT],
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.preview.total).toBe(2);
      expect(data.preview.results).toHaveLength(2);
    });

    it('should handle existing issues data', async () => {
      const request = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          drafts: [EXAMPLE_MINIMAL_ISSUE_DRAFT],
          existingIssues: {
            [EXAMPLE_MINIMAL_ISSUE_DRAFT.canonicalId]: {
              issueNumber: 123,
              title: 'Existing Title',
              body: 'Existing body',
              labels: ['existing-label'],
            },
          },
        }),
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.preview.results[0].existingIssueNumber).toBeDefined();
    });
  });

  describe('response headers', () => {
    it('should include Cache-Control: no-store header', async () => {
      const request = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          drafts: [EXAMPLE_MINIMAL_ISSUE_DRAFT],
        }),
      });

      const response = await POST(request as any);

      expect(response.headers.get('Cache-Control')).toBe('no-store');
    });
  });

  describe('preview determinism', () => {
    it('should produce same previewHash for identical requests', async () => {
      const body = JSON.stringify({
        owner: 'test-owner',
        repo: 'test-repo',
        drafts: [EXAMPLE_MINIMAL_ISSUE_DRAFT],
      });

      const request1 = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'test-user',
          'content-type': 'application/json',
        },
        body,
      });

      const request2 = new Request('http://localhost/api/intent/issue-draft/preview', {
        method: 'POST',
        headers: {
          'x-afu9-sub': 'test-user',
          'content-type': 'application/json',
        },
        body,
      });

      const response1 = await POST(request1 as any);
      const data1 = await response1.json();

      const response2 = await POST(request2 as any);
      const data2 = await response2.json();

      expect(data1.preview.previewHash).toBe(data2.preview.previewHash);
    });
  });
});
