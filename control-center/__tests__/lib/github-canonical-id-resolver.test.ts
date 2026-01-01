/**
 * Canonical-ID Resolver Tests (I751 / E75.1)
 * 
 * Tests for canonical ID resolver functions:
 * - Marker extraction (title and body)
 * - Issue matching logic
 * - Resolver algorithm (find existing issue)
 * - Policy enforcement
 * - Idempotency and determinism
 * - Error handling
 * 
 * @jest-environment node
 */

import {
  extractCanonicalIdFromTitle,
  extractCanonicalIdFromBody,
  checkIssueMatch,
  resolveCanonicalId,
  generateTitleWithMarker,
  generateBodyWithMarker,
  CanonicalIdResolverError,
} from '../../src/lib/github/canonical-id-resolver';

// Mock dependencies
jest.mock('../../src/lib/github/auth-wrapper');

const mockCreateAuthenticatedClient = jest.requireMock('../../src/lib/github/auth-wrapper').createAuthenticatedClient;

// Mock Octokit
const mockSearchIssuesAndPullRequests = jest.fn();

const mockOctokit = {
  rest: {
    search: {
      issuesAndPullRequests: mockSearchIssuesAndPullRequests,
    },
  },
};

describe('Canonical-ID Resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateAuthenticatedClient.mockResolvedValue(mockOctokit);
  });

  // ========================================
  // Marker Extraction Tests
  // ========================================

  describe('extractCanonicalIdFromTitle', () => {
    test('extracts canonical ID from valid title marker', () => {
      const result = extractCanonicalIdFromTitle('[CID:CR-2026-01-01-001] Fix bug');
      expect(result).toBe('CR-2026-01-01-001');
    });

    test('extracts canonical ID with extra whitespace', () => {
      const result = extractCanonicalIdFromTitle('[CID: CR-2026-01-01-001 ] Fix bug');
      expect(result).toBe('CR-2026-01-01-001');
    });

    test('returns null for title without marker', () => {
      const result = extractCanonicalIdFromTitle('Regular title without marker');
      expect(result).toBeNull();
    });

    test('returns null for title with incomplete marker (missing closing bracket)', () => {
      const result = extractCanonicalIdFromTitle('[CID:CR-2026-01-01-001 Missing closing bracket');
      expect(result).toBeNull();
    });

    test('returns null for title with empty canonical ID', () => {
      const result = extractCanonicalIdFromTitle('[CID:] Empty ID');
      expect(result).toBeNull();
    });

    test('returns null for empty string', () => {
      const result = extractCanonicalIdFromTitle('');
      expect(result).toBeNull();
    });

    test('returns null for non-string input', () => {
      const result = extractCanonicalIdFromTitle(null as any);
      expect(result).toBeNull();
    });

    test('handles complex canonical IDs', () => {
      const result = extractCanonicalIdFromTitle('[CID:PROJ-2026-Q1-FEAT-001-v2.1] Complex ID');
      expect(result).toBe('PROJ-2026-Q1-FEAT-001-v2.1');
    });
  });

  describe('extractCanonicalIdFromBody', () => {
    test('extracts canonical ID from valid body marker', () => {
      const body = 'Description text\n\nCanonical-ID: CR-2026-01-01-001\n\nMore text';
      const result = extractCanonicalIdFromBody(body);
      expect(result).toBe('CR-2026-01-01-001');
    });

    test('extracts canonical ID from first line', () => {
      const body = 'Canonical-ID: CR-2026-01-01-001\nDescription';
      const result = extractCanonicalIdFromBody(body);
      expect(result).toBe('CR-2026-01-01-001');
    });

    test('extracts canonical ID with extra whitespace', () => {
      const body = 'Canonical-ID:   CR-2026-01-01-001   \n';
      const result = extractCanonicalIdFromBody(body);
      expect(result).toBe('CR-2026-01-01-001');
    });

    test('returns null for body without marker', () => {
      const body = 'Regular body text without marker';
      const result = extractCanonicalIdFromBody(body);
      expect(result).toBeNull();
    });

    test('returns null for null body', () => {
      const result = extractCanonicalIdFromBody(null);
      expect(result).toBeNull();
    });

    test('returns null for undefined body', () => {
      const result = extractCanonicalIdFromBody(undefined);
      expect(result).toBeNull();
    });

    test('returns null for empty string', () => {
      const result = extractCanonicalIdFromBody('');
      expect(result).toBeNull();
    });

    test('returns first occurrence when multiple markers exist', () => {
      const body = 'Canonical-ID: CR-001\nSome text\nCanonical-ID: CR-002';
      const result = extractCanonicalIdFromBody(body);
      expect(result).toBe('CR-001');
    });

    test('handles Windows line endings', () => {
      const body = 'Description\r\nCanonical-ID: CR-2026-01-01-001\r\nMore';
      const result = extractCanonicalIdFromBody(body);
      expect(result).toBe('CR-2026-01-01-001');
    });
  });

  // ========================================
  // Issue Matching Tests
  // ========================================

  describe('checkIssueMatch', () => {
    test('matches issue by body marker', () => {
      const issue = {
        title: 'Regular title',
        body: 'Canonical-ID: CR-001\nDescription',
      };
      const result = checkIssueMatch(issue, 'CR-001');
      expect(result).toEqual({ matched: true, matchedBy: 'body' });
    });

    test('matches issue by title marker', () => {
      const issue = {
        title: '[CID:CR-001] Fix bug',
        body: 'Description without marker',
      };
      const result = checkIssueMatch(issue, 'CR-001');
      expect(result).toEqual({ matched: true, matchedBy: 'title' });
    });

    test('prefers body marker over title marker when both exist', () => {
      const issue = {
        title: '[CID:CR-001] Fix bug',
        body: 'Canonical-ID: CR-001\nDescription',
      };
      const result = checkIssueMatch(issue, 'CR-001');
      expect(result).toEqual({ matched: true, matchedBy: 'body' });
    });

    test('does not match when canonical ID differs', () => {
      const issue = {
        title: '[CID:CR-001] Fix bug',
        body: 'Canonical-ID: CR-002',
      };
      const result = checkIssueMatch(issue, 'CR-003');
      expect(result).toEqual({ matched: false });
    });

    test('does not match when no markers present', () => {
      const issue = {
        title: 'Regular title',
        body: 'Regular body',
      };
      const result = checkIssueMatch(issue, 'CR-001');
      expect(result).toEqual({ matched: false });
    });

    test('handles null body', () => {
      const issue = {
        title: '[CID:CR-001] Fix bug',
        body: null,
      };
      const result = checkIssueMatch(issue, 'CR-001');
      expect(result).toEqual({ matched: true, matchedBy: 'title' });
    });

    test('handles undefined body', () => {
      const issue = {
        title: '[CID:CR-001] Fix bug',
        body: undefined,
      };
      const result = checkIssueMatch(issue, 'CR-001');
      expect(result).toEqual({ matched: true, matchedBy: 'title' });
    });
  });

  // ========================================
  // Resolver Algorithm Tests
  // ========================================

  describe('resolveCanonicalId', () => {
    test('finds issue by body marker', async () => {
      mockSearchIssuesAndPullRequests.mockResolvedValue({
        data: {
          items: [
            {
              number: 742,
              title: 'E74.1: CR JSON Schema v1',
              body: 'Canonical-ID: CR-2026-01-01-001\n\nImplementation details',
              html_url: 'https://github.com/adaefler-art/codefactory-control/issues/742',
              state: 'open',
            },
          ],
        },
      });

      const result = await resolveCanonicalId({
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        canonicalId: 'CR-2026-01-01-001',
      });

      expect(result).toEqual({
        mode: 'found',
        issueNumber: 742,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/742',
        matchedBy: 'body',
      });

      // Verify search query
      expect(mockSearchIssuesAndPullRequests).toHaveBeenCalledWith({
        q: 'repo:adaefler-art/codefactory-control is:issue "CR-2026-01-01-001"',
        per_page: 100,
      });
    });

    test('finds issue by title marker', async () => {
      mockSearchIssuesAndPullRequests.mockResolvedValue({
        data: {
          items: [
            {
              number: 743,
              title: '[CID:CR-2026-01-01-002] Implement resolver',
              body: 'Implementation without body marker',
              html_url: 'https://github.com/adaefler-art/codefactory-control/issues/743',
              state: 'open',
            },
          ],
        },
      });

      const result = await resolveCanonicalId({
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        canonicalId: 'CR-2026-01-01-002',
      });

      expect(result).toEqual({
        mode: 'found',
        issueNumber: 743,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/743',
        matchedBy: 'title',
      });
    });

    test('returns not_found when no issues match', async () => {
      mockSearchIssuesAndPullRequests.mockResolvedValue({
        data: {
          items: [
            {
              number: 100,
              title: 'Unrelated issue',
              body: 'No marker here',
              html_url: 'https://github.com/adaefler-art/codefactory-control/issues/100',
              state: 'open',
            },
          ],
        },
      });

      const result = await resolveCanonicalId({
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        canonicalId: 'CR-NONEXISTENT',
      });

      expect(result).toEqual({
        mode: 'not_found',
      });
    });

    test('returns not_found when search returns empty results', async () => {
      mockSearchIssuesAndPullRequests.mockResolvedValue({
        data: {
          items: [],
        },
      });

      const result = await resolveCanonicalId({
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        canonicalId: 'CR-EMPTY',
      });

      expect(result).toEqual({
        mode: 'not_found',
      });
    });

    test('filters out pull requests from search results', async () => {
      mockSearchIssuesAndPullRequests.mockResolvedValue({
        data: {
          items: [
            {
              number: 500,
              title: '[CID:CR-2026-01-01-003] PR instead of issue',
              body: 'Canonical-ID: CR-2026-01-01-003',
              html_url: 'https://github.com/adaefler-art/codefactory-control/pull/500',
              state: 'open',
              pull_request: { url: 'https://api.github.com/repos/adaefler-art/codefactory-control/pulls/500' },
            },
          ],
        },
      });

      const result = await resolveCanonicalId({
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        canonicalId: 'CR-2026-01-01-003',
      });

      expect(result).toEqual({
        mode: 'not_found',
      });
    });

    test('prefers body marker when multiple matches exist', async () => {
      mockSearchIssuesAndPullRequests.mockResolvedValue({
        data: {
          items: [
            {
              number: 100,
              title: '[CID:CR-001] Title match only',
              body: 'No body marker',
              html_url: 'https://github.com/adaefler-art/codefactory-control/issues/100',
              state: 'open',
            },
            {
              number: 101,
              title: 'Regular title',
              body: 'Canonical-ID: CR-001\nBody match',
              html_url: 'https://github.com/adaefler-art/codefactory-control/issues/101',
              state: 'open',
            },
          ],
        },
      });

      const result = await resolveCanonicalId({
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        canonicalId: 'CR-001',
      });

      expect(result).toEqual({
        mode: 'found',
        issueNumber: 101,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/101',
        matchedBy: 'body',
      });
    });

    test('throws error for empty canonical ID', async () => {
      await expect(
        resolveCanonicalId({
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          canonicalId: '',
        })
      ).rejects.toThrow(CanonicalIdResolverError);
    });

    test('throws error for whitespace-only canonical ID', async () => {
      await expect(
        resolveCanonicalId({
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          canonicalId: '   ',
        })
      ).rejects.toThrow(CanonicalIdResolverError);
    });

    test('throws error when GitHub search fails', async () => {
      mockSearchIssuesAndPullRequests.mockRejectedValue(new Error('API rate limit exceeded'));

      await expect(
        resolveCanonicalId({
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          canonicalId: 'CR-001',
        })
      ).rejects.toThrow(CanonicalIdResolverError);
    });

    test('is idempotent - same input produces same output', async () => {
      const mockResponse = {
        data: {
          items: [
            {
              number: 742,
              title: '[CID:CR-2026-01-01-001] Test',
              body: 'Canonical-ID: CR-2026-01-01-001',
              html_url: 'https://github.com/adaefler-art/codefactory-control/issues/742',
              state: 'open',
            },
          ],
        },
      };

      mockSearchIssuesAndPullRequests.mockResolvedValue(mockResponse);

      const input = {
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        canonicalId: 'CR-2026-01-01-001',
      };

      // Call multiple times with same input
      const result1 = await resolveCanonicalId(input);
      const result2 = await resolveCanonicalId(input);
      const result3 = await resolveCanonicalId(input);

      // All results should be identical
      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
      expect(result1).toEqual({
        mode: 'found',
        issueNumber: 742,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/742',
        matchedBy: 'body',
      });
    });
  });

  // ========================================
  // Policy Enforcement Tests
  // ========================================

  describe('policy enforcement', () => {
    test('calls createAuthenticatedClient with correct parameters', async () => {
      mockSearchIssuesAndPullRequests.mockResolvedValue({
        data: { items: [] },
      });

      await resolveCanonicalId({
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        canonicalId: 'CR-001',
      });

      expect(mockCreateAuthenticatedClient).toHaveBeenCalledWith({
        owner: 'adaefler-art',
        repo: 'codefactory-control',
      });
    });

    test('propagates RepoAccessDeniedError from auth-wrapper', async () => {
      const deniedError = new Error('Access denied to repository unauthorized/repo');
      deniedError.name = 'RepoAccessDeniedError';

      mockCreateAuthenticatedClient.mockRejectedValue(deniedError);

      await expect(
        resolveCanonicalId({
          owner: 'unauthorized',
          repo: 'repo',
          canonicalId: 'CR-001',
        })
      ).rejects.toThrow('Access denied to repository unauthorized/repo');
    });
  });

  // ========================================
  // Marker Generation Helpers Tests
  // ========================================

  describe('generateTitleWithMarker', () => {
    test('generates title with canonical ID marker', () => {
      const result = generateTitleWithMarker('CR-2026-01-01-001', 'Fix bug');
      expect(result).toBe('[CID:CR-2026-01-01-001] Fix bug');
    });

    test('handles empty title', () => {
      const result = generateTitleWithMarker('CR-001', '');
      expect(result).toBe('[CID:CR-001] ');
    });

    test('handles complex canonical ID', () => {
      const result = generateTitleWithMarker('PROJ-2026-Q1-FEAT-001-v2.1', 'Complex ID test');
      expect(result).toBe('[CID:PROJ-2026-Q1-FEAT-001-v2.1] Complex ID test');
    });
  });

  describe('generateBodyWithMarker', () => {
    test('generates body with canonical ID marker', () => {
      const result = generateBodyWithMarker('CR-2026-01-01-001', 'Description text');
      expect(result).toBe('Canonical-ID: CR-2026-01-01-001\n\nDescription text');
    });

    test('handles empty body', () => {
      const result = generateBodyWithMarker('CR-001', '');
      expect(result).toBe('Canonical-ID: CR-001\n\n');
    });

    test('handles multiline body', () => {
      const body = 'Line 1\nLine 2\nLine 3';
      const result = generateBodyWithMarker('CR-001', body);
      expect(result).toBe('Canonical-ID: CR-001\n\nLine 1\nLine 2\nLine 3');
    });
  });

  // ========================================
  // Edge Cases and Integration
  // ========================================

  describe('edge cases', () => {
    test('handles issue with null body gracefully', async () => {
      mockSearchIssuesAndPullRequests.mockResolvedValue({
        data: {
          items: [
            {
              number: 200,
              title: '[CID:CR-NULL-BODY] Issue with null body',
              body: null,
              html_url: 'https://github.com/adaefler-art/codefactory-control/issues/200',
              state: 'open',
            },
          ],
        },
      });

      const result = await resolveCanonicalId({
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        canonicalId: 'CR-NULL-BODY',
      });

      expect(result).toEqual({
        mode: 'found',
        issueNumber: 200,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/200',
        matchedBy: 'title',
      });
    });

    test('handles canonical ID with special characters', async () => {
      const specialId = 'CR-2026-01-01-001-SPECIAL_CHARS.v2';
      
      mockSearchIssuesAndPullRequests.mockResolvedValue({
        data: {
          items: [
            {
              number: 300,
              title: `[CID:${specialId}] Special chars test`,
              body: `Canonical-ID: ${specialId}`,
              html_url: 'https://github.com/adaefler-art/codefactory-control/issues/300',
              state: 'open',
            },
          ],
        },
      });

      const result = await resolveCanonicalId({
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        canonicalId: specialId,
      });

      expect(result.mode).toBe('found');
      expect(result.issueNumber).toBe(300);
    });

    test('returns first body match when multiple body matches exist', async () => {
      mockSearchIssuesAndPullRequests.mockResolvedValue({
        data: {
          items: [
            {
              number: 400,
              title: 'First match',
              body: 'Canonical-ID: CR-DUP',
              html_url: 'https://github.com/adaefler-art/codefactory-control/issues/400',
              state: 'open',
            },
            {
              number: 401,
              title: 'Second match',
              body: 'Canonical-ID: CR-DUP',
              html_url: 'https://github.com/adaefler-art/codefactory-control/issues/401',
              state: 'open',
            },
          ],
        },
      });

      const result = await resolveCanonicalId({
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        canonicalId: 'CR-DUP',
      });

      // Should return first match (deterministic)
      expect(result).toEqual({
        mode: 'found',
        issueNumber: 400,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/400',
        matchedBy: 'body',
      });
    });
  });
});
