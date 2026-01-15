/**
 * Tests for GitHub Auth Wrapper - E89.1 Requirements
 * 
 * Validates:
 * - GITHUB_AUTH_FAILED error code
 * - Audit evidence fields (requestId, allowlistHash)
 * - Policy enforcement with normalized values
 * 
 * Reference: E89.1 - Repo Read-Only Policy Enhancement
 */

import {
  getAuthenticatedToken,
  RepoAccessDeniedError,
  GitHubAuthError,
  __resetPolicyCache,
} from '../../src/lib/github/auth-wrapper';

// Mock the dependencies
jest.mock('octokit');

jest.mock('../../src/lib/github-app-auth', () => ({
  getGitHubInstallationToken: jest.fn(),
}));

jest.mock('../../src/lib/github/policy', () => {
  const actual = jest.requireActual('../../src/lib/github/policy');
  return {
    ...actual,
    loadRepoAccessPolicy: jest.fn(),
  };
});

import { getGitHubInstallationToken } from '../../src/lib/github-app-auth';
import { loadRepoAccessPolicy, RepoAccessPolicy } from '../../src/lib/github/policy';

const mockGetToken = getGitHubInstallationToken as jest.MockedFunction<typeof getGitHubInstallationToken>;
const mockLoadPolicy = loadRepoAccessPolicy as jest.MockedFunction<typeof loadRepoAccessPolicy>;

