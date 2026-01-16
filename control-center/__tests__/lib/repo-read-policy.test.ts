/**
 * Tests for Repo Read Policy - E89.1 Requirements
 * 
 * Validates:
 * - Deterministic normalization (lowercase owner/repo, canonical branch)
 * - REPO_NOT_ALLOWED and BRANCH_NOT_ALLOWED error codes
 * - Allowlist enforcement with normalized values
 * 
 * Reference: E89.1 - Repo Read-Only Policy Enhancement
 */

import {
  RepoAccessPolicy,
  RepoAccessDeniedError,
  normalizeOwner,
  normalizeRepo,
  normalizeBranch,
  matchBranchPattern,
  RepoAccessPolicyConfig,
} from '../../src/lib/github/policy';

describe('E89.1 - Repo Read Policy', () => {
  describe('Deterministic Normalization', () => {
    describe('normalizeOwner', () => {
      it('should convert owner to lowercase', () => {
        expect(normalizeOwner('AdaEfler-Art')).toBe('adaefler-art');
        expect(normalizeOwner('GITHUB')).toBe('github');
        expect(normalizeOwner('TestOrg')).toBe('testorg');
      });

      it('should trim whitespace', () => {
        expect(normalizeOwner('  owner  ')).toBe('owner');
        expect(normalizeOwner('\towner\n')).toBe('owner');
      });

      it('should be idempotent', () => {
        const owner = 'TestOwner';
        const normalized1 = normalizeOwner(owner);
        const normalized2 = normalizeOwner(normalized1);
        const normalized3 = normalizeOwner(normalized2);
        expect(normalized1).toBe(normalized2);
        expect(normalized2).toBe(normalized3);
      });
    });

    describe('normalizeRepo', () => {
      it('should convert repo to lowercase', () => {
        expect(normalizeRepo('CodeFactory-Control')).toBe('codefactory-control');
        expect(normalizeRepo('MY-REPO')).toBe('my-repo');
        expect(normalizeRepo('TestRepo')).toBe('testrepo');
      });

      it('should trim whitespace', () => {
        expect(normalizeRepo('  repo  ')).toBe('repo');
        expect(normalizeRepo('\trepo\n')).toBe('repo');
      });

      it('should be idempotent', () => {
        const repo = 'TestRepo';
        const normalized1 = normalizeRepo(repo);
        const normalized2 = normalizeRepo(normalized1);
        const normalized3 = normalizeRepo(normalized2);
        expect(normalized1).toBe(normalized2);
        expect(normalized2).toBe(normalized3);
      });
    });

    describe('normalizeBranch', () => {
      it('should remove refs/heads/ prefix', () => {
        expect(normalizeBranch('refs/heads/main')).toBe('main');
        expect(normalizeBranch('refs/heads/feature/test')).toBe('feature/test');
      });

      it('should remove refs/tags/ prefix', () => {
        expect(normalizeBranch('refs/tags/v1.0.0')).toBe('v1.0.0');
        expect(normalizeBranch('refs/tags/release-1.0')).toBe('release-1.0');
      });

      it('should trim whitespace', () => {
        expect(normalizeBranch('  main  ')).toBe('main');
        expect(normalizeBranch('\tmain\n')).toBe('main');
      });

      it('should preserve branch name without refs prefix', () => {
        expect(normalizeBranch('main')).toBe('main');
        expect(normalizeBranch('feature/test')).toBe('feature/test');
        expect(normalizeBranch('release/1.0')).toBe('release/1.0');
      });

      it('should be idempotent', () => {
        const branch = 'refs/heads/main';
        const normalized1 = normalizeBranch(branch);
        const normalized2 = normalizeBranch(normalized1);
        const normalized3 = normalizeBranch(normalized2);
        expect(normalized1).toBe(normalized2);
        expect(normalized2).toBe(normalized3);
      });
    });
  });

  describe('Error Codes', () => {
    const config: RepoAccessPolicyConfig = {
      allowlist: [
        {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          branches: ['main', 'develop'],
        },
      ],
    };

    const policy = new RepoAccessPolicy(config);

    it('should throw REPO_NOT_ALLOWED when repository not in allowlist', () => {
      try {
        policy.checkAccess({ 
          owner: 'unknown', 
          repo: 'repo' 
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RepoAccessDeniedError);
        const err = error as RepoAccessDeniedError;
        expect(err.code).toBe('REPO_NOT_ALLOWED');
        expect(err.details.owner).toBe('unknown');
        expect(err.details.repo).toBe('repo');
      }
    });

    it('should throw BRANCH_NOT_ALLOWED when branch not in allowlist', () => {
      try {
        policy.checkAccess({ 
          owner: 'adaefler-art', 
          repo: 'codefactory-control',
          branch: 'feature/test'
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RepoAccessDeniedError);
        const err = error as RepoAccessDeniedError;
        expect(err.code).toBe('BRANCH_NOT_ALLOWED');
        expect(err.details.owner).toBe('adaefler-art');
        expect(err.details.repo).toBe('codefactory-control');
        expect(err.details.branch).toBe('feature/test');
      }
    });
  });

  describe('Case-Insensitive Matching', () => {
    const config: RepoAccessPolicyConfig = {
      allowlist: [
        {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          branches: ['main', 'release/*'],
        },
      ],
    };

    const policy = new RepoAccessPolicy(config);

    it('should allow access with different case owner/repo', () => {
      // Should NOT throw - case-insensitive match
      expect(() => {
        policy.checkAccess({ 
          owner: 'AdaEfler-Art', 
          repo: 'CodeFactory-Control' 
        });
      }).not.toThrow();
    });

    it('should allow access with uppercase owner', () => {
      expect(() => {
        policy.checkAccess({ 
          owner: 'ADAEFLER-ART', 
          repo: 'codefactory-control',
          branch: 'main'
        });
      }).not.toThrow();
    });

    it('should allow access with mixed case repo', () => {
      expect(() => {
        policy.checkAccess({ 
          owner: 'adaefler-art', 
          repo: 'CodeFactory-CONTROL',
          branch: 'main'
        });
      }).not.toThrow();
    });

    it('should deny access when normalized values don\'t match', () => {
      expect(() => {
        policy.checkAccess({ 
          owner: 'DIFFERENT-ORG', 
          repo: 'codefactory-control' 
        });
      }).toThrow(RepoAccessDeniedError);
    });
  });

  describe('Branch Pattern Matching with Normalization', () => {
    const config: RepoAccessPolicyConfig = {
      allowlist: [
        {
          owner: 'test-org',
          repo: 'test-repo',
          branches: ['main', 'develop', 'release/*', 'hotfix/*'],
        },
      ],
    };

    const policy = new RepoAccessPolicy(config);

    it('should match exact branch names', () => {
      expect(() => {
        policy.checkAccess({ 
          owner: 'test-org', 
          repo: 'test-repo',
          branch: 'main'
        });
      }).not.toThrow();

      expect(() => {
        policy.checkAccess({ 
          owner: 'test-org', 
          repo: 'test-repo',
          branch: 'develop'
        });
      }).not.toThrow();
    });

    it('should match glob patterns', () => {
      expect(() => {
        policy.checkAccess({ 
          owner: 'test-org', 
          repo: 'test-repo',
          branch: 'release/1.0'
        });
      }).not.toThrow();

      expect(() => {
        policy.checkAccess({ 
          owner: 'test-org', 
          repo: 'test-repo',
          branch: 'hotfix/urgent-fix'
        });
      }).not.toThrow();
    });

    it('should normalize refs/heads/ prefix before matching', () => {
      expect(() => {
        policy.checkAccess({ 
          owner: 'test-org', 
          repo: 'test-repo',
          branch: 'refs/heads/main'
        });
      }).not.toThrow();

      expect(() => {
        policy.checkAccess({ 
          owner: 'test-org', 
          repo: 'test-repo',
          branch: 'refs/heads/release/2.0'
        });
      }).not.toThrow();
    });

    it('should deny non-matching branches', () => {
      expect(() => {
        policy.checkAccess({ 
          owner: 'test-org', 
          repo: 'test-repo',
          branch: 'feature/test'
        });
      }).toThrow(RepoAccessDeniedError);
    });
  });

  describe('Allowlist Parsing and Normalization', () => {
    it('should handle allowlist with mixed case entries', () => {
      const config: RepoAccessPolicyConfig = {
        allowlist: [
          {
            owner: 'GitHub',
            repo: 'Hello-World',
            branches: ['main'],
          },
        ],
      };

      const policy = new RepoAccessPolicy(config);

      // Should match regardless of case
      expect(policy.isRepoAllowed('github', 'hello-world')).toBe(true);
      expect(policy.isRepoAllowed('GITHUB', 'HELLO-WORLD')).toBe(true);
      expect(policy.isRepoAllowed('GitHub', 'Hello-World')).toBe(true);
    });
  });

  describe('Determinism', () => {
    const config: RepoAccessPolicyConfig = {
      allowlist: [
        {
          owner: 'test-org',
          repo: 'test-repo',
          branches: ['main', 'release/*'],
        },
      ],
    };

    const policy = new RepoAccessPolicy(config);

    it('should produce stable results for same input', () => {
      const testCases = [
        { owner: 'Test-Org', repo: 'Test-Repo', branch: 'main' },
        { owner: 'TEST-ORG', repo: 'test-repo', branch: 'refs/heads/main' },
        { owner: 'test-org', repo: 'TEST-REPO', branch: 'release/1.0' },
      ];

      testCases.forEach((testCase) => {
        // Call multiple times - should always succeed (deterministic)
        expect(() => policy.checkAccess(testCase)).not.toThrow();
        expect(() => policy.checkAccess(testCase)).not.toThrow();
        expect(() => policy.checkAccess(testCase)).not.toThrow();
      });
    });

    it('should produce stable error codes for same denied input', () => {
      const testCases = [
        { owner: 'unknown', repo: 'repo', expectedCode: 'REPO_NOT_ALLOWED' as const },
        { owner: 'test-org', repo: 'test-repo', branch: 'feature/test', expectedCode: 'BRANCH_NOT_ALLOWED' as const },
      ];

      testCases.forEach(({ expectedCode, ...testCase }) => {
        // Call multiple times - should always throw same error code
        for (let i = 0; i < 3; i++) {
          try {
            policy.checkAccess(testCase);
            fail('Should have thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(RepoAccessDeniedError);
            expect((error as RepoAccessDeniedError).code).toBe(expectedCode);
          }
        }
      });
    });
  });
});
