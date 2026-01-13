/**
 * Drift Detection Service
 * E85.4: Drift Detection + Repair Suggestions
 * 
 * Detects drift between AFU-9 and GitHub without making automatic destructive changes.
 * Evidence-first approach with explainable suggestions.
 */

import { Pool } from 'pg';
import { Octokit } from 'octokit';
import { v4 as uuidv4 } from 'uuid';
import {
  DriftDetectionResult,
  DriftDetectionInput,
  DriftType,
  DriftSeverity,
  DriftEvidence,
  RepairSuggestion,
  RepairDirection,
  RepairAction,
} from './contracts/drift';
import { Afu9IssueStatus } from './contracts/afu9Issue';
import { getAfu9IssueById } from './db/afu9Issues';
import { loadStateMachineSpec, getGitHubLabelsForStatus } from './state-machine/loader';

/**
 * Drift Detection Service
 * 
 * Guards:
 * - ❌ No Auto-Repair
 * - ❌ No Force-Overwrite
 * - ✅ Evidence-first
 * - ✅ Explicit user confirmation required
 */
export class DriftDetectionService {
  private pool: Pool;
  private octokit: Octokit;

  constructor(pool: Pool, octokit: Octokit) {
    this.pool = pool;
    this.octokit = octokit;
  }

  /**
   * Detect drift for an issue
   * 
   * @param input - Drift detection input
   * @returns Drift detection result with suggestions
   */
  async detectDrift(input: DriftDetectionInput): Promise<DriftDetectionResult> {
    const detectionId = uuidv4();

    try {
      // 1. Get AFU-9 issue state
      const issueResult = await getAfu9IssueById(this.pool, input.issue_id);
      if (!issueResult.success || !issueResult.data) {
        throw new Error(issueResult.error || 'Issue not found');
      }

      const afu9Issue = issueResult.data;

      // 2. Get GitHub state
      const githubData = await this.fetchGitHubData(
        input.github_owner,
        input.github_repo,
        input.github_issue_number
      );

      // 3. Collect evidence
      const evidence = this.collectEvidence(afu9Issue, githubData);

      // 4. Detect drift types
      const driftTypes = this.detectDriftTypes(evidence);

      // 5. Calculate severity
      const severity = this.calculateSeverity(driftTypes, evidence);

      // 6. Generate repair suggestions
      const suggestions = this.generateRepairSuggestions(
        driftTypes,
        evidence,
        severity
      );

      return {
        id: detectionId,
        issue_id: input.issue_id,
        drift_detected: driftTypes.length > 0,
        drift_types: driftTypes,
        severity,
        evidence,
        suggestions,
        detected_at: new Date().toISOString(),
        github_owner: input.github_owner,
        github_repo: input.github_repo,
        github_issue_number: input.github_issue_number,
        dry_run: input.dry_run || false,
      };
    } catch (error) {
      console.error('[DriftDetectionService] Error detecting drift:', error);
      
      // Return empty result on error
      return {
        id: detectionId,
        issue_id: input.issue_id,
        drift_detected: false,
        drift_types: [],
        severity: DriftSeverity.LOW,
        evidence: this.createEmptyEvidence(),
        suggestions: [],
        detected_at: new Date().toISOString(),
        github_owner: input.github_owner,
        github_repo: input.github_repo,
        github_issue_number: input.github_issue_number,
        dry_run: input.dry_run || false,
      };
    }
  }

  /**
   * Fetch GitHub data for drift detection
   */
  private async fetchGitHubData(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<{
    issue: any;
    pr?: any;
    reviews?: any[];
    checks?: any;
  }> {
    // Fetch issue
    const { data: issue } = await this.octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    let pr, reviews, checks;

    // If it's a PR, fetch additional data
    if (issue.pull_request) {
      try {
        const { data: prData } = await this.octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: issueNumber,
        });
        pr = prData;

        // Fetch reviews
        const { data: reviewsData } = await this.octokit.rest.pulls.listReviews({
          owner,
          repo,
          pull_number: issueNumber,
        });
        reviews = reviewsData;

        // Fetch checks
        const { data: checksData } = await this.octokit.rest.checks.listForRef({
          owner,
          repo,
          ref: prData.head.sha,
        });
        checks = checksData;
      } catch (error) {
        console.error('[fetchGitHubData] Error fetching PR data:', error);
      }
    }

