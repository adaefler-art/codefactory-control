import { RunSpec, RunResult, StepResult, Runtime } from '../contracts/schemas';
import { validateRuntime } from './validation';

/**
 * Executor Adapter Interface
 * 
 * Defines the contract for runtime-specific execution adapters.
 * Future implementations: GitHubRunnerAdapter (I641), ECSTaskAdapter, SSMAdapter
 */
export interface ExecutorAdapter {
  readonly runtime: Runtime;
  
  /**
   * Create a new run from a specification
   */
  createRun(spec: RunSpec): Promise<RunResult>;
  
  /**
   * Execute a previously created run
   */
  executeRun(runId: string): Promise<RunResult>;
  
  /**
   * Get the current status of a run
   */
  getRunStatus(runId: string): Promise<RunResult>;
  
  /**
   * Read the full results of a run
   */
  readRunResult(runId: string): Promise<RunResult>;
}

/**
 * DummyExecutorAdapter (MVP for I631)
 * 
 * In-memory adapter for zero-copy debugging and testing.
 * - No actual command execution
 * - Simulates successful execution flow
 * - Provides complete create→execute→read flow
 * - No persistence (I632 will add DynamoDB)
 */
export class DummyExecutorAdapter implements ExecutorAdapter {
  readonly runtime: Runtime = 'dummy';
  private runs: Map<string, RunResult> = new Map();
  private runCounter = 0;

  /**
   * Create a new run with 'created' status
   */
  async createRun(spec: RunSpec): Promise<RunResult> {
    // Generate runId if not provided
    const runId = spec.runId || this.generateRunId();
    
    // Check for duplicate runId
    if (this.runs.has(runId)) {
      throw new Error(`Run with ID ${runId} already exists`);
    }

    // Validate runtime is supported
    validateRuntime(spec.runtime, this.runtime, 'DummyExecutorAdapter');

    // Initialize step results as pending
    const steps: StepResult[] = spec.steps.map(step => ({
      name: step.name,
      status: 'pending' as const,
    }));

    const now = new Date().toISOString();
    
    const result: RunResult = {
      runId,
      issueId: spec.issueId,
      title: spec.title,
      runtime: spec.runtime,
      status: 'created',
      steps,
      createdAt: now,
    };

    this.runs.set(runId, result);
    return result;
  }

  /**
   * Execute a run - simulates execution with dummy success
   */
  async executeRun(runId: string): Promise<RunResult> {
    const run = this.runs.get(runId);
    
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    if (run.status !== 'created') {
      throw new Error(`Run ${runId} has already been executed (status: ${run.status})`);
    }

    const startTime = Date.now();
    const startedAt = new Date(startTime).toISOString();
    
    // Update run to running status
    run.status = 'running';
    run.startedAt = startedAt;

    // Simulate step execution
    const executedSteps: StepResult[] = run.steps.map((step, index) => {
      const stepStartTime = Date.now();
      
      // Simulate execution time (10-50ms per step)
      const durationMs = 10 + Math.random() * 40;
      
      return {
        name: step.name,
        status: 'success' as const,
        exitCode: 0,
        stdout: `[DUMMY] Step ${index + 1}: ${step.name} executed successfully`,
        stderr: '',
        startedAt: new Date(stepStartTime).toISOString(),
        completedAt: new Date(stepStartTime + durationMs).toISOString(),
        durationMs: Math.round(durationMs),
      };
    });

    const endTime = Date.now();
    const completedAt = new Date(endTime).toISOString();
    const totalDuration = Math.max(1, endTime - startTime); // Ensure at least 1ms

    // Update run with results
    run.status = 'success';
    run.steps = executedSteps;
    run.completedAt = completedAt;
    run.durationMs = totalDuration;

    return run;
  }

  /**
   * Get current status of a run
   */
  async getRunStatus(runId: string): Promise<RunResult> {
    const run = this.runs.get(runId);
    
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    return run;
  }

  /**
   * Read full results of a run
   */
  async readRunResult(runId: string): Promise<RunResult> {
    return this.getRunStatus(runId);
  }

  /**
   * Generate a unique run ID
   */
  private generateRunId(): string {
    this.runCounter++;
    const timestamp = Date.now();
    return `run-${timestamp}-${this.runCounter}`;
  }

  /**
   * Get all runs (for testing/debugging)
   */
  getAllRuns(): RunResult[] {
    return Array.from(this.runs.values());
  }

  /**
   * Clear all runs (for testing)
   */
  clearAllRuns(): void {
    this.runs.clear();
    this.runCounter = 0;
  }
}
