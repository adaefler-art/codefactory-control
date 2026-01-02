/**
 * Tests for CR GitHub Issue Audit Trail
 * 
 * Validates:
 * 1. Database insertion with all required fields
 * 2. Query by canonical ID
 * 3. Query by owner/repo/issue
 * 4. Pagination
 * 5. Fail-safe behavior (audit errors don't block operations)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  insertAuditRecord,
  queryCrGithubIssueAudit,
  queryByIssue,
  type InsertAuditRecordInput,
} from '../../../src/lib/db/crGithubIssueAudit';

// Mock pg Pool
jest.mock('pg', () => {
  const mockQuery = jest.fn();
  const MockPool = jest.fn(() => ({
    query: mockQuery,
  }));
  
  return {
    Pool: MockPool,
  };
});

describe('CR GitHub Issue Audit Trail', () => {
  let pool: Pool;
  let mockQuery: jest.Mock;
  
  beforeEach(() => {
    jest.clearAllMocks();
    pool = new Pool();
    mockQuery = pool.query as jest.Mock;
  });
  
  // ========================================
  // A) Insert Audit Record Tests
  // ========================================
  
  describe('insertAuditRecord', () => {
    test('inserts audit record with all required fields', async () => {
      const input: InsertAuditRecordInput = {
        canonical_id: 'CR-2026-01-02-001',
        session_id: 'session-123',
        cr_version_id: 'version-456',
        cr_hash: 'abc123def456',
        lawbook_version: '0.7.0',
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        issue_number: 742,
        action: 'create',
        rendered_issue_hash: 'def456ghi789',
        used_sources_hash: 'ghi789jkl012',
        result_json: {
          url: 'https://github.com/adaefler-art/codefactory-control/issues/742',
          labelsApplied: ['afu9', 'automated'],
        },
      };
      
      mockQuery.mockResolvedValue({
        rows: [{ id: 'audit-uuid-123' }],
      });
      
      const result = await insertAuditRecord(pool, input);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.id).toBe('audit-uuid-123');
      }
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO cr_github_issue_audit'),
        [
          'CR-2026-01-02-001',
          'session-123',
          'version-456',
          'abc123def456',
          '0.7.0',
          'adaefler-art',
          'codefactory-control',
          742,
          'create',
          'def456ghi789',
          'ghi789jkl012',
          expect.stringContaining('"url"'),
        ]
      );
    });
    
    test('inserts audit record with nullable fields as null', async () => {
      const input: InsertAuditRecordInput = {
        canonical_id: 'CR-2026-01-02-002',
        cr_hash: 'abc123',
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 1,
        action: 'update',
        rendered_issue_hash: 'def456',
        result_json: {
          url: 'https://github.com/test-owner/test-repo/issues/1',
          labelsApplied: [],
        },
      };
      
      mockQuery.mockResolvedValue({
        rows: [{ id: 'audit-uuid-456' }],
      });
      
      const result = await insertAuditRecord(pool, input);
      
      expect(result.success).toBe(true);
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          null, // session_id
          null, // cr_version_id
          null, // lawbook_version
          null, // used_sources_hash
        ])
      );
    });
    
    test('returns error on database failure (fail-safe)', async () => {
      const input: InsertAuditRecordInput = {
        canonical_id: 'CR-2026-01-02-003',
        cr_hash: 'abc123',
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 1,
        action: 'create',
        rendered_issue_hash: 'def456',
        result_json: {
          url: 'https://github.com/test-owner/test-repo/issues/1',
          labelsApplied: [],
        },
      };
      
      mockQuery.mockRejectedValue(new Error('Database connection failed'));
      
      const result = await insertAuditRecord(pool, input);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Database connection failed');
      }
    });
  });
  
  // ========================================
  // B) Query by Canonical ID Tests
  // ========================================
  
  describe('queryCrGithubIssueAudit', () => {
    test('queries audit records by canonical ID', async () => {
      mockQuery.mockResolvedValue({
        rows: [
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
            action: 'create',
            rendered_issue_hash: 'def456',
            used_sources_hash: 'ghi789',
            created_at: new Date('2026-01-02T10:00:00Z'),
            result_json: { url: 'https://github.com/...', labelsApplied: ['afu9'] },
          },
          {
            id: 'audit-2',
            canonical_id: 'CR-2026-01-02-001',
            session_id: 'session-123',
            cr_version_id: 'version-789',
            cr_hash: 'xyz789',
            lawbook_version: '0.7.0',
            owner: 'adaefler-art',
            repo: 'codefactory-control',
            issue_number: 742,
            action: 'update',
            rendered_issue_hash: 'jkl012',
            used_sources_hash: 'mno345',
            created_at: new Date('2026-01-02T11:00:00Z'),
            result_json: { url: 'https://github.com/...', labelsApplied: ['afu9', 'updated'] },
          },
        ],
      });
      
      const result = await queryCrGithubIssueAudit(pool, 'CR-2026-01-02-001');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0].canonical_id).toBe('CR-2026-01-02-001');
        expect(result.data[0].action).toBe('create');
        expect(result.data[1].action).toBe('update');
      }
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE canonical_id = $1'),
        expect.arrayContaining(['CR-2026-01-02-001', 50, 0])
      );
    });
    
    test('supports pagination', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
      });
      
      await queryCrGithubIssueAudit(pool, 'CR-2026-01-02-001', { limit: 10, offset: 20 });
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['CR-2026-01-02-001', 10, 20])
      );
    });
    
    test('returns error on database failure', async () => {
      mockQuery.mockRejectedValue(new Error('Query failed'));
      
      const result = await queryCrGithubIssueAudit(pool, 'CR-2026-01-02-001');
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Query failed');
      }
    });
  });
  
  // ========================================
  // C) Query by Issue Tests
  // ========================================
  
  describe('queryByIssue', () => {
    test('queries audit records by owner/repo/issue', async () => {
      mockQuery.mockResolvedValue({
        rows: [
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
            action: 'create',
            rendered_issue_hash: 'def456',
            used_sources_hash: null,
            created_at: new Date('2026-01-02T10:00:00Z'),
            result_json: { url: 'https://github.com/...', labelsApplied: [] },
          },
        ],
      });
      
      const result = await queryByIssue(pool, 'adaefler-art', 'codefactory-control', 742);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].owner).toBe('adaefler-art');
        expect(result.data[0].repo).toBe('codefactory-control');
        expect(result.data[0].issue_number).toBe(742);
      }
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE owner = $1 AND repo = $2 AND issue_number = $3'),
        expect.arrayContaining(['adaefler-art', 'codefactory-control', 742, 50, 0])
      );
    });
    
    test('supports pagination', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
      });
      
      await queryByIssue(pool, 'owner', 'repo', 1, { limit: 5, offset: 10 });
      
      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['owner', 'repo', 1, 5, 10])
      );
    });
    
    test('returns error on database failure', async () => {
      mockQuery.mockRejectedValue(new Error('Query failed'));
      
      const result = await queryByIssue(pool, 'owner', 'repo', 1);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Query failed');
      }
    });
  });
  
  // ========================================
  // D) Data Integrity Tests
  // ========================================
  
  describe('Data integrity', () => {
    test('preserves all audit fields in round-trip', async () => {
      const input: InsertAuditRecordInput = {
        canonical_id: 'CR-2026-01-02-999',
        session_id: 'session-abc',
        cr_version_id: 'version-xyz',
        cr_hash: 'hash-cr-123456',
        lawbook_version: '0.7.0',
        owner: 'test-org',
        repo: 'test-repo',
        issue_number: 999,
        action: 'create',
        rendered_issue_hash: 'hash-rendered-789012',
        used_sources_hash: 'hash-sources-345678',
        result_json: {
          url: 'https://github.com/test-org/test-repo/issues/999',
          labelsApplied: ['label1', 'label2'],
          warnings: ['warning1'],
        },
      };
      
      // Insert mock
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'audit-999' }],
      });
      
      // Query mock
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'audit-999',
            canonical_id: input.canonical_id,
            session_id: input.session_id,
            cr_version_id: input.cr_version_id,
            cr_hash: input.cr_hash,
            lawbook_version: input.lawbook_version,
            owner: input.owner,
            repo: input.repo,
            issue_number: input.issue_number,
            action: input.action,
            rendered_issue_hash: input.rendered_issue_hash,
            used_sources_hash: input.used_sources_hash,
            created_at: new Date('2026-01-02T12:00:00Z'),
            result_json: input.result_json,
          },
        ],
      });
      
      const insertResult = await insertAuditRecord(pool, input);
      expect(insertResult.success).toBe(true);
      
      const queryResult = await queryCrGithubIssueAudit(pool, input.canonical_id);
      expect(queryResult.success).toBe(true);
      
      if (queryResult.success) {
        const record = queryResult.data[0];
        expect(record.canonical_id).toBe(input.canonical_id);
        expect(record.cr_hash).toBe(input.cr_hash);
        expect(record.lawbook_version).toBe(input.lawbook_version);
        expect(record.rendered_issue_hash).toBe(input.rendered_issue_hash);
        expect(record.used_sources_hash).toBe(input.used_sources_hash);
        expect(record.result_json).toEqual(input.result_json);
      }
    });
  });
});
