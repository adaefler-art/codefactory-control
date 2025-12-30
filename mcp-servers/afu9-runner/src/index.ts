import { MCPServer, Tool, DependencyCheck } from '@afu9/mcp-base/src/server';
import { DummyExecutorAdapter, ExecutorAdapter } from './adapters/executor';
import { DatabaseExecutorAdapter } from './adapters/database-executor';
import { PlaybookManager } from './adapters/playbook-manager';
import { 
  RunSpec, 
  RunSpecSchema, 
  RunResult,
  Playbook,
} from './contracts/schemas';
import { ZodError } from 'zod';
import { Pool } from 'pg';

/**
 * AFU-9 Runner MCP Server (I631 + I632)
 * 
 * Provides MCP tools for run management and playbook execution:
 * - run.create: Create a new run from RunSpec
 * - run.execute: Execute a created run
 * - run.status: Get current status of a run
 * - run.read: Read full results of a run
 * - playbook.list: List available playbooks
 * - playbook.get: Get a specific playbook
 * 
 * I631: Strict contracts with Zod validation, DummyExecutorAdapter (in-memory)
 * I632: DatabaseExecutorAdapter with PostgreSQL persistence (runs ledger)
 */
export class AFU9RunnerMCPServer extends MCPServer {
  private executor: ExecutorAdapter;
  private playbookManager: PlaybookManager;
  private pool?: Pool;

  constructor(port: number = 3002, useDatabase: boolean = false, pool?: Pool) {
    super(port, 'afu9-runner', '0.1.0');
    
    // Initialize executor based on mode
    if (useDatabase && pool) {
      this.executor = new DatabaseExecutorAdapter(pool);
      this.pool = pool;
    } else {
      this.executor = new DummyExecutorAdapter();
    }
    
    this.playbookManager = new PlaybookManager();
  }

  /**
   * Check dependencies for readiness probe
   */
  protected async checkDependencies(): Promise<Map<string, DependencyCheck>> {
    const checks = new Map<string, DependencyCheck>();

    // Check 1: Service is running
    checks.set('service', { status: 'ok' });

    // Check 2: Database connection (if using database mode)
    if (this.pool) {
      try {
        const client = await this.pool.connect();
        await client.query('SELECT 1');
        client.release();
        checks.set('database', { status: 'ok', message: 'Database connected' });
      } catch (error) {
        checks.set('database', { 
          status: 'error',
          message: error instanceof Error ? error.message : 'Database connection failed',
        });
      }
    }

    // Check 3: Executor adapter is ready
    checks.set('executor', { 
      status: 'ok',
      message: `Using ${this.executor.runtime} runtime ${this.pool ? '(database-backed)' : '(in-memory)'}`,
    });

    // Check 4: Playbook manager is ready
    try {
      const playbooks = await this.playbookManager.listPlaybooks();
      checks.set('playbooks', { 
        status: 'ok',
        message: `${playbooks.length} playbooks available`,
      });
    } catch (error) {
      checks.set('playbooks', { 
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return checks;
  }

  /**
   * Get required dependencies
   */
  protected getRequiredDependencies(): string[] {
    const deps = ['service', 'executor'];
    if (this.pool) {
      deps.push('database');
    }
    return deps;
  }

  /**
   * Get optional dependencies
   */
  protected getOptionalDependencies(): string[] {
    return ['playbooks'];
  }

  /**
   * Register MCP tools
   */
  protected registerTools(): void {
    // run.create
    this.tools.set('run.create', {
      name: 'run.create',
      description: 'Create a new run from a RunSpec. Returns RunResult with "created" status.',
      inputSchema: {
        type: 'object',
        properties: {
          spec: {
            type: 'object',
            description: 'Run specification conforming to RunSpec schema',
            properties: {
              runId: { type: 'string', description: 'Optional run ID (auto-generated if not provided)' },
              issueId: { type: 'string', description: 'Optional GitHub issue ID' },
              title: { type: 'string', description: 'Run title' },
              runtime: { 
                type: 'string', 
                enum: ['dummy', 'github-runner', 'ecs-task', 'ssm'],
                description: 'Execution runtime (only "dummy" supported in I631)' 
              },
              steps: {
                type: 'array',
                description: 'Array of step definitions',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    shell: { type: 'string', enum: ['pwsh', 'bash'] },
                    command: { type: 'string' },
                    cwd: { type: 'string' },
                    timeoutSec: { type: 'number' },
                    expect: { type: 'object' },
                    artifacts: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['name', 'shell', 'command'],
                },
              },
              envRefs: { type: 'object', description: 'Environment variable references' },
            },
            required: ['title', 'runtime', 'steps'],
          },
        },
        required: ['spec'],
      },
    });

    // run.execute
    this.tools.set('run.execute', {
      name: 'run.execute',
      description: 'Execute a previously created run. Returns RunResult with execution results.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run ID to execute' },
        },
        required: ['runId'],
      },
    });

