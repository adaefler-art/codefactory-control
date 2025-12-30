import * as fs from 'fs';
import * as path from 'path';
import { AFU9RunnerMCPServer } from '../../src/index';

describe('Documentation & Contract Consistency', () => {
  const repoRoot = path.join(__dirname, '../../../..');
  const centralDocsPath = path.join(repoRoot, 'docs/mcp/servers/afu9-runner.md');
  const readmePath = path.join(__dirname, '../../README.md');
  
  let centralDocs: string;
  let readme: string;
  let server: AFU9RunnerMCPServer;

  beforeAll(() => {
    server = new AFU9RunnerMCPServer(0);
    server['registerTools']();
    
    if (fs.existsSync(centralDocsPath)) {
      centralDocs = fs.readFileSync(centralDocsPath, 'utf-8');
    }
    
    if (fs.existsSync(readmePath)) {
      readme = fs.readFileSync(readmePath, 'utf-8');
    }
  });

  describe('Central Documentation Structure', () => {
    it('should exist at docs/mcp/servers/afu9-runner.md', () => {
      expect(fs.existsSync(centralDocsPath)).toBe(true);
    });

    it('should contain mandatory sections', () => {
      const requiredSections = [
        '## Overview',
        '## Tool Contracts',
        '## State Machine',
        '## Idempotency',
        '## Error Model',
        '## Timestamps',
        '## Versioning'
      ];

      requiredSections.forEach(section => {
        expect(centralDocs).toContain(section);
      });
    });

    it('should document all 6 tools', () => {
      expect(centralDocs).toContain('### 1. run.create');
      expect(centralDocs).toContain('### 2. run.execute');
      expect(centralDocs).toContain('### 3. run.status');
      expect(centralDocs).toContain('### 4. run.read');
      expect(centralDocs).toContain('### 5. playbook.list');
      expect(centralDocs).toContain('### 6. playbook.get');
    });

    it('should state canonical server name', () => {
      expect(centralDocs).toMatch(/Canonical Server Name.*afu9-runner/);
    });

    it('should state contract version 0.6.0', () => {
      expect(centralDocs).toMatch(/Contract Version.*0\.6\.0/);
    });
  });

  describe('Idempotency Documentation', () => {
    it('should explicitly document run.execute is NOT idempotent', () => {
      const idempotencySection = centralDocs.substring(
        centralDocs.indexOf('## Idempotency'),
        centralDocs.indexOf('## Error Model')
      );

      expect(idempotencySection).toContain('run.execute');
      expect(idempotencySection).toMatch(/NOT [Ii]dempotent/);
      expect(idempotencySection).toContain('has already been executed');
    });

    it('should document run.status is idempotent and side-effect free', () => {
      const idempotencySection = centralDocs.substring(
        centralDocs.indexOf('## Idempotency'),
        centralDocs.indexOf('## Error Model')
      );

      expect(idempotencySection).toContain('run.status');
      expect(idempotencySection).toMatch(/[Ii]dempotent/);
      expect(idempotencySection).toMatch(/[Ss]ide-[Ee]ffect [Ff]ree|[Ss]ide [Ee]ffects?/);
    });

    it('should document run.read is idempotent and side-effect free', () => {
      const idempotencySection = centralDocs.substring(
        centralDocs.indexOf('## Idempotency'),
        centralDocs.indexOf('## Error Model')
      );

      expect(idempotencySection).toContain('run.read');
      expect(idempotencySection).toMatch(/[Ii]dempotent/);
      expect(idempotencySection).toMatch(/[Ss]ide-[Ee]ffect [Ff]ree|[Ss]ide [Ee]ffects?/);
    });
  });

  describe('Error Model Documentation', () => {
    it('should document Unknown RunId error with example', () => {
      const errorSection = centralDocs.substring(
        centralDocs.indexOf('## Error Model'),
        centralDocs.indexOf('## Timestamps')
      );

      expect(errorSection).toContain('Unknown RunId');
      expect(errorSection).toContain('not found');
      expect(errorSection).toMatch(/run\.status|run\.read/);
      expect(errorSection).toContain('Example');
    });

    it('should document Execute Already Executed error with example', () => {
      const errorSection = centralDocs.substring(
        centralDocs.indexOf('## Error Model'),
        centralDocs.indexOf('## Timestamps')
      );

      expect(errorSection).toContain('already been executed');
      expect(errorSection).toContain('run.execute');
      expect(errorSection).toContain('Example');
    });

    it('should document Validation Error with example', () => {
      const errorSection = centralDocs.substring(
        centralDocs.indexOf('## Error Model'),
        centralDocs.indexOf('## Timestamps')
      );

      expect(errorSection).toContain('Validation Error');
      expect(errorSection).toContain('RunSpec');
      expect(errorSection).toContain('Example');
    });

    it('should show error message patterns', () => {
      const errorSection = centralDocs.substring(
        centralDocs.indexOf('## Error Model'),
        centralDocs.indexOf('## Timestamps')
      );

      expect(errorSection).toMatch(/Error Message Pattern|Pattern:/);
    });
  });

  describe('Timestamp Guarantees', () => {
    it('should document ordering guarantee', () => {
      const timestampSection = centralDocs.substring(
        centralDocs.indexOf('## Timestamps'),
        centralDocs.indexOf('## Versioning')
      );

      expect(timestampSection).toContain('createdAt');
      expect(timestampSection).toContain('startedAt');
      expect(timestampSection).toContain('completedAt');
      expect(timestampSection).toMatch(/createdAt.*startedAt.*completedAt/s);
    });

    it('should document timestamp presence by status', () => {
      const timestampSection = centralDocs.substring(
        centralDocs.indexOf('## Timestamps'),
        centralDocs.indexOf('## Versioning')
      );

      expect(timestampSection).toContain('created');
      expect(timestampSection).toContain('success');
    });
  });

  describe('Tool Registration Consistency', () => {
    it('should register exactly the tools documented', () => {
      const tools = server['tools'];
      const toolNames = Array.from(tools.keys());

      const expectedTools = [
        'run.create',
        'run.execute',
        'run.status',
        'run.read',
        'playbook.list',
        'playbook.get'
      ];

      expect(toolNames.sort()).toEqual(expectedTools.sort());
    });

    it('should have tool schemas matching documentation', () => {
      const tools = server['tools'];

      // run.create should require spec
      const createTool = tools.get('run.create');
      expect(createTool?.inputSchema.required).toContain('spec');

      // run.execute should require runId
      const executeTool = tools.get('run.execute');
      expect(executeTool?.inputSchema.required).toContain('runId');

      // run.status should require runId
      const statusTool = tools.get('run.status');
      expect(statusTool?.inputSchema.required).toContain('runId');

      // run.read should require runId
      const readTool = tools.get('run.read');
      expect(readTool?.inputSchema.required).toContain('runId');

      // playbook.get should require id
      const getPlaybookTool = tools.get('playbook.get');
      expect(getPlaybookTool?.inputSchema.required).toContain('id');
    });
  });

  describe('README Link to Central Docs', () => {
    it('should link to central documentation', () => {
      expect(readme).toMatch(/docs\/mcp\/servers\/afu9-runner\.md/);
    });

    it('should mention canonical server name', () => {
      expect(readme).toContain('afu9-runner');
    });

    it('should mention contract version', () => {
      expect(readme).toContain('0.6.0');
    });
  });

  describe('Error Shape Consistency', () => {
    it('should throw consistent error format for unknown runId', async () => {
      const runId = 'unknown-test-id';

      // Test run.status
      await expect(
        server['handleToolCall']('run.status', { runId })
      ).rejects.toThrow(`Run ${runId} not found`);

      // Test run.read
      await expect(
        server['handleToolCall']('run.read', { runId })
      ).rejects.toThrow(`Run ${runId} not found`);

      // Test run.execute
      await expect(
        server['handleToolCall']('run.execute', { runId })
      ).rejects.toThrow(`Run ${runId} not found`);
    });

    it('should throw consistent error for already executed run', async () => {
      const spec = {
        title: 'Test Run',
        runtime: 'dummy',
        steps: [
          { name: 'Step', shell: 'bash', command: 'echo' }
        ]
      };

      const created = await server['handleToolCall']('run.create', { spec });
      await server['handleToolCall']('run.execute', { runId: created.runId });

      await expect(
        server['handleToolCall']('run.execute', { runId: created.runId })
      ).rejects.toThrow(/has already been executed/);
    });
  });

  describe('DummyExecutor Behavior Documentation', () => {
    it('should document what DummyExecutor does', () => {
      const overviewSection = centralDocs.substring(0, centralDocs.indexOf('## Tool Contracts'));
      
      expect(overviewSection).toMatch(/What DummyExecutor Does|DummyExecutor.*Does/);
      expect(overviewSection).toContain('Accepts valid RunSpec');
      expect(overviewSection).toContain('Simulates execution');
    });

    it('should document what DummyExecutor does NOT do', () => {
      const overviewSection = centralDocs.substring(0, centralDocs.indexOf('## Tool Contracts'));
      
      expect(overviewSection).toMatch(/What DummyExecutor Does NOT|NOT Do/);
      expect(overviewSection).toMatch(/Execute actual commands|real.*execution/i);
      expect(overviewSection).toMatch(/database|persist/i);
    });
  });
});
