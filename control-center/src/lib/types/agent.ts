/**
 * Agent Runner Type Definitions
 * 
 * Defines types for LLM-based agent execution with MCP tool integration.
 */

/**
 * LLM Provider type
 */
export type LLMProvider = 'openai' | 'anthropic' | 'bedrock' | 'deepseek';

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** LLM provider to use */
  provider: LLMProvider;
  
  /** Model identifier (e.g., "gpt-4o-mini", "claude-3-5-sonnet") */
  model: string;
  
  /** System prompt for the agent */
  systemPrompt?: string;
  
  /** Temperature for LLM sampling (0.0 to 2.0) */
  temperature?: number;
  
  /** Maximum tokens to generate */
  maxTokens?: number;
  
  /** Maximum number of tool call iterations */
  maxIterations?: number;
  
  /** Enable verbose debug logging */
  debugMode?: boolean;
}

/**
 * Agent tool definition (wraps MCP tools for LLM)
 */
export interface AgentTool {
  /** Tool name (format: "server.tool") */
  name: string;
  
  /** Tool description for LLM */
  description: string;
  
  /** Input schema in JSON Schema format */
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Agent message in conversation
 */
export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: AgentToolCall[];
  toolCallId?: string;
}

/**
 * Agent tool call
 */
export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

/**
 * Agent execution result
 */
export interface AgentExecutionResult {
  /** Final response from the agent */
  response: string;
  
  /** All messages in the conversation */
  messages: AgentMessage[];
  
  /** All tool calls made during execution */
  toolCalls: Array<{
    tool: string;
    arguments: Record<string, any>;
    result: any;
  }>;
  
  /** Token usage statistics */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  
  /** Execution metadata */
  metadata: {
    provider: LLMProvider;
    model: string;
    iterations: number;
    durationMs: number;
  };
}

/**
 * Agent execution context
 */
export interface AgentContext {
  /** User prompt/request */
  prompt: string;
  
  /** Available tools for the agent */
  tools: AgentTool[];
  
  /** Additional context variables */
  variables?: Record<string, any>;
}
