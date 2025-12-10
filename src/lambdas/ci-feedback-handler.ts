/**
 * CI Feedback Processing Lambda Function
 * Processes CI feedback and updates PRs accordingly
 */

import { PROrchestrator } from '../pr-orchestrator/pr-orchestrator';
import { configManager } from '../config/config-manager';

export interface CIFeedbackInput {
  owner: string;
  repo: string;
  prNumber: number;
}

export async function handler(input: CIFeedbackInput) {
  try {
    const config = configManager.getConfig();
    const privateKey = await configManager.getSecret(config.github.privateKeySecretArn);

    const prOrchestrator = new PROrchestrator(privateKey);

    // Process CI feedback
    const feedback = await prOrchestrator.processCIFeedback(
      input.owner,
      input.repo,
      input.prNumber
    );

    // Update PR if action is required
    if (feedback.requiresAction) {
      await prOrchestrator.updatePRBasedOnFeedback(
        input.owner,
        input.repo,
        input.prNumber,
        feedback
      );
    }

    // Auto-merge if all checks pass
    if (feedback.overallStatus === 'success') {
      const merged = await prOrchestrator.mergePullRequest(
        input.owner,
        input.repo,
        input.prNumber
      );

      return {
        feedback,
        merged,
        action: 'merged',
      };
    }

    return {
      feedback,
      merged: false,
      action: feedback.requiresAction ? 'feedback_provided' : 'waiting',
    };
  } catch (error) {
    console.error('Error processing CI feedback:', error);
    throw error;
  }
}
