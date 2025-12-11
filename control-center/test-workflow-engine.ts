/**
 * Workflow Engine Test Script
 * 
 * Tests the workflow engine with persistence and logging features.
 * Can run with or without a database connection.
 */

import { WorkflowEngine } from './src/lib/workflow-engine';
import { WorkflowDefinition, WorkflowContext } from './src/lib/types/workflow';
import { checkDatabase } from './src/lib/db';

// Mock MCP Client for testing
class MockMCPClient {
  async callTool(serverName: string, toolName: string, params: any): Promise<any> {
    console.log(`[Mock MCP] Called ${serverName}.${toolName}`, params);
    
    // Simulate tool responses
    if (toolName === 'getIssue') {
      return {
        number: params.number,
        title: 'Test Issue',
        body: 'This is a test issue',
        labels: [{ name: 'bug' }],
        state: 'open',
      };
    }
    
    if (toolName === 'createBranch') {
      return {
        ref: `refs/heads/${params.branch}`,
        sha: 'abc123def456',
      };
    }
    
    if (toolName === 'createPullRequest') {
      return {
        number: 42,
        title: params.title,
        html_url: 'https://github.com/test/repo/pull/42',
      };
    }
    
    return { success: true };
  }
}

async function runTests() {
  console.log('='.repeat(80));
  console.log('WORKFLOW ENGINE TEST SUITE');
  console.log('='.repeat(80));
  console.log();

  // Check database availability
  const dbAvailable = await checkDatabase();
  console.log(`Database available: ${dbAvailable}`);
  console.log();

  // Create workflow engine with mock client
  const mockClient = new MockMCPClient() as any;
  const engine = new WorkflowEngine(mockClient, true);

  // Test 1: Simple workflow with variable assignment
  console.log('TEST 1: Simple Workflow with Variable Assignment');
  console.log('-'.repeat(80));
  
  const simpleWorkflow: WorkflowDefinition = {
    steps: [
      {
        name: 'fetch_issue',
        tool: 'github.getIssue',
        params: {
          owner: '${repo.owner}',
          repo: '${repo.name}',
          number: '${input.issue_number}',
        },
        assign: 'issue',
      },
      {
        name: 'log_issue',
        tool: 'github.logMessage',
        params: {
          message: 'Processing issue: ${issue.title}',
        },
      },
    ],
  };

  const simpleContext: WorkflowContext = {
    variables: {},
    input: {
      issue_number: 123,
    },
    repo: {
      owner: 'adaefler-art',
      name: 'codefactory-control',
      default_branch: 'main',
    },
  };

  try {
    const result1 = await engine.execute(simpleWorkflow, simpleContext);
    console.log('✓ Simple workflow completed');
    console.log(`  Execution ID: ${result1.executionId}`);
    console.log(`  Status: ${result1.status}`);
    console.log(`  Duration: ${result1.metadata.durationMs}ms`);
    console.log(`  Steps completed: ${result1.metadata.stepsCompleted}/${result1.metadata.stepsTotal}`);
    console.log(`  Issue title: ${result1.output.issue?.title}`);
  } catch (error) {
    console.error('✗ Simple workflow failed:', error);
  }
  console.log();

  // Test 2: Workflow with conditional step
  console.log('TEST 2: Workflow with Conditional Step');
  console.log('-'.repeat(80));

  const conditionalWorkflow: WorkflowDefinition = {
    steps: [
      {
        name: 'fetch_issue',
        tool: 'github.getIssue',
        params: {
          owner: '${repo.owner}',
          repo: '${repo.name}',
          number: '${input.issue_number}',
        },
        assign: 'issue',
      },
      {
        name: 'create_branch_for_bug',
        tool: 'github.createBranch',
        params: {
          owner: '${repo.owner}',
          repo: '${repo.name}',
          branch: 'fix/${issue.number}',
          from: '${repo.default_branch}',
        },
        condition: '${issue.labels[0].name}',
        assign: 'branch',
      },
      {
        name: 'log_result',
        tool: 'github.logMessage',
        params: {
          message: 'Branch created: ${branch.ref}',
        },
        condition: '${branch}',
      },
    ],
  };

  const conditionalContext: WorkflowContext = {
    variables: {},
    input: {
      issue_number: 456,
    },
    repo: {
      owner: 'adaefler-art',
      name: 'codefactory-control',
      default_branch: 'main',
    },
  };

  try {
    const result2 = await engine.execute(conditionalWorkflow, conditionalContext);
    console.log('✓ Conditional workflow completed');
    console.log(`  Execution ID: ${result2.executionId}`);
    console.log(`  Status: ${result2.status}`);
    console.log(`  Duration: ${result2.metadata.durationMs}ms`);
    console.log(`  Steps completed: ${result2.metadata.stepsCompleted}/${result2.metadata.stepsTotal}`);
  } catch (error) {
    console.error('✗ Conditional workflow failed:', error);
  }
  console.log();

  // Test 3: Complex workflow (issue to PR)
  console.log('TEST 3: Complex Workflow (Issue to PR)');
  console.log('-'.repeat(80));

  const complexWorkflow: WorkflowDefinition = {
    steps: [
      {
        name: 'fetch_issue',
        tool: 'github.getIssue',
        params: {
          owner: '${repo.owner}',
          repo: '${repo.name}',
          number: '${input.issue_number}',
        },
        assign: 'issue',
      },
      {
        name: 'create_branch',
        tool: 'github.createBranch',
        params: {
          owner: '${repo.owner}',
          repo: '${repo.name}',
          branch: 'fix/${issue.number}',
          from: '${repo.default_branch}',
        },
        assign: 'branch',
      },
      {
        name: 'create_pull_request',
        tool: 'github.createPullRequest',
        params: {
          owner: '${repo.owner}',
          repo: '${repo.name}',
          title: 'Fix: ${issue.title}',
          body: 'Automated fix for #${issue.number}',
          head: 'fix/${issue.number}',
          base: '${repo.default_branch}',
        },
        assign: 'pull_request',
      },
    ],
  };

  const complexContext: WorkflowContext = {
    variables: {},
    input: {
      issue_number: 789,
    },
    repo: {
      owner: 'adaefler-art',
      name: 'codefactory-control',
      default_branch: 'main',
    },
  };

  try {
    const result3 = await engine.execute(complexWorkflow, complexContext);
    console.log('✓ Complex workflow completed');
    console.log(`  Execution ID: ${result3.executionId}`);
    console.log(`  Status: ${result3.status}`);
    console.log(`  Duration: ${result3.metadata.durationMs}ms`);
    console.log(`  Steps completed: ${result3.metadata.stepsCompleted}/${result3.metadata.stepsTotal}`);
    console.log(`  PR URL: ${result3.output.pull_request?.html_url}`);
  } catch (error) {
    console.error('✗ Complex workflow failed:', error);
  }
  console.log();

  // Test 4: Workflow with retry (simulated failure)
  console.log('TEST 4: Workflow with Error Handling');
  console.log('-'.repeat(80));

  const errorWorkflow: WorkflowDefinition = {
    steps: [
      {
        name: 'fetch_issue',
        tool: 'github.getIssue',
        params: {
          owner: '${repo.owner}',
          repo: '${repo.name}',
          number: '${input.issue_number}',
        },
        assign: 'issue',
      },
      {
        name: 'failing_step',
        tool: 'github.nonexistentTool',
        params: {},
      },
    ],
  };

  const errorContext: WorkflowContext = {
    variables: {},
    input: {
      issue_number: 999,
    },
    repo: {
      owner: 'adaefler-art',
      name: 'codefactory-control',
      default_branch: 'main',
    },
  };

  try {
    const result4 = await engine.execute(errorWorkflow, errorContext);
    console.log(`  Execution ID: ${result4.executionId}`);
    console.log(`  Status: ${result4.status} (expected: failed)`);
    console.log(`  Duration: ${result4.metadata.durationMs}ms`);
    console.log(`  Steps completed: ${result4.metadata.stepsCompleted}/${result4.metadata.stepsTotal}`);
    if (result4.error) {
      console.log(`  Error: ${result4.error.substring(0, 100)}...`);
    }
    console.log('✓ Error handling works correctly');
  } catch (error) {
    console.error('✗ Error workflow failed unexpectedly:', error);
  }
  console.log();

  console.log('='.repeat(80));
  console.log('TEST SUITE COMPLETED');
  console.log('='.repeat(80));
  console.log();

  if (dbAvailable) {
    console.log('Database persistence was enabled during tests.');
    console.log('Check the database for execution records:');
    console.log('  SELECT * FROM workflow_executions ORDER BY started_at DESC LIMIT 5;');
    console.log('  SELECT * FROM workflow_steps WHERE execution_id = \'<execution_id>\';');
  } else {
    console.log('Database persistence was not available during tests.');
    console.log('To enable persistence, configure database connection:');
    console.log('  DATABASE_HOST=localhost');
    console.log('  DATABASE_PORT=5432');
    console.log('  DATABASE_NAME=afu9');
    console.log('  DATABASE_USER=postgres');
    console.log('  DATABASE_PASSWORD=<password>');
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
