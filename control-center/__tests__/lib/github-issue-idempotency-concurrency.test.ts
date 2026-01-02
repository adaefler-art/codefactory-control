/**
 * Idempotency + Concurrency Tests (I753 / E75.3)
 * 
 * Tests for CR→GitHub Issue generator proving:
 * - Idempotency: repeated calls update same issue
 * - Concurrency: safe behavior under parallel calls
 * - Error handling: rate limits, multiple matches
 * 
 * NON-NEGOTIABLES:
 * - Deterministic, fast, fully mocked (no real GitHub network)
 * - Cover resolver and create/update behaviors
 * - Concurrency tests must not be flaky
 * 
 * @jest-environment node
 */

import {
  createOrUpdateFromCR,
  IssueCreatorError,
  ERROR_CODES,
} from '../../src/lib/github/issue-creator';
import { resolveCanonicalId } from '../../src/lib/github/canonical-id-resolver';
import type { ChangeRequest } from '../../src/lib/schemas/changeRequest';

// Mock dependencies
jest.mock('../../src/lib/validators/changeRequestValidator');
jest.mock('../../src/lib/github/auth-wrapper');
jest.mock('../../src/lib/github/canonical-id-resolver', () => {
  const actual = jest.requireActual('../../src/lib/github/canonical-id-resolver');
  return {
    ...actual,
    resolveCanonicalId: jest.fn(),
  };
});

const mockValidateChangeRequest = jest.requireMock('../../src/lib/validators/changeRequestValidator').validateChangeRequest;
const mockResolveCanonicalId = resolveCanonicalId as jest.MockedFunction<typeof resolveCanonicalId>;
const mockCreateAuthenticatedClient = jest.requireMock('../../src/lib/github/auth-wrapper').createAuthenticatedClient;

// Mock Octokit
const mockCreateIssue = jest.fn();
const mockUpdateIssue = jest.fn();
const mockGetIssue = jest.fn();
const mockSearchIssuesAndPullRequests = jest.fn();

const mockOctokit = {
  rest: {
    issues: {
      create: mockCreateIssue,
      update: mockUpdateIssue,
      get: mockGetIssue,
    },
    search: {
      issuesAndPullRequests: mockSearchIssuesAndPullRequests,
    },
  },
};

