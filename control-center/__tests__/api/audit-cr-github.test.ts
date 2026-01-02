/**
 * Tests for GET /api/audit/cr-github
 * 
 * Validates:
 * 1. Query by canonical ID
 * 2. Query by owner/repo/issue
 * 3. Pagination parameters
 * 4. Error handling for missing/invalid parameters
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/audit/cr-github/route';
import * as crGithubIssueAudit from '../../src/lib/db/crGithubIssueAudit';

// Mock dependencies
jest.mock('../../src/lib/db/crGithubIssueAudit');
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({})),
}));

const mockQueryCrGithubIssueAudit = crGithubIssueAudit.queryCrGithubIssueAudit as jest.MockedFunction<
  typeof crGithubIssueAudit.queryCrGithubIssueAudit
>;
const mockQueryByIssue = crGithubIssueAudit.queryByIssue as jest.MockedFunction<
  typeof crGithubIssueAudit.queryByIssue
>;

describe('GET /api/audit/cr-github', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  // ========================================
  // A) Query by Canonical ID
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
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].canonical_id).toBe('CR-2026-01-02-001');
      expect(body.pagination).toEqual({
        limit: 50,
        offset: 0,
        count: 1,
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
