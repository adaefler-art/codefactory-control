import { DummyExecutorAdapter } from '../../src/adapters/executor';
import { RunSpec } from '../../src/contracts/schemas';

describe('DummyExecutorAdapter', () => {
  let adapter: DummyExecutorAdapter;

  beforeEach(() => {
    adapter = new DummyExecutorAdapter();
  });

  describe('Runtime', () => {
    it('should have dummy runtime', () => {
      expect(adapter.runtime).toBe('dummy');
    });
  });

  describe('createRun', () => {
    it('should create a run with generated runId', async () => {
      const spec: RunSpec = {
        title: 'Test Run',
        runtime: 'dummy',
        steps: [
          {
            name: 'Step 1',
            shell: 'bash',
            command: 'echo "hello"',
          },
        ],
      };

      const result = await adapter.createRun(spec);

      expect(result.runId).toBeDefined();
      expect(result.runId).toMatch(/^run-\d+-\d+$/);
      expect(result.title).toBe('Test Run');
      expect(result.runtime).toBe('dummy');
      expect(result.status).toBe('created');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].name).toBe('Step 1');
      expect(result.steps[0].status).toBe('pending');
      expect(result.createdAt).toBeDefined();
    });

    it('should create a run with custom runId', async () => {
      const spec: RunSpec = {
        runId: 'custom-run-123',
        title: 'Custom Run',
        runtime: 'dummy',
        steps: [
          {
            name: 'Step 1',
            shell: 'bash',
            command: 'ls',
          },
        ],
      };

      const result = await adapter.createRun(spec);

      expect(result.runId).toBe('custom-run-123');
    });

    it('should include optional issueId if provided', async () => {
      const spec: RunSpec = {
        issueId: 'issue-456',
        title: 'Issue Run',
        runtime: 'dummy',
        steps: [
          {
            name: 'Step 1',
            shell: 'bash',
            command: 'pwd',
          },
        ],
      };

      const result = await adapter.createRun(spec);

      expect(result.issueId).toBe('issue-456');
    });

    it('should initialize all steps as pending', async () => {
      const spec: RunSpec = {
        title: 'Multi-Step Run',
        runtime: 'dummy',
        steps: [
          { name: 'Step 1', shell: 'bash', command: 'echo 1' },
          { name: 'Step 2', shell: 'bash', command: 'echo 2' },
          { name: 'Step 3', shell: 'pwsh', command: 'Write-Host 3' },
        ],
      };

      const result = await adapter.createRun(spec);

      expect(result.steps).toHaveLength(3);
      result.steps.forEach((step, index) => {
        expect(step.name).toBe(`Step ${index + 1}`);
        expect(step.status).toBe('pending');
      });
    });

    it('should throw error for duplicate runId', async () => {
      const spec: RunSpec = {
        runId: 'duplicate-id',
        title: 'Test',
        runtime: 'dummy',
        steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
      };

      await adapter.createRun(spec);

      await expect(adapter.createRun(spec)).rejects.toThrow(
        'Run with ID duplicate-id already exists'
      );
    });

    it('should throw error for unsupported runtime', async () => {
      const spec: RunSpec = {
        title: 'Test',
        runtime: 'github-runner',
        steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
      };

      await expect(adapter.createRun(spec)).rejects.toThrow(
        'Runtime github-runner not supported by DummyExecutorAdapter'
      );
    });
  });

  describe('executeRun', () => {
    it('should execute a created run successfully', async () => {
      const spec: RunSpec = {
        title: 'Execute Test',
        runtime: 'dummy',
        steps: [
          { name: 'Step 1', shell: 'bash', command: 'echo "test"' },
        ],
      };

      const created = await adapter.createRun(spec);
      const executed = await adapter.executeRun(created.runId);

      expect(executed.runId).toBe(created.runId);
      expect(executed.status).toBe('success');
      expect(executed.startedAt).toBeDefined();
      expect(executed.completedAt).toBeDefined();
      expect(executed.durationMs).toBeDefined();
      expect(executed.durationMs).toBeGreaterThan(0);
      
      expect(executed.steps).toHaveLength(1);
      expect(executed.steps[0].status).toBe('success');
      expect(executed.steps[0].exitCode).toBe(0);
      expect(executed.steps[0].stdout).toContain('DUMMY');
      expect(executed.steps[0].stderr).toBe('');
    });

    it('should execute multiple steps successfully', async () => {
      const spec: RunSpec = {
        title: 'Multi-Step Execute',
        runtime: 'dummy',
        steps: [
          { name: 'Build', shell: 'bash', command: 'npm run build' },
          { name: 'Test', shell: 'bash', command: 'npm test' },
          { name: 'Deploy', shell: 'pwsh', command: 'Deploy-App' },
        ],
      };

      const created = await adapter.createRun(spec);
      const executed = await adapter.executeRun(created.runId);

      expect(executed.steps).toHaveLength(3);
      executed.steps.forEach((step, index) => {
        expect(step.status).toBe('success');
        expect(step.exitCode).toBe(0);
        expect(step.startedAt).toBeDefined();
        expect(step.completedAt).toBeDefined();
        expect(step.durationMs).toBeDefined();
        expect(step.stdout).toContain(`Step ${index + 1}`);
      });
    });

    it('should throw error if run not found', async () => {
      await expect(adapter.executeRun('non-existent-run')).rejects.toThrow(
        'Run non-existent-run not found'
      );
    });

    it('should throw error if run already executed', async () => {
      const spec: RunSpec = {
        title: 'Test',
        runtime: 'dummy',
        steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
      };

      const created = await adapter.createRun(spec);
      await adapter.executeRun(created.runId);

      await expect(adapter.executeRun(created.runId)).rejects.toThrow(
        /has already been executed/
      );
    });
  });

  describe('getRunStatus', () => {
    it('should get status of created run', async () => {
      const spec: RunSpec = {
        title: 'Status Test',
        runtime: 'dummy',
        steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
      };

      const created = await adapter.createRun(spec);
      const status = await adapter.getRunStatus(created.runId);

      expect(status.runId).toBe(created.runId);
      expect(status.status).toBe('created');
    });

    it('should get status of executed run', async () => {
      const spec: RunSpec = {
        title: 'Status Test',
        runtime: 'dummy',
        steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
      };

      const created = await adapter.createRun(spec);
      await adapter.executeRun(created.runId);
      const status = await adapter.getRunStatus(created.runId);

      expect(status.status).toBe('success');
      expect(status.completedAt).toBeDefined();
    });

    it('should throw error if run not found', async () => {
      await expect(adapter.getRunStatus('missing-run')).rejects.toThrow(
        'Run missing-run not found'
      );
    });
  });

  describe('readRunResult', () => {
    it('should read full result of run', async () => {
      const spec: RunSpec = {
        title: 'Read Test',
        runtime: 'dummy',
        steps: [
          { name: 'Step 1', shell: 'bash', command: 'echo "output"' },
        ],
      };

      const created = await adapter.createRun(spec);
      await adapter.executeRun(created.runId);
      const result = await adapter.readRunResult(created.runId);

      expect(result.runId).toBe(created.runId);
      expect(result.status).toBe('success');
      expect(result.steps[0].stdout).toContain('DUMMY');
    });

    it('should throw error if run not found', async () => {
      await expect(adapter.readRunResult('no-such-run')).rejects.toThrow(
        'Run no-such-run not found'
      );
    });
  });

  describe('Complete Flow (create → execute → read)', () => {
    it('should support complete flow with multiple runs', async () => {
      // Create first run
      const spec1: RunSpec = {
        title: 'First Run',
        runtime: 'dummy',
        steps: [{ name: 'Step 1', shell: 'bash', command: 'echo "first"' }],
      };
      const run1 = await adapter.createRun(spec1);

      // Create second run
      const spec2: RunSpec = {
        title: 'Second Run',
        runtime: 'dummy',
        steps: [{ name: 'Step 1', shell: 'pwsh', command: 'Write-Host "second"' }],
      };
      const run2 = await adapter.createRun(spec2);

      // Execute first run
      await adapter.executeRun(run1.runId);

      // Check statuses
      const status1 = await adapter.getRunStatus(run1.runId);
      const status2 = await adapter.getRunStatus(run2.runId);

      expect(status1.status).toBe('success');
      expect(status2.status).toBe('created');

      // Execute second run
      await adapter.executeRun(run2.runId);

      // Read both results
      const result1 = await adapter.readRunResult(run1.runId);
      const result2 = await adapter.readRunResult(run2.runId);

      expect(result1.status).toBe('success');
      expect(result2.status).toBe('success');
    });
  });

  describe('Test utilities', () => {
    it('should get all runs', async () => {
      const spec: RunSpec = {
        title: 'Test',
        runtime: 'dummy',
        steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
      };

      await adapter.createRun(spec);
      await adapter.createRun({ ...spec, title: 'Test 2' });

      const allRuns = adapter.getAllRuns();
      expect(allRuns).toHaveLength(2);
    });

    it('should clear all runs', async () => {
      const spec: RunSpec = {
        title: 'Test',
        runtime: 'dummy',
        steps: [{ name: 'Step', shell: 'bash', command: 'echo' }],
      };

      await adapter.createRun(spec);
      adapter.clearAllRuns();

      const allRuns = adapter.getAllRuns();
      expect(allRuns).toHaveLength(0);
    });
  });
});