    return { issue, pr, reviews, checks };
  }

  /**
   * Collect evidence from AFU-9 and GitHub
   */
  private collectEvidence(
    afu9Issue: any,
    githubData: { issue: any; pr?: any; reviews?: any[]; checks?: any }
  ): DriftEvidence {
    const { issue, pr, reviews, checks } = githubData;

    // Determine GitHub checks status
    let checksStatus = null;
    if (checks && checks.check_runs) {
      const allPass = checks.check_runs.every(
        (run: any) => run.status === 'completed' && 
          (run.conclusion === 'success' || run.conclusion === 'skipped')
      );
      checksStatus = allPass ? 'success' : 'failure';
    }

    // Determine review status
    let reviewStatus = null;
    if (reviews && reviews.length > 0) {
      const hasApproval = reviews.some((review: any) => review.state === 'APPROVED');
      reviewStatus = hasApproval ? 'approved' : 'pending';
    }

    return {
      collected_at: new Date().toISOString(),
      
      // AFU-9 state
      afu9_status: afu9Issue.status as Afu9IssueStatus,
      afu9_labels: afu9Issue.labels || [],
      afu9_last_updated: afu9Issue.updated_at || null,
      
      // GitHub state
      github_pr_state: pr?.state || issue.state,
      github_pr_merged: pr?.merged || false,
      github_labels: issue.labels.map((label: any) => 
        typeof label === 'string' ? label : label.name || ''
      ),
      github_checks_status: checksStatus,
      github_review_status: reviewStatus,
      github_last_updated: issue.updated_at,
      
      // Raw data for audit
      github_raw_data: {
        issue_state: issue.state,
        issue_labels: issue.labels,
        pr_state: pr?.state,
        pr_merged: pr?.merged,
        pr_mergeable_state: pr?.mergeable_state,
        checks_total: checks?.total_count,
        reviews_count: reviews?.length,
      },
    };
  }

  /**
   * Detect drift types from evidence
   */
  private detectDriftTypes(evidence: DriftEvidence): DriftType[] {
    const driftTypes: DriftType[] = [];

    // Check status mismatch
    if (this.hasStatusMismatch(evidence)) {
      driftTypes.push(DriftType.STATUS_MISMATCH);
    }

    // Check label mismatch
    if (this.hasLabelMismatch(evidence)) {
      driftTypes.push(DriftType.LABEL_MISMATCH);
    }

    // Check state mismatch
    if (this.hasStateMismatch(evidence)) {
      driftTypes.push(DriftType.STATE_MISMATCH);
    }

    // Check check mismatch
    if (this.hasCheckMismatch(evidence)) {
      driftTypes.push(DriftType.CHECK_MISMATCH);
    }

    return driftTypes;
  }

  /**
   * Check if there's a status mismatch
   */
  private hasStatusMismatch(evidence: DriftEvidence): boolean {
    const { afu9_status, github_pr_state, github_pr_merged } = evidence;

    // If PR is merged but AFU-9 is not DONE
    if (github_pr_merged && afu9_status !== Afu9IssueStatus.DONE) {
      return true;
    }

    // If PR is closed but not merged, and AFU-9 is not KILLED
    if (github_pr_state === 'closed' && !github_pr_merged && 
        afu9_status !== Afu9IssueStatus.KILLED) {
      return true;
    }

    return false;
  }

  /**
   * Check if there's a label mismatch
   */
  private hasLabelMismatch(evidence: DriftEvidence): boolean {
    const { afu9_status, github_labels } = evidence;

    // Get expected GitHub labels for AFU-9 status
    const spec = loadStateMachineSpec();
    const expectedLabels = getGitHubLabelsForStatus(spec, afu9_status);

    if (!expectedLabels) {
      return false;
    }

    // Check if primary label exists in GitHub
    const hasPrimaryLabel = github_labels.includes(expectedLabels.primary);

    return !hasPrimaryLabel;
  }

  /**
   * Check if there's a state mismatch
   */
  private hasStateMismatch(evidence: DriftEvidence): boolean {
    const { afu9_status, github_pr_state } = evidence;

    // If AFU-9 shows DONE but GitHub is still open
    if (afu9_status === Afu9IssueStatus.DONE && github_pr_state === 'open') {
      return true;
    }

    // If AFU-9 shows active states but GitHub is closed
    const activeStates = [
      Afu9IssueStatus.IMPLEMENTING,
      Afu9IssueStatus.VERIFIED,
      Afu9IssueStatus.MERGE_READY,
    ];
    if (activeStates.includes(afu9_status) && github_pr_state === 'closed') {
      return true;
    }

    return false;
  }

  /**
   * Check if there's a check/CI mismatch
   */
  private hasCheckMismatch(evidence: DriftEvidence): boolean {
    const { afu9_status, github_checks_status } = evidence;

    // If AFU-9 shows MERGE_READY but checks are failing
    if (afu9_status === Afu9IssueStatus.MERGE_READY && 
        github_checks_status === 'failure') {
      return true;
    }

    return false;
  }

  /**
   * Calculate drift severity
   */
  private calculateSeverity(
    driftTypes: DriftType[],
    evidence: DriftEvidence
  ): DriftSeverity {
    if (driftTypes.length === 0) {
      return DriftSeverity.LOW;
    }

    // Critical: Status mismatch with merged PR
    if (driftTypes.includes(DriftType.STATUS_MISMATCH) && 
        evidence.github_pr_merged) {
      return DriftSeverity.CRITICAL;
    }

    // High: Multiple drift types
    if (driftTypes.length >= 3) {
      return DriftSeverity.HIGH;
    }

    // High: State mismatch
    if (driftTypes.includes(DriftType.STATE_MISMATCH)) {
      return DriftSeverity.HIGH;
    }

    // Medium: Status or check mismatch
    if (driftTypes.includes(DriftType.STATUS_MISMATCH) || 
        driftTypes.includes(DriftType.CHECK_MISMATCH)) {
      return DriftSeverity.MEDIUM;
    }

    // Low: Only label mismatch
    return DriftSeverity.LOW;
  }

  /**
   * Generate repair suggestions
   * 
   * ❌ No Auto-Repair: Only generates suggestions, never applies them
   */
  private generateRepairSuggestions(
    driftTypes: DriftType[],
    evidence: DriftEvidence,
    severity: DriftSeverity
  ): RepairSuggestion[] {
    const suggestions: RepairSuggestion[] = [];

    if (driftTypes.length === 0) {
      return suggestions;
    }

    // Generate suggestions based on drift types
    if (driftTypes.includes(DriftType.STATUS_MISMATCH)) {
      suggestions.push(...this.generateStatusMismatchSuggestions(evidence));
    }

    if (driftTypes.includes(DriftType.LABEL_MISMATCH)) {
      suggestions.push(...this.generateLabelMismatchSuggestions(evidence));
    }

    if (driftTypes.includes(DriftType.STATE_MISMATCH)) {
      suggestions.push(...this.generateStateMismatchSuggestions(evidence));
    }

    if (driftTypes.includes(DriftType.CHECK_MISMATCH)) {
      suggestions.push(...this.generateCheckMismatchSuggestions(evidence));
    }

    // Sort by confidence (highest first)
    suggestions.sort((a, b) => b.confidence - a.confidence);

    return suggestions;
  }

  /**
   * Generate suggestions for status mismatch
   */
  private generateStatusMismatchSuggestions(
    evidence: DriftEvidence
  ): RepairSuggestion[] {
    const suggestions: RepairSuggestion[] = [];

    // If PR is merged, suggest updating AFU-9 to DONE
    if (evidence.github_pr_merged && evidence.afu9_status !== Afu9IssueStatus.DONE) {
      suggestions.push({
        id: uuidv4(),
        direction: RepairDirection.GITHUB_TO_AFU9,
        description: 'Update AFU-9 status to DONE (PR merged on GitHub)',
        explanation: 'GitHub PR has been merged, but AFU-9 status is still ' + 
          `${evidence.afu9_status}. This suggests AFU-9 is out of sync.`,
        evidence: [
          `GitHub PR merged: ${evidence.github_pr_merged}`,
          `Current AFU-9 status: ${evidence.afu9_status}`,
          `Expected AFU-9 status: DONE`,
        ],
        risk_level: 'low',
        actions: [
          {
            type: 'UPDATE_AFU9_STATUS',
            target: 'AFU-9 Issue Status',
            current_value: evidence.afu9_status,
            new_value: Afu9IssueStatus.DONE,
            reversible: true,
          },
        ],
        requires_confirmation: true,
        confidence: 0.95,
      });
    }

    // If PR is closed (not merged), suggest updating AFU-9 to KILLED
    if (evidence.github_pr_state === 'closed' && !evidence.github_pr_merged &&
        evidence.afu9_status !== Afu9IssueStatus.KILLED) {
      suggestions.push({
        id: uuidv4(),
        direction: RepairDirection.GITHUB_TO_AFU9,
        description: 'Update AFU-9 status to KILLED (PR closed without merge)',
        explanation: 'GitHub PR was closed without merging, but AFU-9 status is still ' +
          `${evidence.afu9_status}. This suggests the work was abandoned.`,
        evidence: [
          `GitHub PR state: ${evidence.github_pr_state}`,
          `GitHub PR merged: ${evidence.github_pr_merged}`,
          `Current AFU-9 status: ${evidence.afu9_status}`,
        ],
        risk_level: 'medium',
        actions: [
          {
            type: 'UPDATE_AFU9_STATUS',
            target: 'AFU-9 Issue Status',
            current_value: evidence.afu9_status,
            new_value: Afu9IssueStatus.KILLED,
            reversible: true,
          },
        ],
        requires_confirmation: true,
        confidence: 0.85,
      });
    }

    return suggestions;
  }

  /**
   * Generate suggestions for label mismatch
   */
  private generateLabelMismatchSuggestions(
    evidence: DriftEvidence
  ): RepairSuggestion[] {
    const suggestions: RepairSuggestion[] = [];

    const spec = loadStateMachineSpec();
    const expectedLabels = getGitHubLabelsForStatus(spec, evidence.afu9_status);

    if (!expectedLabels) {
      return suggestions;
    }

    // Suggest syncing AFU-9 labels to GitHub
    suggestions.push({
      id: uuidv4(),
      direction: RepairDirection.AFU9_TO_GITHUB,
      description: 'Sync AFU-9 status labels to GitHub',
      explanation: `GitHub labels don't match AFU-9 status (${evidence.afu9_status}). ` +
        `Expected label: ${expectedLabels.primary}`,
      evidence: [
        `AFU-9 status: ${evidence.afu9_status}`,
        `Expected GitHub label: ${expectedLabels.primary}`,
        `Current GitHub labels: ${evidence.github_labels.join(', ')}`,
      ],
      risk_level: 'low',
      actions: [
        {
          type: 'UPDATE_GITHUB_LABELS',
          target: 'GitHub Issue Labels',
          current_value: evidence.github_labels.join(', '),
          new_value: [expectedLabels.primary, ...expectedLabels.additional].join(', '),
          reversible: true,
        },
      ],
      requires_confirmation: true,
      confidence: 0.80,
    });

    return suggestions;
  }

  /**
   * Generate suggestions for state mismatch
   */
  private generateStateMismatchSuggestions(
    evidence: DriftEvidence
  ): RepairSuggestion[] {
    const suggestions: RepairSuggestion[] = [];

    // If AFU-9 is DONE but GitHub is open, suggest manual review
    if (evidence.afu9_status === Afu9IssueStatus.DONE && 
        evidence.github_pr_state === 'open') {
      suggestions.push({
        id: uuidv4(),
        direction: RepairDirection.MANUAL_REVIEW,
        description: 'Manual review required: AFU-9 DONE but GitHub PR open',
        explanation: 'AFU-9 shows DONE status, but GitHub PR is still open. ' +
          'This may indicate the PR was not properly merged or AFU-9 was manually updated.',
        evidence: [
          `AFU-9 status: ${evidence.afu9_status}`,
          `GitHub PR state: ${evidence.github_pr_state}`,
          `GitHub PR merged: ${evidence.github_pr_merged}`,
        ],
        risk_level: 'high',
        actions: [
          {
            type: 'MANUAL_INTERVENTION',
            target: 'Issue State Reconciliation',
            current_value: 'Divergent state',
            new_value: null,
            reversible: false,
          },
        ],
        requires_confirmation: true,
        confidence: 0.60,
      });
    }

    return suggestions;
  }

  /**
   * Generate suggestions for check mismatch
   */
  private generateCheckMismatchSuggestions(
    evidence: DriftEvidence
  ): RepairSuggestion[] {
    const suggestions: RepairSuggestion[] = [];

    // If AFU-9 is MERGE_READY but checks failed
    if (evidence.afu9_status === Afu9IssueStatus.MERGE_READY && 
        evidence.github_checks_status === 'failure') {
      suggestions.push({
        id: uuidv4(),
        direction: RepairDirection.GITHUB_TO_AFU9,
        description: 'Revert AFU-9 status from MERGE_READY (checks failing)',
        explanation: 'AFU-9 shows MERGE_READY but GitHub checks are failing. ' +
          'The issue should be moved back to VERIFIED or IMPLEMENTING.',
        evidence: [
          `AFU-9 status: ${evidence.afu9_status}`,
          `GitHub checks status: ${evidence.github_checks_status}`,
        ],
        risk_level: 'medium',
        actions: [
          {
            type: 'UPDATE_AFU9_STATUS',
            target: 'AFU-9 Issue Status',
            current_value: evidence.afu9_status,
            new_value: Afu9IssueStatus.VERIFIED,
            reversible: true,
          },
        ],
        requires_confirmation: true,
        confidence: 0.75,
      });
    }

    return suggestions;
  }

  /**
   * Create empty evidence (for error cases)
   */
  private createEmptyEvidence(): DriftEvidence {
    return {
      collected_at: new Date().toISOString(),
      afu9_status: Afu9IssueStatus.CREATED,
      afu9_labels: [],
      afu9_last_updated: null,
      github_pr_state: null,
      github_pr_merged: null,
      github_labels: [],
      github_checks_status: null,
      github_review_status: null,
      github_last_updated: null,
      github_raw_data: {},
    };
  }
}