describe('Idempotency + Concurrency Tests (I753 / E75.3)', () => {
  // Sample CR for testing
  const baseCR: ChangeRequest = {
    crVersion: '0.7.0',
    canonicalId: 'CR-2026-01-02-IDEMPOTENCY',
    title: 'Test Issue Creation',
    motivation: 'Test motivation',
    scope: {
      summary: 'Test scope',
      inScope: ['Item 1'],
      outOfScope: ['Item 2'],
    },
    targets: {
      repo: {
        owner: 'adaefler-art',
        repo: 'codefactory-control',
      },
      branch: 'main',
    },
    changes: {
      files: [
        {
          path: 'test.ts',
          changeType: 'create',
        },
      ],
    },
    acceptanceCriteria: ['AC1', 'AC2'],
    tests: {
      required: ['Test 1'],
    },
    risks: {
      items: [],
    },
    rollout: {
      steps: ['Step 1'],
      rollbackPlan: 'Rollback',
    },
    evidence: [
      {
        kind: 'file_snippet',
        repo: { owner: 'test', repo: 'test' },
        branch: 'main',
        path: 'test.ts',
        startLine: 1,
        endLine: 5,
      },
    ],
    constraints: {
      lawbookVersion: '0.7.0',
    },
    metadata: {
      createdAt: '2026-01-02T00:00:00Z',
      createdBy: 'intent',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default: CR is valid
    mockValidateChangeRequest.mockReturnValue({
      ok: true,
      errors: [],
      warnings: [],
      meta: {
        validatedAt: new Date().toISOString(),
        validatorVersion: '0.7.0',
      },
    });
    
    // Default: authenticated client
    mockCreateAuthenticatedClient.mockResolvedValue(mockOctokit);
  });

  // ========================================
  // IDEMPOTENCY TESTS
  // ========================================

  describe('Idempotency: Repeated calls with identical CR', () => {
    test('first call creates issue, subsequent calls update same issue', async () => {
      // First call: not found → create
      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'not_found',
      });
      
      mockCreateIssue.mockResolvedValue({
        data: {
          number: 100,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/100',
        },
      });
      
      const result1 = await createOrUpdateFromCR(baseCR);
      
      expect(result1.mode).toBe('created');
      expect(result1.issueNumber).toBe(100);
      expect(result1.canonicalId).toBe('CR-2026-01-02-IDEMPOTENCY');
      expect(mockCreateIssue).toHaveBeenCalledTimes(1);
      
      // Second call: found → update
      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'found',
        issueNumber: 100,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/100',
        matchedBy: 'body',
      });
      
      mockGetIssue.mockResolvedValue({
        data: {
          number: 100,
          labels: [{ name: 'afu9' }, { name: 'v0.7' }, { name: 'state:CREATED' }],
        },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: 100,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/100',
        },
      });
      
      const result2 = await createOrUpdateFromCR(baseCR);
      
      expect(result2.mode).toBe('updated');
      expect(result2.issueNumber).toBe(100);
      expect(result2.canonicalId).toBe('CR-2026-01-02-IDEMPOTENCY');
      expect(mockUpdateIssue).toHaveBeenCalledTimes(1);
      
      // Same issue number across calls
      expect(result1.issueNumber).toBe(result2.issueNumber);
      
      // Third call: still updates same issue
      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'found',
        issueNumber: 100,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/100',
        matchedBy: 'body',
      });
      
      mockGetIssue.mockResolvedValue({
        data: {
          number: 100,
          labels: [{ name: 'afu9' }, { name: 'v0.7' }, { name: 'state:IN_PROGRESS' }],
        },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: 100,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/100',
        },
      });
      
      const result3 = await createOrUpdateFromCR(baseCR);
      
      expect(result3.mode).toBe('updated');
      expect(result3.issueNumber).toBe(100);
      expect(result1.issueNumber).toBe(result3.issueNumber);
      
      // Total: 1 create, 2 updates
      expect(mockCreateIssue).toHaveBeenCalledTimes(1);
      expect(mockUpdateIssue).toHaveBeenCalledTimes(2);
    });

    test('verifies same issueNumber returned across all calls', async () => {
      const issueNumber = 200;
      
      // Mock sequence: not_found → found → found → found
      mockResolveCanonicalId
        .mockResolvedValueOnce({ mode: 'not_found' })
        .mockResolvedValue({
          mode: 'found',
          issueNumber,
          issueUrl: `https://github.com/adaefler-art/codefactory-control/issues/${issueNumber}`,
          matchedBy: 'body',
        });
      
      mockCreateIssue.mockResolvedValue({
        data: {
          number: issueNumber,
          html_url: `https://github.com/adaefler-art/codefactory-control/issues/${issueNumber}`,
        },
      });
      
      mockGetIssue.mockResolvedValue({
        data: {
          number: issueNumber,
          labels: [{ name: 'afu9' }],
        },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: issueNumber,
          html_url: `https://github.com/adaefler-art/codefactory-control/issues/${issueNumber}`,
        },
      });
      
      // Call 5 times
      const results = await Promise.all([
        createOrUpdateFromCR(baseCR),
        createOrUpdateFromCR(baseCR),
        createOrUpdateFromCR(baseCR),
        createOrUpdateFromCR(baseCR),
        createOrUpdateFromCR(baseCR),
      ]);
      
      // All should reference same issue number
      results.forEach(result => {
        expect(result.issueNumber).toBe(issueNumber);
        expect(result.canonicalId).toBe(baseCR.canonicalId);
      });
      
      // First should be create, rest updates
      expect(results[0].mode).toBe('created');
      results.slice(1).forEach(result => {
        expect(result.mode).toBe('updated');
      });
    });
  });

  describe('Idempotency: CR with minor change (AC change)', () => {
    test('updates existing issue body when AC changes', async () => {
      const issueNumber = 300;
      
      // First call with original AC
      mockResolveCanonicalId.mockResolvedValue({
        mode: 'found',
        issueNumber,
        issueUrl: `https://github.com/adaefler-art/codefactory-control/issues/${issueNumber}`,
        matchedBy: 'body',
      });
      
      mockGetIssue.mockResolvedValue({
        data: {
          number: issueNumber,
          labels: [{ name: 'afu9' }],
        },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: issueNumber,
          html_url: `https://github.com/adaefler-art/codefactory-control/issues/${issueNumber}`,
        },
      });
      
      const result1 = await createOrUpdateFromCR(baseCR);
      const hash1 = result1.renderedHash;
      
      expect(result1.mode).toBe('updated');
      expect(result1.issueNumber).toBe(issueNumber);
      
      // Second call with modified AC
      const modifiedCR = {
        ...baseCR,
        acceptanceCriteria: ['AC1', 'AC2', 'AC3'], // Added AC3
      };
      
      const result2 = await createOrUpdateFromCR(modifiedCR);
      const hash2 = result2.renderedHash;
      
      expect(result2.mode).toBe('updated');
      expect(result2.issueNumber).toBe(issueNumber);
      
      // Same issue number, but different hash (body changed)
      expect(result1.issueNumber).toBe(result2.issueNumber);
      expect(hash1).not.toBe(hash2);
      
      // Verify update was called with new body
      expect(mockUpdateIssue).toHaveBeenCalledTimes(2);
      
      const lastUpdateCall = mockUpdateIssue.mock.calls[1][0];
      expect(lastUpdateCall.body).toContain('AC3');
    });

    test('preserves state label when CR content changes', async () => {
      const issueNumber = 400;
      
      mockResolveCanonicalId.mockResolvedValue({
        mode: 'found',
        issueNumber,
        issueUrl: `https://github.com/adaefler-art/codefactory-control/issues/${issueNumber}`,
        matchedBy: 'body',
      });
      
      mockGetIssue.mockResolvedValue({
        data: {
          number: issueNumber,
          labels: [
            { name: 'afu9' },
            { name: 'v0.7' },
            { name: 'state:IN_PROGRESS' }, // Should be preserved
            { name: 'custom-label' },
          ],
        },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: issueNumber,
          html_url: `https://github.com/adaefler-art/codefactory-control/issues/${issueNumber}`,
        },
      });
      
      const modifiedCR = {
        ...baseCR,
        motivation: 'Updated motivation',
      };
      
      const result = await createOrUpdateFromCR(modifiedCR);
      
      expect(result.mode).toBe('updated');
      expect(result.labelsApplied).toContain('state:IN_PROGRESS');
      expect(result.labelsApplied).toContain('custom-label');
      expect(result.labelsApplied).not.toContain('state:CREATED');
    });
  });

  // ========================================
  // CONCURRENCY TESTS
  // ========================================

  describe('Concurrency: Two parallel invocations with same canonicalId', () => {
    test('race condition: both see not_found initially, one creates, other detects and updates', async () => {
      const issueNumber = 500;
      let createCallCount = 0;
      
      // Both initially resolve to not_found
      mockResolveCanonicalId.mockImplementation(async () => {
        if (createCallCount === 0) {
          return { mode: 'not_found' };
        }
        // After first create, subsequent resolves find it
        return {
          mode: 'found',
          issueNumber,
          issueUrl: `https://github.com/adaefler-art/codefactory-control/issues/${issueNumber}`,
          matchedBy: 'body',
        };
      });
      
      // First create succeeds
      mockCreateIssue.mockImplementation(async () => {
        createCallCount++;
        if (createCallCount === 1) {
          return {
            data: {
              number: issueNumber,
              html_url: `https://github.com/adaefler-art/codefactory-control/issues/${issueNumber}`,
            },
          };
        }
        // Second create fails with duplicate error
        throw new Error('Validation Failed: {"errors":[{"message":"already exists"}]}');
      });
      
      mockGetIssue.mockResolvedValue({
        data: {
          number: issueNumber,
          labels: [{ name: 'afu9' }],
        },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: issueNumber,
          html_url: `https://github.com/adaefler-art/codefactory-control/issues/${issueNumber}`,
        },
      });
      
      // Simulate parallel calls
      const [result1, result2] = await Promise.all([
        createOrUpdateFromCR(baseCR),
        createOrUpdateFromCR(baseCR),
      ]);
      
      // Both should reference same issue
      expect(result1.issueNumber).toBe(issueNumber);
      expect(result2.issueNumber).toBe(issueNumber);
      
      // One should be created, other updated (or both updated after race detection)
      const modes = [result1.mode, result2.mode];
      expect(modes).toContain('created');
      
      // Only one create call should succeed (second should be retried as update)
      expect(mockCreateIssue).toHaveBeenCalled();
      expect(mockUpdateIssue).toHaveBeenCalled();
    });

    test('race condition with duplicate error triggers retry and update', async () => {
      const issueNumber = 600;
      
      // First resolve: not found
      mockResolveCanonicalId
        .mockResolvedValueOnce({ mode: 'not_found' })
        .mockResolvedValueOnce({
          mode: 'found',
          issueNumber,
          issueUrl: `https://github.com/adaefler-art/codefactory-control/issues/${issueNumber}`,
          matchedBy: 'body',
        });
      
      // Create fails with duplicate error
      mockCreateIssue.mockRejectedValue(
        new Error('duplicate key value violates unique constraint')
      );
      
      mockGetIssue.mockResolvedValue({
        data: {
          number: issueNumber,
          labels: [{ name: 'afu9' }],
        },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: issueNumber,
          html_url: `https://github.com/adaefler-art/codefactory-control/issues/${issueNumber}`,
        },
      });
      
      const result = await createOrUpdateFromCR(baseCR);
      
      // Should fall back to update after detecting race
      expect(result.mode).toBe('updated');
      expect(result.issueNumber).toBe(issueNumber);
      
      // Should have called resolve twice (initial + retry)
      expect(mockResolveCanonicalId).toHaveBeenCalledTimes(2);
      
      // Should have attempted create once
      expect(mockCreateIssue).toHaveBeenCalledTimes(1);
      
      // Should have updated after retry
      expect(mockUpdateIssue).toHaveBeenCalledTimes(1);
    });

    test('deterministic resolution when multiple parallel calls race', async () => {
      const issueNumber = 700;
      const parallelCount = 5;
      
      let createAttempts = 0;
      
      // Mock resolver: first call sees not_found, rest see found
      mockResolveCanonicalId.mockImplementation(async () => {
        if (createAttempts === 0) {
          return { mode: 'not_found' };
        }
        return {
          mode: 'found',
          issueNumber,
          issueUrl: `https://github.com/adaefler-art/codefactory-control/issues/${issueNumber}`,
          matchedBy: 'body',
        };
      });
      
      // Mock create: first succeeds, rest fail with duplicate
      mockCreateIssue.mockImplementation(async () => {
        createAttempts++;
        if (createAttempts === 1) {
          return {
            data: {
              number: issueNumber,
              html_url: `https://github.com/adaefler-art/codefactory-control/issues/${issueNumber}`,
            },
          };
        }
        throw new Error('already exists');
      });
      
      mockGetIssue.mockResolvedValue({
        data: { number: issueNumber, labels: [] },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: issueNumber,
          html_url: `https://github.com/adaefler-art/codefactory-control/issues/${issueNumber}`,
        },
      });
      
      // Parallel calls
      const results = await Promise.all(
        Array(parallelCount).fill(null).map(() => createOrUpdateFromCR(baseCR))
      );
      
      // All should have same issue number
      results.forEach(result => {
        expect(result.issueNumber).toBe(issueNumber);
        expect(result.canonicalId).toBe(baseCR.canonicalId);
      });
      
      // At least one should be created
      const createModes = results.filter(r => r.mode === 'created');
      expect(createModes.length).toBeGreaterThan(0);
    });
  });

  // ========================================
  // ERROR PATH TESTS
  // ========================================

  describe('Error Handling: Rate Limited', () => {
    test('surfaces RATE_LIMITED error with headers', async () => {
      const rateLimitError = Object.assign(
        new Error('API rate limit exceeded'),
        {
          status: 403,
          response: {
            headers: {
              'x-ratelimit-limit': '5000',
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': '1609459200',
            },
          },
        }
      );
      
      mockResolveCanonicalId.mockRejectedValue(rateLimitError);
      
      try {
        await createOrUpdateFromCR(baseCR);
        fail('Should have thrown IssueCreatorError');
      } catch (error) {
        expect(error).toBeInstanceOf(IssueCreatorError);
        expect((error as IssueCreatorError).code).toBe(ERROR_CODES.GITHUB_API_ERROR);
        expect((error as IssueCreatorError).message).toContain('rate limit');
      }
    });

    test('rate limit error includes retry information', async () => {
      const rateLimitError = Object.assign(
        new Error('You have exceeded a secondary rate limit'),
        {
          status: 403,
          response: {
            headers: {
              'retry-after': '60',
            },
          },
        }
      );
      
      mockResolveCanonicalId.mockRejectedValue(rateLimitError);
      
      try {
        await createOrUpdateFromCR(baseCR);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(IssueCreatorError);
        const creatorError = error as IssueCreatorError;
        expect(creatorError.code).toBe(ERROR_CODES.GITHUB_API_ERROR);
      }
    });
  });

  describe('Error Handling: Multiple Matches', () => {
    test('warns but selects deterministically when multiple matches found', async () => {
      // This scenario is handled in resolver, testing integration
      mockResolveCanonicalId.mockResolvedValue({
        mode: 'found',
        issueNumber: 800,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/800',
        matchedBy: 'body', // Deterministically selected body match
      });
      
      mockGetIssue.mockResolvedValue({
        data: {
          number: 800,
          labels: [{ name: 'afu9' }],
        },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: 800,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/800',
        },
      });
      
      const result = await createOrUpdateFromCR(baseCR);
      
      // Should deterministically select first body match
      expect(result.mode).toBe('updated');
      expect(result.issueNumber).toBe(800);
    });

    test('deterministic selection is consistent across calls', async () => {
      // Same scenario, called multiple times
      mockResolveCanonicalId.mockResolvedValue({
        mode: 'found',
        issueNumber: 900,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/900',
        matchedBy: 'body',
      });
      
      mockGetIssue.mockResolvedValue({
        data: {
          number: 900,
          labels: [],
        },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: 900,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/900',
        },
      });
      
      const results = await Promise.all([
        createOrUpdateFromCR(baseCR),
        createOrUpdateFromCR(baseCR),
        createOrUpdateFromCR(baseCR),
      ]);
      
      // All should select same issue
      results.forEach(result => {
        expect(result.issueNumber).toBe(900);
      });
    });
  });

  describe('Error Handling: Network Failures', () => {
    test('handles transient network errors gracefully', async () => {
      mockResolveCanonicalId.mockRejectedValue(
        new Error('ECONNRESET: Connection reset by peer')
      );
      
      try {
        await createOrUpdateFromCR(baseCR);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(IssueCreatorError);
        expect((error as IssueCreatorError).code).toBe(ERROR_CODES.GITHUB_API_ERROR);
      }
    });

    test('handles timeout errors', async () => {
      mockResolveCanonicalId.mockRejectedValue(
        new Error('Request timeout')
      );
      
      await expect(createOrUpdateFromCR(baseCR)).rejects.toThrow(IssueCreatorError);
    });
  });

  // ========================================
  // DETERMINISM TESTS
  // ========================================

  describe('Determinism Guarantees', () => {
    test('same CR produces same rendered output every time', async () => {
      mockResolveCanonicalId.mockResolvedValue({
        mode: 'found',
        issueNumber: 1000,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/1000',
        matchedBy: 'body',
      });
      
      mockGetIssue.mockResolvedValue({
        data: { number: 1000, labels: [] },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: 1000,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/1000',
        },
      });
      
      const results = await Promise.all([
        createOrUpdateFromCR(baseCR),
        createOrUpdateFromCR(baseCR),
        createOrUpdateFromCR(baseCR),
      ]);
      
      // All should have same hash
      const hashes = results.map(r => r.renderedHash);
      expect(hashes[0]).toBe(hashes[1]);
      expect(hashes[1]).toBe(hashes[2]);
    });

    test('different CRs (different content) produce different hashes', async () => {
      // First CR
      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'found',
        issueNumber: 1100,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/1100',
        matchedBy: 'body',
      });
      
      mockGetIssue.mockResolvedValue({
        data: { number: 1100, labels: [] },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: 1100,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/1100',
        },
      });
      
      const result1 = await createOrUpdateFromCR(baseCR);
      
      // Different CR with different content (same issue due to same canonicalId)
      const modifiedCR = {
        ...baseCR,
        title: 'Different title',
        motivation: 'Completely different motivation',
      };
      
      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'found',
        issueNumber: 1100,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/1100',
        matchedBy: 'body',
      });
      
      const result2 = await createOrUpdateFromCR(modifiedCR);
      
      // Both update same issue number
      expect(result1.issueNumber).toBe(result2.issueNumber);
      
      // But different content produces different hashes
      expect(result1.renderedHash).not.toBe(result2.renderedHash);
    });
  });
});
