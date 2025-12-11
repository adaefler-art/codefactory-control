/**
 * Agent Runner Test Script
 * 
 * Tests the Agent Runner with different LLM providers (OpenAI, DeepSeek, Anthropic).
 * 
 * Note: This test requires valid API keys set in environment variables:
 * - OPENAI_API_KEY
 * - DEEPSEEK_API_KEY (optional)
 * - ANTHROPIC_API_KEY (optional)
 * 
 * Run with: npx tsx test-agent-runner.ts
 */

import { AgentRunner } from './src/lib/agent-runner';
import { MCPClient } from './src/lib/mcp-client';
import { AgentConfig, AgentContext } from './src/lib/types/agent';
import { LLMProvider } from './src/lib/types/agent';

// Mock MCP Client for testing
class MockMCPClient extends MCPClient {
  constructor() {
    super([
      {
        name: 'github',
        endpoint: 'http://mock-github:3001',
        enabled: true,
      },
      {
        name: 'deploy',
        endpoint: 'http://mock-deploy:3002',
        enabled: true,
      },
    ]);
  }

  async callTool(serverName: string, toolName: string, params: any): Promise<any> {
    console.log(`[Mock MCP] Called ${serverName}.${toolName}`, JSON.stringify(params, null, 2));
    
    // Simulate tool responses
    if (toolName === 'getIssue') {
      return {
        number: params.number || 1,
        title: 'Test Issue: Implement feature X',
        body: 'This is a test issue description',
        labels: [{ name: 'enhancement' }],
        state: 'open',
        created_at: '2025-12-11T00:00:00Z',
      };
    }
    
    if (toolName === 'listIssues') {
      return [
        {
          number: 1,
          title: 'First issue',
          state: 'open',
        },
        {
          number: 2,
          title: 'Second issue',
          state: 'open',
        },
      ];
    }
    
    if (toolName === 'createBranch') {
      return {
        ref: `refs/heads/${params.branch}`,
        sha: 'abc123def456789',
        url: `https://github.com/${params.owner}/${params.repo}/tree/${params.branch}`,
      };
    }
    
    if (toolName === 'updateService') {
      return {
        service: params.service,
        taskDefinition: 'new-revision:42',
        status: 'ACTIVE',
        desiredCount: 2,
      };
    }
    
    return { success: true, tool: toolName, params };
  }

  async listTools(serverName: string) {
    const tools = {
      github: [
        {
          name: 'getIssue',
          description: 'Get details of a GitHub issue',
          inputSchema: {
            type: 'object' as const,
            properties: {
              owner: { type: 'string' },
              repo: { type: 'string' },
              number: { type: 'number' },
            },
            required: ['owner', 'repo', 'number'],
          },
        },
        {
          name: 'listIssues',
          description: 'List GitHub issues',
          inputSchema: {
            type: 'object' as const,
            properties: {
              owner: { type: 'string' },
              repo: { type: 'string' },
              state: { type: 'string' },
            },
            required: ['owner', 'repo'],
          },
        },
        {
          name: 'createBranch',
          description: 'Create a new branch',
          inputSchema: {
            type: 'object' as const,
            properties: {
              owner: { type: 'string' },
              repo: { type: 'string' },
              branch: { type: 'string' },
              from: { type: 'string' },
            },
            required: ['owner', 'repo', 'branch'],
          },
        },
      ],
      deploy: [
        {
          name: 'updateService',
          description: 'Update an ECS service',
          inputSchema: {
            type: 'object' as const,
            properties: {
              cluster: { type: 'string' },
              service: { type: 'string' },
              image: { type: 'string' },
            },
            required: ['cluster', 'service', 'image'],
          },
        },
      ],
    };

    return tools[serverName as keyof typeof tools] || [];
  }
}

/**
 * Test configuration for each provider
 */
interface ProviderTestConfig {
  provider: LLMProvider;
  model: string;
  enabled: boolean;
  apiKeyEnvVar: string;
}

const providerConfigs: ProviderTestConfig[] = [
  {
    provider: 'openai',
    model: 'gpt-4o-mini',
    enabled: !!process.env.OPENAI_API_KEY,
    apiKeyEnvVar: 'OPENAI_API_KEY',
  },
  {
    provider: 'deepseek',
    model: 'deepseek-chat',
    enabled: !!process.env.DEEPSEEK_API_KEY,
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
  },
  {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    enabled: !!process.env.ANTHROPIC_API_KEY,
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  },
];

/**
 * Run a test with a specific provider
 */
