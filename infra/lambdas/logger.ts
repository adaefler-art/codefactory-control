/**
 * Structured Logger for AFU-9 Lambda Functions
 * 
 * Provides structured logging with context for better observability in CloudWatch.
 * All logs include timestamp, log level, function name, and optional context.
 * 
 * Log Levels:
 * - DEBUG: Detailed diagnostic information (disabled in production)
 * - INFO: General informational messages about operations
 * - WARN: Warning messages for potentially harmful situations
 * - ERROR: Error events that might still allow the application to continue
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// Cache production check for performance
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export interface LogContext {
  executionArn?: string;
  requestId?: string;
  issueNumber?: number | string;
  repo?: string;
  branch?: string;
  githubRunId?: string;
  workflowId?: string;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  function: string;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

/**
 * Structured logger for Lambda functions
 * 
 * Usage:
 * ```typescript
 * const logger = new LambdaLogger('afu9-orchestrator');
 * 
 * logger.info('Starting workflow execution', { executionArn: 'arn:...', issueNumber: 42 });
 * logger.error('Failed to start state machine', error, { repo: 'owner/repo' });
 * ```
 */
export class LambdaLogger {
  private functionName: string;

  constructor(functionName: string) {
    this.functionName = functionName;
  }

  /**
   * Log debug information (development only)
   * Automatically skipped in production to reduce log volume
   */
  debug(message: string, context?: LogContext): void {
    if (IS_PRODUCTION) {
      return; // Skip debug logs in production
    }
    this.log('DEBUG', message, context);
  }

  /**
   * Log informational messages
   * Use for normal operations and successful completions
   */
  info(message: string, context?: LogContext): void {
    this.log('INFO', message, context);
  }

  /**
   * Log warnings
   * Use for potentially harmful situations that don't prevent operation
   */
  warn(message: string, context?: LogContext): void {
    this.log('WARN', message, context);
  }

  /**
   * Log errors with optional error object
   * Use for error events that may still allow the application to continue
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      function: this.functionName,
      message,
      context,
    };

    if (error) {
      if (error instanceof Error) {
        logEntry.error = {
          name: error.name,
          message: error.message,
          stack: IS_PRODUCTION ? undefined : error.stack, // Omit stack in production for brevity
          code: (error as any).code,
        };
      } else {
        logEntry.error = {
          name: 'UnknownError',
          message: String(error),
        };
      }
    }

    console.error(JSON.stringify(logEntry));
  }

  /**
   * Log message with custom level
   */
  private log(level: LogLevel, message: string, context?: LogContext): void {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      function: this.functionName,
      message,
      context,
    };

    // Use appropriate console method based on level
    const logMethod = level === 'ERROR' 
      ? console.error 
      : level === 'WARN' 
      ? console.warn 
      : console.log;

    logMethod(JSON.stringify(logEntry));
  }
}
