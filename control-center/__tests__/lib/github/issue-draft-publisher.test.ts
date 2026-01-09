/**
 * Tests for IssueDraft Batch Publisher (E82.1)
 */

import {
  publishIssueDraftBatch,
  ERROR_CODES,
} from '../../../src/lib/github/issue-draft-publisher';
import { EXAMPLE_MINIMAL_ISSUE_DRAFT, EXAMPLE_FULL_ISSUE_DRAFT } from '../../../src/lib/schemas/issueDraft';
import type { IssueDraft } from '../../../src/lib/schemas/issueDraft';

// Mock dependencies
jest.mock('../../../src/lib/github/canonical-id-resolver');
jest.mock('../../../src/lib/github/auth-wrapper');
jest.mock('../../../src/lib/validators/issueDraftValidator');

import { resolveCanonicalId } from '../../../src/lib/github/canonical-id-resolver';
import { createAuthenticatedClient } from '../../../src/lib/github/auth-wrapper';
import { validateIssueDraft } from '../../../src/lib/validators/issueDraftValidator';

const mockResolveCanonicalId = resolveCanonicalId as jest.MockedFunction<typeof resolveCanonicalId>;
const mockCreateAuthenticatedClient = createAuthenticatedClient as jest.MockedFunction<typeof createAuthenticatedClient>;
const mockValidateIssueDraft = validateIssueDraft as jest.MockedFunction<typeof validateIssueDraft>;

// Mock Octokit
const mockOctokit = {
  rest: {
    issues: {
      create: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
    },
  },
};

