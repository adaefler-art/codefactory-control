/**
 * GitHub Checks Triage Service
 * 
 * Analyzes GitHub PR check failures, classifies them, extracts evidence,
 * and provides actionable recommendations.
 * 
 * Reference: E84.1 - Checks Triage Analyzer
 */

import { createAuthenticatedClient } from '@/lib/github/auth-wrapper';
import { withRetry, DEFAULT_RETRY_CONFIG } from '@/lib/github/retry-policy';
import { classifyCheck } from '@/lib/github/checks-classifier';
import { createHash } from 'crypto';
import {
  ChecksTriageReportV1,
  ChecksTriageInput,
  FailureV1,
  OverallStatus,
  NextAction,
  Evidence,
} from '@/lib/types/checks-triage';

/**
 * Lawbook hash placeholder
 * In production, this should be retrieved from the lawbook/registry service
 */
const LAWBOOK_HASH = 'v1.0.0-dev';

/**
 * Deployment environment
 * In production, this should be retrieved from environment variables
 */
const DEPLOYMENT_ENV = (process.env.DEPLOY_ENV || 'staging') as 'staging' | 'prod';

/**
 * Normalize log excerpt for hashing
 * Removes timestamps, line numbers, and other non-deterministic elements
 */
function normalizeLogExcerpt(excerpt: string): string {
  return excerpt
    // Remove timestamps (various formats)
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<TIMESTAMP>')
    .replace(/\d{2}:\d{2}:\d{2}(\.\d+)?/g, '<TIME>')
    // Remove line numbers
    .replace(/^[\s]*\d+[\s]*[|:]/gm, '<LINE>:')
    // Remove memory addresses
    .replace(/0x[0-9a-fA-F]+/g, '<ADDR>')
    // Normalize whitespace
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ')
    .trim();
}

/**
 * Calculate SHA256 hash of normalized excerpt
 */
