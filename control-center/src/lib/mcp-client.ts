/**
 * MCP Client Layer
 * 
 * Handles communication with MCP servers using JSON-RPC 2.0 protocol.
 * Provides a unified interface for calling tools across multiple MCP servers.
 */

import {
  JSONRPCRequest,
  JSONRPCResponse,
  MCPServerConfig,
  MCPToolCallRequest,
  MCPToolCallResult,
  MCPTool,
  MCPServerHealth,
  MCPCallOptions,
} from './types/mcp';

/**
 * Default MCP server configurations
 */
const DEFAULT_SERVERS: MCPServerConfig[] = [
  {
    name: 'github',
    endpoint: process.env.MCP_GITHUB_ENDPOINT || 'http://localhost:3001',
    enabled: true,
    healthCheckUrl: 'http://localhost:3001/health',
    timeoutMs: 30000, // 30 seconds
    maxRetries: 2,
    retryDelayMs: 1000, // 1 second
    backoffMultiplier: 2,
  },
  {
    name: 'deploy',
    endpoint: process.env.MCP_DEPLOY_ENDPOINT || 'http://localhost:3002',
    enabled: true,
    healthCheckUrl: 'http://localhost:3002/health',
    timeoutMs: 60000, // 60 seconds for deployments
    maxRetries: 2,
    retryDelayMs: 1000,
    backoffMultiplier: 2,
  },
  {
    name: 'observability',
    endpoint: process.env.MCP_OBSERVABILITY_ENDPOINT || 'http://localhost:3003',
    enabled: true,
    healthCheckUrl: 'http://localhost:3003/health',
    timeoutMs: 30000,
    maxRetries: 2,
    retryDelayMs: 1000,
    backoffMultiplier: 2,
  },
];

/**
 * MCP Client for communicating with MCP servers
 */
export class MCPClient {
  private servers: Map<string, MCPServerConfig>;
  private requestIdCounter = 0;

  constructor(servers?: MCPServerConfig[]) {
    this.servers = new Map();
    const serversToUse = servers || DEFAULT_SERVERS;
    
    for (const server of serversToUse) {
      this.servers.set(server.name, server);
    }
  }

  /**
   * Call a tool on an MCP server
   * @param serverName - Name of the MCP server (e.g., "github")
   * @param toolName - Name of the tool to call (e.g., "getIssue")
   * @param args - Arguments for the tool
   * @param options - Optional call options (timeout, retries, etc.)
   * @returns Tool execution result
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, any>,
    options?: MCPCallOptions
  ): Promise<any> {
    const server = this.servers.get(serverName);
    
    if (!server) {
      throw new Error(`MCP server not found: ${serverName}`);
    }
    
    if (!server.enabled) {
      throw new Error(`MCP server is disabled: ${serverName}`);
    }

    // Merge options with server defaults
    const timeoutMs = options?.timeoutMs ?? server.timeoutMs ?? 30000;
    const maxRetries = options?.maxRetries ?? server.maxRetries ?? 2;
    const retryDelayMs = options?.retryDelayMs ?? server.retryDelayMs ?? 1000;
    const backoffMultiplier = options?.backoffMultiplier ?? server.backoffMultiplier ?? 2;

    const requestId = `req-${++this.requestIdCounter}-${Date.now()}`;
    
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: {
        tool: toolName,
        arguments: args,
      } as MCPToolCallRequest,
    };

    console.log(`[MCP Client] Calling tool ${serverName}.${toolName}`, {
      requestId,
      args,
      timeoutMs,
      maxRetries,
    });

    // Retry loop with exponential backoff
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = retryDelayMs * Math.pow(backoffMultiplier, attempt - 1);
        console.log(
          `[MCP Client] Retrying ${serverName}.${toolName} (attempt ${attempt + 1}/${maxRetries + 1}) after ${delay}ms`
        );
        await this.sleep(delay);
      }

      try {
        return await this.executeToolCall(server, request, serverName, toolName, timeoutMs);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if error is retryable
        const isRetryable = this.isRetryableError(lastError);
        
        if (!isRetryable || attempt === maxRetries) {
          console.error(`[MCP Client] Tool call failed ${isRetryable ? 'after all retries' : '(non-retryable error)'}`, {
            serverName,
            toolName,
            attempt: attempt + 1,
            error: lastError.message,
          });
          throw lastError;
        }
        
        console.warn(`[MCP Client] Tool call failed (retryable error)`, {
          serverName,
          toolName,
          attempt: attempt + 1,
          error: lastError.message,
        });
      }
    }

    // Should not reach here, but TypeScript needs it
    throw lastError || new Error('Unknown error during tool call');
  }

  /**
   * Execute a single tool call with timeout
   */
  private async executeToolCall(
    server: MCPServerConfig,
    request: JSONRPCRequest,
    serverName: string,
    toolName: string,
    timeoutMs: number
  ): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(server.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read error body');
        throw new Error(
          `MCP server returned HTTP ${response.status} ${response.statusText}: ${errorBody}`
        );
      }

