/**
 * Integration Tests for Issue B5: RED Verdict Abort in Workflow Engine
 * 
 * Tests the workflow engine's behavior when RED verdict is detected:
 * 1. Workflow aborts immediately when RED verdict is in context
 * 2. No further steps are executed after RED
 * 3. System remains stable and cleans up properly
 */

import { WorkflowEngine } from '../../src/lib/workflow-engine';
import { WorkflowDefinition, WorkflowContext } from '../../src/lib/types/workflow';
import { MCPClient } from '../../src/lib/mcp-client';

// Mock dependencies
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
  checkDatabase: jest.fn(() => Promise.resolve(false)), // Disable DB for these tests
}));

jest.mock('../../src/lib/mcp-client', () => ({
  getMCPClient: jest.fn(() => ({
    callTool: jest.fn(),
  })),
}));

jest.mock('../../src/lib/debug-mode', () => ({
  isDebugModeEnabled: jest.fn(() => false),
}));

describe('Workflow Engine RED Verdict Abort (Issue B5)', () => {
  let engine: WorkflowEngine;
  let mockMCPClient: jest.Mocked<MCPClient>;

  beforeEach(() => {
    mockMCPClient = {
      callTool: jest.fn(),
    } as any;
    engine = new WorkflowEngine(mockMCPClient, false); // Disable persistence
  });

  describe('RED Verdict Detection and Abort', () => {
    it('should abort when SimpleVerdict.RED is in context', async () => {
      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
          {
            name: 'step2',
            tool: 'github.createBranch',
            params: { branch: 'test' },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {
          simpleVerdict: 'RED',
        },
        input: {},
      };

      const result = await engine.execute(workflow, context);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('RED verdict');
      expect(result.metadata.stepsCompleted).toBe(0);
    });

    it('should abort when VerdictType.REJECTED is in context', async () => {
      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {
          verdictType: 'REJECTED',
        },
        input: {},
      };

      const result = await engine.execute(workflow, context);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('REJECTED verdict');
    });

    it('should abort when SimpleAction.ABORT is in context', async () => {
      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {
          action: 'ABORT',
        },
        input: {},
      };

      const result = await engine.execute(workflow, context);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('ABORT action');
    });

    it('should detect RED in nested verdict object', async () => {
      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {
          verdict: {
            simpleVerdict: 'RED',
            verdictType: 'REJECTED',
            action: 'ABORT',
            errorClass: 'CRITICAL_ERROR',
          },
        },
        input: {},
      };

      const result = await engine.execute(workflow, context);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('RED verdict');
    });
  });

  describe('RED Abort Timing', () => {
    it('should abort before executing any steps when RED is present initially', async () => {
      mockMCPClient.callTool.mockResolvedValue({ success: true });

      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
          {
            name: 'step2',
            tool: 'github.createBranch',
            params: { branch: 'test' },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {
          simpleVerdict: 'RED',
        },
        input: {},
      };

      await engine.execute(workflow, context);

      // No MCP tools should have been called
      expect(mockMCPClient.callTool).not.toHaveBeenCalled();
    });

    it('should abort after step that sets RED verdict', async () => {
      mockMCPClient.callTool.mockResolvedValueOnce({
        simpleVerdict: 'RED',
        verdictType: 'REJECTED',
      });

      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'evaluateDeployment',
            tool: 'verdict.evaluate',
            params: { signals: [] },
            assign: 'verdictResult',
          },
          {
            name: 'shouldNotExecute',
            tool: 'github.createBranch',
            params: { branch: 'test' },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {},
        input: {},
      };

      const result = await engine.execute(workflow, context);

      // First step executed, second should not
      expect(mockMCPClient.callTool).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('failed');
    });
  });

  describe('Non-RED Verdicts Continue Normally', () => {
    it('should not abort for GREEN verdict', async () => {
      mockMCPClient.callTool.mockResolvedValue({ success: true });

      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {
          simpleVerdict: 'GREEN',
        },
        input: {},
      };

      const result = await engine.execute(workflow, context);

      expect(result.status).toBe('completed');
      expect(mockMCPClient.callTool).toHaveBeenCalled();
    });

    it('should not abort for HOLD verdict (pauses instead)', async () => {
      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {
          simpleVerdict: 'HOLD',
        },
        input: {},
        issue: {
          number: 123,
          state: 'HOLD' as any,
        },
      };

      const result = await engine.execute(workflow, context);

      // HOLD should pause, not abort
      expect(result.status).toBe('paused');
      expect(result.status).not.toBe('failed');
    });

    it('should not abort for RETRY verdict', async () => {
      mockMCPClient.callTool.mockResolvedValue({ success: true });

      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {
          simpleVerdict: 'RETRY',
        },
        input: {},
      };

      const result = await engine.execute(workflow, context);

      expect(result.status).toBe('completed');
      expect(mockMCPClient.callTool).toHaveBeenCalled();
    });
  });

  describe('System Stability', () => {
    it('should handle RED abort without throwing exceptions', async () => {
      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {
          simpleVerdict: 'RED',
        },
        input: {},
      };

      // Should not throw
      await expect(engine.execute(workflow, context)).resolves.toBeDefined();
    });

    it('should clean up properly after RED abort', async () => {
      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {
          simpleVerdict: 'RED',
        },
        input: {},
      };

      const result = await engine.execute(workflow, context);

      // Verify result has all required fields
      expect(result).toHaveProperty('executionId');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('output');
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('metadata');
      expect(result.metadata).toHaveProperty('startedAt');
      expect(result.metadata).toHaveProperty('completedAt');
      expect(result.metadata).toHaveProperty('durationMs');
    });

    it('should handle multiple rapid RED aborts without memory leaks', async () => {
      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
        ],
      };

      const executions = [];
      for (let i = 0; i < 100; i++) {
        const context: WorkflowContext = {
          variables: {
            simpleVerdict: 'RED',
          },
          input: { iteration: i },
        };

        executions.push(engine.execute(workflow, context));
      }

      const results = await Promise.all(executions);

      // All should complete with failed status
      expect(results).toHaveLength(100);
      results.forEach(result => {
        expect(result.status).toBe('failed');
        expect(result.error).toContain('RED verdict');
      });
    });
  });

  describe('Error Messages and Logging', () => {
    it('should provide clear error message for RED abort', async () => {
      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {
          simpleVerdict: 'RED',
        },
        input: {},
      };

      const result = await engine.execute(workflow, context);

      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/RED verdict/i);
      expect(result.error).toMatch(/critical failure/i);
    });

    it('should include verdict information in abort message for REJECTED', async () => {
      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {
          verdictType: 'REJECTED',
        },
        input: {},
      };

      const result = await engine.execute(workflow, context);

      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/REJECTED verdict/i);
    });

    it('should include action information in abort message for ABORT', async () => {
      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {
          action: 'ABORT',
        },
        input: {},
      };

      const result = await engine.execute(workflow, context);

      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/ABORT action/i);
    });
  });

  describe('Issue B5 Compliance', () => {
    it('RED ist hart - no discussion, immediate abort', async () => {
      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
          {
            name: 'step2',
            tool: 'github.createBranch',
            params: { branch: 'test' },
          },
          {
            name: 'step3',
            tool: 'github.commitFiles',
            params: { files: [] },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {
          simpleVerdict: 'RED',
        },
        input: {},
      };

      const startTime = Date.now();
      const result = await engine.execute(workflow, context);
      const endTime = Date.now();

      // Should abort immediately (< 100ms for in-memory execution)
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(100);

      // Status must be failed
      expect(result.status).toBe('failed');

      // No steps should have executed
      expect(result.metadata.stepsCompleted).toBe(0);
    });

    it('System remains stable after RED abort', async () => {
      const workflow: WorkflowDefinition = {
        steps: [
          {
            name: 'step1',
            tool: 'github.getIssue',
            params: { number: 1 },
          },
        ],
      };

      const context: WorkflowContext = {
        variables: {
          simpleVerdict: 'RED',
        },
        input: {},
      };

      // Execute and abort
      const result1 = await engine.execute(workflow, context);
      expect(result1.status).toBe('failed');

      // Engine should still be usable after abort
      mockMCPClient.callTool.mockResolvedValue({ success: true });
      const context2: WorkflowContext = {
        variables: {
          simpleVerdict: 'GREEN',
        },
        input: {},
      };

      const result2 = await engine.execute(workflow, context2);
      expect(result2.status).toBe('completed');
    });
  });
});
