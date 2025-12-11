/**
 * Workflow Engine
 * 
 * Executes workflows as sequences of tool calls with variable substitution,
 * error handling, and execution tracking.
 */

import { MCPClient, getMCPClient } from './mcp-client';
import {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowContext,
  WorkflowStatus,
  StepStatus,
  WorkflowExecutionResult,
  WorkflowExecutionConfig,
} from './types/workflow';

/**
 * Step execution result
 */
interface StepExecutionResult {
  stepName: string;
  status: StepStatus;
  output?: any;
  error?: string;
  durationMs: number;
  startedAt: Date;
  completedAt: Date;
}

/**
 * Workflow Engine for executing workflows
 */
export class WorkflowEngine {
  private mcpClient: MCPClient;

  constructor(mcpClient?: MCPClient) {
    this.mcpClient = mcpClient || getMCPClient();
  }

  /**
   * Execute a workflow
   * @param workflow - Workflow definition to execute
   * @param context - Initial execution context
   * @param config - Execution configuration
   * @returns Workflow execution result
   */
  async execute(
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    config?: WorkflowExecutionConfig
  ): Promise<WorkflowExecutionResult> {
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const startedAt = new Date();
    
    const mergedConfig: Required<WorkflowExecutionConfig> = {
      timeoutMs: config?.timeoutMs || 300000, // 5 minutes default
      maxRetries: config?.maxRetries || 0,
      continueOnError: config?.continueOnError || false,
    };

    console.log(`[Workflow Engine] Starting execution ${executionId}`, {
      stepsCount: workflow.steps.length,
      config: mergedConfig,
    });

    const stepResults: StepExecutionResult[] = [];
    let status: WorkflowStatus = 'running';
    let error: string | undefined;

    try {
      // Execute each step in sequence
      for (let i = 0; i < workflow.steps.length; i++) {
        const step = workflow.steps[i];
        
        console.log(`[Workflow Engine] Executing step ${i + 1}/${workflow.steps.length}: ${step.name}`);

        // Check if step should be executed based on condition
        if (step.condition && !this.evaluateCondition(step.condition, context)) {
          console.log(`[Workflow Engine] Skipping step ${step.name} (condition not met)`);
          stepResults.push({
            stepName: step.name,
            status: 'skipped',
            durationMs: 0,
            startedAt: new Date(),
            completedAt: new Date(),
          });
          continue;
        }

        // Execute the step with retries
        const stepResult = await this.executeStep(step, context, mergedConfig.maxRetries);
        stepResults.push(stepResult);

        // Handle step failure
        if (stepResult.status === 'failed') {
          if (mergedConfig.continueOnError) {
            console.warn(`[Workflow Engine] Step ${step.name} failed, continuing due to continueOnError`);
          } else {
            console.error(`[Workflow Engine] Step ${step.name} failed, stopping workflow`);
            status = 'failed';
            error = stepResult.error;
            break;
          }
        }

        // Assign result to context if specified
        if (step.assign && stepResult.output !== undefined) {
          context.variables[step.assign] = stepResult.output;
        }
      }

      // Mark as completed if we got through all steps without fatal error
      if (status === 'running') {
        status = 'completed';
      }
    } catch (err) {
      console.error(`[Workflow Engine] Workflow execution failed`, err);
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    const result: WorkflowExecutionResult = {
      executionId,
      status,
      output: context.variables,
      error,
      metadata: {
        startedAt,
        completedAt,
        durationMs,
        stepsCompleted: stepResults.filter((r) => r.status === 'completed').length,
        stepsTotal: workflow.steps.length,
      },
    };

    console.log(`[Workflow Engine] Execution ${executionId} ${status}`, {
      durationMs,
      stepsCompleted: result.metadata.stepsCompleted,
      stepsTotal: result.metadata.stepsTotal,
    });

    return result;
  }

  /**
   * Execute a single workflow step
   */
  private async executeStep(
    step: WorkflowStep,
    context: WorkflowContext,
    maxRetries: number
  ): Promise<StepExecutionResult> {
    const startedAt = new Date();
    let lastError: Error | undefined;

    // Try executing with retries
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        console.log(`[Workflow Engine] Retrying step ${step.name}, attempt ${attempt + 1}/${maxRetries + 1}`);
      }

      try {
        // Parse tool name (format: "server.tool")
        const [serverName, toolName] = step.tool.split('.');
        
        if (!serverName || !toolName) {
          throw new Error(`Invalid tool format: ${step.tool}. Expected format: "server.tool"`);
        }

        // Substitute variables in parameters
        const substitutedParams = this.substituteVariables(step.params, context);

        // Call the MCP tool
        const output = await this.mcpClient.callTool(serverName, toolName, substitutedParams);

        const completedAt = new Date();
        const durationMs = completedAt.getTime() - startedAt.getTime();

        return {
          stepName: step.name,
          status: 'completed',
          output,
          durationMs,
          startedAt,
          completedAt,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(`[Workflow Engine] Step ${step.name} failed (attempt ${attempt + 1})`, {
          error: lastError.message,
        });
      }
    }

    // All retries exhausted
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    return {
      stepName: step.name,
      status: 'failed',
      error: lastError?.message || 'Unknown error',
      durationMs,
      startedAt,
      completedAt,
    };
  }

  /**
   * Substitute variables in a value
   * Supports ${variable.path} syntax
   */
  private substituteVariables(value: any, context: WorkflowContext): any {
    if (typeof value === 'string') {
      // Replace ${path} with actual values
      return value.replace(/\$\{([^}]+)\}/g, (match, path) => {
        const resolved = this.resolvePath(path, context);
        return resolved !== undefined ? String(resolved) : match;
      });
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.substituteVariables(item, context));
    }

    if (value !== null && typeof value === 'object') {
      const result: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = this.substituteVariables(val, context);
      }
      return result;
    }

    return value;
  }

  /**
   * Resolve a dot-notation path in the context
   * Example: "repo.owner" or "input.issue_number"
   */
  private resolvePath(path: string, context: WorkflowContext): any {
    const parts = path.split('.');
    let current: any = context;

    for (const part of parts) {
      if (current === undefined || current === null) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Evaluate a condition string
   * For now, this is a simple implementation
   * In the future, could support more complex expressions
   */
  private evaluateCondition(condition: string, context: WorkflowContext): boolean {
    try {
      // Simple variable existence check: "${variable}"
      const match = condition.match(/^\$\{([^}]+)\}$/);
      if (match) {
        const value = this.resolvePath(match[1], context);
        return !!value;
      }

      // Default to false for unrecognized condition formats
      // This is safer than defaulting to true
      console.warn(`[Workflow Engine] Unrecognized condition format: ${condition}`);
      return false;
    } catch (error) {
      console.error(`[Workflow Engine] Error evaluating condition: ${condition}`, error);
      return false;
    }
  }
}

/**
 * Create a singleton instance of WorkflowEngine
 */
let workflowEngineInstance: WorkflowEngine | null = null;

/**
 * Get or create the singleton WorkflowEngine instance
 */
export function getWorkflowEngine(): WorkflowEngine {
  if (!workflowEngineInstance) {
    workflowEngineInstance = new WorkflowEngine();
  }
  return workflowEngineInstance;
}
