/**
 * Tests for INTENT Issue Authoring Evidence Module (E81.5)
 * 
 * Validates:
 * 1. Secret redaction (no tokens, env vars, credentials in output)
 * 2. Deterministic hashing (same input → same hash)
 * 3. Bounded payloads (max 100KB per event)
 * 4. lawbookVersion inclusion
 * 
 * @jest-environment node
 */

import {
  stableStringify,
  redactSecrets,
  computeHash,
  computeParamsHash,
  computeResultHash,
  createEvidenceRecord,
  verifyDeterministicHash,
  extractEvidenceSummary,
  MAX_EVIDENCE_PAYLOAD_BYTES,
  type EvidenceRecord,
} from '../../src/lib/intent-issue-evidence';
import { getActiveLawbookVersion } from '../../src/lib/lawbook-version-helper';

// Mock lawbook-version-helper
jest.mock('../../src/lib/lawbook-version-helper');
const mockGetActiveLawbookVersion = getActiveLawbookVersion as jest.MockedFunction<typeof getActiveLawbookVersion>;

describe('INTENT Issue Authoring Evidence Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveLawbookVersion.mockResolvedValue('v0.8.0');
  });

  // ========================================
  // A) Secret Redaction Tests
  // ========================================
  
  describe('Secret redaction', () => {
    test('redacts token fields', () => {
      const input = {
        name: 'test',
        token: 'secret-token-123',
        apiToken: 'api-secret',
      };
      
      const result = redactSecrets(input);
      
      expect(result.name).toBe('test');
      expect(result.token).toBe('[REDACTED]');
      expect(result.apiToken).toBe('[REDACTED]');
    });
    
    test('redacts password fields', () => {
      const input = {
        username: 'user',
        password: 'super-secret',
        dbPassword: 'db-secret',
      };
      
      const result = redactSecrets(input);
      
      expect(result.username).toBe('user');
      expect(result.password).toBe('[REDACTED]');
      expect(result.dbPassword).toBe('[REDACTED]');
    });
    
    test('redacts API keys', () => {
      const input = {
        api_key: 'sk-123456',
        apiKey: 'pk-789',
        x_api_key: 'header-key',
      };
      
      const result = redactSecrets(input);
      
      expect(result.api_key).toBe('[REDACTED]');
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.x_api_key).toBe('[REDACTED]');
    });
    
    test('redacts environment variables', () => {
      const input = {
        config: 'normal',
        env: { GITHUB_TOKEN: 'ghp_123' },
        github_token: 'token',
      };
      
      const result = redactSecrets(input);
      
      expect(result.config).toBe('normal');
      expect(result.env).toBe('[REDACTED]');
      expect(result.github_token).toBe('[REDACTED]');
    });
    
    test('redacts nested secrets', () => {
      const input = {
        user: {
          name: 'test',
          auth: {
            token: 'secret',
            password: 'pass123',
          },
        },
        public: 'data',
      };
      
      const result = redactSecrets(input);
      
      expect(result.user.name).toBe('test');
      expect(result.user.auth.token).toBe('[REDACTED]');
      expect(result.user.auth.password).toBe('[REDACTED]');
      expect(result.public).toBe('data');
    });
    
    test('redacts secrets in arrays', () => {
      const input = {
        items: [
          { name: 'item1', secret: 'sec1' },
          { name: 'item2', token: 'tok2' },
        ],
      };
      
      const result = redactSecrets(input);
      
      expect(result.items[0].name).toBe('item1');
      expect(result.items[0].secret).toBe('[REDACTED]');
      expect(result.items[1].name).toBe('item2');
      expect(result.items[1].token).toBe('[REDACTED]');
    });
    
    test('handles null and undefined', () => {
      expect(redactSecrets(null)).toBeNull();
      expect(redactSecrets(undefined)).toBeUndefined();
      expect(redactSecrets({ a: null, b: undefined })).toEqual({ a: null, b: undefined });
    });
    
    test('preserves non-secret data', () => {
      const input = {
        title: 'Test Issue',
        description: 'Test description',
        tags: ['bug', 'urgent'],
        metadata: {
          createdAt: '2026-01-08T00:00:00Z',
          author: 'test-user',
        },
      };
      
      const result = redactSecrets(input);
      
      expect(result).toEqual(input);
    });
  });

  // ========================================
  // B) Deterministic Hashing Tests
  // ========================================
  
  describe('Deterministic hashing', () => {
    test('stableStringify sorts object keys', () => {
      const obj1 = { b: 2, a: 1, c: 3 };
      const obj2 = { a: 1, b: 2, c: 3 };
      const obj3 = { c: 3, a: 1, b: 2 };
      
      const str1 = stableStringify(obj1);
      const str2 = stableStringify(obj2);
      const str3 = stableStringify(obj3);
      
      expect(str1).toBe(str2);
      expect(str2).toBe(str3);
      expect(str1).toBe('{"a":1,"b":2,"c":3}');
    });
    
    test('stableStringify handles nested objects', () => {
      const obj1 = { outer: { b: 2, a: 1 }, x: 'value' };
      const obj2 = { x: 'value', outer: { a: 1, b: 2 } };
      
      const str1 = stableStringify(obj1);
      const str2 = stableStringify(obj2);
      
      expect(str1).toBe(str2);
    });
    
    test('stableStringify handles arrays', () => {
      const obj = { items: [3, 1, 2], name: 'test' };
      const str = stableStringify(obj);
      
      // Arrays preserve order, only object keys are sorted
      expect(str).toBe('{"items":[3,1,2],"name":"test"}');
    });
    
    test('computeHash produces consistent SHA256', () => {
      const obj = { b: 2, a: 1 };
      const hash1 = computeHash(obj);
      const hash2 = computeHash(obj);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
    });
    
    test('same input produces same hash regardless of key order', () => {
      const obj1 = { z: 3, y: 2, x: 1 };
      const obj2 = { x: 1, y: 2, z: 3 };
      
      expect(computeHash(obj1)).toBe(computeHash(obj2));
    });
    
    test('different input produces different hash', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { a: 1, b: 3 };
      
      expect(computeHash(obj1)).not.toBe(computeHash(obj2));
    });
    
    test('verifyDeterministicHash works correctly', () => {
      const obj1 = { b: 2, a: 1 };
      const obj2 = { a: 1, b: 2 };
      const obj3 = { a: 1, b: 3 };
      
      expect(verifyDeterministicHash(obj1, obj2)).toBe(true);
      expect(verifyDeterministicHash(obj1, obj3)).toBe(false);
    });
    
    test('computeParamsHash redacts and hashes', () => {
      const params1 = { data: 'test', token: 'secret-1' };
      const params2 = { data: 'test', token: 'secret-2' };
      
      // Same params after redaction should produce same hash
      const hash1 = computeParamsHash(params1);
      const hash2 = computeParamsHash(params2);
      
      expect(hash1).toBe(hash2); // Because token is redacted
    });
    
    test('computeResultHash redacts and hashes', () => {
      const result1 = { success: true, apiKey: 'key-1' };
      const result2 = { success: true, apiKey: 'key-2' };
      
      const hash1 = computeResultHash(result1);
      const hash2 = computeResultHash(result2);
      
      expect(hash1).toBe(hash2); // Because apiKey is redacted
    });
  });

  // ========================================
  // C) Bounded Payload Tests
  // ========================================
  
  describe('Bounded payloads', () => {
    test('accepts payloads under limit', async () => {
      const smallParams = { data: 'small' };
      const smallResult = { success: true };
      
      const record = await createEvidenceRecord({
        requestId: 'req-1',
        sessionId: 'sess-1',
        sub: 'user-1',
        action: 'draft_save',
        params: smallParams,
        result: smallResult,
      });
      
      expect(record).toBeDefined();
      expect(record.paramsHash).toBeDefined();
      expect(record.resultHash).toBeDefined();
    });
    
    test('rejects combined payload over limit', async () => {
      // Create two medium payloads that together exceed MAX_EVIDENCE_PAYLOAD_BYTES (100KB)
      const mediumString = 'x'.repeat(60000); // 60KB
      const mediumParams = { data: mediumString };
      const mediumResult = { output: mediumString };
      
      await expect(
        createEvidenceRecord({
          requestId: 'req-1',
          sessionId: 'sess-1',
          sub: 'user-1',
          action: 'draft_save',
          params: mediumParams,
          result: mediumResult,
        })
      ).rejects.toThrow(/Combined payload exceeds maximum size/);
    });
    
    test('accepts individual large payloads if combined size is under limit', async () => {
      // Create params at 80KB, result at 10KB = 90KB total (under 100KB)
      const largeParams = { data: 'x'.repeat(80000) };
      const smallResult = { output: 'x'.repeat(10000) };
      
      const record = await createEvidenceRecord({
        requestId: 'req-1',
        sessionId: 'sess-1',
        sub: 'user-1',
        action: 'draft_save',
        params: largeParams,
        result: smallResult,
      });
      
      expect(record).toBeDefined();
    });
    
    test('payload size is checked after redaction', async () => {
      // Even if original has secrets, size is checked after redaction
      const params = {
        data: 'test',
        secret: 'x'.repeat(1000), // This will be redacted to '[REDACTED]'
      };
      
      // Should succeed because redacted payload is small
      const record = await createEvidenceRecord({
        requestId: 'req-1',
        sessionId: 'sess-1',
        sub: 'user-1',
        action: 'draft_save',
        params,
        result: { success: true },
      });
      
      expect(record).toBeDefined();
    });
  });

  // ========================================
  // D) lawbookVersion Inclusion Tests
  // ========================================
  
  describe('lawbookVersion tracking', () => {
    test('includes lawbookVersion when configured', async () => {
      mockGetActiveLawbookVersion.mockResolvedValue('v0.8.0');
      
      const record = await createEvidenceRecord({
        requestId: 'req-1',
        sessionId: 'sess-1',
        sub: 'user-1',
        action: 'draft_validate',
        params: { data: 'test' },
        result: { valid: true },
      });
      
      expect(record.lawbookVersion).toBe('v0.8.0');
    });
    
    test('sets lawbookVersion to null when not configured', async () => {
      mockGetActiveLawbookVersion.mockResolvedValue(null);
      
      const record = await createEvidenceRecord({
        requestId: 'req-1',
        sessionId: 'sess-1',
        sub: 'user-1',
        action: 'draft_save',
        params: { data: 'test' },
        result: { success: true },
      });
      
      expect(record.lawbookVersion).toBeNull();
    });
    
    test('passes pool to getActiveLawbookVersion', async () => {
      const mockPool = {} as any;
      
      await createEvidenceRecord(
        {
          requestId: 'req-1',
          sessionId: 'sess-1',
          sub: 'user-1',
          action: 'draft_commit',
          params: { data: 'test' },
          result: { committed: true },
        },
        mockPool
      );
      
      expect(mockGetActiveLawbookVersion).toHaveBeenCalledWith(mockPool);
    });
  });

  // ========================================
  // E) Evidence Record Creation Tests
  // ========================================
  
  describe('Evidence record creation', () => {
    test('creates complete evidence record', async () => {
      mockGetActiveLawbookVersion.mockResolvedValue('v0.8.0');
      
      const record = await createEvidenceRecord({
        requestId: 'req-123',
        sessionId: 'sess-456',
        sub: 'user-789',
        action: 'draft_validate',
        params: { issueJson: { title: 'Test' } },
        result: { valid: true, errors: [] },
      });
      
      expect(record.requestId).toBe('req-123');
      expect(record.sessionId).toBe('sess-456');
      expect(record.sub).toBe('user-789');
      expect(record.action).toBe('draft_validate');
      expect(record.paramsHash).toBeDefined();
      expect(record.resultHash).toBeDefined();
      expect(record.lawbookVersion).toBe('v0.8.0');
      expect(record.createdAt).toBeDefined();
      expect(record.paramsJson).toBeDefined();
      expect(record.resultJson).toBeDefined();
    });
    
    test('redacts secrets in stored JSON', async () => {
      const record = await createEvidenceRecord({
        requestId: 'req-1',
        sessionId: 'sess-1',
        sub: 'user-1',
        action: 'issue_set_generate',
        params: { briefing: 'text', token: 'secret' },
        result: { issues: [], apiKey: 'key' },
      });
      
      expect(record.paramsJson?.token).toBe('[REDACTED]');
      expect(record.resultJson?.apiKey).toBe('[REDACTED]');
    });
    
    test('sets createdAt timestamp', async () => {
      const before = new Date().toISOString();
      
      const record = await createEvidenceRecord({
        requestId: 'req-1',
        sessionId: 'sess-1',
        sub: 'user-1',
        action: 'draft_save',
        params: {},
        result: {},
      });
      
      const after = new Date().toISOString();
      
      expect(record.createdAt).toBeDefined();
      expect(record.createdAt >= before).toBe(true);
      expect(record.createdAt <= after).toBe(true);
    });
  });

  // ========================================
  // F) Evidence Summary Extraction Tests
  // ========================================
  
  describe('Evidence summary extraction', () => {
    test('extracts summary without full payloads', async () => {
      const record = await createEvidenceRecord({
        requestId: 'req-1',
        sessionId: 'sess-1',
        sub: 'user-1',
        action: 'draft_save',
        params: { large: 'data' },
        result: { success: true },
      });
      
      const summary = extractEvidenceSummary(record);
      
      expect(summary.requestId).toBe('req-1');
      expect(summary.sessionId).toBe('sess-1');
      expect(summary.action).toBe('draft_save');
      expect(summary.paramsHash).toBeDefined();
      expect(summary.resultHash).toBeDefined();
      expect(summary.lawbookVersion).toBeDefined();
      expect(summary.createdAt).toBeDefined();
      expect('paramsJson' in summary).toBe(false);
      expect('resultJson' in summary).toBe(false);
    });
  });

  // ========================================
  // G) Action Type Tests
  // ========================================
  
  describe('Action types', () => {
    test('supports all expected action types', async () => {
      const actions = [
        'draft_save',
        'draft_validate',
        'draft_commit',
        'issue_set_generate',
        'issue_set_export',
      ] as const;
      
      for (const action of actions) {
        const record = await createEvidenceRecord({
          requestId: 'req-1',
          sessionId: 'sess-1',
          sub: 'user-1',
          action,
          params: {},
          result: {},
        });
        
        expect(record.action).toBe(action);
      }
    });
  });

  // ========================================
  // H) Error Handling and Security Tests
  // ========================================
  
  describe('Error handling and security', () => {
    test('createEvidenceErrorInfo produces secret-free error info', () => {
      const { createEvidenceErrorInfo, EVIDENCE_ERROR_CODES } = require('../../src/lib/intent-issue-evidence');
      
      const ghToken = 'ghp_' + '1234567890abcdefghijklmnopqrstuv';
      const rawPassword = 'secret' + '123';
      const error = new Error(`Insert failed: token=${ghToken}, password=${rawPassword}`);
      (error as any).code = EVIDENCE_ERROR_CODES.INSERT_FAILED;
      
      const errorInfo = createEvidenceErrorInfo(error, {
        requestId: 'req-1',
        sessionId: 'sess-1',
        action: 'draft_save',
      });
      
      expect(errorInfo.code).toBe(EVIDENCE_ERROR_CODES.INSERT_FAILED);
      expect(errorInfo.message).not.toContain('ghp_');
      expect(errorInfo.message).not.toContain(rawPassword);
      expect(errorInfo.message).toContain('[REDACTED');
      expect(errorInfo.requestId).toBe('req-1');
      expect(errorInfo.sessionId).toBe('sess-1');
      expect(errorInfo.action).toBe('draft_save');
      expect(errorInfo.timestamp).toBeDefined();
    });
    
    test('createEvidenceErrorInfo redacts GitHub tokens', () => {
      const { createEvidenceErrorInfo } = require('../../src/lib/intent-issue-evidence');
      
      const token = 'ghp_' + 'x'.repeat(36);
      const error = new Error(`Failed with token ${token}`);
      
      const errorInfo = createEvidenceErrorInfo(error, {
        requestId: 'req-1',
        sessionId: 'sess-1',
        action: 'draft_validate',
      });
      
      expect(errorInfo.message).not.toContain('ghp_');
      expect(errorInfo.message).toContain('[REDACTED_TOKEN]');
    });
    
    test('createEvidenceErrorInfo redacts API keys', () => {
      const { createEvidenceErrorInfo } = require('../../src/lib/intent-issue-evidence');
      
      const apiKey = 'sk-' + 'x'.repeat(48);
      const error = new Error(`API error: ${apiKey}`);
      
      const errorInfo = createEvidenceErrorInfo(error, {
        requestId: 'req-1',
        sessionId: 'sess-1',
        action: 'draft_commit',
      });
      
      expect(errorInfo.message).not.toContain('sk-');
      expect(errorInfo.message).toContain('[REDACTED_KEY]');
    });
    
    test('createEvidenceErrorInfo redacts key=value patterns', () => {
      const { createEvidenceErrorInfo } = require('../../src/lib/intent-issue-evidence');
      
      const error = new Error('Config error: password=mySecretPass123, token=abc123');
      
      const errorInfo = createEvidenceErrorInfo(error, {
        requestId: 'req-1',
        sessionId: 'sess-1',
        action: 'issue_set_generate',
      });
      
      expect(errorInfo.message).not.toContain('mySecretPass123');
      expect(errorInfo.message).not.toContain('abc123');
      expect(errorInfo.message).toContain('password=[REDACTED]');
      expect(errorInfo.message).toContain('token=[REDACTED]');
    });
    
    test('PAYLOAD_TOO_LARGE error has correct code', async () => {
      const largeString = 'x'.repeat(60000);
      const largeParams = { data: largeString };
      const largeResult = { output: largeString };
      
      try {
        await createEvidenceRecord({
          requestId: 'req-1',
          sessionId: 'sess-1',
          sub: 'user-1',
          action: 'draft_save',
          params: largeParams,
          result: largeResult,
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.code).toBe('EVIDENCE_PAYLOAD_TOO_LARGE');
      }
    });
    
    test('error codes are exported and available', () => {
      const { EVIDENCE_ERROR_CODES } = require('../../src/lib/intent-issue-evidence');
      
      expect(EVIDENCE_ERROR_CODES.PAYLOAD_TOO_LARGE).toBe('EVIDENCE_PAYLOAD_TOO_LARGE');
      expect(EVIDENCE_ERROR_CODES.INSERT_FAILED).toBe('EVIDENCE_INSERT_FAILED');
      expect(EVIDENCE_ERROR_CODES.REDACTION_FAILED).toBe('EVIDENCE_REDACTION_FAILED');
      expect(EVIDENCE_ERROR_CODES.HASH_FAILED).toBe('EVIDENCE_HASH_FAILED');
    });
  });

  // ========================================
  // I) Regression Tests for Key Pattern Matching
  // ========================================
  
  describe('Key pattern matching (camelCase/snake_case/kebab-case)', () => {
    test('redacts camelCase keys with secret patterns', () => {
      const input = {
        apiToken: 'secret1',
        userPassword: 'secret2',
        dbCredential: 'secret3',
        mySecret: 'secret4',
      };
      
      const result = redactSecrets(input);
      
      expect(result.apiToken).toBe('[REDACTED]');
      expect(result.userPassword).toBe('[REDACTED]');
      expect(result.dbCredential).toBe('[REDACTED]');
      expect(result.mySecret).toBe('[REDACTED]');
    });
    
    test('redacts snake_case keys with secret patterns', () => {
      const input = {
        api_token: 'secret1',
        user_password: 'secret2',
        db_credential: 'secret3',
        my_secret: 'secret4',
      };
      
      const result = redactSecrets(input);
      
      expect(result.api_token).toBe('[REDACTED]');
      expect(result.user_password).toBe('[REDACTED]');
      expect(result.db_credential).toBe('[REDACTED]');
      expect(result.my_secret).toBe('[REDACTED]');
    });
    
    test('redacts kebab-case keys with secret patterns', () => {
      const input = {
        'api-token': 'secret1',
        'user-password': 'secret2',
        'db-credential': 'secret3',
        'my-secret': 'secret4',
      };
      
      const result = redactSecrets(input);
      
      expect(result['api-token']).toBe('[REDACTED]');
      expect(result['user-password']).toBe('[REDACTED]');
      expect(result['db-credential']).toBe('[REDACTED]');
      expect(result['my-secret']).toBe('[REDACTED]');
    });
    
    test('does not redact non-secret keys with similar substrings', () => {
      const input = {
        author: 'John Doe',
        description: 'A description',
        category: 'testing',
      };
      
      const result = redactSecrets(input);
      
      expect(result.author).toBe('John Doe');
      expect(result.description).toBe('A description');
      expect(result.category).toBe('testing');
    });
  });

  // ========================================
  // J) Combined Payload Enforcement Tests
  // ========================================
  
  describe('Combined payload enforcement (params + result)', () => {
    test('validates combined size after redaction', async () => {
      // Create params with secrets that will be redacted
      const params = {
        data: 'x'.repeat(40000),
        secret: 'x'.repeat(30000), // Will become '[REDACTED]'
      };
      const result = {
        output: 'x'.repeat(40000),
        token: 'x'.repeat(30000), // Will become '[REDACTED]'
      };
      
      // After redaction, total should be ~80KB (under 100KB limit)
      // So this should succeed
      const record = await createEvidenceRecord({
        requestId: 'req-1',
        sessionId: 'sess-1',
        sub: 'user-1',
        action: 'draft_save',
        params,
        result,
      });
      
      expect(record).toBeDefined();
      expect(record.paramsJson?.secret).toBe('[REDACTED]');
      expect(record.resultJson?.token).toBe('[REDACTED]');
    });
    
    test('rejects when combined size exceeds limit after redaction', async () => {
      const params = { data: 'x'.repeat(60000) };
      const result = { output: 'x'.repeat(50000) };
      
      // Combined: ~110KB, over 100KB limit
      await expect(
        createEvidenceRecord({
          requestId: 'req-1',
          sessionId: 'sess-1',
          sub: 'user-1',
          action: 'draft_validate',
          params,
          result,
        })
      ).rejects.toThrow(/Combined payload exceeds maximum size/);
    });
    
    test('error message includes actual sizes when over limit', async () => {
      const params = { data: 'x'.repeat(70000) };
      const result = { output: 'x'.repeat(40000) };
      
      try {
        await createEvidenceRecord({
          requestId: 'req-1',
          sessionId: 'sess-1',
          sub: 'user-1',
          action: 'draft_commit',
          params,
          result,
        });
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain('bytes >');
        expect(error.message).toContain('102400'); // MAX_EVIDENCE_PAYLOAD_BYTES
        expect(error.code).toBe('EVIDENCE_PAYLOAD_TOO_LARGE');
      }
    });
  });
});
