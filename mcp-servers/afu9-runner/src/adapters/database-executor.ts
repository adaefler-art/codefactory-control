import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { RunSpec, RunResult, Runtime } from '../contracts/schemas';
import { RunsDAO } from './runs-dao';
import { ExecutorAdapter } from './executor';

/**
 * DatabaseExecutorAdapter (I632)
 * 
 * Database-backed executor that persists runs to PostgreSQL.
 * - Stores runs in the runs ledger (runs, run_steps, run_artifacts tables)
 * - Uses DummyExecutor logic for actual execution (no real command execution yet)
 * - Supports immutable runs with re-run via parentRunId
 * - Caps stdout/stderr tails to 4000 characters
 */
export class DatabaseExecutorAdapter implements ExecutorAdapter {
  readonly runtime: Runtime = 'dummy';
  private dao: RunsDAO;

  constructor(pool: Pool) {
    this.dao = new RunsDAO(pool);
  }

  /**
   * Create a new run with 'created' status
   */
  async createRun(spec: RunSpec): Promise<RunResult> {
    // Generate runId if not provided
    const runId = spec.runId || this.generateRunId();
    
    // Validate runtime is supported
    if (spec.runtime !== 'dummy') {
      throw new Error(`Runtime ${spec.runtime} not supported by DatabaseExecutorAdapter. Only 'dummy' runtime is supported in I632.`);
    }

    // Check for duplicate runId
    const existing = await this.dao.getRun(runId);
    if (existing) {
      throw new Error(`Run with ID ${runId} already exists`);
    }

    // Create run in database
    await this.dao.createRun(runId, spec, spec.issueId);

    // Reconstruct and return RunResult
    const result = await this.dao.reconstructRunResult(runId);
    
    if (!result) {
      throw new Error(`Failed to create run ${runId}`);
    }

    return result;
  }

  /**
   * Execute a run - simulates execution with dummy success and persists to DB
   */
  async executeRun(runId: string): Promise<RunResult> {
    const data = await this.dao.getRun(runId);
    
    if (!data) {
      throw new Error(`Run ${runId} not found`);
    }

    const { run, steps } = data;

    if (run.status !== 'QUEUED') {
      throw new Error(`Run ${runId} has already been executed (status: ${run.status})`);
    }

    const startTime = new Date();
    
    // Update run to running status
    await this.dao.updateRunStatus(runId, 'RUNNING', startTime);

    // Simulate step execution
    let finalStatus = 'SUCCEEDED';
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      
      // Update step to running
      await this.dao.updateStep(runId, i, 'RUNNING');
      
      // Simulate execution time (10-50ms per step)
      const durationMs = Math.round(10 + Math.random() * 40);
      await this.sleep(durationMs);
      
      // Simulate success
      const stdout = `[DUMMY] Step ${i + 1}: ${step.name} executed successfully`;
      const stderr = '';
      const exitCode = 0;
      
      await this.dao.updateStep(
        runId,
        i,
        'SUCCEEDED',
        exitCode,
        durationMs,
        stdout,
        stderr
      );
    }

    const endTime = new Date();
    
    // Update run with final status
    await this.dao.updateRunStatus(runId, finalStatus, undefined, endTime);

    // Reconstruct and return RunResult
    const result = await this.dao.reconstructRunResult(runId);
    
    if (!result) {
      throw new Error(`Failed to read run ${runId} after execution`);
    }

    return result;
  }

  /**
   * Get current status of a run
   */
  async getRunStatus(runId: string): Promise<RunResult> {
    const result = await this.dao.reconstructRunResult(runId);
    
    if (!result) {
      throw new Error(`Run ${runId} not found`);
    }

    return result;
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
    return uuidv4();
  }

  /**
   * Sleep utility for simulating execution time
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
