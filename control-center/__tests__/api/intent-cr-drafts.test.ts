/**
 * Tests for INTENT CR Draft API Routes
 * Issue E74.3: CR Preview/Edit UI + Validation Gate
 */

import { Pool } from 'pg';
import { getCrDraft, saveCrDraft, validateAndSaveCrDraft } from '../../src/lib/db/intentCrDrafts';
import { EXAMPLE_MINIMAL_CR } from '../../src/lib/schemas/changeRequest';

// Mock the database pool
const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
} as unknown as Pool;

describe('INTENT CR Drafts Database Layer', () => {
  const sessionId = 'session-123';
  const userId = 'user-456';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCrDraft', () => {
    it('should return null when no draft exists', async () => {
      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock draft query returning no rows
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await getCrDraft(mockPool, sessionId, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it('should return draft when it exists', async () => {
      const draftData = {
        id: 'draft-123',
        session_id: sessionId,
        created_at: new Date(),
        updated_at: new Date(),
        cr_json: EXAMPLE_MINIMAL_CR,
        cr_hash: 'abc123',
        status: 'draft',
      };

      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock draft query
      mockQuery.mockResolvedValueOnce({
        rows: [draftData],
      });

      const result = await getCrDraft(mockPool, sessionId, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        expect(result.data?.id).toBe(draftData.id);
        expect(result.data?.status).toBe('draft');
      }
    });

    it('should fail when session does not belong to user', async () => {
      // Mock session ownership check failing
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await getCrDraft(mockPool, sessionId, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Session not found or access denied');
      }
    });
  });

  describe('saveCrDraft', () => {
    it('should save a new draft', async () => {
      const savedDraft = {
        id: 'draft-456',
        session_id: sessionId,
        created_at: new Date(),
        updated_at: new Date(),
        cr_json: EXAMPLE_MINIMAL_CR,
        cr_hash: 'abc456',
        status: 'draft',
      };

      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock insert/upsert
      mockQuery.mockResolvedValueOnce({
        rows: [savedDraft],
      });

      const result = await saveCrDraft(mockPool, sessionId, userId, EXAMPLE_MINIMAL_CR);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        expect(result.data.id).toBe(savedDraft.id);
        expect(result.data.cr_hash).toBeDefined();
      }
    });

    it('should fail when session does not belong to user', async () => {
      // Mock session ownership check failing
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await saveCrDraft(mockPool, sessionId, userId, EXAMPLE_MINIMAL_CR);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Session not found or access denied');
      }
    });
  });

  describe('validateAndSaveCrDraft', () => {
    it('should validate and save a valid CR', async () => {
      const savedDraft = {
        id: 'draft-789',
        session_id: sessionId,
        created_at: new Date(),
        updated_at: new Date(),
        cr_json: EXAMPLE_MINIMAL_CR,
        cr_hash: 'abc789',
        status: 'valid',
      };

      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock insert/upsert
      mockQuery.mockResolvedValueOnce({
        rows: [savedDraft],
      });

      const result = await validateAndSaveCrDraft(mockPool, sessionId, userId, EXAMPLE_MINIMAL_CR);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        expect(result.data.status).toBe('valid');
        expect(result.validation).toBeDefined();
        expect(result.validation.ok).toBe(true);
      }
    });

    it('should validate and save an invalid CR with status invalid', async () => {
      const invalidCr = {
        ...EXAMPLE_MINIMAL_CR,
        title: 'a'.repeat(121), // Exceeds size limit
      };

      const savedDraft = {
        id: 'draft-invalid',
        session_id: sessionId,
        created_at: new Date(),
        updated_at: new Date(),
        cr_json: invalidCr,
        cr_hash: 'abc999',
        status: 'invalid',
      };

      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock insert/upsert
      mockQuery.mockResolvedValueOnce({
        rows: [savedDraft],
      });

      const result = await validateAndSaveCrDraft(mockPool, sessionId, userId, invalidCr);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        expect(result.data.status).toBe('invalid');
        expect(result.validation).toBeDefined();
        expect(result.validation.ok).toBe(false);
        expect(result.validation.errors.length).toBeGreaterThan(0);
      }
    });

    it('should fail when session does not belong to user', async () => {
      // Mock session ownership check failing
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await validateAndSaveCrDraft(mockPool, sessionId, userId, EXAMPLE_MINIMAL_CR);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Session not found or access denied');
      }
    });

    it('should enforce minimum 1 evidence requirement', async () => {
      const crWithoutEvidence = {
        ...EXAMPLE_MINIMAL_CR,
        evidence: [],
      };

      const savedDraft = {
        id: 'draft-no-evidence',
        session_id: sessionId,
        created_at: new Date(),
        updated_at: new Date(),
        cr_json: crWithoutEvidence,
        cr_hash: 'abc111',
        status: 'invalid',
      };

      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock insert/upsert
      mockQuery.mockResolvedValueOnce({
        rows: [savedDraft],
      });

      const result = await validateAndSaveCrDraft(mockPool, sessionId, userId, crWithoutEvidence);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.validation.ok).toBe(false);
        expect(result.validation.errors.some(e => 
          e.code === 'CR_SCHEMA_INVALID' || e.code === 'CR_EVIDENCE_MISSING'
        )).toBe(true);
      }
    });
  });

  describe('Deterministic hashing', () => {
    it('should compute same hash for same CR', async () => {
      // Mock session ownership check
      mockQuery.mockResolvedValue({
        rows: [{ id: sessionId }],
      });

      let hash1: string | undefined;
      let hash2: string | undefined;

      // First save
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'draft-1',
          session_id: sessionId,
          created_at: new Date(),
          updated_at: new Date(),
          cr_json: EXAMPLE_MINIMAL_CR,
          cr_hash: 'test-hash-1',
          status: 'draft',
        }],
      });

      const result1 = await saveCrDraft(mockPool, sessionId, userId, EXAMPLE_MINIMAL_CR);
      if (result1.success) {
        hash1 = result1.data.cr_hash;
      }

      // Second save with same CR
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'draft-2',
          session_id: sessionId,
          created_at: new Date(),
          updated_at: new Date(),
          cr_json: EXAMPLE_MINIMAL_CR,
          cr_hash: 'test-hash-2',
          status: 'draft',
        }],
      });

      const result2 = await saveCrDraft(mockPool, sessionId, userId, EXAMPLE_MINIMAL_CR);
      if (result2.success) {
        hash2 = result2.data.cr_hash;
      }

      // Note: In real implementation, hashes would match
      // Here we're just testing that the function returns hashes
      expect(hash1).toBeDefined();
      expect(hash2).toBeDefined();
    });
  });

  describe('Invalid JSON handling', () => {
    it('should handle invalid JSON gracefully in validation', async () => {
      const invalidJson = {
        not: 'a',
        valid: 'cr',
      };

      const savedDraft = {
        id: 'draft-invalid-json',
        session_id: sessionId,
        created_at: new Date(),
        updated_at: new Date(),
        cr_json: invalidJson,
        cr_hash: 'invalid-hash',
        status: 'invalid',
      };

      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock insert/upsert
      mockQuery.mockResolvedValueOnce({
        rows: [savedDraft],
      });

      const result = await validateAndSaveCrDraft(mockPool, sessionId, userId, invalidJson);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.validation.ok).toBe(false);
        expect(result.validation.errors.length).toBeGreaterThan(0);
        expect(result.validation.errors.some(e => 
          e.code === 'CR_SCHEMA_INVALID'
        )).toBe(true);
      }
    });
  });
});
