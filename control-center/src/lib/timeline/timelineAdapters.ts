/**
 * Timeline Event Adapters (E87.3)
 * 
 * Adapters for converting existing audit data sources into unified timeline events:
 * - E87.1 approval_gates → timeline events
 * - E87.2 automation_policy_executions → timeline events
 * - workflow_action_audit (PR actions, reruns) → timeline events
 * - cr_github_issue_audit (issue publish) → timeline events
 */

import { Pool } from 'pg';
import {
  UnifiedTimelineEventInput,
  formatApprovalSummary,
  formatPolicySummary,
  formatPRSummary,
  formatIssuePublishSummary,
  buildBacklinks,
} from './unifiedTimelineEvents';
import { recordTimelineEvent } from '../db/unifiedTimelineEvents';

// ========================================
// Approval Gate Adapters (E87.1)
// ========================================

/**
 * Create timeline event from approval gate record
 */
export async function recordApprovalEvent(
  pool: Pool,
  params: {
    requestId: string;
    sessionId?: string | null;
    actionType: string;
    targetType: string;
    targetIdentifier: string;
    decision: 'approved' | 'denied' | 'cancelled';
    actor: string;
    lawbookHash?: string | null;
    contextSummary?: Record<string, any>;
    signedPhrase?: string | null;
    reason?: string | null;
  }
): Promise<void> {
  // Map decision to event type
  const eventTypeMap = {
    approved: 'approval_approved' as const,
    denied: 'approval_denied' as const,
    cancelled: 'approval_cancelled' as const,
  };
  
  const eventType = eventTypeMap[params.decision];
  
  // Determine subject type
  let subjectType: 'pr' | 'afu9_issue' | 'deployment' = 'pr';
  if (params.targetType === 'pr') {
    subjectType = 'pr';
  } else if (params.targetType === 'env' || params.targetType === 'database') {
    subjectType = 'deployment';
  }
  
  // Extract PR number or issue number from targetIdentifier if available
  let prNumber: number | null = null;
  let ghIssueNumber: number | null = null;
  const prMatch = params.targetIdentifier.match(/#(\d+)/);
  if (prMatch && params.targetType === 'pr') {
    prNumber = parseInt(prMatch[1], 10);
  }
  
  const event: UnifiedTimelineEventInput = {
    event_type: eventType,
    timestamp: new Date(),
    actor: params.actor,
    session_id: params.sessionId,
    canonical_id: null,
    gh_issue_number: ghIssueNumber,
    pr_number: prNumber,
    workflow_run_id: null,
    subject_type: subjectType,
    subject_identifier: params.targetIdentifier,
    request_id: params.requestId,
    lawbook_hash: params.lawbookHash,
    evidence_hash: null,
    context_pack_id: null,
    links: buildBacklinks({
      sessionId: params.sessionId,
      prNumber,
      ghIssueNumber,
    }),
    summary: formatApprovalSummary(
      params.decision,
      params.actionType,
      params.targetIdentifier,
      params.actor
    ),
    details: {
      actionType: params.actionType,
      targetType: params.targetType,
      reason: params.reason || null,
      contextSummary: params.contextSummary || null,
    },
  };
  
  await recordTimelineEvent(pool, event);
}

// ========================================
// Automation Policy Adapters (E87.2)
// ========================================

/**
 * Create timeline event from automation policy execution
 */
export async function recordPolicyEvent(
  pool: Pool,
  params: {
    requestId: string;
    sessionId?: string | null;
    actionType: string;
    targetType: string;
    targetIdentifier: string;
    decision: 'allowed' | 'denied';
    decisionReason: string;
    actor?: string;
    lawbookHash?: string | null;
    nextAllowedAt?: Date | null;
    policyName?: string | null;
    deploymentEnv?: string | null;
  }
): Promise<void> {
  // Map decision to event type
  const eventType = params.decision === 'allowed' 
    ? 'automation_policy_allowed' as const
    : 'automation_policy_denied' as const;
  
  // Determine subject type
  let subjectType: 'pr' | 'workflow_run' | 'deployment' = 'pr';
  if (params.targetType === 'pr') {
    subjectType = 'pr';
  } else if (params.targetType === 'workflow') {
    subjectType = 'workflow_run';
  } else if (params.targetType === 'deployment') {
    subjectType = 'deployment';
  }
  
  // Extract PR/workflow numbers from targetIdentifier
  let prNumber: number | null = null;
  let workflowRunId: number | null = null;
  const prMatch = params.targetIdentifier.match(/#(\d+)/);
  if (prMatch && params.targetType === 'pr') {
    prNumber = parseInt(prMatch[1], 10);
  }
  const workflowMatch = params.targetIdentifier.match(/workflow:(\d+)/);
  if (workflowMatch) {
    workflowRunId = parseInt(workflowMatch[1], 10);
  }
  
  const event: UnifiedTimelineEventInput = {
    event_type: eventType,
    timestamp: new Date(),
    actor: params.actor || 'system',
    session_id: params.sessionId,
    canonical_id: null,
    gh_issue_number: null,
    pr_number: prNumber,
    workflow_run_id: workflowRunId,
    subject_type: subjectType,
    subject_identifier: params.targetIdentifier,
    request_id: params.requestId,
    lawbook_hash: params.lawbookHash,
    evidence_hash: null,
    context_pack_id: null,
    links: buildBacklinks({
      sessionId: params.sessionId,
      prNumber,
    }),
    summary: formatPolicySummary(
      params.decision,
      params.actionType,
      params.targetIdentifier,
      params.decisionReason
    ),
    details: {
      actionType: params.actionType,
      targetType: params.targetType,
      decisionReason: params.decisionReason,
      policyName: params.policyName || null,
      deploymentEnv: params.deploymentEnv || null,
      nextAllowedAt: params.nextAllowedAt?.toISOString() || null,
    },
  };
  
  await recordTimelineEvent(pool, event);
}

// ========================================
// PR/Workflow Action Adapters
// ========================================

/**
 * Create timeline event from PR action (merge, open, close)
 */
export async function recordPRActionEvent(
  pool: Pool,
  params: {
    requestId: string;
    actionType: 'pr_opened' | 'pr_merged' | 'pr_closed';
    owner: string;
    repo: string;
    prNumber: number;
    actor: string;
    sessionId?: string | null;
  }
): Promise<void> {
  const prIdentifier = `${params.owner}/${params.repo}#${params.prNumber}`;
  
  const event: UnifiedTimelineEventInput = {
    event_type: params.actionType,
    timestamp: new Date(),
    actor: params.actor,
    session_id: params.sessionId,
    canonical_id: null,
    gh_issue_number: null,
    pr_number: params.prNumber,
    workflow_run_id: null,
    subject_type: 'pr',
    subject_identifier: prIdentifier,
    request_id: params.requestId,
    lawbook_hash: null,
    evidence_hash: null,
    context_pack_id: null,
    links: buildBacklinks({
      sessionId: params.sessionId,
      prNumber: params.prNumber,
      owner: params.owner,
      repo: params.repo,
    }),
    summary: formatPRSummary(params.actionType, prIdentifier, params.actor),
    details: {
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
    },
  };
  
  await recordTimelineEvent(pool, event);
}

/**
 * Create timeline event from checks rerun
 */
export async function recordChecksRerunEvent(
  pool: Pool,
  params: {
    requestId: string;
    owner: string;
    repo: string;
    prNumber: number;
    actor: string;
    sessionId?: string | null;
    workflowRunId?: number | null;
  }
): Promise<void> {
  const prIdentifier = `${params.owner}/${params.repo}#${params.prNumber}`;
  
  const event: UnifiedTimelineEventInput = {
    event_type: 'checks_rerun',
    timestamp: new Date(),
    actor: params.actor,
    session_id: params.sessionId,
    canonical_id: null,
    gh_issue_number: null,
    pr_number: params.prNumber,
    workflow_run_id: params.workflowRunId,
    subject_type: 'pr',
    subject_identifier: prIdentifier,
    request_id: params.requestId,
    lawbook_hash: null,
    evidence_hash: null,
    context_pack_id: null,
    links: buildBacklinks({
      sessionId: params.sessionId,
      prNumber: params.prNumber,
      owner: params.owner,
      repo: params.repo,
    }),
    summary: `${params.actor} reran checks for ${prIdentifier}`,
    details: {
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      workflowRunId: params.workflowRunId || null,
    },
  };
  
  await recordTimelineEvent(pool, event);
}

// ========================================
// Issue Publish Adapters (E82.3)
// ========================================

/**
 * Create timeline event from issue publish/update
 */
export async function recordIssuePublishEvent(
  pool: Pool,
  params: {
    requestId: string;
    canonicalId: string;
    sessionId?: string | null;
    action: 'create' | 'update';
    owner: string;
    repo: string;
    issueNumber: number;
    crHash: string;
    lawbookVersion?: string | null;
    renderedIssueHash: string;
    contextPackId?: string | null;
  }
): Promise<void> {
  const issueIdentifier = `${params.owner}/${params.repo}#${params.issueNumber}`;
  const eventType = params.action === 'create' ? 'issue_published' as const : 'issue_updated' as const;
  
  const event: UnifiedTimelineEventInput = {
    event_type: eventType,
    timestamp: new Date(),
    actor: 'system', // Issue publishing is typically system-triggered
    session_id: params.sessionId,
    canonical_id: params.canonicalId,
    gh_issue_number: params.issueNumber,
    pr_number: null,
    workflow_run_id: null,
    subject_type: 'gh_issue',
    subject_identifier: issueIdentifier,
    request_id: params.requestId,
    lawbook_hash: null, // Could be derived from lawbookVersion if needed
    evidence_hash: params.crHash,
    context_pack_id: params.contextPackId,
    links: buildBacklinks({
      sessionId: params.sessionId,
      canonicalId: params.canonicalId,
      ghIssueNumber: params.issueNumber,
      owner: params.owner,
      repo: params.repo,
    }),
    summary: formatIssuePublishSummary(params.action, issueIdentifier, params.canonicalId),
    details: {
      owner: params.owner,
      repo: params.repo,
      issueNumber: params.issueNumber,
      canonicalId: params.canonicalId,
      crHash: params.crHash,
      lawbookVersion: params.lawbookVersion || null,
      renderedIssueHash: params.renderedIssueHash,
    },
  };
  
  await recordTimelineEvent(pool, event);
}
