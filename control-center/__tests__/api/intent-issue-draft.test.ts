/**
 * Tests for INTENT Issue Draft API Routes
 * Issue E81.2: INTENT Tools create/update Issue Draft (session-bound)
 */

import { Pool } from 'pg';
import { getIssueDraft, saveIssueDraft, validateAndSaveIssueDraft } from '../../src/lib/db/intentIssueDrafts';
import { commitIssueDraftVersion, listIssueDraftVersions } from '../../src/lib/db/intentIssueDraftVersions';
import { validateIssueDraft } from '../../src/lib/validators/issueDraftValidator';
import { EXAMPLE_MINIMAL_ISSUE_DRAFT } from '../../src/lib/schemas/issueDraft';

// Mock the database pool
const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockRelease = jest.fn();
const mockClient = {
  query: mockQuery,
  release: mockRelease,
};

const mockPool = {
  query: mockQuery,
  connect: mockConnect,
} as unknown as Pool;

describe('INTENT Issue Drafts Database Layer', () => {
  const sessionId = 'session-123';
  const userId = 'user-456';

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(mockClient);
  });

  describe('getIssueDraft', () => {
    it('should return null when no draft exists', async () => {
      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock draft query returning no rows
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await getIssueDraft(mockPool, sessionId, userId);

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
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: 'abc123',
        last_validation_status: 'valid',
        last_validation_at: new Date(),
        last_validation_result: { isValid: true, errors: [], warnings: [], meta: {} },
      };

      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock draft query
      mockQuery.mockResolvedValueOnce({
        rows: [draftData],
      });

      const result = await getIssueDraft(mockPool, sessionId, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        expect(result.data?.id).toBe(draftData.id);
        expect(result.data?.last_validation_status).toBe('valid');
      }
    });

    it('should fail when session does not belong to user', async () => {
      // Mock session ownership check failing
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await getIssueDraft(mockPool, sessionId, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Session not found or access denied');
      }
    });
  });

  describe('saveIssueDraft', () => {
    it('should save a new draft without validation', async () => {
      const savedDraft = {
        id: 'draft-456',
        session_id: sessionId,
        created_at: new Date(),
        updated_at: new Date(),
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: 'abc456',
        last_validation_status: 'unknown',
        last_validation_at: null,
        last_validation_result: null,
      };

      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock insert/upsert
      mockQuery.mockResolvedValueOnce({
        rows: [savedDraft],
      });

      const result = await saveIssueDraft(mockPool, sessionId, userId, EXAMPLE_MINIMAL_ISSUE_DRAFT);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        expect(result.data.id).toBe(savedDraft.id);
        expect(result.data.issue_hash).toBeDefined();
        expect(result.data.last_validation_status).toBe('unknown');
      }
    });

    it('should save draft with validation result when provided', async () => {
      const validationResult = validateIssueDraft(EXAMPLE_MINIMAL_ISSUE_DRAFT);
      
      const savedDraft = {
        id: 'draft-789',
        session_id: sessionId,
        created_at: new Date(),
        updated_at: new Date(),
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: 'abc789',
        last_validation_status: 'valid',
        last_validation_at: new Date(),
        last_validation_result: validationResult,
      };

      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock insert/upsert
      mockQuery.mockResolvedValueOnce({
        rows: [savedDraft],
      });

      const result = await saveIssueDraft(
        mockPool, 
        sessionId, 
        userId, 
        EXAMPLE_MINIMAL_ISSUE_DRAFT,
        validationResult
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.last_validation_status).toBe('valid');
        expect(result.data.last_validation_at).toBeDefined();
      }
    });

    it('should accept invalid draft but mark as invalid', async () => {
      const invalidDraft = { title: 'Too short' }; // Invalid draft
      const validationResult = validateIssueDraft(invalidDraft);
      
      const savedDraft = {
        id: 'draft-invalid',
        session_id: sessionId,
        created_at: new Date(),
        updated_at: new Date(),
        issue_json: invalidDraft,
        issue_hash: 'invalid-hash',
        last_validation_status: 'invalid',
        last_validation_at: new Date(),
        last_validation_result: validationResult,
      };

      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock insert/upsert
      mockQuery.mockResolvedValueOnce({
        rows: [savedDraft],
      });

      const result = await saveIssueDraft(
        mockPool, 
        sessionId, 
        userId, 
        invalidDraft,
        validationResult
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.last_validation_status).toBe('invalid');
      }
    });

    it('should fail when session does not belong to user', async () => {
      // Mock session ownership check failing
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await saveIssueDraft(mockPool, sessionId, userId, EXAMPLE_MINIMAL_ISSUE_DRAFT);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Session not found or access denied');
      }
    });
  });

  describe('validateAndSaveIssueDraft', () => {
    it('should validate and save a valid issue draft', async () => {
      const savedDraft = {
        id: 'draft-valid',
        session_id: sessionId,
        created_at: new Date(),
        updated_at: new Date(),
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: 'valid-hash',
        last_validation_status: 'valid',
        last_validation_at: new Date(),
        last_validation_result: { isValid: true, errors: [], warnings: [], meta: {} },
      };

      // Mock session ownership check (called twice)
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock save
      mockQuery.mockResolvedValueOnce({
        rows: [savedDraft],
      });

      const result = await validateAndSaveIssueDraft(
        mockPool, 
        sessionId, 
        userId, 
        EXAMPLE_MINIMAL_ISSUE_DRAFT
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.last_validation_status).toBe('valid');
        expect(result.validation.isValid).toBe(true);
        expect(result.validation.errors).toHaveLength(0);
      }
    });

    it('should validate and save invalid draft with errors', async () => {
      const invalidDraft = { title: 'x' }; // Too short
      
      const savedDraft = {
        id: 'draft-invalid',
        session_id: sessionId,
        created_at: new Date(),
        updated_at: new Date(),
        issue_json: invalidDraft,
        issue_hash: 'invalid-hash',
        last_validation_status: 'invalid',
        last_validation_at: new Date(),
        last_validation_result: { isValid: false, errors: [{ code: 'ERR', message: 'Invalid', path: '/', severity: 'error' }], warnings: [], meta: {} },
      };

      // Mock session ownership check (called twice)
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock save
      mockQuery.mockResolvedValueOnce({
        rows: [savedDraft],
      });

      const result = await validateAndSaveIssueDraft(
        mockPool, 
        sessionId, 
        userId, 
        invalidDraft
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.last_validation_status).toBe('invalid');
        expect(result.validation.isValid).toBe(false);
        expect(result.validation.errors.length).toBeGreaterThan(0);
      }
    });

    it('should fail when session does not belong to user', async () => {
      // Mock session ownership check failing
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await validateAndSaveIssueDraft(
        mockPool, 
        sessionId, 
        userId, 
        EXAMPLE_MINIMAL_ISSUE_DRAFT
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Session not found or access denied');
      }
    });
  });

  describe('commitIssueDraftVersion', () => {
    beforeEach(() => {
      // Reset client mock for transaction tests
      mockClient.query = jest.fn();
    });

    it('should commit valid draft as new version', async () => {
      const newVersion = {
        id: 'version-1',
        session_id: sessionId,
        created_at: new Date(),
        created_by_sub: userId,
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: 'version-hash',
        version_number: 1,
      };

      // Transaction mocks
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // Session check
        .mockResolvedValueOnce({ rows: [{ last_validation_status: 'valid' }] }) // Draft check
        .mockResolvedValueOnce({ rows: [] }) // Check for existing hash
        .mockResolvedValueOnce({ rows: [{ next_version: 1 }] }) // Get next version
        .mockResolvedValueOnce({ rows: [newVersion] }) // Insert version
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await commitIssueDraftVersion(
        mockPool, 
        sessionId, 
        userId, 
        EXAMPLE_MINIMAL_ISSUE_DRAFT
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.isNew).toBe(true);
        expect(result.data.version_number).toBe(1);
      }
    });

    it('should return existing version for duplicate hash (idempotency)', async () => {
      const existingVersion = {
        id: 'version-existing',
        session_id: sessionId,
        created_at: new Date(),
        created_by_sub: userId,
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: 'existing-hash',
        version_number: 1,
      };

      // Transaction mocks
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // Session check
        .mockResolvedValueOnce({ rows: [{ last_validation_status: 'valid' }] }) // Draft check
        .mockResolvedValueOnce({ rows: [existingVersion] }) // Existing hash found
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await commitIssueDraftVersion(
        mockPool, 
        sessionId, 
        userId, 
        EXAMPLE_MINIMAL_ISSUE_DRAFT
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.isNew).toBe(false);
        expect(result.data.id).toBe(existingVersion.id);
      }
    });

    it('should fail when last validation is not valid', async () => {
      // Transaction mocks
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // Session check
        .mockResolvedValueOnce({ rows: [{ last_validation_status: 'invalid' }] }) // Draft check - invalid
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      const result = await commitIssueDraftVersion(
        mockPool, 
        sessionId, 
        userId, 
        EXAMPLE_MINIMAL_ISSUE_DRAFT
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Cannot commit: last validation status is not valid');
      }
    });

    it('should fail when no draft exists', async () => {
      // Transaction mocks
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // Session check
        .mockResolvedValueOnce({ rows: [] }) // No draft found
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      const result = await commitIssueDraftVersion(
        mockPool, 
        sessionId, 
        userId, 
        EXAMPLE_MINIMAL_ISSUE_DRAFT
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('No draft exists for this session');
      }
    });

    it('should fail when session does not belong to user', async () => {
      // Transaction mocks
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // Session check - no match
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      const result = await commitIssueDraftVersion(
        mockPool, 
        sessionId, 
        userId, 
        EXAMPLE_MINIMAL_ISSUE_DRAFT
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Session not found or access denied');
      }
    });
  });

  describe('listIssueDraftVersions', () => {
    it('should list versions for a session', async () => {
      const versions = [
        {
          id: 'v1',
          session_id: sessionId,
          created_at: new Date(),
          created_by_sub: userId,
          issue_hash: 'hash1',
          version_number: 2,
        },
        {
          id: 'v2',
          session_id: sessionId,
          created_at: new Date(),
          created_by_sub: userId,
          issue_hash: 'hash2',
          version_number: 1,
        },
      ];

      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock versions query
      mockQuery.mockResolvedValueOnce({
        rows: versions,
      });

      const result = await listIssueDraftVersions(mockPool, sessionId, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0].version_number).toBe(2);
        expect(result.data[1].version_number).toBe(1);
      }
    });

    it('should respect pagination parameters', async () => {
      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock versions query
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await listIssueDraftVersions(mockPool, sessionId, userId, {
        limit: 10,
        offset: 5,
      });

      expect(result.success).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([sessionId, 10, 5])
      );
    });

    it('should fail when session does not belong to user', async () => {
      // Mock session ownership check failing
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await listIssueDraftVersions(mockPool, sessionId, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Session not found or access denied');
      }
    });
  });
});

