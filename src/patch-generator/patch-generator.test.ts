/**
 * Tests for Patch Generator
 */

import { PatchGenerator } from '../patch-generator/patch-generator';
import { IssueAnalysis } from '../issue-interpreter/issue-interpreter';

describe('PatchGenerator', () => {
  let generator: PatchGenerator;

  beforeEach(() => {
    generator = new PatchGenerator();
  });

  describe('generatePatchPlan', () => {
    it('should generate a patch plan for a bug fix', async () => {
      const issueAnalysis: IssueAnalysis = {
        issueNumber: 1,
        repository: 'test/repo',
        title: 'Fix login bug',
        description: 'Login button not working',
        labels: ['bug'],
        actionableTask: true,
        taskType: 'bug',
        priority: 'high',
        estimatedComplexity: 'simple',
      };

      const repositoryContext = {
        defaultBranch: 'main',
        existingFiles: ['src/index.ts', 'README.md'],
        programmingLanguages: ['TypeScript'],
      };

      const result = await generator.generatePatchPlan(issueAnalysis, repositoryContext);

      expect(result.issueNumber).toBe(1);
      expect(result.targetBranch).toContain('fix/1-');
      expect(result.changes.length).toBeGreaterThan(0);
      expect(result.testStrategy).toBeTruthy();
    });

    it('should generate a patch plan for a feature', async () => {
      const issueAnalysis: IssueAnalysis = {
        issueNumber: 2,
        repository: 'test/repo',
        title: 'Add dark mode',
        description: 'Implement dark mode feature',
        labels: ['feature'],
        actionableTask: true,
        taskType: 'feature',
        priority: 'medium',
        estimatedComplexity: 'moderate',
      };

      const repositoryContext = {
        defaultBranch: 'main',
        existingFiles: ['src/index.ts'],
        programmingLanguages: ['TypeScript'],
      };

      const result = await generator.generatePatchPlan(issueAnalysis, repositoryContext);

      expect(result.targetBranch).toContain('feature/2-');
      expect(result.changes.length).toBeGreaterThan(0);
    });
  });

  describe('validatePatch', () => {
    it('should validate a valid patch plan', async () => {
      const patchPlan = {
        issueNumber: 1,
        repository: 'test/repo',
        targetBranch: 'fix/1-test',
        filesAffected: ['src/file.ts'],
        changes: [
          {
            filePath: 'src/file.ts',
            changeType: 'modify' as const,
            description: 'Fix bug',
          },
        ],
        testStrategy: 'Add unit tests',
      };

      const result = await generator.validatePatch(patchPlan);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should detect invalid patch with no changes', async () => {
      const patchPlan = {
        issueNumber: 1,
        repository: 'test/repo',
        targetBranch: 'fix/1-test',
        filesAffected: [],
        changes: [],
        testStrategy: 'Add unit tests',
      };

      const result = await generator.validatePatch(patchPlan);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should warn about large patches', async () => {
      const changes = Array.from({ length: 60 }, (_, i) => ({
        filePath: `src/file${i}.ts`,
        changeType: 'modify' as const,
        description: 'Change',
      }));

      const patchPlan = {
        issueNumber: 1,
        repository: 'test/repo',
        targetBranch: 'fix/1-test',
        filesAffected: changes.map(c => c.filePath),
        changes,
        testStrategy: 'Add tests',
      };

      const result = await generator.validatePatch(patchPlan);

      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});