describe('E89.1 - GitHub Auth Wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetPolicyCache();
  });

  describe('GITHUB_AUTH_FAILED Error Code', () => {
    it('should throw GitHubAuthError when token acquisition fails', async () => {
      // Setup: Allow repo but fail token acquisition
      const policy = new RepoAccessPolicy({
        allowlist: [
          {
            owner: 'test',
            repo: 'repo',
            branches: ['main'],
          },
        ],
      });
      mockLoadPolicy.mockReturnValue(policy);

      // Mock token acquisition to fail
      mockGetToken.mockRejectedValue(new Error('GitHub API error'));

      // Act & Assert
      await expect(
        getAuthenticatedToken({ 
          owner: 'test', 
          repo: 'repo',
          branch: 'main'
        })
      ).rejects.toThrow(GitHubAuthError);

      // Verify error details
      try {
        await getAuthenticatedToken({ 
          owner: 'test', 
          repo: 'repo',
          branch: 'main'
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubAuthError);
        const err = error as GitHubAuthError;
        expect(err.code).toBe('GITHUB_AUTH_FAILED');
        expect(err.details.owner).toBe('test');
        expect(err.details.repo).toBe('repo');
        expect(err.details.reason).toContain('GitHub API error');
      }
    });

    it('should NOT wrap RepoAccessDeniedError in GitHubAuthError', async () => {
      // Setup: Deny repo access
      const policy = new RepoAccessPolicy({ allowlist: [] });
      mockLoadPolicy.mockReturnValue(policy);

      // Act & Assert - Should throw original RepoAccessDeniedError, not GitHubAuthError
      await expect(
        getAuthenticatedToken({ 
          owner: 'test', 
          repo: 'repo' 
        })
      ).rejects.toThrow(RepoAccessDeniedError);

      await expect(
        getAuthenticatedToken({ 
          owner: 'test', 
          repo: 'repo' 
        })
      ).rejects.not.toThrow(GitHubAuthError);
    });
  });

  describe('Audit Evidence Fields', () => {
    it('should include audit evidence in successful response', async () => {
      // Setup: Allow repo
      const policy = new RepoAccessPolicy({
        allowlist: [
          {
            owner: 'test',
            repo: 'repo',
            branches: ['main'],
          },
        ],
      });
      mockLoadPolicy.mockReturnValue(policy);

      mockGetToken.mockResolvedValue({
        token: 'ghs_test_token',
        expiresAt: '2025-12-31T23:59:59Z',
      });

      // Act: Request with requestId
      const result = await getAuthenticatedToken({ 
        owner: 'test', 
        repo: 'repo',
        branch: 'main',
        requestId: 'req-123-456'
      });

      // Assert: Audit evidence is present
      expect(result.auditEvidence).toBeDefined();
      expect(result.auditEvidence?.requestId).toBe('req-123-456');
      expect(result.auditEvidence?.allowlistHash).toBeDefined();
      expect(result.auditEvidence?.allowlistHash).toHaveLength(16); // SHA256 truncated to 16 chars
    });

    it('should include allowlistHash even without requestId', async () => {
      // Setup
      const policy = new RepoAccessPolicy({
        allowlist: [
          {
            owner: 'test',
            repo: 'repo',
            branches: ['main'],
          },
        ],
      });
      mockLoadPolicy.mockReturnValue(policy);

      mockGetToken.mockResolvedValue({
        token: 'ghs_test_token',
      });

      // Act: Request without requestId
      const result = await getAuthenticatedToken({ 
        owner: 'test', 
        repo: 'repo',
        branch: 'main'
      });

      // Assert: allowlistHash still present
      expect(result.auditEvidence).toBeDefined();
      expect(result.auditEvidence?.requestId).toBeUndefined();
      expect(result.auditEvidence?.allowlistHash).toBeDefined();
      expect(result.auditEvidence?.allowlistHash).toHaveLength(16);
    });

    it('should produce deterministic allowlistHash', async () => {
      // Setup
      const policy = new RepoAccessPolicy({
        allowlist: [
          {
            owner: 'test',
            repo: 'repo',
            branches: ['main'],
          },
        ],
      });
      mockLoadPolicy.mockReturnValue(policy);

      mockGetToken.mockResolvedValue({
        token: 'ghs_test_token',
      });

      // Act: Multiple calls
      const result1 = await getAuthenticatedToken({ 
        owner: 'test', 
        repo: 'repo',
        branch: 'main'
      });

      const result2 = await getAuthenticatedToken({ 
        owner: 'test', 
        repo: 'repo',
        branch: 'main'
      });

      // Assert: Same hash
      expect(result1.auditEvidence?.allowlistHash).toBe(result2.auditEvidence?.allowlistHash);
    });
  });

  describe('Policy Enforcement with Normalization', () => {
    it('should enforce policy with case-insensitive owner/repo', async () => {
      // Setup: Allowlist with lowercase
      const policy = new RepoAccessPolicy({
        allowlist: [
          {
            owner: 'adaefler-art',
            repo: 'codefactory-control',
            branches: ['main'],
          },
        ],
      });
      mockLoadPolicy.mockReturnValue(policy);

      mockGetToken.mockResolvedValue({
        token: 'ghs_test_token',
      });

      // Act: Request with mixed case should succeed
      const result = await getAuthenticatedToken({ 
        owner: 'AdaEfler-Art', 
        repo: 'CodeFactory-Control',
        branch: 'main'
      });

      // Assert: Token obtained
      expect(result.token).toBe('ghs_test_token');
      expect(mockGetToken).toHaveBeenCalledWith({
        owner: 'AdaEfler-Art',
        repo: 'CodeFactory-Control',
      });
    });

    it('should enforce branch policy with normalized refs', async () => {
      // Setup
      const policy = new RepoAccessPolicy({
        allowlist: [
          {
            owner: 'test',
            repo: 'repo',
            branches: ['main', 'release/*'],
          },
        ],
      });
      mockLoadPolicy.mockReturnValue(policy);

      mockGetToken.mockResolvedValue({
        token: 'ghs_test_token',
      });

      // Act: Request with refs/heads/ prefix should succeed
      const result = await getAuthenticatedToken({ 
        owner: 'test', 
        repo: 'repo',
        branch: 'refs/heads/main'
      });

      // Assert: Token obtained
      expect(result.token).toBe('ghs_test_token');

      // Act: Request with refs/heads/ and glob pattern should succeed
      const result2 = await getAuthenticatedToken({ 
        owner: 'test', 
        repo: 'repo',
        branch: 'refs/heads/release/1.0'
      });

      expect(result2.token).toBe('ghs_test_token');
    });
  });

  describe('Error Code Differentiation', () => {
    it('should throw REPO_NOT_ALLOWED for unlisted repo', async () => {
      const policy = new RepoAccessPolicy({ allowlist: [] });
      mockLoadPolicy.mockReturnValue(policy);

      try {
        await getAuthenticatedToken({ 
          owner: 'test', 
          repo: 'repo' 
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RepoAccessDeniedError);
        expect((error as RepoAccessDeniedError).code).toBe('REPO_NOT_ALLOWED');
      }
    });

    it('should throw BRANCH_NOT_ALLOWED for unlisted branch', async () => {
      const policy = new RepoAccessPolicy({
        allowlist: [
          {
            owner: 'test',
            repo: 'repo',
            branches: ['main'],
          },
        ],
      });
      mockLoadPolicy.mockReturnValue(policy);

      try {
        await getAuthenticatedToken({ 
          owner: 'test', 
          repo: 'repo',
          branch: 'feature/test'
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RepoAccessDeniedError);
        expect((error as RepoAccessDeniedError).code).toBe('BRANCH_NOT_ALLOWED');
      }
    });

    it('should throw GITHUB_AUTH_FAILED for token acquisition errors', async () => {
      const policy = new RepoAccessPolicy({
        allowlist: [
          {
            owner: 'test',
            repo: 'repo',
            branches: ['main'],
          },
        ],
      });
      mockLoadPolicy.mockReturnValue(policy);

      mockGetToken.mockRejectedValue(new Error('Network timeout'));

      try {
        await getAuthenticatedToken(
          { 
            owner: 'test', 
            repo: 'repo',
            branch: 'main'
          },
          {
            // Disable retries for this test to avoid timeout
            retryConfig: {
              maxAttempts: 1,
              baseDelayMs: 0,
              maxDelayMs: 0,
              jitterMs: 0,
            }
          }
        );
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubAuthError);
        expect((error as GitHubAuthError).code).toBe('GITHUB_AUTH_FAILED');
      }
    });
  });
});