describe('IssueDraft Batch Publisher', () => {
  const owner = 'test-owner';
  const repo = 'test-repo';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mocks
    mockCreateAuthenticatedClient.mockResolvedValue(mockOctokit as any);
    mockValidateIssueDraft.mockReturnValue({
      isValid: true,
      errors: [],
      warnings: [],
      meta: {},
    });
  });

  describe('publishIssueDraftBatch', () => {
    it('should successfully publish multiple drafts', async () => {
      const drafts = [EXAMPLE_MINIMAL_ISSUE_DRAFT, EXAMPLE_FULL_ISSUE_DRAFT];

      // Mock resolveCanonicalId for both drafts (not found -> create)
      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'not_found',
        canonicalId: EXAMPLE_MINIMAL_ISSUE_DRAFT.canonicalId,
      });
      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'not_found',
        canonicalId: EXAMPLE_FULL_ISSUE_DRAFT.canonicalId,
      });

      // Mock issue creation
      mockOctokit.rest.issues.create
        .mockResolvedValueOnce({
          data: {
            number: 1,
            html_url: 'https://github.com/test/issue/1',
          },
        } as any)
        .mockResolvedValueOnce({
          data: {
            number: 2,
            html_url: 'https://github.com/test/issue/2',
          },
        } as any);

      const result = await publishIssueDraftBatch(drafts, owner, repo);

      expect(result.total).toBe(2);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].mode).toBe('created');
      expect(result.results[1].success).toBe(true);
      expect(result.results[1].mode).toBe('created');
    });

    it('should update existing issues', async () => {
      const drafts = [EXAMPLE_MINIMAL_ISSUE_DRAFT];

      // Mock resolveCanonicalId (found -> update)
      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'found',
        canonicalId: EXAMPLE_MINIMAL_ISSUE_DRAFT.canonicalId,
        issueNumber: 42,
      });

      // Mock get issue (for existing labels)
      mockOctokit.rest.issues.get.mockResolvedValueOnce({
        data: {
          labels: [{ name: 'existing-label' }],
        },
      } as any);

      // Mock issue update
      mockOctokit.rest.issues.update.mockResolvedValueOnce({
        data: {
          number: 42,
          html_url: 'https://github.com/test/issue/42',
        },
      } as any);

      const result = await publishIssueDraftBatch(drafts, owner, repo);

      expect(result.total).toBe(1);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.results[0].mode).toBe('updated');
      expect(result.results[0].issueNumber).toBe(42);
    });

    it('should handle partial failures and continue processing', async () => {
      const drafts = [EXAMPLE_MINIMAL_ISSUE_DRAFT, EXAMPLE_FULL_ISSUE_DRAFT];

      // First draft fails validation
      mockValidateIssueDraft
        .mockReturnValueOnce({
          isValid: false,
          errors: [{ path: 'title', message: 'Title too short' }],
          warnings: [],
          meta: {},
        })
        .mockReturnValueOnce({
          isValid: true,
          errors: [],
          warnings: [],
          meta: {},
        });

      // Second draft succeeds
      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'not_found',
        canonicalId: EXAMPLE_FULL_ISSUE_DRAFT.canonicalId,
      });

      mockOctokit.rest.issues.create.mockResolvedValueOnce({
        data: {
          number: 2,
          html_url: 'https://github.com/test/issue/2',
        },
      } as any);

      const result = await publishIssueDraftBatch(drafts, owner, repo);

      expect(result.total).toBe(2);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].errorCode).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(result.results[1].success).toBe(true);
    });

    it('should handle repo access denied errors', async () => {
      const drafts = [EXAMPLE_MINIMAL_ISSUE_DRAFT];

      mockResolveCanonicalId.mockRejectedValueOnce(
        Object.assign(new Error('Repo access denied'), { name: 'RepoAccessDeniedError' })
      );

      const result = await publishIssueDraftBatch(drafts, owner, repo);

      expect(result.total).toBe(1);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].errorCode).toBe(ERROR_CODES.REPO_ACCESS_DENIED);
    });

    it('should fail all drafts if owner or repo is missing', async () => {
      const drafts = [EXAMPLE_MINIMAL_ISSUE_DRAFT];

      const result = await publishIssueDraftBatch(drafts, '', repo);

      expect(result.total).toBe(1);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].errorCode).toBe(ERROR_CODES.MISSING_REPO_INFO);
    });

    it('should handle empty draft array', async () => {
      const result = await publishIssueDraftBatch([], owner, repo);

      expect(result.total).toBe(0);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it('should be idempotent when publishing same draft multiple times', async () => {
      const drafts = [EXAMPLE_MINIMAL_ISSUE_DRAFT];

      // First call: issue not found -> create
      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'not_found',
        canonicalId: EXAMPLE_MINIMAL_ISSUE_DRAFT.canonicalId,
      });

      mockOctokit.rest.issues.create.mockResolvedValueOnce({
        data: {
          number: 1,
          html_url: 'https://github.com/test/issue/1',
        },
      } as any);

      const result1 = await publishIssueDraftBatch(drafts, owner, repo);

      // Second call: issue found -> update
      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'found',
        canonicalId: EXAMPLE_MINIMAL_ISSUE_DRAFT.canonicalId,
        issueNumber: 1,
      });

      mockOctokit.rest.issues.get.mockResolvedValueOnce({
        data: {
          labels: EXAMPLE_MINIMAL_ISSUE_DRAFT.labels.map(name => ({ name })),
        },
      } as any);

      mockOctokit.rest.issues.update.mockResolvedValueOnce({
        data: {
          number: 1,
          html_url: 'https://github.com/test/issue/1',
        },
      } as any);

      const result2 = await publishIssueDraftBatch(drafts, owner, repo);

      // Both should succeed
      expect(result1.successful).toBe(1);
      expect(result2.successful).toBe(1);
      
      // Same issue number
      expect(result1.results[0].issueNumber).toBe(1);
      expect(result2.results[0].issueNumber).toBe(1);
    });

    it('should include rendered hash in successful results', async () => {
      const drafts = [EXAMPLE_MINIMAL_ISSUE_DRAFT];

      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'not_found',
        canonicalId: EXAMPLE_MINIMAL_ISSUE_DRAFT.canonicalId,
      });

      mockOctokit.rest.issues.create.mockResolvedValueOnce({
        data: {
          number: 1,
          html_url: 'https://github.com/test/issue/1',
        },
      } as any);

      const result = await publishIssueDraftBatch(drafts, owner, repo);

      expect(result.results[0].renderedHash).toBeDefined();
      expect(result.results[0].renderedHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should apply labels from draft to created issue', async () => {
      const drafts = [EXAMPLE_MINIMAL_ISSUE_DRAFT];

      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'not_found',
        canonicalId: EXAMPLE_MINIMAL_ISSUE_DRAFT.canonicalId,
      });

      mockOctokit.rest.issues.create.mockResolvedValueOnce({
        data: {
          number: 1,
          html_url: 'https://github.com/test/issue/1',
        },
      } as any);

      await publishIssueDraftBatch(drafts, owner, repo);

      expect(mockOctokit.rest.issues.create).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: EXAMPLE_MINIMAL_ISSUE_DRAFT.labels,
        })
      );
    });
  });
});
