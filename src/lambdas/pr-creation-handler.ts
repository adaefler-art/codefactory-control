/**
 * PR Creation Lambda Function
 * Creates pull requests from generated patches
 */

import { PROrchestrator } from '../pr-orchestrator/pr-orchestrator';
import { PatchPlan } from '../patch-generator/patch-generator';
import { GitHubClient } from '../github/github-client';
import { configManager } from '../config/config-manager';

export interface PRCreationInput {
  patchPlan: PatchPlan;
  owner: string;
  repo: string;
  defaultBranch: string;
}

export async function handler(input: PRCreationInput) {
  try {
    const config = configManager.getConfig();
    const privateKey = await configManager.getSecret(config.github.privateKeySecretArn);

    // Initialize GitHub client
    const githubClient = new GitHubClient({
      appId: config.github.appId,
      privateKey,
      installationId: parseInt(process.env.GITHUB_INSTALLATION_ID || '0'),
    });

    // Create branch
    await githubClient.createBranch(
      input.owner,
      input.repo,
      input.patchPlan.targetBranch,
      input.defaultBranch
    );

    // Apply changes to files
    for (const change of input.patchPlan.changes) {
      if (change.changeType === 'create' || change.changeType === 'modify') {
        const content = change.patch || `// ${change.description}\n// TODO: Implement changes`;
        await githubClient.createOrUpdateFile(
          input.owner,
          input.repo,
          change.filePath,
          content,
          change.description,
          input.patchPlan.targetBranch
        );
      }
    }

    // Get GitHub token for PR orchestrator
    // In production, this would use a different authentication method
    const prOrchestrator = new PROrchestrator(privateKey);

    // Create pull request
    const result = await prOrchestrator.createPullRequest(
      input.owner,
      input.repo,
      input.patchPlan,
      input.defaultBranch
    );

    return {
      prResult: result,
    };
  } catch (error) {
    console.error('Error creating PR:', error);
    throw error;
  }
}
