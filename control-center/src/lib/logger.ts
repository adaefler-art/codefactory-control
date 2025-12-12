/**
 * Structured Logger for AFU-9 Control Center
 * 
 * Provides structured logging with context for better observability in CloudWatch.
 * All logs include timestamp, service name, and optional trace context.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  workflowId?: string;
  executionId?: string;
  stepId?: string;
  agentRunId?: string;
  mcpServer?: string;
  mcpTool?: string;
  userId?: string;
  requestId?: string;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  component?: string;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  durationMs?: number;
}

class Logger {
  private serviceName: string;

  constructor(serviceName: string = 'control-center') {
    this.serviceName = serviceName;
  }

  /**
   * Log debug information (development only)
   */
  debug(message: string, context?: LogContext, component?: string): void {
    if (process.env.NODE_ENV === 'production') {
      return; // Skip debug logs in production
    }
    this.log('debug', message, context, component);
  }

  /**
   * Log informational messages
   */
  info(message: string, context?: LogContext, component?: string): void {
    this.log('info', message, context, component);
  }

  /**
   * Log warnings
   */
  warn(message: string, context?: LogContext, component?: string): void {
    this.log('warn', message, context, component);
  }

  /**
   * Log errors with full stack trace
   */
  error(message: string, error?: Error, context?: LogContext, component?: string): void {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      service: this.serviceName,
      component,
      message,
      context,
    };

    if (error) {
      logEntry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    console.error(JSON.stringify(logEntry));
  }

  /**
   * Log with execution timing
   */
  timed(
    message: string,
    durationMs: number,
    context?: LogContext,
    component?: string,
    level: LogLevel = 'info'
  ): void {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      component,
      message,
      context,
      durationMs,
    };

    const logMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logMethod(JSON.stringify(logEntry));
  }

  /**
   * Create a child logger with a component name
   */
  withComponent(component: string): ComponentLogger {
    return new ComponentLogger(this.serviceName, component);
  }

  private log(level: LogLevel, message: string, context?: LogContext, component?: string): void {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      component,
      message,
      context,
    };

    const logMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logMethod(JSON.stringify(logEntry));
  }
}

/**
 * Component-specific logger that includes component name in all logs
 */
class ComponentLogger {
  constructor(
    private serviceName: string,
    private component: string
  ) {}

  debug(message: string, context?: LogContext): void {
    if (process.env.NODE_ENV === 'production') {
      return;
    }
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error, context?: LogContext): void {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      service: this.serviceName,
      component: this.component,
      message,
      context,
    };

    if (error) {
      logEntry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    console.error(JSON.stringify(logEntry));
  }

  timed(message: string, durationMs: number, context?: LogContext, level: LogLevel = 'info'): void {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      component: this.component,
      message,
      context,
      durationMs,
    };

    const logMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logMethod(JSON.stringify(logEntry));
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      component: this.component,
      message,
      context,
    };

    const logMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logMethod(JSON.stringify(logEntry));
  }
}

// Export singleton instance
export const logger = new Logger();

// Export class for testing
export { Logger };
