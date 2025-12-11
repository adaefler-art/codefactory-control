/**
 * AFU-9 Workflow Engine Type Definitions
 * 
 * Defines the structure for workflows, executions, and related entities.
 */

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
}

/**
 * Workflow execution status
 */
export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

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
}
