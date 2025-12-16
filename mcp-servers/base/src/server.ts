import express, { Request, Response } from 'express';
import { MCPLogger } from './logger';

/**
 * Base MCP Server implementation
 * 
 * Provides common functionality for all MCP servers following the JSON-RPC 2.0 protocol
 * Implements standardized health and readiness endpoints according to Control Plane Spec v1
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

export interface DependencyCheck {
  status: 'ok' | 'warning' | 'error' | 'not_configured';
  message?: string;
  latency_ms?: number;
}

export interface ReadinessCheckResult {
  ready: boolean;
  service: string;
  version: string;
  timestamp: string;
  checks: Record<string, DependencyCheck>;
  dependencies: {
    required: string[];
    optional: string[];
  };
  errors?: string[];
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
  protected version: string;
  protected logger: MCPLogger;

  constructor(protected port: number, serverName: string, version: string = '0.2.0') {
    this.serverName = serverName;
    this.version = version;
    this.logger = new MCPLogger(serverName);
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

  /**
   * Perform dependency checks for readiness probe
   * To be implemented by subclasses to check service-specific dependencies
   * 
   * @returns Map of dependency name to check result
   */
  protected async checkDependencies(): Promise<Map<string, DependencyCheck>> {
    // Base implementation - subclasses should override
    return new Map([
      ['service', { status: 'ok' }]
    ]);
  }

  /**
   * Get list of required dependencies
   * To be overridden by subclasses
   */
  protected getRequiredDependencies(): string[] {
    return [];
  }

  /**
   * Get list of optional dependencies
   * To be overridden by subclasses
   */
  protected getOptionalDependencies(): string[] {
    return [];
  }

  private setupRoutes() {
    this.app.post('/', async (req: Request, res: Response) => {
      const request = req.body as JSONRPCRequest;
      const { jsonrpc, id, method, params } = request;
      // Generate a more unique request ID using timestamp and crypto-based randomness
      const randomPart = Math.random().toString(36).substring(2, 11);
      const requestId = `req-${Date.now()}-${randomPart}`;

      this.logger.debug('Received JSON-RPC request', { requestId, method });

      // Validate JSON-RPC version
      if (jsonrpc !== '2.0') {
        this.logger.warn('Invalid JSON-RPC version', { requestId, jsonrpc });
        return this.sendError(res, id, -32600, 'Invalid JSON-RPC version');
      }

      const startTime = Date.now();

      try {
        switch (method) {
          case 'health':
            this.logger.debug('Health check', { requestId });
            return this.sendResult(res, id, {
              status: 'ok',
              server: this.serverName,
              timestamp: new Date().toISOString(),
            });

          case 'tools/list':
            this.logger.debug('List tools', { requestId });
            return this.sendResult(res, id, {
              tools: Array.from(this.tools.values()),
            });

          case 'tools/call':
            const { tool, arguments: args } = params;
            
            if (!this.tools.has(tool)) {
              this.logger.warn('Tool not found', { requestId, tool });
              return this.sendError(res, id, -32601, `Tool not found: ${tool}`);
            }

            this.logger.info('Executing tool', { requestId, tool });
            const result = await this.handleToolCall(tool, args || {});
            const duration = Date.now() - startTime;
            
            this.logger.info('Tool execution completed', { 
              requestId, 
              tool, 
              duration 
            });

            return this.sendResult(res, id, {
              content: [{ type: 'text', text: JSON.stringify(result) }],
            });

          default:
            this.logger.warn('Method not found', { requestId, method });
            return this.sendError(res, id, -32601, `Method not found: ${method}`);
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        this.logger.error('Error handling request', error, { 
          requestId, 
          method,
          duration 
        });
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
    // Simple liveness probe - responds quickly without dependency checks
    this.app.get('/health', (req: Request, res: Response) => {
      this.logger.debug('Health check endpoint accessed');
      res.json({
        status: 'ok',
        service: this.serverName,
        version: this.version,
        timestamp: new Date().toISOString(),
      });
    });

    // Readiness check endpoint (non-JSON-RPC)
    // Comprehensive readiness probe - checks all dependencies
    this.app.get('/ready', async (req: Request, res: Response) => {
      const startTime = Date.now();
      this.logger.debug('Readiness check endpoint accessed');

      try {
        // Perform all dependency checks with timeout
        const checksPromise = this.checkDependencies();
        const timeoutPromise = new Promise<Map<string, DependencyCheck>>((_, reject) => {
          setTimeout(() => reject(new Error('Readiness check timeout')), 5000);
        });

        const checks = await Promise.race([checksPromise, timeoutPromise]);
        const checksObj: Record<string, DependencyCheck> = {};
        const errors: string[] = [];

        // Convert Map to object and collect errors
        checks.forEach((check, name) => {
          checksObj[name] = check;
          if (check.status === 'error') {
            errors.push(`${name} check failed: ${check.message || 'unknown error'}`);
          }
        });

        const duration = Date.now() - startTime;

        // Determine if service is ready
        // Service is ready if all required dependencies are ok or warning
        const requiredDeps = this.getRequiredDependencies();
        const hasFailedRequiredDeps = requiredDeps.some(dep => {
          const check = checksObj[dep];
          return check && check.status === 'error';
        });

        const result: ReadinessCheckResult = {
          ready: !hasFailedRequiredDeps,
          service: this.serverName,
          version: this.version,
          timestamp: new Date().toISOString(),
          checks: checksObj,
          dependencies: {
            required: requiredDeps,
            optional: this.getOptionalDependencies(),
          },
        };

        if (errors.length > 0) {
          result.errors = errors;
        }

        const statusCode = result.ready ? 200 : 503;

        this.logger.info('Readiness check completed', {
          ready: result.ready,
          duration_ms: duration,
          failed_checks: errors.length,
        });

        res.status(statusCode).json(result);
      } catch (error) {
        const duration = Date.now() - startTime;
        this.logger.error('Readiness check failed', error, { duration_ms: duration });

        res.status(503).json({
          ready: false,
          service: this.serverName,
          version: this.version,
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
          checks: {
            service: { status: 'error', message: 'Readiness check exception' }
          },
          dependencies: {
            required: this.getRequiredDependencies(),
            optional: this.getOptionalDependencies(),
          },
        });
      }
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
      this.logger.info('MCP Server started', { 
        port: this.port,
        tools: Array.from(this.tools.keys()),
        environment: process.env.NODE_ENV || 'development'
      });
    });
  }
}
