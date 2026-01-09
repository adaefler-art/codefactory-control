/**
 * Tests for INTENT Issue Set API Routes and Database Layer
 * Issue E81.4: Briefing → Issue Set Generator (batch from a briefing doc)
 */

import { Pool } from 'pg';
import { 
  getIssueSet, 
  generateIssueSet, 
  commitIssueSet,
  validateIssueSetItems 
} from '../../src/lib/db/intentIssueSets';
import { 
  exportIssueSetToAFU9Markdown,
  generateIssueSetSummary 
} from '../../src/lib/utils/issueSetExporter';
import { 
  validateIssueSet,
  generateBriefingHash,
  normalizeIssueSet,
  ISSUE_SET_VERSION 
} from '../../src/lib/schemas/issueSet';
import { EXAMPLE_MINIMAL_ISSUE_DRAFT } from '../../src/lib/schemas/issueDraft';
import type { IssueDraft } from '../../src/lib/schemas/issueDraft';

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

describe('INTENT Issue Sets Database Layer', () => {
  const sessionId = 'session-123';
  const userId = 'user-456';
  const briefingText = 'Create issue drafts for epic E81';

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(mockClient);
    mockClient.query = jest.fn();
  });

  describe('getIssueSet', () => {
    it('should return null when no issue set exists', async () => {
      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock issue set query returning no rows
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await getIssueSet(mockPool, sessionId, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it('should return issue set with items when it exists', async () => {
      const setData = {
        id: 'set-123',
        session_id: sessionId,
        created_at: new Date(),
        updated_at: new Date(),
        source_hash: 'abc123',
        briefing_text: briefingText,
        constraints_json: {},
        generated_at: new Date(),
        is_committed: false,
        committed_at: null,
      };

      const itemData = {
        id: 'item-1',
        issue_set_id: 'set-123',
        created_at: new Date(),
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: 'hash1',
        canonical_id: 'E81.1',
        last_validation_status: 'valid',
        last_validation_at: new Date(),
        last_validation_result: { isValid: true, errors: [], warnings: [], meta: {} },
        position: 0,
      };

      // Mock session ownership check
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: sessionId }],
      });
      
      // Mock issue set query
      mockQuery.mockResolvedValueOnce({
        rows: [setData],
      });

      // Mock items query
      mockQuery.mockResolvedValueOnce({
        rows: [itemData],
      });

      const result = await getIssueSet(mockPool, sessionId, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        expect(result.data?.id).toBe(setData.id);
        expect(result.items).toHaveLength(1);
        expect(result.items?.[0].canonical_id).toBe('E81.1');
      }
    });

    it('should fail when session does not belong to user', async () => {
      // Mock session ownership check failing
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      const result = await getIssueSet(mockPool, sessionId, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Session not found or access denied');
      }
    });
  });

  describe('generateIssueSet', () => {
    it('should generate a new issue set with items', async () => {
      const drafts: IssueDraft[] = [
        { ...EXAMPLE_MINIMAL_ISSUE_DRAFT, canonicalId: 'E81.1' },
        { ...EXAMPLE_MINIMAL_ISSUE_DRAFT, canonicalId: 'E81.2', title: 'E81.2: Second Issue' },
      ];

      const setData = {
        id: 'set-new',
        session_id: sessionId,
        created_at: new Date(),
        updated_at: new Date(),
        source_hash: 'newhash',
        briefing_text: briefingText,
        constraints_json: {},
        generated_at: new Date(),
        is_committed: false,
        committed_at: null,
      };

      // Transaction mocks
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // Session check
        .mockResolvedValueOnce({ rows: [] }) // Delete existing
        .mockResolvedValueOnce({ rows: [setData] }) // Insert set
        .mockResolvedValueOnce({ rows: [{ id: 'item-1', ...setData, issue_json: drafts[0], canonical_id: 'E81.1', position: 0 }] }) // Insert item 1
        .mockResolvedValueOnce({ rows: [{ id: 'item-2', ...setData, issue_json: drafts[1], canonical_id: 'E81.2', position: 1 }] }) // Insert item 2
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await generateIssueSet(
        mockPool,
        sessionId,
        userId,
        briefingText,
        drafts
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
        expect(result.items).toHaveLength(2);
        // Items should be sorted by canonicalId
        expect(result.items[0].canonical_id).toBe('E81.1');
        expect(result.items[1].canonical_id).toBe('E81.2');
      }
    });

    it('should fail when issue set exceeds maximum size', async () => {
      const drafts: IssueDraft[] = Array(21).fill(EXAMPLE_MINIMAL_ISSUE_DRAFT);

      // Transaction mocks
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // Session check
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      const result = await generateIssueSet(
        mockPool,
        sessionId,
        userId,
        briefingText,
        drafts
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Issue set exceeds maximum size of 20 items');
      }
    });

    it('should fail when session does not belong to user', async () => {
      const drafts: IssueDraft[] = [EXAMPLE_MINIMAL_ISSUE_DRAFT];

      // Transaction mocks
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // Session check - no match
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      const result = await generateIssueSet(
        mockPool,
        sessionId,
        userId,
        briefingText,
        drafts
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Session not found or access denied');
      }
    });
  });

  describe('commitIssueSet', () => {
    it('should commit issue set when all items are valid', async () => {
      const committedSet = {
        id: 'set-123',
        session_id: sessionId,
        created_at: new Date(),
        updated_at: new Date(),
        source_hash: 'abc123',
        briefing_text: briefingText,
        constraints_json: {},
        generated_at: new Date(),
        is_committed: true,
        committed_at: new Date(),
      };

      // Transaction mocks
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // Session check
        .mockResolvedValueOnce({ rows: [{ id: 'set-123', is_committed: false }] }) // Get set
        .mockResolvedValueOnce({ rows: [{ total: '2', valid_count: '2' }] }) // Check items - all valid
        .mockResolvedValueOnce({ rows: [committedSet] }) // Update
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await commitIssueSet(mockPool, sessionId, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.is_committed).toBe(true);
        expect(result.data.committed_at).toBeDefined();
      }
    });

    it('should fail when not all items are valid', async () => {
      // Transaction mocks
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // Session check
        .mockResolvedValueOnce({ rows: [{ id: 'set-123', is_committed: false }] }) // Get set
        .mockResolvedValueOnce({ rows: [{ total: '2', valid_count: '1' }] }) // Check items - not all valid
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      const result = await commitIssueSet(mockPool, sessionId, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Cannot commit: not all items are valid');
      }
    });

    it('should fail when issue set is already committed', async () => {
      // Transaction mocks
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // Session check
        .mockResolvedValueOnce({ rows: [{ id: 'set-123', is_committed: true }] }) // Get set - already committed
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      const result = await commitIssueSet(mockPool, sessionId, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Issue set is already committed');
      }
    });

    it('should fail when no issue set exists', async () => {
      // Transaction mocks
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // Session check
        .mockResolvedValueOnce({ rows: [] }) // Get set - no rows
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      const result = await commitIssueSet(mockPool, sessionId, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('No issue set exists for this session');
      }
    });
  });

  describe('validateIssueSetItems', () => {
    it('should validate all items in issue set', async () => {
      const items = [
        { id: 'item-1', issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT },
        { id: 'item-2', issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT },
      ];

      // Transaction mocks
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: sessionId }] }) // Session check
        .mockResolvedValueOnce({ rows: [{ id: 'set-123' }] }) // Get set
        .mockResolvedValueOnce({ rows: items }) // Get items
        .mockResolvedValueOnce({ rows: [] }) // Update item 1
        .mockResolvedValueOnce({ rows: [] }) // Update item 2
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await validateIssueSetItems(mockPool, sessionId, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.validCount).toBe(2);
        expect(result.invalidCount).toBe(0);
      }
    });
  });
});