function hashExcerpt(excerpt: string): string {
  const normalized = normalizeLogExcerpt(excerpt);
  return createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

/**
 * Extract primary signal (error message) from log excerpt
 * Looks for common error patterns and returns the most relevant line
 */
function extractPrimarySignal(excerpt: string, checkName: string): string {
  const lines = excerpt.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  // Common error patterns
  const errorPatterns = [
    /error:/i,
    /failed:/i,
    /failure:/i,
    /exception:/i,
    /✗/,
    /×/,
    /❌/,
    /FAIL/,
    /ERROR/,
  ];
  
  // Find first line with error pattern
  for (const line of lines) {
    for (const pattern of errorPatterns) {
      if (pattern.test(line)) {
        return line.substring(0, 200); // Limit to 200 chars
      }
    }
  }
  
  // Fallback: use first non-empty line or check name
  if (lines.length > 0) {
    return lines[0].substring(0, 200);
  }
  
  return `Check failed: ${checkName}`;
}

/**
 * Determine recommended next action based on failure type and signals
 */
function determineNextAction(
  type: string,
  conclusion: string | null,
  primarySignal: string
): { nextAction: NextAction; rationale: string } {
  const signal = primarySignal.toLowerCase();
  
  // Timeout or cancelled → RERUN
  if (conclusion === 'timed_out' || conclusion === 'cancelled') {
    return {
      nextAction: 'RERUN',
      rationale: 'Check timed out or was cancelled, likely transient',
    };
  }
  
  // Infra/deploy failures → HOLD
  if (type === 'infra' || type === 'deploy') {
    return {
      nextAction: 'HOLD',
      rationale: 'Infrastructure or deployment issue may require manual intervention',
    };
  }
  
  // Rate limit, network, or quota errors → RERUN
  if (
    signal.includes('rate limit') ||
    signal.includes('timeout') ||
    signal.includes('network') ||
    signal.includes('quota') ||
    signal.includes('econnrefused') ||
    signal.includes('econnreset')
  ) {
    return {
      nextAction: 'RERUN',
      rationale: 'Transient network or quota issue detected',
    };
  }
  
  // Lint, test, build failures → PROMPT (fixable by code changes)
  if (type === 'lint' || type === 'test' || type === 'build' || type === 'e2e') {
    return {
      nextAction: 'PROMPT',
      rationale: `${type} failure likely requires code changes`,
    };
  }
  
  // Unknown → PROMPT (default to human/AI intervention)
  return {
    nextAction: 'PROMPT',
    rationale: 'Failure type unknown, requires investigation',
  };
}

/**
 * Fetch logs for a specific workflow job
 * Returns bounded excerpt (first match window)
 */
async function fetchJobLogs(
  owner: string,
  repo: string,
  jobId: number,
  maxLogBytes: number
): Promise<string> {
  const octokit = await createAuthenticatedClient({ owner, repo });
  
  try {
    // Download logs (GitHub returns raw text)
    const response = await withRetry(
      async () => {
        return await octokit.request('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs', {
          owner,
          repo,
          job_id: jobId,
        });
      },
      { ...DEFAULT_RETRY_CONFIG, httpMethod: 'GET', requestId: `job-${jobId}`, endpoint: 'actions.jobs.logs' }
    );
    
    // Bound the logs to maxLogBytes
    const logs = String(response.data);
    if (logs.length > maxLogBytes) {
      return logs.substring(0, maxLogBytes);
    }
    return logs;
  } catch (error) {
    // If logs are not available, return empty string
    console.warn(`[Checks Triage] Failed to fetch logs for job ${jobId}:`, error);
    return '';
  }
}

/**
 * Analyze a single check run and create failure entry
 */
async function analyzeCheckRun(
  owner: string,
  repo: string,
  check: any,
  maxLogBytes: number
): Promise<FailureV1 | null> {
  // Only analyze completed checks with non-success conclusions
  if (check.status !== 'completed') {
    return null;
  }
  
  if (check.conclusion === 'success' || check.conclusion === 'skipped' || check.conclusion === 'neutral') {
    return null;
  }
  
  const checkName = check.name;
  const type = classifyCheck(checkName);
  const conclusion = check.conclusion;
  
  // Extract evidence
  let excerpt = '';
  let url = check.html_url || check.url || `https://github.com/${owner}/${repo}/runs/${check.id}`;
  
  // Try to fetch logs if available
  if (check.id) {
    excerpt = await fetchJobLogs(owner, repo, check.id, maxLogBytes);
  }
  
  // If no logs, use check output summary
  if (!excerpt && check.output?.summary) {
    excerpt = check.output.summary.substring(0, maxLogBytes);
  }
  
  // If still no excerpt, use title
  if (!excerpt && check.output?.title) {
    excerpt = check.output.title;
  }
  
  // Fallback to generic message
  if (!excerpt) {
    excerpt = `Check ${checkName} failed with conclusion: ${conclusion}`;
  }
  
  const excerptHash = hashExcerpt(excerpt);
  const primarySignal = extractPrimarySignal(excerpt, checkName);
  const recommendation = determineNextAction(type, conclusion, primarySignal);
  
  const evidence: Evidence = {
    url,
    excerpt: excerpt.substring(0, maxLogBytes), // Ensure bounded
    excerptHash,
  };
  
  return {
    checkName,
    type,
    conclusion,
    runId: check.run_id,
    jobId: check.id,
    stepName: check.name,
    evidence,
    primarySignal,
    recommendation,
  };
}

/**
 * Generate checks triage report for a PR
 */
export async function generateChecksTriageReport(
  input: ChecksTriageInput
): Promise<ChecksTriageReportV1> {
  const { owner, repo, prNumber, workflowRunId, maxLogBytes, maxSteps, requestId } = input;
  
  const octokit = await createAuthenticatedClient({ owner, repo });
  
  // Fetch PR to get head SHA
  const prData = await withRetry(
    async () => {
      const { data } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });
      return data;
    },
    { ...DEFAULT_RETRY_CONFIG, httpMethod: 'GET', requestId: `pr-${prNumber}`, endpoint: 'pulls.get' }
  );
  
  const headSha = prData.head.sha;
  
  // Fetch check runs for the head SHA
  const checksData = await withRetry(
    async () => {
      const { data } = await octokit.rest.checks.listForRef({
        owner,
        repo,
        ref: headSha,
        per_page: maxSteps,
      });
      return data;
    },
    { ...DEFAULT_RETRY_CONFIG, httpMethod: 'GET', requestId: `pr-${prNumber}`, endpoint: 'checks.listForRef' }
  );
  
  // Analyze each check run
  const failures: FailureV1[] = [];
  const failingChecks = new Set<string>();
  const failingRuns = new Set<number>();
  
  for (const check of checksData.check_runs) {
    const failure = await analyzeCheckRun(owner, repo, check, maxLogBytes);
    if (failure) {
      failures.push(failure);
      failingChecks.add(check.name);
      if (check.run_id) {
        failingRuns.add(check.run_id);
      }
    }
  }
  
  // Sort failures deterministically: checkName asc, runId asc, jobId asc
  failures.sort((a, b) => {
    if (a.checkName !== b.checkName) {
      return a.checkName.localeCompare(b.checkName);
    }
    if (a.runId !== b.runId) {
      return (a.runId || 0) - (b.runId || 0);
    }
    return (a.jobId || 0) - (b.jobId || 0);
  });
  
  // Determine overall status
  let overall: OverallStatus = 'GREEN';
  if (failures.length > 0) {
    // RED if any failures require PROMPT or HOLD
    const hasBlockingFailure = failures.some(
      f => f.recommendation.nextAction === 'PROMPT' || f.recommendation.nextAction === 'HOLD'
    );
    if (hasBlockingFailure) {
      overall = 'RED';
    } else {
      overall = 'YELLOW'; // Only RERUN or NONE actions
    }
  }
  
  return {
    schemaVersion: '1.0',
    requestId: requestId || `triage-${Date.now()}`,
    deploymentEnv: DEPLOYMENT_ENV,
    lawbookHash: LAWBOOK_HASH,
    repo: { owner, repo },
    pr: { number: prNumber, headSha },
    summary: {
      overall,
      failingChecks: failingChecks.size,
      failingRuns: failingRuns.size,
    },
    failures,
  };
}
