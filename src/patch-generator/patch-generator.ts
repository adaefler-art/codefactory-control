/**
 * Patch Generator Module
 * Generates code patches based on issue analysis
 */

import { IssueAnalysis } from '../issue-interpreter/issue-interpreter';

export interface PatchPlan {
  issueNumber: number;
  repository: string;
  targetBranch: string;
  filesAffected: string[];
  changes: CodeChange[];
  testStrategy: string;
}

export interface CodeChange {
  filePath: string;
  changeType: 'create' | 'modify' | 'delete';
  description: string;
  patch?: string;
}

export class PatchGenerator {
  /**
   * Generate a patch plan based on issue analysis
   */
  async generatePatchPlan(
    issueAnalysis: IssueAnalysis,
    repositoryContext: {
      defaultBranch: string;
      existingFiles: string[];
      programmingLanguages: string[];
    }
  ): Promise<PatchPlan> {
    const targetBranch = this.createBranchName(issueAnalysis);
    const changes = await this.planChanges(issueAnalysis, repositoryContext);
    const testStrategy = this.defineTestStrategy(issueAnalysis, repositoryContext);

    return {
      issueNumber: issueAnalysis.issueNumber,
      repository: issueAnalysis.repository,
      targetBranch,
      filesAffected: changes.map(c => c.filePath),
      changes,
      testStrategy,
    };
  }

  /**
   * Create a descriptive branch name for the patch
   */
  private createBranchName(issueAnalysis: IssueAnalysis): string {
    const prefix = issueAnalysis.taskType === 'bug' ? 'fix' : 'feature';
    const issueNum = issueAnalysis.issueNumber;
    const titleSlug = issueAnalysis.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .substring(0, 30);
    
    return `${prefix}/${issueNum}-${titleSlug}`;
  }

  /**
   * Plan the code changes needed
   */
  private async planChanges(
    issueAnalysis: IssueAnalysis,
    repositoryContext: {
      existingFiles: string[];
      programmingLanguages: string[];
    }
  ): Promise<CodeChange[]> {
    const changes: CodeChange[] = [];

    // This is a simplified implementation
    // In production, this would use AI/ML to analyze code and generate patches
    
    if (issueAnalysis.taskType === 'bug') {
      changes.push({
        filePath: 'src/bugfix.ts',
        changeType: 'modify',
        description: `Fix for issue #${issueAnalysis.issueNumber}: ${issueAnalysis.title}`,
      });
    } else if (issueAnalysis.taskType === 'feature') {
      changes.push({
        filePath: `src/features/feature-${issueAnalysis.issueNumber}.ts`,
        changeType: 'create',
        description: `Implement feature: ${issueAnalysis.title}`,
      });
    }

    return changes;
  }

  /**
   * Define testing strategy for the patch
   */
  private defineTestStrategy(
    issueAnalysis: IssueAnalysis,
    repositoryContext: {
      programmingLanguages: string[];
    }
  ): string {
    const strategies: string[] = [];

    if (issueAnalysis.taskType === 'bug') {
      strategies.push('Add regression test for the bug');
      strategies.push('Verify existing tests still pass');
    } else {
      strategies.push('Add unit tests for new functionality');
      strategies.push('Add integration tests if applicable');
    }

    if (repositoryContext.programmingLanguages.includes('TypeScript') || 
        repositoryContext.programmingLanguages.includes('JavaScript')) {
      strategies.push('Run ESLint and fix any issues');
    }

    return strategies.join('; ');
  }

  /**
   * Validate a generated patch
   */
  async validatePatch(patchPlan: PatchPlan): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (patchPlan.changes.length === 0) {
      errors.push('Patch plan has no changes');
    }

    if (!patchPlan.targetBranch) {
      errors.push('No target branch specified');
    }

    if (patchPlan.changes.length > 50) {
      warnings.push('Patch affects many files, consider breaking into smaller changes');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

export const patchGenerator = new PatchGenerator();
