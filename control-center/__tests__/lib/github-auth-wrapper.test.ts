/**
 * Tests for GitHub Auth Wrapper with Policy Enforcement
 * 
 * Validates that policy is enforced before token acquisition
 * and that access is denied by default.
 * 
 * Reference: I711 (E71.1) - Repo Access Policy + Auth Wrapper
 */

import {
  getAuthenticatedToken,
  createAuthenticatedClient,
  isRepoAllowed,
  getAllowedRepos,
  RepoAccessDeniedError,
  __resetPolicyCache,
} from '../../src/lib/github/auth-wrapper';

// Mock the dependencies
jest.mock('octokit', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    rest: {},
  })),
}));

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

describe('GitHub Auth Wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset cached policy between tests
    __resetPolicyCache();
  });

  describe('getAuthenticatedToken - Policy Enforcement', () => {
    it('should deny access when repository not in allowlist', async () => {
      // Setup: Empty allowlist (deny all)
      const policy = new RepoAccessPolicy({ allowlist: [] });
      mockLoadPolicy.mockReturnValue(policy);

      // Expect: Access denied before token call
      await expect(
        getAuthenticatedToken({ 
          owner: 'test', 
          repo: 'repo' 
        })
      ).rejects.toThrow(RepoAccessDeniedError);

      // Verify: Token acquisition was NOT called (policy blocked it)
      expect(mockGetToken).not.toHaveBeenCalled();
    });

    it('should deny access when branch not allowed', async () => {
      // Setup: Allow repo but only 'main' branch
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

      // Expect: Access denied for different branch
      await expect(
        getAuthenticatedToken({ 
          owner: 'test', 
          repo: 'repo',
          branch: 'develop'
        })
      ).rejects.toThrow(RepoAccessDeniedError);

      // Verify: Token acquisition was NOT called
      expect(mockGetToken).not.toHaveBeenCalled();
    });

    it('should allow access when repository and branch are allowed', async () => {
      // Setup: Allow specific repo and branch
      const policy = new RepoAccessPolicy({
        allowlist: [
          {
            owner: 'test',
            repo: 'repo',
            branches: ['main', 'develop'],
          },
        ],
      });
      mockLoadPolicy.mockReturnValue(policy);

      mockGetToken.mockResolvedValue({
        token: 'ghs_test_token',
        expiresAt: '2025-12-31T23:59:59Z',
      });

      // Act: Request access
      const result = await getAuthenticatedToken({ 
        owner: 'test', 
        repo: 'repo',
        branch: 'main'
      });

      // Verify: Token was obtained
      expect(result.token).toBe('ghs_test_token');
      expect(result.expiresAt).toBe('2025-12-31T23:59:59Z');
      expect(mockGetToken).toHaveBeenCalledWith({
        owner: 'test',
        repo: 'repo',
      });
    });

    it('should allow access with glob pattern branch match', async () => {
      // Setup: Allow glob pattern
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

      // Act: Request access to release branch
      const result = await getAuthenticatedToken({ 
        owner: 'test', 
        repo: 'repo',
        branch: 'release/1.0'
      });

      // Verify: Token was obtained
      expect(result.token).toBe('ghs_test_token');
      expect(mockGetToken).toHaveBeenCalled();
    });

    it('should provide structured error details on denial', async () => {
      // Setup: Empty allowlist
      const policy = new RepoAccessPolicy({ allowlist: [] });
      mockLoadPolicy.mockReturnValue(policy);

      // Act & Assert
      await expect(getAuthenticatedToken({ 
        owner: 'test', 
        repo: 'repo',
        branch: 'main',
        path: 'src/file.ts'
      })).rejects.toThrow(RepoAccessDeniedError);

      const error = await getAuthenticatedToken({ 
        owner: 'test', 
        repo: 'repo',
        branch: 'main',
        path: 'src/file.ts'
      }).catch(e => e);
      
      expect(error).toBeInstanceOf(RepoAccessDeniedError);
      const err = error as RepoAccessDeniedError;
      expect(err.code).toBe('REPO_NOT_ALLOWED');
      expect(err.details).toEqual({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'src/file.ts',
      });
    });
  });

  describe('createAuthenticatedClient', () => {
    it('should return Octokit client when access is allowed', async () => {
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
      });

      // Act: Create client
      const client = await createAuthenticatedClient({ 
        owner: 'test', 
        repo: 'repo',
        branch: 'main'
      });

      // Verify: Client created
      expect(client).toBeDefined();
      expect(mockGetToken).toHaveBeenCalled();
    });

    it('should deny client creation when policy blocks access', async () => {
      // Setup: Deny repo
      const policy = new RepoAccessPolicy({ allowlist: [] });
      mockLoadPolicy.mockReturnValue(policy);

      // Expect: Client creation denied
      await expect(
        createAuthenticatedClient({ 
          owner: 'test', 
          repo: 'repo' 
        })
      ).rejects.toThrow(RepoAccessDeniedError);

      // Verify: No token call
      expect(mockGetToken).not.toHaveBeenCalled();
    });
  });

  describe('isRepoAllowed - Preflight Checks', () => {
    it('should return true for allowed repositories', () => {
      // Setup: Allow specific repo
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

      // Act & Assert
      expect(isRepoAllowed('test', 'repo')).toBe(true);
    });

    it('should return false for non-allowed repositories', () => {
      // Setup: Empty allowlist
      const policy = new RepoAccessPolicy({ allowlist: [] });
      mockLoadPolicy.mockReturnValue(policy);

      // Act & Assert
      expect(isRepoAllowed('test', 'repo')).toBe(false);
    });
  });

  describe('getAllowedRepos - Query', () => {
    it('should return all allowed repositories', () => {
      // Setup: Multiple repos
      const policy = new RepoAccessPolicy({
        allowlist: [
          {
            owner: 'adaefler-art',
            repo: 'codefactory-control',
            branches: ['main'],
          },
          {
            owner: 'test-org',
            repo: 'test-repo',
            branches: ['main'],
          },
        ],
      });
      mockLoadPolicy.mockReturnValue(policy);

      // Act
      const repos = getAllowedRepos();

      // Assert
      expect(repos).toHaveLength(2);
      expect(repos).toContainEqual({ owner: 'adaefler-art', repo: 'codefactory-control' });
      expect(repos).toContainEqual({ owner: 'test-org', repo: 'test-repo' });
    });

    it('should return empty array when no repos allowed', () => {
      // Setup: Empty allowlist
      const policy = new RepoAccessPolicy({ allowlist: [] });
      mockLoadPolicy.mockReturnValue(policy);

      // Act
      const repos = getAllowedRepos();

      // Assert
      expect(repos).toEqual([]);
    });
  });

  describe('Idempotency', () => {
    it('should return same result when called multiple times', async () => {
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

      let callCount = 0;
      mockGetToken.mockImplementation(async () => {
        callCount++;
        return {
          token: `ghs_token_${callCount}`,
          expiresAt: '2025-12-31T23:59:59Z',
        };
      });

      // Act: Call multiple times
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

      // Verify: Both calls succeeded (policy allowed both)
      expect(result1.token).toBe('ghs_token_1');
      expect(result2.token).toBe('ghs_token_2');
      expect(mockGetToken).toHaveBeenCalledTimes(2);
    });
  });

  describe('Determinism', () => {
    it('should produce stable results for same input', async () => {
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

      // Test cases
      const testCases = [
        { owner: 'test', repo: 'repo', branch: 'main' },
        { owner: 'test', repo: 'repo', branch: 'release/1.0' },
      ];

      for (const testCase of testCases) {
        // Call multiple times
        const result1 = await getAuthenticatedToken(testCase);
        const result2 = await getAuthenticatedToken(testCase);
        const result3 = await getAuthenticatedToken(testCase);

        // Should all succeed (no randomness)
        expect(result1.token).toBe('ghs_test_token');
        expect(result2.token).toBe('ghs_test_token');
        expect(result3.token).toBe('ghs_test_token');
      }
    });
  });
});