    // run.status
    this.tools.set('run.status', {
      name: 'run.status',
      description: 'Get current status of a run without full results.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run ID to check' },
        },
        required: ['runId'],
      },
    });

    // run.read
    this.tools.set('run.read', {
      name: 'run.read',
      description: 'Read full results of a run including all step outputs.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string', description: 'Run ID to read' },
        },
        required: ['runId'],
      },
    });

    // playbook.list
    this.tools.set('playbook.list', {
      name: 'playbook.list',
      description: 'List all available playbooks.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    });

    // playbook.get
    this.tools.set('playbook.get', {
      name: 'playbook.get',
      description: 'Get a specific playbook by ID.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Playbook ID' },
        },
        required: ['id'],
      },
    });
  }

  /**
   * Handle tool calls with Zod validation
   */
  protected async handleToolCall(tool: string, args: Record<string, any>): Promise<any> {
    try {
      switch (tool) {
        case 'run.create':
          return await this.handleRunCreate(args as { spec: any });
        case 'run.execute':
          return await this.handleRunExecute(args as { runId: string });
        case 'run.status':
          return await this.handleRunStatus(args as { runId: string });
        case 'run.read':
          return await this.handleRunRead(args as { runId: string });
        case 'playbook.list':
          return await this.handlePlaybookList(args);
        case 'playbook.get':
          return await this.handlePlaybookGet(args as { id: string });
        default:
          throw new Error(`Unknown tool: ${tool}`);
      }
    } catch (error) {
      if (error instanceof ZodError) {
        this.logger.error('Validation error', error);
        throw new Error(`Validation error: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      throw error;
    }
  }

  /**
   * Handle run.create
   */
  private async handleRunCreate(args: { spec: any }): Promise<RunResult> {
    this.logger.info('Creating run', { hasSpec: !!args.spec });

    // Validate with Zod
    const spec = RunSpecSchema.parse(args.spec);
    
    this.logger.info('Run spec validated', { 
      title: spec.title, 
      runtime: spec.runtime,
      stepCount: spec.steps.length 
    });

    const result = await this.executor.createRun(spec);
    
    this.logger.info('Run created', { runId: result.runId, status: result.status });
    
    return result;
  }

  /**
   * Handle run.execute
   */
  private async handleRunExecute(args: { runId: string }): Promise<RunResult> {
    const { runId } = args;
    
    if (!runId) {
      throw new Error('runId is required');
    }

    this.logger.info('Executing run', { runId });

    const result = await this.executor.executeRun(runId);
    
    this.logger.info('Run executed', { 
      runId: result.runId, 
      status: result.status,
      durationMs: result.durationMs 
    });
    
    return result;
  }

  /**
   * Handle run.status
   */
  private async handleRunStatus(args: { runId: string }): Promise<RunResult> {
    const { runId } = args;
    
    if (!runId) {
      throw new Error('runId is required');
    }

    this.logger.info('Getting run status', { runId });

    const result = await this.executor.getRunStatus(runId);
    
    this.logger.info('Run status retrieved', { runId, status: result.status });
    
    return result;
  }

  /**
   * Handle run.read
   */
  private async handleRunRead(args: { runId: string }): Promise<RunResult> {
    const { runId } = args;
    
    if (!runId) {
      throw new Error('runId is required');
    }

    this.logger.info('Reading run result', { runId });

    const result = await this.executor.readRunResult(runId);
    
    this.logger.info('Run result read', { 
      runId, 
      status: result.status,
      stepCount: result.steps.length 
    });
    
    return result;
  }

  /**
   * Handle playbook.list
   */
  private async handlePlaybookList(args: Record<string, any>): Promise<{ playbooks: Playbook[] }> {
    this.logger.info('Listing playbooks');

    const playbooks = await this.playbookManager.listPlaybooks();
    
    this.logger.info('Playbooks listed', { count: playbooks.length });
    
    return { playbooks };
  }

  /**
   * Handle playbook.get
   */
  private async handlePlaybookGet(args: { id: string }): Promise<Playbook> {
    const { id } = args;
    
    if (!id) {
      throw new Error('id is required');
    }

    this.logger.info('Getting playbook', { id });

    const playbook = await this.playbookManager.getPlaybook(id);
    
    this.logger.info('Playbook retrieved', { id, name: playbook.name });
    
    return playbook;
  }
}

// Start server if run directly
if (require.main === module) {
  const port = parseInt(process.env.PORT || '3002', 10);
  const useDatabase = process.env.USE_DATABASE === 'true';
  
  let pool: Pool | undefined;
  if (useDatabase) {
    // Use strict SSL in production, configurable otherwise
    const sslConfig = process.env.DATABASE_SSL === 'true' 
      ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : undefined;
      
    pool = new Pool({
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      database: process.env.DATABASE_NAME || 'afu9',
      user: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      ssl: sslConfig,
    });

    pool.on('error', (err) => {
      console.error('[Database] Unexpected error on idle client', err);
    });

    console.log('[AFU9Runner] Starting with database-backed persistence');
  } else {
    console.log('[AFU9Runner] Starting with in-memory persistence');
  }
  
  const server = new AFU9RunnerMCPServer(port, useDatabase, pool);
  server.start();
}
