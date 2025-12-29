import { AFU9RunnerMCPServer } from '../../src/index';
import request from 'supertest';

describe('AFU9RunnerMCPServer Integration Tests', () => {
  let server: AFU9RunnerMCPServer;
  let app: any;

  beforeAll(() => {
    server = new AFU9RunnerMCPServer(0); // Use port 0 to avoid conflicts
    // Access the express app for testing (we'll need to expose it or test via actual server)
    // For now, we'll register tools and test the methods directly
    server['registerTools']();
  });

  describe('Tool Registration', () => {
    it('should register all required tools', () => {
      const tools = server['tools'];
      
      expect(tools.has('run.create')).toBe(true);
      expect(tools.has('run.execute')).toBe(true);
      expect(tools.has('run.status')).toBe(true);
      expect(tools.has('run.read')).toBe(true);
      expect(tools.has('playbook.list')).toBe(true);
      expect(tools.has('playbook.get')).toBe(true);
    });

    it('should have correct tool schemas', () => {
      const tools = server['tools'];
      
      const createTool = tools.get('run.create');
      expect(createTool?.name).toBe('run.create');
      expect(createTool?.description).toContain('Create a new run');
      expect(createTool?.inputSchema.required).toContain('spec');
      
      const executeTool = tools.get('run.execute');
      expect(executeTool?.name).toBe('run.execute');
      expect(executeTool?.inputSchema.required).toContain('runId');
    });
  });

  describe('run.create Tool', () => {
    it('should create a run with valid spec', async () => {
      const spec = {
        title: 'Test Run',
        runtime: 'dummy',
        steps: [
          {
            name: 'Echo Step',
            shell: 'bash',
            command: 'echo "hello"',
          },
        ],
      };

      const result = await server['handleToolCall']('run.create', { spec });

      expect(result.runId).toBeDefined();
      expect(result.title).toBe('Test Run');
      expect(result.status).toBe('created');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].status).toBe('pending');
    });

    it('should create a run with all optional fields', async () => {
      const spec = {
        runId: 'custom-integration-run',
        issueId: 'issue-integration-123',
        title: 'Full Integration Run',
        runtime: 'dummy',
        steps: [
          {
            name: 'Build',
            shell: 'bash',
            command: 'npm run build',
            cwd: '/app',
            timeoutSec: 300,
            expect: {
              exitCode: 0,
            },
            artifacts: ['dist/**/*'],
          },
        ],
        envRefs: {
          NODE_ENV: 'production',
        },
      };

      const result = await server['handleToolCall']('run.create', { spec });

      expect(result.runId).toBe('custom-integration-run');
      expect(result.issueId).toBe('issue-integration-123');
    });

    it('should reject invalid spec', async () => {
      const invalidSpec = {
        title: '',
        runtime: 'dummy',
        steps: [],
      };

      await expect(
        server['handleToolCall']('run.create', { spec: invalidSpec })
      ).rejects.toThrow(/Validation error/);
    });

    it('should reject unsupported runtime in DummyAdapter', async () => {
      const spec = {
        title: 'GitHub Runner Test',
        runtime: 'github-runner',
        steps: [
          {
            name: 'Step',
            shell: 'bash',
            command: 'echo',
          },
        ],
      };

      await expect(
        server['handleToolCall']('run.create', { spec })
      ).rejects.toThrow(/not supported by DummyExecutorAdapter/);
    });
  });

  describe('run.execute Tool', () => {
    it('should execute a created run', async () => {
      // Create run first
      const spec = {
        title: 'Execute Test',
        runtime: 'dummy',
        steps: [
          {
            name: 'Test Step',
            shell: 'bash',
            command: 'echo "execute test"',
          },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });
      
      // Execute the run
      const executed = await server['handleToolCall']('run.execute', { 
        runId: created.runId 
      });

      expect(executed.runId).toBe(created.runId);
      expect(executed.status).toBe('success');
      expect(executed.startedAt).toBeDefined();
      expect(executed.completedAt).toBeDefined();
      expect(executed.durationMs).toBeGreaterThan(0);
      expect(executed.steps[0].status).toBe('success');
      expect(executed.steps[0].exitCode).toBe(0);
    });

    it('should reject execution of non-existent run', async () => {
      await expect(
        server['handleToolCall']('run.execute', { runId: 'non-existent' })
      ).rejects.toThrow(/not found/);
    });

    it('should reject missing runId', async () => {
      await expect(
        server['handleToolCall']('run.execute', {})
      ).rejects.toThrow(/required/);
    });
  });

  describe('run.status Tool', () => {
    it('should get status of created run', async () => {
      const spec = {
        title: 'Status Test',
        runtime: 'dummy',
        steps: [
          { name: 'Step', shell: 'bash', command: 'echo' },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });
      const status = await server['handleToolCall']('run.status', { 
        runId: created.runId 
      });

      expect(status.runId).toBe(created.runId);
      expect(status.status).toBe('created');
    });

    it('should get status of executed run', async () => {
      const spec = {
        title: 'Status After Execute',
        runtime: 'dummy',
        steps: [
          { name: 'Step', shell: 'bash', command: 'echo' },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });
      await server['handleToolCall']('run.execute', { runId: created.runId });
      const status = await server['handleToolCall']('run.status', { 
        runId: created.runId 
      });

      expect(status.status).toBe('success');
    });
  });

  describe('run.read Tool', () => {
    it('should read full results of executed run', async () => {
      const spec = {
        title: 'Read Test',
        runtime: 'dummy',
        steps: [
          { name: 'Step 1', shell: 'bash', command: 'echo "output"' },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });
      await server['handleToolCall']('run.execute', { runId: created.runId });
      const result = await server['handleToolCall']('run.read', { 
        runId: created.runId 
      });

      expect(result.runId).toBe(created.runId);
      expect(result.status).toBe('success');
      expect(result.steps[0].stdout).toBeDefined();
      expect(result.steps[0].stdout).toContain('DUMMY');
    });
  });

  describe('playbook.list Tool', () => {
    it('should list available playbooks', async () => {
      const result = await server['handleToolCall']('playbook.list', {});

      expect(result.playbooks).toBeDefined();
      expect(Array.isArray(result.playbooks)).toBe(true);
      expect(result.playbooks.length).toBeGreaterThan(0);
      
      // Check structure of first playbook
      const firstPlaybook = result.playbooks[0];
      expect(firstPlaybook.id).toBeDefined();
      expect(firstPlaybook.name).toBeDefined();
      expect(firstPlaybook.spec).toBeDefined();
      expect(firstPlaybook.spec.title).toBeDefined();
      expect(firstPlaybook.spec.runtime).toBeDefined();
      expect(firstPlaybook.spec.steps).toBeDefined();
    });

    it('should include example playbooks', async () => {
      const result = await server['handleToolCall']('playbook.list', {});

      const playbookIds = result.playbooks.map((p: any) => p.id);
      expect(playbookIds).toContain('hello-world');
      expect(playbookIds).toContain('multi-step-build');
      expect(playbookIds).toContain('pwsh-example');
    });
  });

  describe('playbook.get Tool', () => {
    it('should get a specific playbook', async () => {
      const result = await server['handleToolCall']('playbook.get', { 
        id: 'hello-world' 
      });

      expect(result.id).toBe('hello-world');
      expect(result.name).toBe('Hello World');
      expect(result.spec.title).toBeDefined();
      expect(result.spec.steps).toHaveLength(1);
    });

    it('should reject non-existent playbook', async () => {
      await expect(
        server['handleToolCall']('playbook.get', { id: 'non-existent' })
      ).rejects.toThrow(/not found/);
    });

    it('should reject missing id', async () => {
      await expect(
        server['handleToolCall']('playbook.get', {})
      ).rejects.toThrow(/required/);
    });
  });

  describe('Complete Roundtrip Flow', () => {
    it('should support create → execute → status → read flow', async () => {
      // 1. Create run
      const spec = {
        issueId: 'roundtrip-issue',
        title: 'Roundtrip Test',
        runtime: 'dummy',
        steps: [
          {
            name: 'First Step',
            shell: 'bash',
            command: 'echo "step 1"',
          },
          {
            name: 'Second Step',
            shell: 'pwsh',
            command: 'Write-Host "step 2"',
          },
        ],
      };

      const created = await server['handleToolCall']('run.create', { spec });
      expect(created.status).toBe('created');
      expect(created.steps).toHaveLength(2);

      // 2. Execute run
      const executed = await server['handleToolCall']('run.execute', { 
        runId: created.runId 
      });
      expect(executed.status).toBe('success');
      expect(executed.steps[0].status).toBe('success');
      expect(executed.steps[1].status).toBe('success');

      // 3. Get status
      const status = await server['handleToolCall']('run.status', { 
        runId: created.runId 
      });
      expect(status.status).toBe('success');

      // 4. Read full result
      const result = await server['handleToolCall']('run.read', { 
        runId: created.runId 
      });
      expect(result.status).toBe('success');
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].stdout).toContain('First Step');
      expect(result.steps[1].stdout).toContain('Second Step');
    });

    it('should support playbook → create → execute flow', async () => {
      // 1. Get playbook
      const playbook = await server['handleToolCall']('playbook.get', { 
        id: 'multi-step-build' 
      });

      // 2. Create run from playbook
      const created = await server['handleToolCall']('run.create', { 
        spec: playbook.spec 
      });
      expect(created.title).toBe(playbook.spec.title);

      // 3. Execute the run
      const executed = await server['handleToolCall']('run.execute', { 
        runId: created.runId 
      });
      expect(executed.status).toBe('success');
    });
  });

  describe('Dependency Checks', () => {
    it('should have service and executor dependencies', async () => {
      const deps = await server['checkDependencies']();
      
      expect(deps.has('service')).toBe(true);
      expect(deps.has('executor')).toBe(true);
      expect(deps.has('playbooks')).toBe(true);
      
      expect(deps.get('service')?.status).toBe('ok');
      expect(deps.get('executor')?.status).toBe('ok');
    });

    it('should list required and optional dependencies', () => {
      const required = server['getRequiredDependencies']();
      const optional = server['getOptionalDependencies']();
      
      expect(required).toContain('service');
      expect(required).toContain('executor');
      expect(optional).toContain('playbooks');
    });
  });
});
