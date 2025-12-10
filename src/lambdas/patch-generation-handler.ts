/**
 * Patch Generation Lambda Function
 * Generates code patches based on issue analysis
 */

import { PatchGenerator } from '../patch-generator/patch-generator';
import { IssueAnalysis } from '../issue-interpreter/issue-interpreter';
import { GitHubClient } from '../github/github-client';
import { configManager } from '../config/config-manager';

const patchGenerator = new PatchGenerator();

export interface PatchGenerationInput {
  issueAnalysis: IssueAnalysis;
  owner: string;
  repo: string;
  defaultBranch: string;
}

export async function handler(input: PatchGenerationInput) {
  try {
    const config = configManager.getConfig();
    const privateKey = await configManager.getSecret(config.github.privateKeySecretArn);

    // Initialize GitHub client
    const githubClient = new GitHubClient({
      appId: config.github.appId,
      privateKey,
      installationId: parseInt(process.env.GITHUB_INSTALLATION_ID || '0'),
    });

    // Get repository context
    const existingFiles = await githubClient.listFiles(input.owner, input.repo);
    const programmingLanguages = await githubClient.getRepositoryLanguages(input.owner, input.repo);

    // Generate patch plan
    const patchPlan = await patchGenerator.generatePatchPlan(input.issueAnalysis, {
      defaultBranch: input.defaultBranch,
      existingFiles,
      programmingLanguages,
    });

    // Validate patch
    const validation = await patchGenerator.validatePatch(patchPlan);

    if (!validation.valid) {
      throw new Error(`Patch validation failed: ${validation.errors.join(', ')}`);
    }

    return {
      patchPlan,
      validation,
    };
  } catch (error) {
    console.error('Error generating patch:', error);
    throw error;
  }
}
