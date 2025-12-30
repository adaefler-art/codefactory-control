/**
 * AFU-9 Runner Service
 * 
 * Provides playbook management and run execution services.
 * Integrates with RunsDAO for persistence.
 * 
 * Reference: I631 (MCP Runner Tools), I632 (Runs Ledger), I633 (Issue UI)
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { RunSpec, RunResult, Playbook, RunResultSchema } from './contracts/afu9Runner';
import { getRunsDAO } from './db/afu9Runs';

/**
 * In-memory playbook storage (I631 MVP)
 * Future: Load from S3, DynamoDB, or file system
 */
const EXAMPLE_PLAYBOOKS: Playbook[] = [
  {
    id: 'hello-world',
    name: 'Hello World',
    description: 'Simple hello world example',
    spec: {
      title: 'Hello World Run',
      runtime: 'dummy',
      steps: [
        {
          name: 'Print Hello',
          shell: 'bash',
          command: 'echo "Hello, World!"',
        },
      ],
    },
  },
  {
    id: 'hello-world-fail',
    name: 'Hello World (Fail)',
    description: 'Hello world example with a guaranteed failing step',
    spec: {
      title: 'Hello World Run (Fail)',
      runtime: 'dummy',
      steps: [
        {
          name: 'Print Hello',
          shell: 'bash',
          command: 'echo "Hello, World!"',
        },
        {
          name: 'Forced Fail',
          shell: 'bash',
          command: 'echo "FORCED FAILURE: hello-world-fail" 1>&2; exit 1',
        },
      ],
    },
  },
  {
    id: 'multi-step-build',
    name: 'Multi-Step Build',
    description: 'Example multi-step build process',
    spec: {
      title: 'Multi-Step Build Example',
      runtime: 'dummy',
      steps: [
        {
          name: 'Install Dependencies',
          shell: 'bash',
          command: 'npm install',
          cwd: '/app',
          timeoutSec: 300,
        },
        {
          name: 'Run Tests',
          shell: 'bash',
          command: 'npm test',
          cwd: '/app',
          timeoutSec: 600,
          expect: {
            exitCode: 0,
          },
        },
        {
          name: 'Build Application',
          shell: 'bash',
          command: 'npm run build',
          cwd: '/app',
          artifacts: ['dist/**/*'],
        },
      ],
      envRefs: {
        NODE_ENV: 'production',
      },
    },
  },
  {
    id: 'pwsh-example',
    name: 'PowerShell Example',
    description: 'Example using PowerShell',
    spec: {
      title: 'PowerShell Example Run',
      runtime: 'dummy',
      steps: [
        {
          name: 'Get System Info',
          shell: 'pwsh',
          command: 'Get-Host | Select-Object Version',
        },
        {
          name: 'List Files',
          shell: 'pwsh',
          command: 'Get-ChildItem -Path .',
        },
      ],
    },
  },
  {
    id: 'issue-analysis',
    name: 'Issue Analysis',
    description: 'Analyze issue and generate specification',
    spec: {
      title: 'Issue Analysis & Spec Generation',
      runtime: 'dummy',
      steps: [
        {
          name: 'Fetch Issue Details',
          shell: 'bash',
          command: 'echo "Fetching issue details from GitHub..."',
        },
        {
          name: 'Analyze Issue',
          shell: 'bash',
          command: 'echo "Analyzing issue content and context..."',
        },
        {
          name: 'Generate Specification',
          shell: 'bash',
          command: 'echo "Generating detailed specification..."',
        },
      ],
    },
  },
];

export class RunnerService {
  private pool: Pool;
  private playbooks: Map<string, Playbook>;

  constructor(pool: Pool) {
    this.pool = pool;
    this.playbooks = new Map();
    
    // Initialize with example playbooks
    EXAMPLE_PLAYBOOKS.forEach((playbook) => {
      this.playbooks.set(playbook.id, playbook);
    });
  }

  /**
   * List all available playbooks
   */
  async listPlaybooks(): Promise<Playbook[]> {
    return Array.from(this.playbooks.values());
  }

  /**
   * Get a specific playbook by ID
   */
  async getPlaybook(id: string): Promise<Playbook | null> {
    return this.playbooks.get(id) || null;
  }

