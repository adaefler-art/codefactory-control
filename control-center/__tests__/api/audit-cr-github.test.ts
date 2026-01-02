/**
 * Tests for GET /api/audit/cr-github
 * 
 * Validates:
 * 1. Authentication and authorization
 * 2. Query by canonical ID
 * 3. Query by owner/repo/issue
 * 4. Cursor-based pagination
 * 5. Repo allowlist enforcement
 * 6. Error handling
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/audit/cr-github/route';
import * as crGithubIssueAudit from '../../src/lib/db/crGithubIssueAudit';
import * as authWrapper from '../../src/lib/github/auth-wrapper';

// Mock dependencies
jest.mock('../../src/lib/db/crGithubIssueAudit');
jest.mock('../../src/lib/github/auth-wrapper');
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({})),
}));

const mockQueryCrGithubIssueAuditWithCursor = crGithubIssueAudit.queryCrGithubIssueAuditWithCursor as jest.MockedFunction<
  typeof crGithubIssueAudit.queryCrGithubIssueAuditWithCursor
>;
const mockQueryByIssueWithCursor = crGithubIssueAudit.queryByIssueWithCursor as jest.MockedFunction<
  typeof crGithubIssueAudit.queryByIssueWithCursor
>;
const mockIsRepoAllowed = authWrapper.isRepoAllowed as jest.MockedFunction<
  typeof authWrapper.isRepoAllowed
>;

describe('GET /api/audit/cr-github', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: allow all repos (can be overridden per test)
    mockIsRepoAllowed.mockReturnValue(true);
  });
  
  // ========================================
  // A) Authentication Tests
  // ========================================
  
  describe('Authentication', () => {
    test('returns 401 when x-afu9-sub header is missing', async () => {
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?canonicalId=CR-TEST'
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('Unauthorized');
      expect(body.details).toContain('Authentication required');
    });
    
    test('succeeds with valid x-afu9-sub header', async () => {
      mockQueryCrGithubIssueAuditWithCursor.mockResolvedValue({
        success: true,
        data: [],
      });
      
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?canonicalId=CR-TEST',
        {
          headers: {
            'x-afu9-sub': 'user-123',
          },
        }
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(200);
    });
  });
  
  // ========================================
  // B) Authorization (Repo Allowlist) Tests
  // ========================================
  
  describe('Repo allowlist enforcement', () => {
    test('returns 403 when querying non-allowed repo directly', async () => {
      mockIsRepoAllowed.mockReturnValue(false);
      
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?owner=forbidden&repo=repo&issueNumber=1',
        {
          headers: {
            'x-afu9-sub': 'user-123',
          },
        }
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('Access denied');
      expect(body.details).toContain('not in the allowlist');
    });
    
    test('filters out non-allowed repos when querying by canonical ID', async () => {
      // Mock: return mixed allowed/disallowed repos
      const mockRecords = [
        {
          id: 'audit-1',
          canonical_id: 'CR-TEST',
          session_id: null,
          cr_version_id: null,
          cr_hash: 'hash1',
          lawbook_version: null,
          owner: 'allowed-org',
          repo: 'allowed-repo',
          issue_number: 1,
          action: 'create' as const,
          rendered_issue_hash: 'hash2',
          used_sources_hash: null,
          created_at: '2026-01-02T10:00:00Z',
          result_json: { url: 'https://github.com/...', labelsApplied: [] },
        },
        {
          id: 'audit-2',
          canonical_id: 'CR-TEST',
          session_id: null,
          cr_version_id: null,
          cr_hash: 'hash3',
          lawbook_version: null,
          owner: 'forbidden-org',
          repo: 'forbidden-repo',
          issue_number: 2,
          action: 'create' as const,
          rendered_issue_hash: 'hash4',
          used_sources_hash: null,
          created_at: '2026-01-02T09:00:00Z',
          result_json: { url: 'https://github.com/...', labelsApplied: [] },
        },
      ];
      
      mockQueryCrGithubIssueAuditWithCursor.mockResolvedValue({
        success: true,
        data: mockRecords,
      });
      
      // Mock allowlist check: only allow first repo
      mockIsRepoAllowed.mockImplementation((owner, repo) => 
        owner === 'allowed-org' && repo === 'allowed-repo'
      );
      
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?canonicalId=CR-TEST',
        {
          headers: {
            'x-afu9-sub': 'user-123',
          },
        }
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].owner).toBe('allowed-org');
    });
  });
  
  // ========================================
  // C) Query by Canonical ID
  // ========================================
  
  describe('Query by canonical ID', () => {
    test('returns audit records for valid canonical ID', async () => {
      const mockRecords = [
        {
          id: 'audit-1',
          canonical_id: 'CR-2026-01-02-001',
          session_id: 'session-123',
          cr_version_id: 'version-456',
          cr_hash: 'abc123',
          lawbook_version: '0.7.0',
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          issue_number: 742,
          action: 'create' as const,
          rendered_issue_hash: 'def456',
          used_sources_hash: 'ghi789',
          created_at: '2026-01-02T10:00:00Z',
          result_json: { url: 'https://github.com/...', labelsApplied: ['afu9'] },
        },
      ];
      
      mockQueryCrGithubIssueAuditWithCursor.mockResolvedValue({
        success: true,
        data: mockRecords,
      });
      
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?canonicalId=CR-2026-01-02-001',
        {
          headers: {
            'x-afu9-sub': 'user-123',
          },
        }
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].canonical_id).toBe('CR-2026-01-02-001');
      expect(body.pagination).toMatchObject({
        limit: 50,
        count: 1,
        hasMore: false,
      });
      
      expect(mockQueryCrGithubIssueAudit).toHaveBeenCalledWith(
        expect.anything(),
        'CR-2026-01-02-001',
        { limit: 50, offset: 0 }
      );
    });
    
    test('supports custom pagination parameters', async () => {
      mockQueryCrGithubIssueAudit.mockResolvedValue({
        success: true,
        data: [],
      });
      
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?canonicalId=CR-TEST&limit=10&offset=20'
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pagination).toEqual({
        limit: 10,
        offset: 20,
        count: 0,
      });
      
      expect(mockQueryCrGithubIssueAudit).toHaveBeenCalledWith(
        expect.anything(),
        'CR-TEST',
        { limit: 10, offset: 20 }
      );
    });
    
    test('enforces max limit of 100', async () => {
      mockQueryCrGithubIssueAudit.mockResolvedValue({
        success: true,
        data: [],
      });
      
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?canonicalId=CR-TEST&limit=200'
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pagination.limit).toBe(100); // Capped at max
      
      expect(mockQueryCrGithubIssueAudit).toHaveBeenCalledWith(
        expect.anything(),
        'CR-TEST',
        { limit: 100, offset: 0 }
      );
    });
  });
  
  // ========================================
  // B) Query by Owner/Repo/Issue
  // ========================================
  
  describe('Query by owner/repo/issue', () => {
    test('returns audit records for valid issue coordinates', async () => {
      const mockRecords = [
        {
          id: 'audit-1',
          canonical_id: 'CR-2026-01-02-001',
          session_id: null,
          cr_version_id: null,
          cr_hash: 'abc123',
          lawbook_version: null,
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          issue_number: 742,
          action: 'create' as const,
          rendered_issue_hash: 'def456',
          used_sources_hash: null,
          created_at: '2026-01-02T10:00:00Z',
          result_json: { url: 'https://github.com/...', labelsApplied: [] },
        },
      ];
      
      mockQueryByIssue.mockResolvedValue({
        success: true,
        data: mockRecords,
      });
      
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?owner=adaefler-art&repo=codefactory-control&issueNumber=742'
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].owner).toBe('adaefler-art');
      expect(body.data[0].repo).toBe('codefactory-control');
      expect(body.data[0].issue_number).toBe(742);
      
      expect(mockQueryByIssue).toHaveBeenCalledWith(
        expect.anything(),
        'adaefler-art',
        'codefactory-control',
        742,
        { limit: 50, offset: 0 }
      );
    });
    
    test('supports pagination for issue query', async () => {
      mockQueryByIssue.mockResolvedValue({
        success: true,
        data: [],
      });
      
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?owner=test&repo=test&issueNumber=1&limit=25&offset=50'
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(200);
      expect(mockQueryByIssue).toHaveBeenCalledWith(
        expect.anything(),
        'test',
        'test',
        1,
        { limit: 25, offset: 50 }
      );
    });
  });
  
  // ========================================
  // C) Error Handling
  // ========================================
  
  describe('Error handling', () => {
    test('returns 400 when no query parameters provided', async () => {
      const req = new NextRequest('http://localhost/api/audit/cr-github');
      
      const res = await GET(req);
      
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Missing required query parameters');
      expect(body.details).toContain('canonicalId OR (owner + repo + issueNumber)');
    });
    
    test('returns 400 when only owner provided (missing repo and issueNumber)', async () => {
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?owner=test'
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Missing required query parameters');
    });
    
    test('returns 400 when only owner and repo provided (missing issueNumber)', async () => {
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?owner=test&repo=test'
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(400);
    });
    
    test('returns 400 for invalid limit (< 1)', async () => {
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?canonicalId=CR-TEST&limit=0'
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid limit parameter');
    });
    
    test('returns 400 for invalid offset (< 0)', async () => {
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?canonicalId=CR-TEST&offset=-1'
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid offset parameter');
    });
    
    test('returns 500 when database query fails', async () => {
      mockQueryCrGithubIssueAudit.mockResolvedValue({
        success: false,
        error: 'Database connection failed',
      });
      
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?canonicalId=CR-TEST'
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('Failed to query audit trail');
      expect(body.details).toContain('Database connection failed');
    });
    
    test('returns 500 when unexpected error occurs', async () => {
      mockQueryCrGithubIssueAudit.mockRejectedValue(new Error('Unexpected error'));
      
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?canonicalId=CR-TEST'
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('Failed to query audit trail');
    });
  });
  
  // ========================================
  // D) Integration Scenarios
  // ========================================
  
  describe('Integration scenarios', () => {
    test('returns empty array when no audit records exist', async () => {
      mockQueryCrGithubIssueAudit.mockResolvedValue({
        success: true,
        data: [],
      });
      
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?canonicalId=CR-NONEXISTENT'
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
      expect(body.pagination.count).toBe(0);
    });
    
    test('handles multiple audit records in chronological order', async () => {
      const mockRecords = [
        {
          id: 'audit-2',
          canonical_id: 'CR-2026-01-02-001',
          session_id: 'session-123',
          cr_version_id: null,
          cr_hash: 'xyz789',
          lawbook_version: '0.7.0',
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          issue_number: 742,
          action: 'update' as const,
          rendered_issue_hash: 'jkl012',
          used_sources_hash: 'mno345',
          created_at: '2026-01-02T11:00:00Z',
          result_json: { url: 'https://github.com/...', labelsApplied: ['updated'] },
        },
        {
          id: 'audit-1',
          canonical_id: 'CR-2026-01-02-001',
          session_id: 'session-123',
          cr_version_id: null,
          cr_hash: 'abc123',
          lawbook_version: '0.7.0',
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          issue_number: 742,
          action: 'create' as const,
          rendered_issue_hash: 'def456',
          used_sources_hash: 'ghi789',
          created_at: '2026-01-02T10:00:00Z',
          result_json: { url: 'https://github.com/...', labelsApplied: ['afu9'] },
        },
      ];
      
      mockQueryCrGithubIssueAudit.mockResolvedValue({
        success: true,
        data: mockRecords,
      });
      
      const req = new NextRequest(
        'http://localhost/api/audit/cr-github?canonicalId=CR-2026-01-02-001'
      );
      
      const res = await GET(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(2);
      expect(body.data[0].action).toBe('update'); // Most recent first
      expect(body.data[1].action).toBe('create'); // Original creation
    });
  });
});
