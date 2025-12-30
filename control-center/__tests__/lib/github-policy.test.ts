/**
 * Tests for Repo Access Policy
 * 
 * Validates policy matching logic, deny-by-default behavior,
 * and error handling.
 * 
 * Reference: I711 (E71.1) - Repo Access Policy
 */

import {
  RepoAccessPolicy,
  RepoAccessDeniedError,
  PolicyConfigError,
  matchBranchPattern,
  matchPathPattern,
  loadRepoAccessPolicy,
  RepoAccessPolicyConfig,
} from '../../src/lib/github/policy';

describe('RepoAccessPolicy - Pattern Matching', () => {
  describe('matchBranchPattern', () => {
    it('should match exact branch names', () => {
      expect(matchBranchPattern('main', 'main')).toBe(true);
      expect(matchBranchPattern('develop', 'develop')).toBe(true);
      expect(matchBranchPattern('feature/xyz', 'feature/xyz')).toBe(true);
    });

    it('should not match different branch names', () => {
      expect(matchBranchPattern('main', 'develop')).toBe(false);
      expect(matchBranchPattern('feature/a', 'feature/b')).toBe(false);
    });

    it('should match glob patterns with *', () => {
      expect(matchBranchPattern('release/1.0', 'release/*')).toBe(true);
      expect(matchBranchPattern('release/2.5.3', 'release/*')).toBe(true);
      expect(matchBranchPattern('hotfix/urgent', 'hotfix/*')).toBe(true);
      expect(matchBranchPattern('feature/new-thing', 'feature/*')).toBe(true);
    });

    it('should not match non-matching glob patterns', () => {
      expect(matchBranchPattern('main', 'release/*')).toBe(false);
      expect(matchBranchPattern('feature/xyz', 'hotfix/*')).toBe(false);
      expect(matchBranchPattern('develop', 'release/*')).toBe(false);
    });

    it('should handle complex glob patterns', () => {
      expect(matchBranchPattern('v1.2.3', 'v*')).toBe(true);
      expect(matchBranchPattern('test-123', 'test-*')).toBe(true);
      expect(matchBranchPattern('any-thing-here', '*')).toBe(true);
    });

    it('should be deterministic (same input = same output)', () => {
      const inputs = [
        ['main', 'main'],
        ['release/1.0', 'release/*'],
        ['feature/test', 'hotfix/*'],
      ] as const;

      inputs.forEach(([branch, pattern]) => {
        const result1 = matchBranchPattern(branch, pattern);
        const result2 = matchBranchPattern(branch, pattern);
        const result3 = matchBranchPattern(branch, pattern);
        expect(result1).toBe(result2);
        expect(result2).toBe(result3);
      });
    });
  });

  describe('matchPathPattern', () => {
    it('should match exact paths', () => {
      expect(matchPathPattern('src/app.ts', 'src/app.ts')).toBe(true);
      expect(matchPathPattern('docs/README.md', 'docs/README.md')).toBe(true);
    });

    it('should match path glob patterns', () => {
      expect(matchPathPattern('src/file.ts', 'src/*')).toBe(true);
      expect(matchPathPattern('src/lib/util.ts', 'src/*')).toBe(true);
      expect(matchPathPattern('anything.ts', '*.ts')).toBe(true);
    });
  });
});