  /**
   * Create a new run from a spec
   */
  async createRun(
    spec: RunSpec,
    issueId?: string,
    playbookId?: string,
    parentRunId?: string
  ): Promise<string> {
    const runId = spec.runId || uuidv4();
    const dao = getRunsDAO(this.pool);

    await dao.createRun(runId, spec, issueId, playbookId, parentRunId);

    return runId;
  }

  /**
   * Execute a run (dummy implementation for I631/I633)
   * Real execution will be implemented in I641 (GitHub Runner Adapter)
   * 
   * Execute Idempotency Policy (Option A - Strict):
   * - Throws error if run is not in QUEUED status
   * - Safe to call multiple times (first call executes, subsequent calls fail)
   * - Prevents accidental re-execution
   * 
   * Reference: I633, Merge-Blocker B
   */
  async executeRun(runId: string): Promise<RunResult> {
    const dao = getRunsDAO(this.pool);

    // Idempotent transition: only proceeds if status is QUEUED
    const transition = await dao.transitionToRunningIfQueued(runId);
    
    if (!transition.success) {
      // Run is not in QUEUED state - already executed or executing
      throw new Error(
        `Run ${runId} already executed or in progress (status: ${transition.currentStatus})`
      );
    }

    // Fetch run data for execution
    const data = await dao.getRun(runId);
    if (!data) {
      throw new Error(`Run ${runId} not found`);
    }

    const { run, steps } = data;
    const spec = run.spec_json as RunSpec;

    // Simulate step execution
    let failedAtStepIdx: number | null = null;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const specStep = spec.steps[i];
      
      // Mark step as running
      await dao.updateStep(runId, i, 'RUNNING');

      const stepStart = Date.now();
      // Simulate execution delay
      await new Promise((resolve) => setTimeout(resolve, 100));

      const isForcedFailPlaybook = run.playbook_id === 'hello-world-fail';
      const shouldFail =
        (isForcedFailPlaybook && i === 1) ||
        /\bFORCE_FAIL\b|process\.exit\(1\)|\bexit\s+1\b/i.test(specStep?.command || '');

      if (shouldFail) {
        failedAtStepIdx = i;
        await dao.updateStep(
          runId,
          i,
          'FAILED',
          1,
          Date.now() - stepStart,
          '',
          '[Dummy] FORCED FAILURE: This step is designed to fail (hello-world-fail).'
        );
        break;
      }

      // Mark step as succeeded with dummy output
      await dao.updateStep(
        runId,
        i,
        'SUCCEEDED',
        0,
        Date.now() - stepStart,
        `[Dummy] Output for step: ${step.name}`,
        ''
      );
    }

    // Mark any remaining steps as skipped after a failure
    if (failedAtStepIdx !== null) {
      for (let i = failedAtStepIdx + 1; i < steps.length; i++) {
        await dao.updateStep(runId, i, 'SKIPPED');
      }
    }

    // Mark run as succeeded/failed
    await dao.updateRunStatus(
      runId,
      failedAtStepIdx !== null ? 'FAILED' : 'SUCCEEDED',
      undefined,
      new Date()
    );

    // Reconstruct and return result
    const result = await dao.reconstructRunResult(runId);
    if (!result) {
      throw new Error(`Failed to reconstruct run result for ${runId}`);
    }

    // Validate against schema
    const validated = RunResultSchema.parse(result);

    return validated;
  }

  /**
   * Get run result
   */
  async getRunResult(runId: string): Promise<RunResult | null> {
    const dao = getRunsDAO(this.pool);
    const result = await dao.reconstructRunResult(runId);

    if (!result) {
      return null;
    }

    // Validate against schema
    const validated = RunResultSchema.parse(result);

    return validated;
  }

  /**
   * Create a re-run from an existing run
   */
  async rerun(runId: string): Promise<string> {
    const dao = getRunsDAO(this.pool);
    const data = await dao.getRun(runId);

    if (!data) {
      throw new Error(`Run ${runId} not found`);
    }

    const { run } = data;
    const spec = run.spec_json as RunSpec;

    // Create new run with parent reference
    const newRunId = await this.createRun(
      spec,
      run.issue_id,
      run.playbook_id,
      runId
    );

    return newRunId;
  }
}

/**
 * Get RunnerService instance with pool
 */
export function getRunnerService(pool: Pool): RunnerService {
  return new RunnerService(pool);
}
