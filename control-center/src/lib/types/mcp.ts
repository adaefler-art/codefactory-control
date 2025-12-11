/**
 * MCP (Model Context Protocol) Type Definitions
 * 
 * Defines types for JSON-RPC 2.0 communication with MCP servers.
 */

/**
 * JSON-RPC 2.0 Request
 */
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

/**
 * JSON-RPC 2.0 Response
 */
export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: JSONRPCError;
}

/**
 * JSON-RPC 2.0 Error
 */
export interface JSONRPCError {
  code: number;
  message: string;
  data?: any;
}

/**
 * MCP Tool Definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * MCP Server Configuration
 */
export interface MCPServerConfig {
  name: string;
  endpoint: string;
  enabled: boolean;
  healthCheckUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  backoffMultiplier?: number;
}

/**
 * MCP Tool Call Request
 */
export interface MCPToolCallRequest {
  tool: string;
  arguments: Record<string, any>;
}

/**
 * MCP Tool Call Result
 */
export interface MCPToolCallResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
}

/**
 * MCP Server Health Status
 */
export interface MCPServerHealth {
  status: 'ok' | 'error';
  server: string;
  timestamp: string;
  error?: string;
}

/**
 * MCP Client Options for tool calls
 */
export interface MCPCallOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  backoffMultiplier?: number;
}
