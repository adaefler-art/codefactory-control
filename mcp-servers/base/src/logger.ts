/**
 * Structured Logger for AFU-9 MCP Servers
 * 
 * Provides structured logging with context for better observability in CloudWatch.
 * All logs include timestamp, log level, service name, and optional context.
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
  requestId?: string;
  tool?: string;
  method?: string;
  userId?: string;
  duration?: number;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
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
 * Structured logger for MCP servers
 * 
 * Usage:
 * ```typescript
 * const logger = new MCPLogger('mcp-github');
 * 
 * logger.info('Processing request', { requestId: 'req-123', tool: 'getIssue' });
 * logger.error('Failed to fetch issue', error, { requestId: 'req-123', issueNumber: 42 });
 * ```
 */
export class MCPLogger {
  private serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
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
      service: this.serviceName,
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
      service: this.serviceName,
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
