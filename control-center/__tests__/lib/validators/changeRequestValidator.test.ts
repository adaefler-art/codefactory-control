/**
 * Tests for Change Request Validator Library
 * Issue E74.2: CR Validator Library + Standard Error Format
 */

import {
  validateChangeRequest,
  VALIDATOR_VERSION,
  ERROR_CODES,
  type ValidationResult,
  type ValidationError,
} from '../../../src/lib/validators/changeRequestValidator';
import { EXAMPLE_MINIMAL_CR, type ChangeRequest } from '../../../src/lib/schemas/changeRequest';

describe('validateChangeRequest', () => {
  describe('Valid CR validation', () => {
    it('should validate minimal valid CR with ok: true', () => {
      const result = validateChangeRequest(EXAMPLE_MINIMAL_CR);

      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.meta.validatorVersion).toBe(VALIDATOR_VERSION);
      expect(result.meta.crVersion).toBe('0.7.0');
      expect(result.meta.validatedAt).toBeDefined();
      expect(result.meta.hash).toBeDefined();
      expect(result.meta.hash).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
    });

    it('should include lawbookVersion in meta if present', () => {
      const crWithLawbook: ChangeRequest = {
        ...EXAMPLE_MINIMAL_CR,
        constraints: {
          ...EXAMPLE_MINIMAL_CR.constraints,
          lawbookVersion: '1.0.0',
        },
      };

      const result = validateChangeRequest(crWithLawbook);

      expect(result.ok).toBe(true);
      expect(result.meta.lawbookVersion).toBe('1.0.0');
    });

    it('should warn if lawbookVersion is missing', () => {
      const result = validateChangeRequest(EXAMPLE_MINIMAL_CR);

      expect(result.ok).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.code === 'CR_LAWBOOK_VERSION_MISSING')).toBe(true);
    });

    it('should generate consistent hash for same CR', () => {
      const result1 = validateChangeRequest(EXAMPLE_MINIMAL_CR);
      const result2 = validateChangeRequest(EXAMPLE_MINIMAL_CR);

      expect(result1.meta.hash).toBe(result2.meta.hash);
    });
  });

  describe('Schema validation (Layer 1)', () => {
    it('should return errors for invalid CR schema', () => {
      const invalidCR = {
        crVersion: '0.7.0',
        title: 'Test',
        // Missing many required fields
      };

      const result = validateChangeRequest(invalidCR);

      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.every(e => e.code === ERROR_CODES.CR_SCHEMA_INVALID)).toBe(true);
    });

    it('should return errors with proper path for nested fields', () => {
      const invalidCR = {
        ...EXAMPLE_MINIMAL_CR,
        targets: {
          ...EXAMPLE_MINIMAL_CR.targets,
          repo: {
            owner: '', // Invalid: empty string
            repo: 'test',
          },
        },
      };

      const result = validateChangeRequest(invalidCR);

      expect(result.ok).toBe(false);
      expect(result.errors.some(e => e.path.includes('/targets/repo/owner'))).toBe(true);
    });

    it('should return sorted errors by path then code', () => {
      const invalidCR = {
        crVersion: '0.7.0',
        canonicalId: '',
        title: '',
        motivation: '',
        // Partial invalid CR to trigger multiple errors
      };

      const result = validateChangeRequest(invalidCR);

      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);

      // Check that errors are sorted by path
      for (let i = 1; i < result.errors.length; i++) {
        const prevPath = result.errors[i - 1].path;
        const currPath = result.errors[i].path;
        expect(prevPath.localeCompare(currPath)).toBeLessThanOrEqual(0);
      }
    });
  });

  describe('Semantic validation (Layer 2)', () => {
    describe('Size limits', () => {
      it('should error when title exceeds 120 characters', () => {
        const longTitle = 'a'.repeat(121);
        const cr: ChangeRequest = {
          ...EXAMPLE_MINIMAL_CR,
          title: longTitle,
        };

        const result = validateChangeRequest(cr);

        expect(result.ok).toBe(false);
        expect(result.errors.some(e => 
          e.code === ERROR_CODES.CR_SIZE_LIMIT && e.path === '/title'
        )).toBe(true);

        const titleError = result.errors.find(e => e.path === '/title');
        expect(titleError?.details?.limit).toBe(120);
        expect(titleError?.details?.actual).toBe(121);
      });

      it('should error when motivation exceeds 5000 characters', () => {
        const longMotivation = 'a'.repeat(5001);
        const cr: ChangeRequest = {
          ...EXAMPLE_MINIMAL_CR,
          motivation: longMotivation,
        };

        const result = validateChangeRequest(cr);

        expect(result.ok).toBe(false);
        expect(result.errors.some(e => 
          e.code === ERROR_CODES.CR_SIZE_LIMIT && e.path === '/motivation'
        )).toBe(true);
      });

      it('should error when files exceed 100 entries', () => {
        const manyFiles = Array.from({ length: 101 }, (_, i) => ({
          path: `file${i}.ts`,
          changeType: 'create' as const,
        }));

        const cr: ChangeRequest = {
          ...EXAMPLE_MINIMAL_CR,
          changes: {
            files: manyFiles,
          },
        };

        const result = validateChangeRequest(cr);

        expect(result.ok).toBe(false);
        expect(result.errors.some(e => 
          e.code === ERROR_CODES.CR_SIZE_LIMIT && e.path === '/changes/files'
        )).toBe(true);
      });

      it('should error when evidence exceeds 50 entries', () => {
        const manyEvidence = Array.from({ length: 51 }, (_, i) => ({
          kind: 'github_issue' as const,
          repo: { owner: 'test', repo: 'test' },
          number: i + 1,
        }));

        const cr: ChangeRequest = {
          ...EXAMPLE_MINIMAL_CR,
          evidence: manyEvidence,
        };

        const result = validateChangeRequest(cr);

        expect(result.ok).toBe(false);
        expect(result.errors.some(e => 
          e.code === ERROR_CODES.CR_SIZE_LIMIT && e.path === '/evidence'
        )).toBe(true);
      });
    });

    describe('Path validation', () => {
      it('should error for paths with ".." (directory traversal)', () => {
        const cr: ChangeRequest = {
          ...EXAMPLE_MINIMAL_CR,
          changes: {
            files: [
              {
                path: '../../../etc/passwd',
                changeType: 'modify',
              },
            ],
          },
        };

        const result = validateChangeRequest(cr);

        expect(result.ok).toBe(false);
        expect(result.errors.some(e => 
          e.code === ERROR_CODES.CR_PATH_INVALID && e.path === '/changes/files/0/path'
        )).toBe(true);
        expect(result.errors.find(e => e.code === ERROR_CODES.CR_PATH_INVALID)?.details?.invalidPath).toBe('../../../etc/passwd');
      });

      it('should error for paths with backslashes', () => {
        const cr: ChangeRequest = {
          ...EXAMPLE_MINIMAL_CR,
          changes: {
            files: [
              {
                path: 'src\\bad\\path.ts',
                changeType: 'create',
              },
            ],
          },
        };

        const result = validateChangeRequest(cr);

        expect(result.ok).toBe(false);
        expect(result.errors.some(e => 
          e.code === ERROR_CODES.CR_PATH_INVALID
        )).toBe(true);
      });

      it('should error for absolute paths starting with /', () => {
        const cr: ChangeRequest = {
          ...EXAMPLE_MINIMAL_CR,
          changes: {
            files: [
              {
                path: '/absolute/path.ts',
                changeType: 'create',
              },
            ],
          },
        };

        const result = validateChangeRequest(cr);

        expect(result.ok).toBe(false);
        expect(result.errors.some(e => 
          e.code === ERROR_CODES.CR_PATH_INVALID
        )).toBe(true);
      });

      it('should accept valid relative paths', () => {
        const cr: ChangeRequest = {
          ...EXAMPLE_MINIMAL_CR,
          changes: {
            files: [
              {
                path: 'src/lib/valid/path.ts',
                changeType: 'create',
              },
              {
                path: 'control-center/app/api/route.ts',
                changeType: 'modify',
              },
            ],
          },
        };

        const result = validateChangeRequest(cr);

        expect(result.ok).toBe(true);
        expect(result.errors.some(e => e.code === ERROR_CODES.CR_PATH_INVALID)).toBe(false);
      });

      it('should check all file paths for forbidden patterns', () => {
        const cr: ChangeRequest = {
          ...EXAMPLE_MINIMAL_CR,
          changes: {
            files: [
              {
                path: 'valid/path.ts',
                changeType: 'create',
              },
              {
                path: '../invalid/path.ts',
                changeType: 'create',
              },
              {
                path: 'another\\bad\\path.ts',
                changeType: 'create',
              },
            ],
          },
        };

        const result = validateChangeRequest(cr);

        expect(result.ok).toBe(false);
        const pathErrors = result.errors.filter(e => e.code === ERROR_CODES.CR_PATH_INVALID);
        expect(pathErrors.length).toBe(2); // Two invalid paths
        expect(pathErrors.some(e => e.path === '/changes/files/1/path')).toBe(true);
        expect(pathErrors.some(e => e.path === '/changes/files/2/path')).toBe(true);
      });
    });

    describe('Minimum counts', () => {
      it('should error if acceptanceCriteria is empty', () => {
        const cr = {
          ...EXAMPLE_MINIMAL_CR,
          acceptanceCriteria: [],
        };

        const result = validateChangeRequest(cr);

        expect(result.ok).toBe(false);
        // This should be caught by schema validation first
        expect(result.errors.some(e => 
          e.code === ERROR_CODES.CR_SCHEMA_INVALID || e.code === ERROR_CODES.CR_AC_MISSING
        )).toBe(true);
      });

      it('should error if tests.required is empty', () => {
        const cr = {
          ...EXAMPLE_MINIMAL_CR,
          tests: {
            required: [],
          },
        };

        const result = validateChangeRequest(cr);

        expect(result.ok).toBe(false);
        expect(result.errors.some(e => 
          e.code === ERROR_CODES.CR_SCHEMA_INVALID || e.code === ERROR_CODES.CR_TESTS_MISSING
        )).toBe(true);
      });

      it('should error if evidence is empty', () => {
        const cr = {
          ...EXAMPLE_MINIMAL_CR,
          evidence: [],
        };

        const result = validateChangeRequest(cr);

        expect(result.ok).toBe(false);
        expect(result.errors.some(e => 
          e.code === ERROR_CODES.CR_SCHEMA_INVALID || e.code === ERROR_CODES.CR_EVIDENCE_MISSING
        )).toBe(true);
      });
    });
  });

  describe('Policy validation (Layer 3)', () => {
    it('should error when repo is not in allowlist', () => {
      const allowedRepos = [
        { owner: 'allowed-org', repo: 'allowed-repo' },
      ];

      const result = validateChangeRequest(EXAMPLE_MINIMAL_CR, { allowedRepos });

      expect(result.ok).toBe(false);
      expect(result.errors.some(e => 
        e.code === ERROR_CODES.CR_TARGET_NOT_ALLOWED && e.path === '/targets/repo'
      )).toBe(true);
    });

    it('should pass when repo is in allowlist', () => {
      const allowedRepos = [
        { owner: 'adaefler-art', repo: 'codefactory-control' },
      ];

      const result = validateChangeRequest(EXAMPLE_MINIMAL_CR, { allowedRepos });

      expect(result.ok).toBe(true);
      expect(result.errors.some(e => e.code === ERROR_CODES.CR_TARGET_NOT_ALLOWED)).toBe(false);
    });

    it('should warn when branch is not in allowlist', () => {
      const allowedBranches = ['main', 'develop'];

      const crWithFeatureBranch: ChangeRequest = {
        ...EXAMPLE_MINIMAL_CR,
        targets: {
          ...EXAMPLE_MINIMAL_CR.targets,
          branch: 'feature/test',
        },
      };

      const result = validateChangeRequest(crWithFeatureBranch, { allowedBranches });

      expect(result.ok).toBe(true); // Just a warning, not an error
      expect(result.warnings.some(w => 
        w.code === ERROR_CODES.CR_TARGET_NOT_ALLOWED && w.path === '/targets/branch'
      )).toBe(true);
    });

    it('should pass when branch is in allowlist', () => {
      const allowedBranches = ['main', 'develop'];

      const result = validateChangeRequest(EXAMPLE_MINIMAL_CR, { allowedBranches });

      expect(result.ok).toBe(true);
      expect(result.warnings.some(w => 
        w.code === ERROR_CODES.CR_TARGET_NOT_ALLOWED && w.path === '/targets/branch'
      )).toBe(false);
    });

    it('should skip policy checks when allowlists are empty', () => {
      const result = validateChangeRequest(EXAMPLE_MINIMAL_CR, { 
        allowedRepos: [], 
        allowedBranches: [] 
      });

      expect(result.ok).toBe(true);
      expect(result.errors.some(e => e.code === ERROR_CODES.CR_TARGET_NOT_ALLOWED)).toBe(false);
    });

    it('should skip policy checks when no options provided', () => {
      const result = validateChangeRequest(EXAMPLE_MINIMAL_CR);

      expect(result.ok).toBe(true);
      expect(result.errors.some(e => e.code === ERROR_CODES.CR_TARGET_NOT_ALLOWED)).toBe(false);
    });
  });

  describe('Error determinism', () => {
    it('should return errors in stable sorted order', () => {
      const invalidCR = {
        ...EXAMPLE_MINIMAL_CR,
        title: 'a'.repeat(121), // Size limit violation
        motivation: 'a'.repeat(5001), // Size limit violation
        changes: {
          files: [
            {
              path: '../invalid.ts',
              changeType: 'create' as const,
            },
          ],
        },
      };

      const result1 = validateChangeRequest(invalidCR);
      const result2 = validateChangeRequest(invalidCR);

      expect(result1.errors).toEqual(result2.errors);

      // Verify errors are sorted by path
      for (let i = 1; i < result1.errors.length; i++) {
        const prevPath = result1.errors[i - 1].path;
        const currPath = result1.errors[i].path;
        expect(prevPath.localeCompare(currPath)).toBeLessThanOrEqual(0);
      }
    });

    it('should return warnings in stable sorted order', () => {
      const result1 = validateChangeRequest(EXAMPLE_MINIMAL_CR);
      const result2 = validateChangeRequest(EXAMPLE_MINIMAL_CR);

      expect(result1.warnings).toEqual(result2.warnings);
    });
  });

  describe('Meta information', () => {
    it('should include validatorVersion', () => {
      const result = validateChangeRequest(EXAMPLE_MINIMAL_CR);

      expect(result.meta.validatorVersion).toBe(VALIDATOR_VERSION);
    });

    it('should include validatedAt timestamp in ISO format', () => {
      const result = validateChangeRequest(EXAMPLE_MINIMAL_CR);

      expect(result.meta.validatedAt).toBeDefined();
      expect(() => new Date(result.meta.validatedAt)).not.toThrow();
      expect(result.meta.validatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should include crVersion from validated CR', () => {
      const result = validateChangeRequest(EXAMPLE_MINIMAL_CR);

      expect(result.meta.crVersion).toBe('0.7.0');
    });

    it('should include hash for valid CR', () => {
      const result = validateChangeRequest(EXAMPLE_MINIMAL_CR);

      expect(result.meta.hash).toBeDefined();
      expect(result.meta.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should not include hash for invalid CR', () => {
      const result = validateChangeRequest({ invalid: 'cr' });

      expect(result.meta.hash).toBeUndefined();
    });
  });

  describe('Error format', () => {
    it('should return errors with all required fields', () => {
      const invalidCR = {
        ...EXAMPLE_MINIMAL_CR,
        title: 'a'.repeat(121),
      };

      const result = validateChangeRequest(invalidCR);

      expect(result.errors.length).toBeGreaterThan(0);
      result.errors.forEach((error: ValidationError) => {
        expect(error.code).toBeDefined();
        expect(error.message).toBeDefined();
        expect(error.path).toBeDefined();
        expect(error.severity).toBe('error');
      });
    });

    it('should include details object for specific errors', () => {
      const invalidCR: ChangeRequest = {
        ...EXAMPLE_MINIMAL_CR,
        title: 'a'.repeat(121),
      };

      const result = validateChangeRequest(invalidCR);

      const sizeLimitError = result.errors.find(e => e.code === ERROR_CODES.CR_SIZE_LIMIT);
      expect(sizeLimitError?.details).toBeDefined();
      expect(sizeLimitError?.details?.limit).toBeDefined();
      expect(sizeLimitError?.details?.actual).toBeDefined();
    });
  });
});
