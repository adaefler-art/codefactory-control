/**
 * AFU-9 Workflow Engine Type Definitions
 * 
 * Defines the structure for workflows, executions, and related entities.
 */

import { IssueState } from './issue-state';

/**
 * Workflow definition structure
 */
export interface WorkflowDefinition {
  steps: WorkflowStep[];
}

/**
 * A single step in a workflow
 */
export interface WorkflowStep {
  /** Unique name for this step */
  name: string;
  
  /** MCP tool to call (format: "server.tool" e.g. "github.getIssue") */
  tool: string;
  
  /** Parameters for the tool call (supports variable substitution) */
  params: Record<string, any>;
  
  /** Optional: Variable name to assign the result to */
  assign?: string;
  
  /** Optional: Condition to execute this step (supports variable substitution) */
  condition?: string;
}

/**
 * Workflow execution context
 */
export interface WorkflowContext {
  /** Variables accessible during workflow execution */
  variables: Record<string, any>;
  
  /** Input provided to the workflow */
  input: Record<string, any>;
  
  /** Repository information */
  repo?: {
    owner: string;
    name: string;
    default_branch?: string;
  };
  
  /** Optional: Issue tracking information */
  issue?: {
    number: number;
    state?: IssueState;
    title?: string;
  };
}

/**
 * Workflow execution status
 * 
 * Issue B4: 'paused' status enforces HOLD state - workflow stops completely
 * and can only be resumed by explicit human action (no automatic timeout)
 */
export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

/**
 * Workflow step execution status
 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Result of a workflow execution
 */
export interface WorkflowExecutionResult {
  /** Execution ID */
  executionId: string;
  
  /** Final status of the execution */
  status: WorkflowStatus;
  
  /** Output data from the workflow */
  output: Record<string, any>;
  
  /** Error message if failed */
  error?: string;
  
  /** Execution metadata */
  metadata: {
    startedAt: Date;
    completedAt?: Date;
    durationMs?: number;
    stepsCompleted: number;
    stepsTotal: number;
  };
}

/**
 * Configuration for workflow execution
 */
export interface WorkflowExecutionConfig {
  /** Maximum execution time in milliseconds */
  timeoutMs?: number;
  
  /** Number of retries for failed steps */
  maxRetries?: number;
  
  /** Whether to continue on step failure */
  continueOnError?: boolean;
  
  /** Enable verbose debug logging */
  debugMode?: boolean;
}

/**
 * Workflow pause metadata (Issue B4)
 * 
 * Tracks pause/resume information for HOLD enforcement
 */
export interface WorkflowPauseMetadata {
  /** When the workflow was paused */
  pausedAt: Date;
  
  /** Who paused the workflow */
  pausedBy: string;
  
  /** Reason for pausing */
  reason: string;
  
  /** When the workflow was resumed (if applicable) */
  resumedAt?: Date;
  
  /** Who resumed the workflow (if applicable) */
  resumedBy?: string;
  
  /** Step index at which workflow was paused */
  pausedAtStepIndex?: number;
}
