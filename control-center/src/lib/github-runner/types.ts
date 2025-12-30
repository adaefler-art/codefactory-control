/**
 * E64.1: GitHub Runner Adapter - Type Definitions
 * 
 * Contracts for dispatching, polling, and ingesting GitHub Actions workflow runs.
 */

/**
 * GitHub Actions workflow run status
 * From GitHub API: https://docs.github.com/en/rest/actions/workflow-runs
 */
export type GitHubRunStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'waiting'
  | 'requested';

/**
 * GitHub Actions workflow run conclusion
 * Only present when status is 'completed'
 */
export type GitHubRunConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'neutral'
  | 'stale'
  | null;

/**
 * Normalized run status for internal use
 * Maps to the runs table status values
 */
export type NormalizedRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

/**
 * Input for dispatching a workflow
 */
export interface DispatchWorkflowInput {
  /** Repository owner (e.g., 'adaefler-art') */
  owner: string;
  
  /** Repository name (e.g., 'codefactory-control') */
  repo: string;
  
  /** Workflow ID (number) or workflow file name (e.g., 'ci.yml') */
  workflowIdOrFile: string | number;
  
  /** Git ref (branch, tag, or commit SHA) */
  ref: string;
  
  /** Workflow inputs (key-value pairs) */
  inputs?: Record<string, string>;
  
  /** Correlation ID (issue ID or execution ID) for idempotency and tracking */
  correlationId: string;
  
  /** Optional title for the run record */
  title?: string;
}

/**
 * Result from dispatching a workflow
 */
export interface DispatchWorkflowResult {
  /** GitHub workflow run ID */
  runId: number;
  
  /** URL to the workflow run */
  runUrl: string;
  
  /** Internal run record ID (UUID) */
  recordId: string;
  
  /** Whether this was an existing run (idempotent) */
  isExisting: boolean;
}

/**
 * Input for polling a workflow run
 */
export interface PollRunInput {
  /** Repository owner */
  owner: string;
  
  /** Repository name */
  repo: string;
  
  /** GitHub workflow run ID */
  runId: number;
}

/**
 * Result from polling a workflow run
 */
export interface PollRunResult {
  /** GitHub workflow run ID */
  runId: number;
  
  /** Current status */
  status: GitHubRunStatus;
  
  /** Conclusion (if completed) */
  conclusion: GitHubRunConclusion;
  
  /** When the run was last updated */
  updatedAt: string;
  
  /** When the run was created */
  createdAt: string;
  
  /** When the run started (if started) */
  runStartedAt?: string;
  
  /** Normalized status for internal use */
  normalizedStatus: NormalizedRunStatus;
}

/**
 * Input for ingesting a workflow run
 */
export interface IngestRunInput {
  /** Repository owner */
  owner: string;
  
  /** Repository name */
  repo: string;
  
  /** GitHub workflow run ID */
  runId: number;
}

/**
 * Artifact metadata from a workflow run
 */
export interface WorkflowArtifact {
  /** Artifact ID */
  id: number;
  
  /** Artifact name */
  name: string;
  
  /** Size in bytes */
  sizeInBytes: number;
  
  /** Download URL (requires authentication) */
  downloadUrl: string;
  
  /** When the artifact was created */
  createdAt: string;
  
  /** When the artifact expires */
  expiresAt: string;
}

/**
 * Job information from a workflow run
 */
export interface WorkflowJob {
  /** Job ID */
  id: number;
  
  /** Job name */
  name: string;
  
  /** Job status */
  status: GitHubRunStatus;
  
  /** Job conclusion */
  conclusion: GitHubRunConclusion;
  
  /** When the job started */
  startedAt?: string;
  
  /** When the job completed */
  completedAt?: string;
  
  /** Step count */
  stepCount: number;
}

/**
 * Annotation from a workflow run (warnings, errors)
 */
export interface WorkflowAnnotation {
  /** Annotation level (notice, warning, failure) */
  level: 'notice' | 'warning' | 'failure';
  
  /** Annotation message */
  message: string;
  
  /** File path (if applicable) */
  path?: string;
  
  /** Line number (if applicable) */
  line?: number;
  
  /** Title (if applicable) */
  title?: string;
}

/**
 * Result from ingesting a workflow run
 */
export interface IngestRunResult {
  /** GitHub workflow run ID */
  runId: number;
  
  /** Internal run record ID */
  recordId: string;
  
  /** Summary of the run */
  summary: {
    /** Run status */
    status: GitHubRunStatus;
    
    /** Run conclusion */
    conclusion: GitHubRunConclusion;
    
    /** Total jobs */
    totalJobs: number;
    
    /** Successful jobs */
    successfulJobs: number;
    
    /** Failed jobs */
    failedJobs: number;
    
    /** Duration in milliseconds */
    durationMs?: number;
  };
  
  /** Jobs from the run */
  jobs: WorkflowJob[];
  
  /** Artifacts (metadata only) */
  artifacts: WorkflowArtifact[];
  
  /** Annotations (warnings, errors) */
  annotations: WorkflowAnnotation[];
  
  /** Logs URL */
  logsUrl: string;
}

/**
 * Database record for a GitHub workflow run
 */
export interface GitHubRunRecord {
  /** Internal record ID (UUID) */
  id: string;
  
  /** Correlation ID (issue_id or execution_id) */
  correlationId: string;
  
  /** GitHub workflow run ID */
  githubRunId: number;
  
  /** Repository (owner/repo) */
  repo: string;
  
  /** Workflow ID or file name */
  workflowId: string;
  
  /** Git ref */
  ref: string;
  
  /** Current status */
  status: NormalizedRunStatus;
  
  /** Workflow inputs */
  inputs: Record<string, string>;
  
  /** Result JSON (from ingest) */
  result?: IngestRunResult;
  
  /** Run URL */
  runUrl: string;
  
  /** When the run was dispatched */
  dispatchedAt: string;
  
  /** When the run was last polled */
  lastPolledAt?: string;
  
  /** When the run was ingested */
  ingestedAt?: string;
  
  /** Title/description */
  title?: string;
}

/**
 * Helper to normalize GitHub run status to internal status
 * 
 * Note on 'skipped': Skipped workflows are treated as SUCCEEDED because
 * they completed without errors. A skipped workflow means all steps were
 * intentionally bypassed (e.g., via conditions), which is a successful outcome.
 * This differs from 'cancelled' which indicates user intervention.
 */
export function normalizeGitHubRunStatus(
  status: GitHubRunStatus,
  conclusion: GitHubRunConclusion
): NormalizedRunStatus {
  if (status === 'completed') {
    switch (conclusion) {
      case 'success':
      case 'neutral':
      case 'skipped':
        return 'SUCCEEDED';
      case 'cancelled':
        return 'CANCELLED';
      default:
        return 'FAILED';
    }
  }
  
  if (status === 'in_progress') {
    return 'RUNNING';
  }
  
  // queued, waiting, requested
  return 'QUEUED';
}