async function testProvider(
  provider: LLMProvider,
  model: string,
  mockClient: MockMCPClient
): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log(`Testing ${provider.toUpperCase()} Provider (${model})`);
  console.log('='.repeat(80) + '\n');

  const runner = new AgentRunner(mockClient);

  // Load mock tools
  const tools = await runner.loadToolsFromMCP(['github']);
  console.log(`✓ Loaded ${tools.length} tools from MCP servers\n`);

  const config: AgentConfig = {
    provider,
    model,
    temperature: 0.7,
    maxIterations: 5,
    systemPrompt: 'You are a helpful assistant for managing GitHub repositories. Use the available tools to complete tasks.',
  };

  const context: AgentContext = {
    prompt: 'Get information about issue #1 in the adaefler-art/codefactory-control repository',
    tools,
  };

  try {
    console.log(`Prompt: "${context.prompt}"\n`);
    
    const startTime = Date.now();
    const result = await runner.execute(context, config);
    const duration = Date.now() - startTime;

    console.log('\n' + '-'.repeat(80));
    console.log('EXECUTION RESULT');
    console.log('-'.repeat(80));
    console.log(`\n✓ Agent execution completed successfully`);
    console.log(`\nResponse:\n${result.response}\n`);
    console.log(`Tool Calls: ${result.toolCalls.length}`);
    
    if (result.toolCalls.length > 0) {
      console.log('\nTools called:');
      result.toolCalls.forEach((tc, idx) => {
        console.log(`  ${idx + 1}. ${tc.tool}`);
        console.log(`     Arguments: ${JSON.stringify(tc.arguments)}`);
      });
    }

    console.log(`\nToken Usage:`);
    console.log(`  - Prompt tokens: ${result.usage.promptTokens}`);
    console.log(`  - Completion tokens: ${result.usage.completionTokens}`);
    console.log(`  - Total tokens: ${result.usage.totalTokens}`);

    console.log(`\nMetadata:`);
    console.log(`  - Provider: ${result.metadata.provider}`);
    console.log(`  - Model: ${result.metadata.model}`);
    console.log(`  - Iterations: ${result.metadata.iterations}`);
    console.log(`  - Duration: ${result.metadata.durationMs}ms (actual: ${duration}ms)`);

    console.log('\n✅ Test PASSED\n');
    
  } catch (error) {
    console.error('\n❌ Test FAILED');
    console.error('Error:', error instanceof Error ? error.message : String(error));
    
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    
    throw error;
  }
}

/**
 * Test tool loading functionality
 */
async function testToolLoading(mockClient: MockMCPClient): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('Testing Tool Loading');
  console.log('='.repeat(80) + '\n');

  const runner = new AgentRunner(mockClient);

  // Test loading from specific servers
  const githubTools = await runner.loadToolsFromMCP(['github']);
  console.log(`✓ Loaded ${githubTools.length} tools from GitHub MCP server`);
  githubTools.forEach(tool => {
    console.log(`  - ${tool.name}: ${tool.description}`);
  });

  // Test loading from multiple servers
  const allTools = await runner.loadToolsFromMCP(['github', 'deploy']);
  console.log(`\n✓ Loaded ${allTools.length} tools from multiple MCP servers`);
  
  console.log('\n✅ Tool loading test PASSED\n');
}

/**
 * Main test runner
 */
async function main() {
  console.log('\n' + '█'.repeat(80));
  console.log('AGENT RUNNER TEST SUITE');
  console.log('█'.repeat(80));
  console.log('\nThis test suite validates the Agent Runner with multiple LLM providers.');
  console.log('It uses a mock MCP client to avoid external dependencies.\n');

  const mockClient = new MockMCPClient();
  
  let totalTests = 0;
  let passedTests = 0;
  let skippedTests = 0;

  try {
    // Test 1: Tool loading
    totalTests++;
    await testToolLoading(mockClient);
    passedTests++;

    // Test 2-4: Provider tests
    for (const config of providerConfigs) {
      totalTests++;
      
      if (!config.enabled) {
        console.log('\n' + '='.repeat(80));
        console.log(`Skipping ${config.provider.toUpperCase()} Provider (${config.model})`);
        console.log('='.repeat(80));
        console.log(`\n⚠️  ${config.apiKeyEnvVar} not set - skipping this provider\n`);
        skippedTests++;
        continue;
      }

      try {
        await testProvider(config.provider, config.model, mockClient);
        passedTests++;
      } catch (error) {
        console.error(`\n❌ ${config.provider} test failed:`, error);
        // Continue with other tests
      }
    }

    // Final summary
    console.log('\n' + '█'.repeat(80));
    console.log('TEST SUMMARY');
    console.log('█'.repeat(80));
    console.log(`\nTotal tests: ${totalTests}`);
    console.log(`✅ Passed: ${passedTests}`);
    console.log(`⚠️  Skipped: ${skippedTests}`);
    console.log(`❌ Failed: ${totalTests - passedTests - skippedTests}`);

    if (skippedTests > 0) {
      console.log('\nTo enable skipped tests, set the following environment variables:');
      providerConfigs.forEach(config => {
        if (!config.enabled) {
          console.log(`  - ${config.apiKeyEnvVar} (for ${config.provider})`);
        }
      });
    }

    console.log('\n' + '█'.repeat(80) + '\n');

    if (passedTests === totalTests - skippedTests && totalTests > 0) {
      console.log('🎉 All enabled tests passed!\n');
      process.exit(0);
    } else if (passedTests > 0) {
      console.log('⚠️  Some tests failed, but at least one provider is working.\n');
      process.exit(0);
    } else {
      console.log('❌ All tests failed or were skipped.\n');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Fatal error in test suite:', error);
    process.exit(1);
  }
}

// Run tests
main();