describe('Issue Set Schema and Validation', () => {
  it('should validate a valid issue set', () => {
    const issueSet = {
      issueSetVersion: ISSUE_SET_VERSION,
      issueSetId: '123e4567-e89b-12d3-a456-426614174000',
      generatedAt: new Date().toISOString(),
      sourceHash: 'abc123',
      items: [
        {
          canonicalId: 'E81.1',
          issueDraft: EXAMPLE_MINIMAL_ISSUE_DRAFT,
          validationStatus: 'valid' as const,
        },
      ],
    };

    const result = validateIssueSet(issueSet);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
    }
  });

  it('should fail validation when issue set exceeds max items', () => {
    const items = Array(21).fill({
      canonicalId: 'E81.1',
      issueDraft: EXAMPLE_MINIMAL_ISSUE_DRAFT,
      validationStatus: 'valid' as const,
    });

    const issueSet = {
      issueSetVersion: ISSUE_SET_VERSION,
      issueSetId: '123e4567-e89b-12d3-a456-426614174000',
      generatedAt: new Date().toISOString(),
      sourceHash: 'abc123',
      items,
    };

    const result = validateIssueSet(issueSet);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.message.includes('20 items'))).toBe(true);
    }
  });

  it('should normalize issue set with stable ordering', () => {
    const issueSet = {
      issueSetVersion: ISSUE_SET_VERSION,
      issueSetId: '123e4567-e89b-12d3-a456-426614174000',
      generatedAt: new Date().toISOString(),
      sourceHash: 'abc123',
      items: [
        {
          canonicalId: 'E81.2',
          issueDraft: EXAMPLE_MINIMAL_ISSUE_DRAFT,
          validationStatus: 'valid' as const,
        },
        {
          canonicalId: 'E81.1',
          issueDraft: EXAMPLE_MINIMAL_ISSUE_DRAFT,
          validationStatus: 'valid' as const,
        },
      ],
    };

    const normalized = normalizeIssueSet(issueSet);

    // Items should be sorted by canonicalId
    expect(normalized.items[0].canonicalId).toBe('E81.1');
    expect(normalized.items[1].canonicalId).toBe('E81.2');
  });
});

