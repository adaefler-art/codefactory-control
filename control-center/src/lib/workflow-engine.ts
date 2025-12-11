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
import {
  createExecution,
  updateExecutionStatus,
  updateExecutionContext,
  createStep,
  updateStep,
  incrementStepRetry,
} from './workflow-persistence';
import { checkDatabase } from './db';

/**
 * Step execution result
 */
interface StepExecutionResult {
  stepName: string;
  stepId?: string;
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
  private persistenceEnabled: boolean;

  constructor(mcpClient?: MCPClient, enablePersistence: boolean = true) {
    this.mcpClient = mcpClient || getMCPClient();
    this.persistenceEnabled = enablePersistence;
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
    const startedAt = new Date();
    
    const mergedConfig: Required<WorkflowExecutionConfig> = {
      timeoutMs: config?.timeoutMs || 300000, // 5 minutes default
      maxRetries: config?.maxRetries || 0,
      continueOnError: config?.continueOnError || false,
    };

    // Check if database persistence is available
    let dbAvailable = false;
    if (this.persistenceEnabled) {
      dbAvailable = await checkDatabase();
      if (!dbAvailable) {
        console.warn('[Workflow Engine] Database not available, running without persistence');
      }
    }

    // Create execution record in database if persistence is enabled
    let executionId: string;
    if (dbAvailable) {
      try {
        executionId = await createExecution(
          null, // workflowId - could be passed in config if workflow is stored
          context.input,
          context
        );
        console.log(`[Workflow Engine] Created database execution record: ${executionId}`);
      } catch (error) {
        console.error('[Workflow Engine] Failed to create execution record:', error);
        // Fall back to in-memory execution ID
        executionId = `exec-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        dbAvailable = false;
      }
    } else {
      executionId = `exec-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    }

    console.log(`[Workflow Engine] Starting execution ${executionId}`, {
      stepsCount: workflow.steps.length,
      config: mergedConfig,
      persistenceEnabled: dbAvailable,
    });

    const stepResults: StepExecutionResult[] = [];
    let status: WorkflowStatus = 'running';
    let error: string | undefined;

    try {
      // Execute each step in sequence
      for (let i = 0; i < workflow.steps.length; i++) {
        const step = workflow.steps[i];
        
        console.log(`[Workflow Engine] Executing step ${i + 1}/${workflow.steps.length}: ${step.name}`);

        // Check if step should be executed based on condition (supports both "condition" and "if" fields)
        const conditionField = step.condition || (step as any).if;
        if (conditionField && !this.evaluateCondition(conditionField, context)) {
          console.log(`[Workflow Engine] Skipping step ${step.name} (condition not met: ${conditionField})`);
          
          // Log skipped step to database
          if (dbAvailable) {
            try {
              const stepId = await createStep(executionId, step.name, i, step.params);
              await updateStep(stepId, 'skipped');
            } catch (dbError) {
              console.error('[Workflow Engine] Failed to log skipped step:', dbError);
            }
          }
          
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
        const stepResult = await this.executeStep(
          step,
          context,
          mergedConfig.maxRetries,
          executionId,
          i,
          dbAvailable
        );
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
          
          // Update context in database
          if (dbAvailable) {
            try {
              await updateExecutionContext(executionId, context);
            } catch (dbError) {
              console.error('[Workflow Engine] Failed to update execution context:', dbError);
            }
          }
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

    // Update final execution status in database
    if (dbAvailable) {
      try {
        await updateExecutionStatus(executionId, status, context.variables, error);
      } catch (dbError) {
        console.error('[Workflow Engine] Failed to update execution status:', dbError);
      }
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
    maxRetries: number,
    executionId: string,
    stepIndex: number,
    dbAvailable: boolean
  ): Promise<StepExecutionResult> {
    const startedAt = new Date();
    let lastError: Error | undefined;
    let stepId: string | undefined;

    // Create step record in database
    if (dbAvailable) {
      try {
        const substitutedParams = this.substituteVariables(step.params, context);
        stepId = await createStep(executionId, step.name, stepIndex, substitutedParams);
        console.log(`[Workflow Engine] Created database step record: ${stepId}`);
      } catch (error) {
        console.error('[Workflow Engine] Failed to create step record:', error);
      }
    }

    // Try executing with retries
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        console.log(`[Workflow Engine] Retrying step ${step.name}, attempt ${attempt + 1}/${maxRetries + 1}`);
        
        // Increment retry count in database
        if (dbAvailable && stepId) {
          try {
            await incrementStepRetry(stepId);
          } catch (error) {
            console.error('[Workflow Engine] Failed to increment retry count:', error);
          }
        }
      }

      try {
        // Parse tool name (format: "server.tool")
        const [serverName, toolName] = step.tool.split('.');
        
        if (!serverName || !toolName) {
          throw new Error(`Invalid tool format: ${step.tool}. Expected format: "server.tool"`);
        }

        // Substitute variables in parameters
        const substitutedParams = this.substituteVariables(step.params, context);

        console.log(`[Workflow Engine] Calling tool ${step.tool} with params:`, substitutedParams);

        // Call the MCP tool
        const output = await this.mcpClient.callTool(serverName, toolName, substitutedParams);

        const completedAt = new Date();
        const durationMs = completedAt.getTime() - startedAt.getTime();

        console.log(`[Workflow Engine] Step ${step.name} completed successfully (${durationMs}ms)`);

        // Update step in database
        if (dbAvailable && stepId) {
          try {
            await updateStep(stepId, 'completed', output, undefined, durationMs);
          } catch (error) {
            console.error('[Workflow Engine] Failed to update step:', error);
          }
        }

        return {
          stepName: step.name,
          stepId,
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

    console.error(`[Workflow Engine] Step ${step.name} failed after ${maxRetries + 1} attempts`);

    // Update step in database as failed
    if (dbAvailable && stepId) {
      try {
        await updateStep(stepId, 'failed', undefined, lastError?.message, durationMs);
      } catch (error) {
        console.error('[Workflow Engine] Failed to update step:', error);
      }
    }

    return {
      stepName: step.name,
      stepId,
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
   * Example: "repo.owner" or "input.issue_number" or "issue.labels[0].name"
   */
  private resolvePath(path: string, context: WorkflowContext): any {
    // Handle array indices like "issue.labels[0].name"
    const normalizedPath = path.replace(/\[(\d+)\]/g, '.$1');
    const parts = normalizedPath.split('.');
    let current: any = context;

    for (const part of parts) {
      if (current === undefined || current === null) {
        return undefined;
      }
      
      // Handle numeric indices for arrays
      const index = parseInt(part, 10);
      if (!isNaN(index) && Array.isArray(current)) {
        current = current[index];
      } else {
        current = current[part];
      }
    }

    return current;
  }

  /**
   * Evaluate a condition string
   * Supports:
   * - Variable existence: "${variable}"
   * - Simple comparisons: "${var} === 'value'" (after variable substitution)
   * - Boolean values: true/false
   */
  private evaluateCondition(condition: string, context: WorkflowContext): boolean {
    try {
      // Substitute variables first
      const substituted = this.substituteVariables(condition, context);
      
      console.log(`[Workflow Engine] Evaluating condition: "${condition}" -> "${substituted}"`);
      
      // Handle simple boolean strings
      if (substituted === 'true') return true;
      if (substituted === 'false') return false;
      
      // Simple variable existence check: "${variable}"
      const match = condition.match(/^\$\{([^}]+)\}$/);
      if (match) {
        const value = this.resolvePath(match[1], context);
        const result = !!value;
        console.log(`[Workflow Engine] Condition result: ${result} (value: ${JSON.stringify(value)})`);
        return result;
      }

      // If the condition still has ${} syntax after substitution, it means variables weren't found
      if (substituted.includes('${')) {
        console.log(`[Workflow Engine] Condition contains unresolved variables, evaluating as false`);
        return false;
      }

      // For simple comparisons, try to evaluate as JavaScript expression
      // This is safe because we've already substituted variables
      if (substituted.includes('===') || substituted.includes('!==') || 
          substituted.includes('==') || substituted.includes('!=') ||
          substituted.includes('>') || substituted.includes('<')) {
        try {
          // Use Function constructor for safer evaluation than eval
          const result = new Function('return ' + substituted)();
          console.log(`[Workflow Engine] Condition expression result: ${result}`);
          return !!result;
        } catch (evalError) {
          console.warn(`[Workflow Engine] Failed to evaluate condition expression: ${substituted}`, evalError);
          return false;
        }
      }

      // If it's not a recognized pattern, treat as truthy/falsy
      const result = !!substituted && substituted !== 'null' && substituted !== 'undefined';
      console.log(`[Workflow Engine] Condition truthy check result: ${result}`);
      return result;
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