      const jsonResponse: JSONRPCResponse = await response.json();

      if (jsonResponse.error) {
        console.error(`[MCP Client] Tool call failed`, {
          serverName,
          toolName,
          error: jsonResponse.error,
        });
        throw new Error(
          `MCP tool call failed: ${jsonResponse.error.message}`,
          { cause: jsonResponse.error }
        );
      }

      if (!jsonResponse.result) {
        throw new Error('MCP server returned no result');
      }

      // Extract the actual result from the MCP response format
      const result = jsonResponse.result as MCPToolCallResult;
      
      if (result.content && result.content.length > 0) {
        const textContent = result.content[0].text;
        try {
          // Try to parse JSON if the result is a JSON string
          return JSON.parse(textContent);
        } catch {
          // Return as string if not JSON
          return textContent;
        }
      }

      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Handle abort (timeout) specially
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`MCP tool call timed out after ${timeoutMs}ms`);
      }
      
      throw error;
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    // Network errors and timeouts are retryable
    if (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('fetch failed')
    ) {
      return true;
    }
    
    // HTTP 5xx errors are retryable
    if (message.includes('http 5')) {
      return true;
    }
    
    // HTTP 429 (rate limit) is retryable
    if (message.includes('http 429')) {
      return true;
    }
    
    // Other errors (4xx, invalid params, etc.) are not retryable
    return false;
  }

  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * List available tools on an MCP server
   * @param serverName - Name of the MCP server
   * @param options - Optional call options (timeout)
   * @returns Array of available tools
   */
  async listTools(serverName: string, options?: MCPCallOptions): Promise<MCPTool[]> {
    const server = this.servers.get(serverName);
    
    if (!server) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    const timeoutMs = options?.timeoutMs ?? server.timeoutMs ?? 30000;

    const requestId = `req-${++this.requestIdCounter}-${Date.now()}`;
    
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/list',
      params: {},
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(server.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `MCP server returned error status: ${response.status} ${response.statusText}`
        );
      }

      const jsonResponse: JSONRPCResponse = await response.json();

      if (jsonResponse.error) {
        throw new Error(
          `Failed to list tools: ${jsonResponse.error.message}`
        );
      }

      return jsonResponse.result?.tools || [];
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`List tools request timed out after ${timeoutMs}ms`);
      }
      
      console.error(`[MCP Client] Error listing tools`, {
        serverName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check health of an MCP server
   * @param serverName - Name of the MCP server
   * @param options - Optional call options (timeout)
   * @returns Health status
   */
  async checkHealth(serverName: string, options?: MCPCallOptions): Promise<MCPServerHealth> {
    const server = this.servers.get(serverName);
    
    if (!server) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    const timeoutMs = options?.timeoutMs ?? server.timeoutMs ?? 10000; // 10s default for health checks
    const healthUrl = server.healthCheckUrl || `${server.endpoint}/health`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          status: 'error',
          server: serverName,
          timestamp: new Date().toISOString(),
          error: `Health check failed with status ${response.status}`,
        };
      }

      const health = await response.json();
      
      return {
        status: 'ok',
        server: serverName,
        timestamp: health.timestamp || new Date().toISOString(),
      };
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          status: 'error',
          server: serverName,
          timestamp: new Date().toISOString(),
          error: `Health check timed out after ${timeoutMs}ms`,
        };
      }
      
      return {
        status: 'error',
        server: serverName,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check health of all configured MCP servers
   * @returns Map of server names to health status
   */
  async checkAllHealth(): Promise<Map<string, MCPServerHealth>> {
    const healthChecks = new Map<string, MCPServerHealth>();
    
    const promises = Array.from(this.servers.keys()).map(async (serverName) => {
      const health = await this.checkHealth(serverName);
      healthChecks.set(serverName, health);
    });

    await Promise.all(promises);
    
    return healthChecks;
  }

  /**
   * Get all configured servers
   * @returns Array of server configurations
   */
  getServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  /**
   * Add or update a server configuration
   * @param config - Server configuration
   */
  setServer(config: MCPServerConfig): void {
    this.servers.set(config.name, config);
  }

  /**
   * Remove a server configuration
   * @param serverName - Name of the server to remove
   */
  removeServer(serverName: string): void {
    this.servers.delete(serverName);
  }
}

/**
 * Create a singleton instance of MCPClient
 */
let mcpClientInstance: MCPClient | null = null;

/**
 * Get or create the singleton MCPClient instance
 */
export function getMCPClient(): MCPClient {
  if (!mcpClientInstance) {
    mcpClientInstance = new MCPClient();
  }
  return mcpClientInstance;
}