describe('RepoAccessPolicy - Enforcement', () => {
  describe('deny by default', () => {
    it('should deny access to unlisted repositories', () => {
      const policy = new RepoAccessPolicy({ allowlist: [] });

      expect(() => {
        policy.checkAccess({ owner: 'test', repo: 'repo' });
      }).toThrow(RepoAccessDeniedError);
    });

    it('should provide structured error with request details', () => {
      const policy = new RepoAccessPolicy({ allowlist: [] });

      try {
        policy.checkAccess({ 
          owner: 'test', 
          repo: 'repo',
          branch: 'main'
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RepoAccessDeniedError);
        const err = error as RepoAccessDeniedError;
        expect(err.code).toBe('REPO_NOT_ALLOWED');
        expect(err.details).toEqual({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
        });
      }
    });
  });

  describe('allowlist matching', () => {
    const config: RepoAccessPolicyConfig = {
      allowlist: [
        {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          branches: ['main', 'develop', 'release/*'],
        },
        {
          owner: 'test-org',
          repo: 'test-repo',
          branches: ['main'],
          paths: ['src/*', 'docs/*'],
        },
      ],
    };

    const policy = new RepoAccessPolicy(config);

    it('should allow access to listed repository without branch', () => {
      expect(() => {
        policy.checkAccess({ 
          owner: 'adaefler-art', 
          repo: 'codefactory-control' 
        });
      }).not.toThrow();
    });

    it('should allow access to exact branch match', () => {
      expect(() => {
        policy.checkAccess({ 
          owner: 'adaefler-art', 
          repo: 'codefactory-control',
          branch: 'main'
        });
      }).not.toThrow();

      expect(() => {
        policy.checkAccess({ 
          owner: 'adaefler-art', 
          repo: 'codefactory-control',
          branch: 'develop'
        });
      }).not.toThrow();
    });

    it('should allow access to glob pattern branch match', () => {
      expect(() => {
        policy.checkAccess({ 
          owner: 'adaefler-art', 
          repo: 'codefactory-control',
          branch: 'release/1.0'
        });
      }).not.toThrow();

      expect(() => {
        policy.checkAccess({ 
          owner: 'adaefler-art', 
          repo: 'codefactory-control',
          branch: 'release/2.5.3'
        });
      }).not.toThrow();
    });

    it('should deny access to non-matching branch', () => {
      expect(() => {
        policy.checkAccess({ 
          owner: 'adaefler-art', 
          repo: 'codefactory-control',
          branch: 'feature/test'
        });
      }).toThrow(RepoAccessDeniedError);

      expect(() => {
        policy.checkAccess({ 
          owner: 'adaefler-art', 
          repo: 'codefactory-control',
          branch: 'hotfix/urgent'
        });
      }).toThrow(RepoAccessDeniedError);
    });

    it('should allow access when path matches (if paths defined)', () => {
      expect(() => {
        policy.checkAccess({ 
          owner: 'test-org', 
          repo: 'test-repo',
          path: 'src/app.ts'
        });
      }).not.toThrow();

      expect(() => {
        policy.checkAccess({ 
          owner: 'test-org', 
          repo: 'test-repo',
          path: 'docs/README.md'
        });
      }).not.toThrow();
    });

    it('should deny access when path does not match', () => {
      expect(() => {
        policy.checkAccess({ 
          owner: 'test-org', 
          repo: 'test-repo',
          path: 'lib/util.ts'
        });
      }).toThrow(RepoAccessDeniedError);
    });

    it('should allow any path if no path restrictions defined', () => {
      expect(() => {
        policy.checkAccess({ 
          owner: 'adaefler-art', 
          repo: 'codefactory-control',
          path: 'any/path/here.ts'
        });
      }).not.toThrow();
    });
  });

  describe('query methods', () => {
    const config: RepoAccessPolicyConfig = {
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
    };

    const policy = new RepoAccessPolicy(config);

    it('should check if repo is allowed', () => {
      expect(policy.isRepoAllowed('adaefler-art', 'codefactory-control')).toBe(true);
      expect(policy.isRepoAllowed('test-org', 'test-repo')).toBe(true);
      expect(policy.isRepoAllowed('unknown', 'repo')).toBe(false);
    });

    it('should return all allowed repos', () => {
      const allowed = policy.getAllowedRepos();
      expect(allowed).toHaveLength(2);
      expect(allowed).toContainEqual({ owner: 'adaefler-art', repo: 'codefactory-control' });
      expect(allowed).toContainEqual({ owner: 'test-org', repo: 'test-repo' });
    });
  });
});

describe('loadRepoAccessPolicy', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should load from GITHUB_REPO_ALLOWLIST env var', () => {
    process.env.GITHUB_REPO_ALLOWLIST = JSON.stringify({
      allowlist: [
        {
          owner: 'test',
          repo: 'repo',
          branches: ['main'],
        },
      ],
    });

    const policy = loadRepoAccessPolicy();
    expect(policy.isRepoAllowed('test', 'repo')).toBe(true);
    expect(policy.isRepoAllowed('other', 'repo')).toBe(false);
  });

  it('should use development default when no env var set', () => {
    delete process.env.GITHUB_REPO_ALLOWLIST;

    const policy = loadRepoAccessPolicy();
    expect(policy.isRepoAllowed('adaefler-art', 'codefactory-control')).toBe(true);
  });

  it('should throw PolicyConfigError on invalid JSON', () => {
    process.env.GITHUB_REPO_ALLOWLIST = 'not valid json{';

    expect(() => {
      loadRepoAccessPolicy();
    }).toThrow(PolicyConfigError);
  });

  it('should throw PolicyConfigError on invalid schema', () => {
    process.env.GITHUB_REPO_ALLOWLIST = JSON.stringify({
      allowlist: [
        {
          // missing required fields
          owner: 'test',
        },
      ],
    });

    expect(() => {
      loadRepoAccessPolicy();
    }).toThrow(PolicyConfigError);
  });

  it('should be deterministic (stable results)', () => {
    process.env.GITHUB_REPO_ALLOWLIST = JSON.stringify({
      allowlist: [
        {
          owner: 'test',
          repo: 'repo',
          branches: ['main', 'release/*'],
        },
      ],
    });

    const policy1 = loadRepoAccessPolicy();
    const policy2 = loadRepoAccessPolicy();

    // Both should allow same repos
    expect(policy1.isRepoAllowed('test', 'repo')).toBe(true);
    expect(policy2.isRepoAllowed('test', 'repo')).toBe(true);

    // Both should deny same repos
    expect(policy1.isRepoAllowed('other', 'repo')).toBe(false);
    expect(policy2.isRepoAllowed('other', 'repo')).toBe(false);
  });
});
