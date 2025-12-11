/**
 * Agent Runner
 * 
 * Orchestrates LLM-based agent execution with MCP tool integration.
 * Allows LLMs to dynamically call MCP tools during execution.
 */

import OpenAI from 'openai';
import { MCPClient, getMCPClient } from './mcp-client';
import {
  AgentConfig,
  AgentTool,
  AgentMessage,
  AgentToolCall,
  AgentExecutionResult,
  AgentContext,
  LLMProvider,
} from './types/agent';
import { MCPTool } from './types/mcp';

/**
 * Agent Runner for executing LLM-based agents with tool calling
 */
export class AgentRunner {
  private mcpClient: MCPClient;
  private openaiClient: OpenAI | null = null;

  constructor(mcpClient?: MCPClient) {
    this.mcpClient = mcpClient || getMCPClient();
  }

  /**
   * Execute an agent with the given context
   * @param context - Agent execution context (prompt and tools)
   * @param config - Agent configuration
   * @returns Agent execution result
   */
  async execute(
    context: AgentContext,
    config: AgentConfig
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    
    console.log(`[Agent Runner] Starting agent execution`, {
      provider: config.provider,
      model: config.model,
      toolsCount: context.tools.length,
    });

    // Initialize LLM client based on provider
    const provider = config.provider || 'openai';
    
    if (provider === 'openai') {
      return await this.executeOpenAI(context, config, startTime);
    } else if (provider === 'anthropic') {
      throw new Error('Anthropic provider not yet implemented');
    } else if (provider === 'bedrock') {
      throw new Error('AWS Bedrock provider not yet implemented');
    } else {
      throw new Error(`Unknown LLM provider: ${provider}`);
    }
  }

  /**
   * Execute agent using OpenAI
   */
  private async executeOpenAI(
    context: AgentContext,
    config: AgentConfig,
    startTime: number
  ): Promise<AgentExecutionResult> {
    const client = this.getOpenAIClient();
    
    const messages: AgentMessage[] = [];
    const allToolCalls: Array<{
      tool: string;
      arguments: Record<string, any>;
      result: any;
    }> = [];

    // Add system message if provided
    if (config.systemPrompt) {
      messages.push({
        role: 'system',
        content: config.systemPrompt,
      });
    }

    // Add user prompt
    messages.push({
      role: 'user',
      content: context.prompt,
    });

    // Convert MCP tools to OpenAI tool format
    const tools = this.convertToolsToOpenAI(context.tools);

    let iterations = 0;
    const maxIterations = config.maxIterations || 10;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let finalResponse = '';

    // Agent loop: LLM can call tools multiple times
    while (iterations < maxIterations) {
      iterations++;
      
      console.log(`[Agent Runner] Iteration ${iterations}/${maxIterations}`);

      const completion = await client.chat.completions.create({
        model: config.model,
        messages: messages as any,
        tools: tools.length > 0 ? tools : undefined,
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens,
      });

      const choice = completion.choices[0];
      if (!choice) {
        throw new Error('No response from LLM');
      }

      // Track token usage
      if (completion.usage) {
        totalPromptTokens += completion.usage.prompt_tokens;
        totalCompletionTokens += completion.usage.completion_tokens;
      }

      const assistantMessage = choice.message;

      // Check if LLM wants to call tools
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        console.log(`[Agent Runner] LLM requested ${assistantMessage.tool_calls.length} tool call(s)`);

        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: assistantMessage.content || '',
          toolCalls: assistantMessage.tool_calls.map((tc) => {
            // Handle both function and custom tool calls
            const toolCall = tc as any;
            return {
              id: tc.id,
              name: toolCall.function?.name || toolCall.name,
              arguments: JSON.parse(toolCall.function?.arguments || toolCall.arguments || '{}'),
            };
          }),
        });

        // Execute each tool call
        for (const toolCall of assistantMessage.tool_calls) {
          try {
            // Handle both function and custom tool calls
            const tc = toolCall as any;
            const toolName = tc.function?.name || tc.name;
            const args = JSON.parse(tc.function?.arguments || tc.arguments || '{}');

            console.log(`[Agent Runner] Executing tool: ${toolName}`, { args });

            // Parse server.tool format
            const [serverName, mcpToolName] = toolName.split('.');
            if (!serverName || !mcpToolName) {
              throw new Error(`Invalid tool format: ${toolName}`);
            }

            // Call the MCP tool
            const result = await this.mcpClient.callTool(serverName, mcpToolName, args);

            // Track tool call
            allToolCalls.push({
              tool: toolName,
              arguments: args,
              result,
            });

            // Add tool result message
            messages.push({
              role: 'tool',
              content: JSON.stringify(result),
              toolCallId: toolCall.id,
            });

            console.log(`[Agent Runner] Tool ${toolName} completed successfully`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[Agent Runner] Tool call failed: ${errorMessage}`);

            // Add error as tool result
            messages.push({
              role: 'tool',
              content: JSON.stringify({ error: errorMessage }),
              toolCallId: toolCall.id,
            });
          }
        }

        // Continue loop to let LLM process tool results
        continue;
      }

      // No tool calls, LLM has finished
      finalResponse = assistantMessage.content || '';
      messages.push({
        role: 'assistant',
        content: finalResponse,
      });

      console.log(`[Agent Runner] Agent execution completed after ${iterations} iteration(s)`);
      break;
    }

    if (iterations >= maxIterations) {
      console.warn(`[Agent Runner] Agent reached max iterations (${maxIterations})`);
    }

    const durationMs = Date.now() - startTime;

    return {
      response: finalResponse,
      messages,
      toolCalls: allToolCalls,
      usage: {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
      },
      metadata: {
        provider: config.provider,
        model: config.model,
        iterations,
        durationMs,
      },
    };
  }

  /**
   * Convert MCP tools to OpenAI tool format
   */
  private convertToolsToOpenAI(tools: AgentTool[]): any[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * Get OpenAI client instance
   */
  private getOpenAIClient(): OpenAI {
    if (!this.openaiClient) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not configured');
      }
      this.openaiClient = new OpenAI({ apiKey });
    }
    return this.openaiClient;
  }

  /**
   * Load tools from MCP servers
   * @param serverNames - Names of MCP servers to load tools from (or all if not specified)
   * @returns Array of agent tools
   */
  async loadToolsFromMCP(serverNames?: string[]): Promise<AgentTool[]> {
    const servers = serverNames || this.mcpClient.getServers().map((s) => s.name);
    const allTools: AgentTool[] = [];

    for (const serverName of servers) {
      try {
        const mcpTools = await this.mcpClient.listTools(serverName);
        
        // Convert MCP tools to agent tools with server prefix
        const agentTools = mcpTools.map((tool: MCPTool) => ({
          name: `${serverName}.${tool.name}`,
          description: `[${serverName}] ${tool.description}`,
          inputSchema: tool.inputSchema,
        }));

        allTools.push(...agentTools);
      } catch (error) {
        console.error(`[Agent Runner] Failed to load tools from ${serverName}`, error);
      }
    }

    console.log(`[Agent Runner] Loaded ${allTools.length} tools from ${servers.length} MCP server(s)`);

    return allTools;
  }
}

/**
 * Create a singleton instance of AgentRunner
 */
let agentRunnerInstance: AgentRunner | null = null;

/**
 * Get or create the singleton AgentRunner instance
 */
export function getAgentRunner(): AgentRunner {
  if (!agentRunnerInstance) {
    agentRunnerInstance = new AgentRunner();
  }
  return agentRunnerInstance;
}
