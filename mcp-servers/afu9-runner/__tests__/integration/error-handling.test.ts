import { AFU9RunnerMCPServer } from '../../src/index';

describe('AFU9RunnerMCPServer Error Handling & Semantics', () => {
  let server: AFU9RunnerMCPServer;

  beforeEach(() => {
    server = new AFU9RunnerMCPServer(0);
    server['registerTools']();
  });

  describe('Unknown runId Error Handling', () => {
    it('should throw error with "not found" for run.status with unknown runId', async () => {
      await expect(
        server['handleToolCall']('run.status', { runId: 'unknown-run-123' })
      ).rejects.toThrow(/not found/);
    });

    it('should throw error with "not found" for run.read with unknown runId', async () => {
      await expect(
        server['handleToolCall']('run.read', { runId: 'unknown-run-456' })
      ).rejects.toThrow(/not found/);
    });

    it('should throw error with "not found" for run.execute with unknown runId', async () => {
      await expect(
        server['handleToolCall']('run.execute', { runId: 'unknown-run-789' })
      ).rejects.toThrow(/not found/);
    });

    it('should provide consistent error format for unknown runId', async () => {
      const runId = 'consistent-unknown-id';
      
      const errors = await Promise.allSettled([
        server['handleToolCall']('run.status', { runId }),
        server['handleToolCall']('run.read', { runId }),
        server['handleToolCall']('run.execute', { runId }),
      ]);

      errors.forEach((result) => {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
          expect(result.reason.message).toContain('not found');
          expect(result.reason.message).toContain(runId);
        }
      });
    });
  });

  describe('Execute Idempotency & Multiple Calls', () => {
    it('should reject second execute call on same run', async () => {
      const spec = {
        title: 'Idempotency Test',
        runtime: 'dummy',
        steps: [
          { name: 'Step 1', shell: 'bash', command: 'echo "test"' },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });
      
      // First execute should succeed
      const firstExecute = await server['handleToolCall']('run.execute', { 
        runId: created.runId 
      });
      expect(firstExecute.status).toBe('success');

      // Second execute should fail
      await expect(
        server['handleToolCall']('run.execute', { runId: created.runId })
      ).rejects.toThrow(/already been executed/);
    });

    it('should reject execute call on non-created status', async () => {
      const spec = {
        title: 'Non-Created Execute Test',
        runtime: 'dummy',
        steps: [
          { name: 'Step 1', shell: 'bash', command: 'echo "test"' },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });
      await server['handleToolCall']('run.execute', { runId: created.runId });

      // Try to execute again
      await expect(
        server['handleToolCall']('run.execute', { runId: created.runId })
      ).rejects.toThrow(/has already been executed/);
    });

    it('should allow multiple status/read calls without side effects', async () => {
      const spec = {
        title: 'Multiple Read Test',
        runtime: 'dummy',
        steps: [
          { name: 'Step 1', shell: 'bash', command: 'echo "test"' },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });
      await server['handleToolCall']('run.execute', { runId: created.runId });

      // Multiple status calls should work
      const status1 = await server['handleToolCall']('run.status', { 
        runId: created.runId 
      });
      const status2 = await server['handleToolCall']('run.status', { 
        runId: created.runId 
      });
      const read1 = await server['handleToolCall']('run.read', { 
        runId: created.runId 
      });
      const read2 = await server['handleToolCall']('run.read', { 
        runId: created.runId 
      });

      expect(status1.status).toBe('success');
      expect(status2.status).toBe('success');
      expect(read1.status).toBe('success');
      expect(read2.status).toBe('success');
      expect(status1.runId).toBe(created.runId);
      expect(read1.runId).toBe(created.runId);
    });
  });

  describe('Status Transitions & Timestamps', () => {
    it('should have only createdAt in created status', async () => {
      const spec = {
        title: 'Timestamp Test',
        runtime: 'dummy',
        steps: [
          { name: 'Step 1', shell: 'bash', command: 'echo "test"' },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });

      expect(created.status).toBe('created');
      expect(created.createdAt).toBeDefined();
      expect(created.startedAt).toBeUndefined();
      expect(created.completedAt).toBeUndefined();
      expect(created.durationMs).toBeUndefined();
    });

    it('should transition from created to success with correct timestamps', async () => {
      const spec = {
        title: 'Transition Test',
        runtime: 'dummy',
        steps: [
          { name: 'Step 1', shell: 'bash', command: 'echo "test"' },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });
      expect(created.status).toBe('created');

      const executed = await server['handleToolCall']('run.execute', { 
        runId: created.runId 
      });

      expect(executed.status).toBe('success');
      expect(executed.createdAt).toBe(created.createdAt);
      expect(executed.startedAt).toBeDefined();
      expect(executed.completedAt).toBeDefined();
      expect(executed.durationMs).toBeDefined();
      expect(executed.durationMs).toBeGreaterThan(0);
    });

    it('should have chronological timestamps', async () => {
      const spec = {
        title: 'Chronology Test',
        runtime: 'dummy',
        steps: [
          { name: 'Step 1', shell: 'bash', command: 'echo "test"' },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });
      const executed = await server['handleToolCall']('run.execute', { 
        runId: created.runId 
      });

      const createdTime = new Date(executed.createdAt).getTime();
      const startedTime = new Date(executed.startedAt!).getTime();
      const completedTime = new Date(executed.completedAt!).getTime();

      expect(createdTime).toBeLessThanOrEqual(startedTime);
      expect(startedTime).toBeLessThanOrEqual(completedTime);
    });

    it('should have step timestamps within reasonable bounds of run timestamps', async () => {
      const spec = {
        title: 'Step Timestamp Test',
        runtime: 'dummy',
        steps: [
          { name: 'Step 1', shell: 'bash', command: 'echo "test"' },
          { name: 'Step 2', shell: 'bash', command: 'echo "test2"' },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });
      const executed = await server['handleToolCall']('run.execute', { 
        runId: created.runId 
      });

      const runStarted = new Date(executed.startedAt!).getTime();
      const runCompleted = new Date(executed.completedAt!).getTime();

      executed.steps.forEach((step: any) => {
        if (step.startedAt && step.completedAt) {
          const stepStarted = new Date(step.startedAt).getTime();
          const stepCompleted = new Date(step.completedAt).getTime();

          // Steps should start after or at run start
          expect(stepStarted).toBeGreaterThanOrEqual(runStarted);
          // Allow 100ms tolerance for step completion vs run completion
          // (dummy executor may record timestamps slightly differently)
          expect(stepCompleted).toBeLessThanOrEqual(runCompleted + 100);
          // Step should complete after or when it started
          expect(stepStarted).toBeLessThanOrEqual(stepCompleted);
        }
      });
    });

    it('should maintain status through status/read calls', async () => {
      const spec = {
        title: 'Status Persistence Test',
        runtime: 'dummy',
        steps: [
          { name: 'Step 1', shell: 'bash', command: 'echo "test"' },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });
      
      // Check created status
      const statusCreated = await server['handleToolCall']('run.status', { 
        runId: created.runId 
      });
      expect(statusCreated.status).toBe('created');

      // Execute
      await server['handleToolCall']('run.execute', { runId: created.runId });

      // Check success status
      const statusSuccess = await server['handleToolCall']('run.status', { 
        runId: created.runId 
      });
      expect(statusSuccess.status).toBe('success');

      // Read should also show success
      const readResult = await server['handleToolCall']('run.read', { 
        runId: created.runId 
      });
      expect(readResult.status).toBe('success');
    });
  });

  describe('Step Status Transitions', () => {
    it('should initialize steps as pending in created run', async () => {
      const spec = {
        title: 'Step Status Init Test',
        runtime: 'dummy',
        steps: [
          { name: 'Step 1', shell: 'bash', command: 'echo "1"' },
          { name: 'Step 2', shell: 'bash', command: 'echo "2"' },
          { name: 'Step 3', shell: 'bash', command: 'echo "3"' },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });

      expect(created.steps).toHaveLength(3);
      created.steps.forEach((step: any, index: number) => {
        expect(step.name).toBe(`Step ${index + 1}`);
        expect(step.status).toBe('pending');
        expect(step.exitCode).toBeUndefined();
        expect(step.stdout).toBeUndefined();
        expect(step.stderr).toBeUndefined();
      });
    });

    it('should transition all steps to success on execute', async () => {
      const spec = {
        title: 'Step Transition Test',
        runtime: 'dummy',
        steps: [
          { name: 'Step 1', shell: 'bash', command: 'echo "1"' },
          { name: 'Step 2', shell: 'pwsh', command: 'Write-Host "2"' },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });
      const executed = await server['handleToolCall']('run.execute', { 
        runId: created.runId 
      });

      expect(executed.steps).toHaveLength(2);
      executed.steps.forEach((step: any) => {
        expect(step.status).toBe('success');
        expect(step.exitCode).toBe(0);
        expect(step.stdout).toBeDefined();
        expect(step.stdout).toContain('[DUMMY]');
        expect(step.stderr).toBe('');
        expect(step.startedAt).toBeDefined();
        expect(step.completedAt).toBeDefined();
        expect(step.durationMs).toBeDefined();
      });
    });

    it('should include step name in dummy output', async () => {
      const spec = {
        title: 'Step Name Test',
        runtime: 'dummy',
        steps: [
          { name: 'Build Application', shell: 'bash', command: 'npm run build' },
          { name: 'Run Tests', shell: 'bash', command: 'npm test' },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });
      const executed = await server['handleToolCall']('run.execute', { 
        runId: created.runId 
      });

      expect(executed.steps[0].stdout).toContain('Build Application');
      expect(executed.steps[1].stdout).toContain('Run Tests');
    });
  });

  describe('Validation Error Format', () => {
    it('should provide clear validation error for missing required fields', async () => {
      const invalidSpec = {
        runtime: 'dummy',
        steps: [
          { name: 'Step', shell: 'bash', command: 'echo' },
        ],
        // Missing title
      };

      await expect(
        server['handleToolCall']('run.create', { spec: invalidSpec })
      ).rejects.toThrow(/Validation error/);
    });

    it('should provide clear validation error for invalid runtime', async () => {
      const invalidSpec = {
        title: 'Invalid Runtime Test',
        runtime: 'invalid-runtime',
        steps: [
          { name: 'Step', shell: 'bash', command: 'echo' },
        ],
      };

      await expect(
        server['handleToolCall']('run.create', { spec: invalidSpec })
      ).rejects.toThrow(/Validation error/);
    });

    it('should reject unsupported runtime in DummyExecutorAdapter', async () => {
      const spec = {
        title: 'GitHub Runner Test',
        runtime: 'github-runner',
        steps: [
          { name: 'Step', shell: 'bash', command: 'echo' },
        ],
      };

      await expect(
        server['handleToolCall']('run.create', { spec })
      ).rejects.toThrow(/not supported by DummyExecutorAdapter/);
    });
  });
});