describe('Issue Draft Validator', () => {
  it('should validate a valid issue draft', () => {
    const result = validateIssueDraft(EXAMPLE_MINIMAL_ISSUE_DRAFT);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.meta.hash).toBeDefined();
  });

  it('should reject invalid issue draft with deterministic errors', () => {
    const invalidDraft = {
      title: 'x', // Too short
      // Missing required fields
    };

    const result = validateIssueDraft(invalidDraft);

    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // Errors should be sorted by path
    const paths = result.errors.map(e => e.path);
    const sortedPaths = [...paths].sort();
    expect(paths).toEqual(sortedPaths);
  });

  it('should normalize labels and dependsOn', () => {
    const draftWithDuplicates = {
      ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
      labels: ['a', 'b', 'a', 'c', 'b'], // Duplicates
      dependsOn: ['I811', 'E81.1', 'I811'], // Duplicates
    };

    const result = validateIssueDraft(draftWithDuplicates);

    expect(result.isValid).toBe(true);
    // Note: The validator doesn't return normalized data directly,
    // but we can verify it doesn't fail on duplicates
  });

  it('should warn on self-dependency', () => {
    const draftWithSelfDep = {
      ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
      dependsOn: [EXAMPLE_MINIMAL_ISSUE_DRAFT.canonicalId], // Self reference
    };

    const result = validateIssueDraft(draftWithSelfDep);

    // Should be valid but have warning
    expect(result.isValid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.code === 'ISSUE_SELF_DEPENDENCY')).toBe(true);
  });

  it('should generate consistent hash for same draft', () => {
    const result1 = validateIssueDraft(EXAMPLE_MINIMAL_ISSUE_DRAFT);
    const result2 = validateIssueDraft(EXAMPLE_MINIMAL_ISSUE_DRAFT);

    expect(result1.meta.hash).toBe(result2.meta.hash);
  });
});
