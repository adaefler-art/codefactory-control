import express, { Request, Response } from 'express';

/**
 * Base MCP Server implementation
 * 
 * Provides common functionality for all MCP servers following the JSON-RPC 2.0 protocol
 */

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export abstract class MCPServer {
  protected app = express();
  protected tools: Map<string, Tool> = new Map();
  protected serverName: string;

  constructor(protected port: number, serverName: string) {
    this.serverName = serverName;
    this.app.use(express.json());
    this.setupRoutes();
  }

  /**
   * Register available tools - to be implemented by subclasses
   */
  protected abstract registerTools(): void;

  /**
   * Handle tool call - to be implemented by subclasses
   */
  protected abstract handleToolCall(
    tool: string,
    args: Record<string, any>
  ): Promise<any>;

  private setupRoutes() {
    this.app.post('/', async (req: Request, res: Response) => {
      const request = req.body as JSONRPCRequest;
      const { jsonrpc, id, method, params } = request;

      // Validate JSON-RPC version
      if (jsonrpc !== '2.0') {
        return this.sendError(res, id, -32600, 'Invalid JSON-RPC version');
      }

      try {
        switch (method) {
          case 'health':
            return this.sendResult(res, id, {
              status: 'ok',
              server: this.serverName,
              timestamp: new Date().toISOString(),
            });

          case 'tools/list':
            return this.sendResult(res, id, {
              tools: Array.from(this.tools.values()),
            });

          case 'tools/call':
            const { tool, arguments: args } = params;
            
            if (!this.tools.has(tool)) {
              return this.sendError(res, id, -32601, `Tool not found: ${tool}`);
            }

            const result = await this.handleToolCall(tool, args || {});
            return this.sendResult(res, id, {
              content: [{ type: 'text', text: JSON.stringify(result) }],
            });

          default:
            return this.sendError(res, id, -32601, `Method not found: ${method}`);
        }
      } catch (error) {
        console.error(`[${this.serverName}] Error handling request:`, error);
        return this.sendError(
          res,
          id,
          -32000,
          error instanceof Error ? error.message : 'Unknown error',
          error instanceof Error ? { stack: error.stack } : undefined
        );
      }
    });

    // Health check endpoint (non-JSON-RPC)
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'ok',
        server: this.serverName,
        timestamp: new Date().toISOString(),
      });
    });
  }

  private sendResult(res: Response, id: string | number, result: any) {
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };
    res.json(response);
  }

  private sendError(
    res: Response,
    id: string | number,
    code: number,
    message: string,
    data?: any
  ) {
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        ...(data && { data }),
      },
    };
    res.status(200).json(response); // JSON-RPC errors use 200 status
  }

  start() {
    this.registerTools();
    this.app.listen(this.port, '0.0.0.0', () => {
      console.log(`[${this.serverName}] MCP Server listening on port ${this.port}`);
      console.log(`[${this.serverName}] Available tools: ${Array.from(this.tools.keys()).join(', ')}`);
    });
  }
}
