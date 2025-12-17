/**
 * Agent Runner
 * 
 * Orchestrates LLM-based agent execution with MCP tool integration.
 * Allows LLMs to dynamically call MCP tools during execution.
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { MCPClient, getMCPClient } from './mcp-client';
import {
  AgentConfig,
  AgentTool,
  AgentMessage,
  AgentExecutionResult,
  AgentContext,
} from './types/agent';
import { MCPTool } from './types/mcp';
import { logger } from './logger';
import { isDebugModeEnabled } from './debug-mode';
import { getPromptLibraryService } from './prompt-library-service';
import { PromptVersion } from './types/prompt-library';

/**
 * Agent Runner for executing LLM-based agents with tool calling
 */
export class AgentRunner {
  private mcpClient: MCPClient;
  private openaiClient: OpenAI | null = null;
  private anthropicClient: Anthropic | null = null;
  private deepseekClient: OpenAI | null = null;

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
    const debugMode = config.debugMode ?? isDebugModeEnabled();
    
    console.log(`[Agent Runner] Starting agent execution`, {
      provider: config.provider,
      model: config.model,
      toolsCount: context.tools.length,
      debugMode,
    });
    
    if (debugMode) {
      logger.debug('Agent execution starting', {
        provider: config.provider,
        model: config.model,
        prompt: context.prompt,
        tools: context.tools.map(t => t.name),
        variables: context.variables,
        config,
      }, 'AgentRunner');
    }

    // Initialize LLM client based on provider
    const provider = config.provider || 'openai';
    
    if (provider === 'openai') {
      return await this.executeOpenAI(context, config, startTime, debugMode);
    } else if (provider === 'deepseek') {
      return await this.executeDeepSeek(context, config, startTime, debugMode);
    } else if (provider === 'anthropic') {
      return await this.executeAnthropic(context, config, startTime, debugMode);
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
    startTime: number,
    debugMode: boolean = false
  ): Promise<AgentExecutionResult> {
    const client = this.getOpenAIClient();
    return await this.executeOpenAICompatible(client, context, config, startTime, debugMode);
  }

