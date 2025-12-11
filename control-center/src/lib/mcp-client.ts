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
  },
  {
    name: 'deploy',
    endpoint: process.env.MCP_DEPLOY_ENDPOINT || 'http://localhost:3002',
    enabled: true,
    healthCheckUrl: 'http://localhost:3002/health',
  },
  {
    name: 'observability',
    endpoint: process.env.MCP_OBSERVABILITY_ENDPOINT || 'http://localhost:3003',
    enabled: true,
    healthCheckUrl: 'http://localhost:3003/health',
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
   * @returns Tool execution result
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<any> {
    const server = this.servers.get(serverName);
    
    if (!server) {
      throw new Error(`MCP server not found: ${serverName}`);
    }
    
    if (!server.enabled) {
      throw new Error(`MCP server is disabled: ${serverName}`);
    }

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
    });

    try {
      const response = await fetch(server.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(
          `MCP server returned error status: ${response.status} ${response.statusText}`
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
      console.error(`[MCP Client] Error calling tool`, {
        serverName,
        toolName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * List available tools on an MCP server
   * @param serverName - Name of the MCP server
   * @returns Array of available tools
   */
  async listTools(serverName: string): Promise<MCPTool[]> {
    const server = this.servers.get(serverName);
    
    if (!server) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    const requestId = `req-${++this.requestIdCounter}-${Date.now()}`;
    
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/list',
      params: {},
    };

    try {
      const response = await fetch(server.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

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
   * @returns Health status
   */
  async checkHealth(serverName: string): Promise<MCPServerHealth> {
    const server = this.servers.get(serverName);
    
    if (!server) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    const healthUrl = server.healthCheckUrl || `${server.endpoint}/health`;

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
      });

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