describe('Briefing Hash Generation', () => {
  it('should generate deterministic hash for same input', async () => {
    const briefing = 'Create issue drafts for epic E81';
    const constraints = { maxItems: 10 };

    const hash1 = await generateBriefingHash(briefing, constraints);
    const hash2 = await generateBriefingHash(briefing, constraints);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it('should generate different hashes for different input', async () => {
    const briefing1 = 'Create issue drafts for epic E81';
    const briefing2 = 'Create issue drafts for epic E82';

    const hash1 = await generateBriefingHash(briefing1);
    const hash2 = await generateBriefingHash(briefing2);

    expect(hash1).not.toBe(hash2);
  });

  it('should generate different hashes for different constraints', async () => {
    const briefing = 'Create issue drafts for epic E81';
    const constraints1 = { maxItems: 10 };
    const constraints2 = { maxItems: 20 };

    const hash1 = await generateBriefingHash(briefing, constraints1);
    const hash2 = await generateBriefingHash(briefing, constraints2);

    expect(hash1).not.toBe(hash2);
  });
});

describe('AFU9 Markdown Exporter', () => {
  it('should export issue set to markdown format', () => {
    const items = [
      {
        id: 'item-1',
        issue_set_id: 'set-123',
        created_at: new Date().toISOString(),
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: 'hash1',
        canonical_id: 'E81.1',
        last_validation_status: 'valid' as const,
        last_validation_at: new Date().toISOString(),
        last_validation_result: null,
        position: 0,
      },
    ];

    const markdown = exportIssueSetToAFU9Markdown(items);

    expect(markdown).toContain('# AFU9 Issue Import');
    expect(markdown).toContain('E81.1: Issue Draft Schema v1');
    expect(markdown).toContain('## Acceptance Criteria');
  });

  it('should exclude invalid items by default', () => {
    const items = [
      {
        id: 'item-1',
        issue_set_id: 'set-123',
        created_at: new Date().toISOString(),
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: 'hash1',
        canonical_id: 'E81.1',
        last_validation_status: 'valid' as const,
        last_validation_at: new Date().toISOString(),
        last_validation_result: null,
        position: 0,
      },
      {
        id: 'item-2',
        issue_set_id: 'set-123',
        created_at: new Date().toISOString(),
        issue_json: { title: 'Invalid' },
        issue_hash: 'hash2',
        canonical_id: 'E81.2',
        last_validation_status: 'invalid' as const,
        last_validation_at: new Date().toISOString(),
        last_validation_result: null,
        position: 1,
      },
    ];

    const markdown = exportIssueSetToAFU9Markdown(items);

    expect(markdown).toContain('E81.1');
    expect(markdown).not.toContain('E81.2');
    expect(markdown).toContain('Total Items: 1');
  });

  it('should include invalid items when requested', () => {
    const items = [
      {
        id: 'item-1',
        issue_set_id: 'set-123',
        created_at: new Date().toISOString(),
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: 'hash1',
        canonical_id: 'E81.1',
        last_validation_status: 'valid' as const,
        last_validation_at: new Date().toISOString(),
        last_validation_result: null,
        position: 0,
      },
      {
        id: 'item-2',
        issue_set_id: 'set-123',
        created_at: new Date().toISOString(),
        issue_json: { title: 'Invalid' },
        issue_hash: 'hash2',
        canonical_id: 'E81.2',
        last_validation_status: 'invalid' as const,
        last_validation_at: new Date().toISOString(),
        last_validation_result: null,
        position: 1,
      },
    ];

    const markdown = exportIssueSetToAFU9Markdown(items, { includeInvalid: true });

    expect(markdown).toContain('Total Items: 2');
  });
});

describe('Issue Set Summary', () => {
  it('should generate correct summary', () => {
    const items = [
      {
        id: 'item-1',
        issue_set_id: 'set-123',
        created_at: new Date().toISOString(),
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: 'hash1',
        canonical_id: 'E81.1',
        last_validation_status: 'valid' as const,
        last_validation_at: new Date().toISOString(),
        last_validation_result: null,
        position: 0,
      },
      {
        id: 'item-2',
        issue_set_id: 'set-123',
        created_at: new Date().toISOString(),
        issue_json: {},
        issue_hash: 'hash2',
        canonical_id: 'E81.2',
        last_validation_status: 'invalid' as const,
        last_validation_at: new Date().toISOString(),
        last_validation_result: null,
        position: 1,
      },
      {
        id: 'item-3',
        issue_set_id: 'set-123',
        created_at: new Date().toISOString(),
        issue_json: {},
        issue_hash: 'hash3',
        canonical_id: 'E81.3',
        last_validation_status: 'unknown' as const,
        last_validation_at: null,
        last_validation_result: null,
        position: 2,
      },
    ];

    const summary = generateIssueSetSummary(items);

    expect(summary.total).toBe(3);
    expect(summary.valid).toBe(1);
    expect(summary.invalid).toBe(1);
    expect(summary.unknown).toBe(1);
    expect(summary.allValid).toBe(false);
  });

  it('should detect when all items are valid', () => {
    const items = [
      {
        id: 'item-1',
        issue_set_id: 'set-123',
        created_at: new Date().toISOString(),
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: 'hash1',
        canonical_id: 'E81.1',
        last_validation_status: 'valid' as const,
        last_validation_at: new Date().toISOString(),
        last_validation_result: null,
        position: 0,
      },
      {
        id: 'item-2',
        issue_set_id: 'set-123',
        created_at: new Date().toISOString(),
        issue_json: EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issue_hash: 'hash2',
        canonical_id: 'E81.2',
        last_validation_status: 'valid' as const,
        last_validation_at: new Date().toISOString(),
        last_validation_result: null,
        position: 1,
      },
    ];

    const summary = generateIssueSetSummary(items);

    expect(summary.allValid).toBe(true);
  });
});