  /**
   * Execute agent using OpenAI-compatible API (OpenAI or DeepSeek)
   */
  private async executeOpenAICompatible(
    client: OpenAI,
    context: AgentContext,
    config: AgentConfig,
    startTime: number,
    debugMode: boolean = false
  ): Promise<AgentExecutionResult> {
    
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
      
      if (debugMode) {
        logger.debug('Agent iteration starting', {
          iteration: iterations,
          maxIterations,
          messagesCount: messages.length,
          toolCallsCount: allToolCalls.length,
        }, 'AgentRunner');
      }

      const completion = await client.chat.completions.create({
        model: config.model,
        messages: messages as any,
        tools: tools.length > 0 ? tools : undefined,
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens,
      });
      
      if (debugMode) {
        logger.debug('LLM response received', {
          iteration: iterations,
          model: config.model,
          usage: completion.usage,
          hasToolCalls: !!completion.choices[0]?.message.tool_calls,
        }, 'AgentRunner');
      }

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
        
        if (debugMode) {
          logger.debug('LLM requested tool calls', {
            iteration: iterations,
            toolCallsCount: assistantMessage.tool_calls.length,
            toolNames: assistantMessage.tool_calls.map(tc => (tc as any).function?.name),
          }, 'AgentRunner');
        }

        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: assistantMessage.content || '',
          toolCalls: assistantMessage.tool_calls.map((tc) => {
            // OpenAI tool calls always have the function property
            // This type assertion is safe as we're coming from OpenAI's API
            const functionCall = (tc as any).function;
            if (!functionCall) {
              throw new Error(`Invalid tool call format: missing function property`);
            }
            return {
              id: tc.id,
              name: functionCall.name,
              arguments: JSON.parse(functionCall.arguments),
            };
          }),
        });

        // Execute each tool call
        for (const toolCall of assistantMessage.tool_calls) {
          try {
            // OpenAI tool calls always have the function property
            const functionCall = (toolCall as any).function;
            if (!functionCall) {
              throw new Error(`Invalid tool call format: missing function property`);
            }
            const toolName = functionCall.name;
            const args = JSON.parse(functionCall.arguments);

            console.log(`[Agent Runner] Executing tool: ${toolName}`, { args });
            
            if (debugMode) {
              logger.debug('Executing MCP tool via agent', {
                iteration: iterations,
                toolName,
                args,
              }, 'AgentRunner');
            }

            // Parse server.tool format
            const [serverName, mcpToolName] = toolName.split('.');
            if (!serverName || !mcpToolName) {
              throw new Error(`Invalid tool format: ${toolName}`);
            }

            // Call the MCP tool
            const result = await this.mcpClient.callTool(serverName, mcpToolName, args, { debugMode });
            
            if (debugMode) {
              logger.debug('MCP tool call completed', {
                iteration: iterations,
                toolName,
                result,
              }, 'AgentRunner');
            }

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
            
            if (debugMode) {
              logger.debug('MCP tool call failed', {
                iteration: iterations,
                toolName: (toolCall as any).function?.name,
                error: errorMessage,
              }, 'AgentRunner');
            }

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
   * Convert MCP tools to Anthropic tool format
   */
  private convertToolsToAnthropic(tools: AgentTool[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  /**
   * Execute agent using DeepSeek
   */
  private async executeDeepSeek(
    context: AgentContext,
    config: AgentConfig,
    startTime: number,
    debugMode: boolean = false
  ): Promise<AgentExecutionResult> {
    const client = this.getDeepSeekClient();
    
    // DeepSeek uses the same API as OpenAI, so we can reuse the OpenAI execution logic
    return await this.executeOpenAICompatible(client, context, config, startTime, debugMode);
  }

  /**
   * Execute agent using Anthropic Claude
   */
  private async executeAnthropic(
    context: AgentContext,
    config: AgentConfig,
    startTime: number,
    debugMode: boolean = false
  ): Promise<AgentExecutionResult> {
    const client = this.getAnthropicClient();
    
    const messages: AgentMessage[] = [];
    const allToolCalls: Array<{
      tool: string;
      arguments: Record<string, any>;
      result: any;
    }> = [];

    // Convert MCP tools to Anthropic tool format
    const tools = this.convertToolsToAnthropic(context.tools);

    let iterations = 0;
    const maxIterations = config.maxIterations || 10;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalResponse = '';

    // Prepare messages - Anthropic doesn't use system in messages array
    const anthropicMessages: Anthropic.MessageParam[] = [{
      role: 'user',
      content: context.prompt,
    }];

    // Agent loop: LLM can call tools multiple times
    while (iterations < maxIterations) {
      iterations++;
      
      console.log(`[Agent Runner] Iteration ${iterations}/${maxIterations}`);
      
      if (debugMode) {
        logger.debug('Agent iteration starting (Anthropic)', {
          iteration: iterations,
          maxIterations,
          messagesCount: anthropicMessages.length,
          toolCallsCount: allToolCalls.length,
        }, 'AgentRunner');
      }

      const response = await client.messages.create({
        model: config.model,
        max_tokens: config.maxTokens || 4096,
        system: config.systemPrompt,
        messages: anthropicMessages,
        tools: tools.length > 0 ? tools : undefined,
        temperature: config.temperature || 0.7,
      });
      
      if (debugMode) {
        logger.debug('LLM response received (Anthropic)', {
          iteration: iterations,
          model: config.model,
          usage: response.usage,
          stopReason: response.stop_reason,
        }, 'AgentRunner');
      }

      // Track token usage
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      // Check if Claude wants to call tools
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      if (toolUseBlocks.length > 0) {
        console.log(`[Agent Runner] LLM requested ${toolUseBlocks.length} tool call(s)`);

        // Add assistant message with tool calls
        anthropicMessages.push({
          role: 'assistant',
          content: response.content,
        });

        // Execute each tool call
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        
        for (const toolBlock of toolUseBlocks) {
          try {
            const toolName = toolBlock.name;
            const args = toolBlock.input as Record<string, any>;

            console.log(`[Agent Runner] Executing tool: ${toolName}`, { args });

            // Parse server.tool format
            const [serverName, mcpToolName] = toolName.split('.');
            if (!serverName || !mcpToolName) {
              throw new Error(`Invalid tool format: ${toolName}`);
            }

            // Call the MCP tool
            const result = await this.mcpClient.callTool(serverName, mcpToolName, args, { debugMode });

            // Track tool call
            allToolCalls.push({
              tool: toolName,
              arguments: args,
              result,
            });

            // Add tool result
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: JSON.stringify(result),
            });

            console.log(`[Agent Runner] Tool ${toolName} completed successfully`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[Agent Runner] Tool call failed: ${errorMessage}`);

            // Add error as tool result
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: JSON.stringify({ error: errorMessage }),
              is_error: true,
            });
          }
        }

        // Add tool results message
        anthropicMessages.push({
          role: 'user',
          content: toolResults,
        });

        // Continue loop to let LLM process tool results
        continue;
      }

      // No tool calls, LLM has finished
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      finalResponse = textBlocks.map(block => block.text).join('\n');

      console.log(`[Agent Runner] Agent execution completed after ${iterations} iteration(s)`);
      break;
    }

    if (iterations >= maxIterations) {
      console.warn(`[Agent Runner] Agent reached max iterations (${maxIterations})`);
    }

    const durationMs = Date.now() - startTime;

    // Convert anthropic messages back to generic messages for result
    messages.push({
      role: 'system',
      content: config.systemPrompt || '',
    });
    messages.push({
      role: 'user',
      content: context.prompt,
    });
    messages.push({
      role: 'assistant',
      content: finalResponse,
    });

    return {
      response: finalResponse,
      messages,
      toolCalls: allToolCalls,
      usage: {
        promptTokens: totalInputTokens,
        completionTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
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
   * Get DeepSeek client instance (OpenAI-compatible)
   */
  private getDeepSeekClient(): OpenAI {
    if (!this.deepseekClient) {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        throw new Error('DEEPSEEK_API_KEY is not configured');
      }
      this.deepseekClient = new OpenAI({
        apiKey,
        baseURL: 'https://api.deepseek.com',
      });
    }
    return this.deepseekClient;
  }

  /**
   * Get Anthropic client instance
   */
  private getAnthropicClient(): Anthropic {
    if (!this.anthropicClient) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is not configured');
      }
      this.anthropicClient = new Anthropic({ apiKey });
    }
    return this.anthropicClient;
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

  /**
   * Load prompt from library by name
   * @param promptName - Name of the prompt to load
   * @param variables - Variables to substitute in the prompt template
   * @returns Context with prompt loaded from library
   */
  async loadPromptFromLibrary(
    promptName: string,
    variables?: Record<string, any>
  ): Promise<{ prompt: string; promptVersionId: string; systemPrompt?: string }> {
    try {
      const promptService = getPromptLibraryService();
      const promptWithVersion = await promptService.getPromptByName(promptName);

      if (!promptWithVersion || !promptWithVersion.currentVersion) {
        throw new Error(`Prompt not found in library: ${promptName}`);
      }

      const version = promptWithVersion.currentVersion;

      // Substitute variables in user prompt template
      let userPrompt = version.userPromptTemplate || version.content;
      if (variables && userPrompt) {
        userPrompt = this.substituteVariables(userPrompt, variables);
      }

      logger.info('Loaded prompt from library', {
        promptName,
        version: version.version,
        hasVariables: !!variables,
      }, 'AgentRunner');

      return {
        prompt: userPrompt || version.content,
        promptVersionId: version.id,
        systemPrompt: version.systemPrompt,
      };
    } catch (error) {
      logger.error(
        'Failed to load prompt from library',
        error instanceof Error ? error : new Error(String(error)),
        { promptName },
        'AgentRunner'
      );
      throw error;
    }
  }

  /**
   * Substitute variables in a template string
   * Supports ${variable} syntax
   */
  private substituteVariables(template: string, variables: Record<string, any>): string {
    return template.replace(/\$\{([^}]+)\}/g, (match, key) => {
      const value = variables[key];
      return value !== undefined ? String(value) : match;
    });
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
