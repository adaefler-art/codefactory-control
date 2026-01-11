/**
 * GitHub API Retry Policy with Rate-Limit Handling
 * 
 * Implements deterministic exponential backoff with bounded retries for GitHub API calls.
 * Handles rate-limiting (primary and secondary), network errors, and server errors.
 * 
 * Reference: E82.4 - GH Rate-limit & Retry Policy (deterministic backoff, bounded)
 */

import { z } from 'zod';

// ========================================
// Configuration Schema
// ========================================

/**
 * Retry policy configuration
 */
export const RetryPolicyConfigSchema = z.object({
  maxRetries: z.number().int().min(0).max(10).default(3),
  initialDelayMs: z.number().int().min(100).max(10000).default(1000),
  maxDelayMs: z.number().int().min(1000).max(300000).default(32000),
  backoffMultiplier: z.number().min(1).max(5).default(2),
  jitterFactor: z.number().min(0).max(1).default(0.25),
  // HTTP method for idempotency checks
  httpMethod: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  // Opt-in for non-idempotent operations
  allowNonIdempotentRetry: z.boolean().default(false),
  // Context for deterministic jitter
  requestId: z.string().optional(),
  endpoint: z.string().optional(),
}).strict();

export type RetryPolicyConfig = z.infer<typeof RetryPolicyConfigSchema>;

/**
 * Default retry policy configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryPolicyConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 32000,
  backoffMultiplier: 2,
  jitterFactor: 0.25,
  httpMethod: 'GET',
  allowNonIdempotentRetry: false,
};

// ========================================
// Error Classification
// ========================================

/**
 * Error types for retry decisions
 */
export enum ErrorType {
  RATE_LIMIT_PRIMARY = 'RATE_LIMIT_PRIMARY',
  RATE_LIMIT_SECONDARY = 'RATE_LIMIT_SECONDARY',
  SERVER_ERROR = 'SERVER_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  CLIENT_ERROR = 'CLIENT_ERROR',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Retry decision
 */
export interface RetryDecision {
  shouldRetry: boolean;
  errorType: ErrorType;
  delayMs?: number;
  reason: string;
}

/**
 * Rate limit information from GitHub headers
 */
export interface RateLimitInfo {
  remaining: number;
  limit: number;
  reset: number; // Unix timestamp
  retryAfter?: number; // Seconds to wait
}

// ========================================
// Error Classification
// ========================================

/**
 * Classify error for retry decision
 */
export function classifyError(error: unknown): ErrorType {
  if (!(error instanceof Error)) {
    return ErrorType.UNKNOWN;
  }

  const message = error.message.toLowerCase();
  
  // Check for rate limit errors
  if (message.includes('rate limit') || message.includes('x-ratelimit-remaining')) {
    if (message.includes('secondary')) {
      return ErrorType.RATE_LIMIT_SECONDARY;
    }
    return ErrorType.RATE_LIMIT_PRIMARY;
  }
  
  // Check for HTTP status codes in error message
  if (message.includes('http 429') || message.includes('status 429')) {
    return ErrorType.RATE_LIMIT_PRIMARY;
  }
  
  if (message.includes('http 403') && message.includes('abuse')) {
    return ErrorType.RATE_LIMIT_SECONDARY;
  }
  
  if (
    message.includes('http 500') ||
    message.includes('http 502') ||
    message.includes('http 503') ||
    message.includes('http 504') ||
    message.includes('status 5')
  ) {
    return ErrorType.SERVER_ERROR;
  }
  
  // Network errors
  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('fetch failed')
  ) {
    return ErrorType.NETWORK_ERROR;
  }
  
  // Client errors (4xx except 429)
  if (
    message.includes('http 400') ||
    message.includes('http 401') ||
    message.includes('http 403') ||
    message.includes('http 404') ||
    message.includes('status 4')
  ) {
    return ErrorType.CLIENT_ERROR;
  }
  
  return ErrorType.UNKNOWN;
}

/**
 * Extract rate limit info from error or headers
 */
export function extractRateLimitInfo(error: unknown, headers?: Headers): RateLimitInfo | null {
  if (headers) {
    const remaining = headers.get('x-ratelimit-remaining');
    const limit = headers.get('x-ratelimit-limit');
    const reset = headers.get('x-ratelimit-reset');
    const retryAfter = headers.get('retry-after');
    
    if (remaining !== null && limit !== null && reset !== null) {
      return {
        remaining: parseInt(remaining, 10),
        limit: parseInt(limit, 10),
        reset: parseInt(reset, 10),
        retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
      };
    }
  }
  
  // Try to extract from error message
  if (error instanceof Error) {
    const message = error.message;
    const retryAfterMatch = message.match(/retry after (\d+)/i);
    if (retryAfterMatch) {
      return {
        remaining: 0,
        limit: 5000, // Default GitHub limit
        reset: Math.floor(Date.now() / 1000) + parseInt(retryAfterMatch[1], 10),
        retryAfter: parseInt(retryAfterMatch[1], 10),
      };
    }
  }
  
  return null;
}

// ========================================
// Backoff Calculation
// ========================================

/**
 * Deterministic pseudo-random number generator using seed
 * Uses simple LCG (Linear Congruential Generator) algorithm
 */
function seededRandom(seed: number): number {
  // LCG parameters (from Numerical Recipes)
  const a = 1664525;
  const c = 1013904223;
  const m = Math.pow(2, 32);
  
  const next = (a * seed + c) % m;
  return next / m;
}

/**
 * Create a deterministic seed from context
 */
function createSeed(requestId: string | undefined, attempt: number, endpoint: string | undefined): number {
  const str = `${requestId || 'default'}-${attempt}-${endpoint || 'unknown'}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Calculate exponential backoff delay with deterministic jitter
 * 
 * Formula: min(maxDelay, initialDelay * (backoffMultiplier ^ attempt)) ± jitter
 * 
 * Jitter is deterministic based on requestId, attempt, and endpoint to ensure
 * reproducible behavior for the same request context.
 * 
 * @param attempt - Retry attempt number (0-indexed)
 * @param config - Retry policy configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoff(attempt: number, config: RetryPolicyConfig): number {
  const { initialDelayMs, maxDelayMs, backoffMultiplier, jitterFactor, requestId, endpoint } = config;
  
  // Calculate base delay with exponential backoff
  const baseDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt);
  
  // Cap at max delay
  const cappedDelay = Math.min(baseDelay, maxDelayMs);
  
  // Add deterministic jitter (±jitterFactor%)
  const jitterRange = cappedDelay * jitterFactor;
  const seed = createSeed(requestId, attempt, endpoint);
  const randomValue = seededRandom(seed);
  const jitter = (randomValue * 2 - 1) * jitterRange;
  
  // Ensure positive delay
  return Math.max(0, Math.floor(cappedDelay + jitter));
}

/**
 * Calculate delay for rate limit with reset time
 * 
 * Priority order:
 * 1. Retry-After header (highest priority, required by HTTP spec)
 * 2. X-RateLimit-Reset header
 * 3. Fallback to calculated delay
 * 
 * @param resetTimestamp - Unix timestamp when rate limit resets
 * @param retryAfter - Optional retry-after header value (seconds) - HIGHEST PRIORITY
 * @param maxDelayMs - Maximum delay to enforce
 * @returns Delay in milliseconds
 */
export function calculateRateLimitDelay(
  resetTimestamp: number,
  retryAfter: number | undefined,
  maxDelayMs: number
): number {
  // Priority 1: Retry-After header (RFC 7231 compliant)
  if (retryAfter !== undefined && retryAfter > 0) {
    const delayMs = retryAfter * 1000;
    return Math.min(delayMs, maxDelayMs);
  }
  
  // Priority 2: Calculate from reset timestamp
  const now = Math.floor(Date.now() / 1000);
  const delaySeconds = Math.max(0, resetTimestamp - now);
  const delayMs = delaySeconds * 1000;
  
  // Add 1 second buffer to ensure rate limit has reset
  return Math.min(delayMs + 1000, maxDelayMs);
}

// ========================================
// Retry Decision Logic
// ========================================

/**
 * Decide whether to retry based on error type and attempt count
 * 
 * Implements idempotency safeguard: only retries GET/HEAD by default.
 * Mutating methods (POST/PUT/PATCH/DELETE) require explicit opt-in.
 * 
 * @param error - The error that occurred
 * @param attempt - Current retry attempt (0-indexed)
 * @param config - Retry policy configuration
 * @param headers - Optional HTTP response headers
 * @returns Retry decision with delay if applicable
 */
export function shouldRetry(
  error: unknown,
  attempt: number,
  config: RetryPolicyConfig,
  headers?: Headers
): RetryDecision {
  const errorType = classifyError(error);
  
  // Check if max retries exceeded
  if (attempt >= config.maxRetries) {
    return {
      shouldRetry: false,
      errorType,
      reason: `Max retries (${config.maxRetries}) exceeded`,
    };
  }
  
  // Idempotency check: only retry safe methods by default
  const httpMethod = config.httpMethod || 'GET';
  const isIdempotentMethod = httpMethod === 'GET' || httpMethod === 'HEAD';
  
  if (!isIdempotentMethod && !config.allowNonIdempotentRetry) {
    return {
      shouldRetry: false,
      errorType,
      reason: `Non-idempotent method ${httpMethod} requires explicit opt-in (allowNonIdempotentRetry=true)`,
    };
  }
  
  // Handle different error types
  switch (errorType) {
    case ErrorType.RATE_LIMIT_PRIMARY:
    case ErrorType.RATE_LIMIT_SECONDARY: {
      const rateLimitInfo = extractRateLimitInfo(error, headers);
      let delayMs: number;
      
      if (rateLimitInfo) {
        delayMs = calculateRateLimitDelay(
          rateLimitInfo.reset,
          rateLimitInfo.retryAfter,
          config.maxDelayMs
        );
      } else {
        // Fallback to exponential backoff if rate limit info not available
        delayMs = calculateBackoff(attempt, config);
      }
      
      return {
        shouldRetry: true,
        errorType,
        delayMs,
        reason: `Rate limit hit, waiting ${Math.ceil(delayMs / 1000)}s before retry ${attempt + 1}/${config.maxRetries}`,
      };
    }
    
    case ErrorType.SERVER_ERROR:
    case ErrorType.NETWORK_ERROR: {
      const delayMs = calculateBackoff(attempt, config);
      return {
        shouldRetry: true,
        errorType,
        delayMs,
        reason: `${errorType} detected, retrying with ${delayMs}ms backoff (attempt ${attempt + 1}/${config.maxRetries})`,
      };
    }
    
    case ErrorType.CLIENT_ERROR:
      return {
        shouldRetry: false,
        errorType,
        reason: 'Client error (4xx) - not retryable',
      };
    
    case ErrorType.UNKNOWN:
    default:
      // Conservative: don't retry unknown errors
      return {
        shouldRetry: false,
        errorType,
        reason: 'Unknown error type - not retryable',
      };
  }
}

// ========================================
// Retry Execution Helper
// ========================================

/**
 * Execute a function with retry logic
 * 
 * @param fn - Async function to execute
 * @param config - Retry policy configuration
 * @param onRetry - Optional callback called before each retry
 * @returns Result of the function
 * @throws Last error if all retries exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryPolicyConfig = DEFAULT_RETRY_CONFIG,
  onRetry?: (decision: RetryDecision, attempt: number) => void
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Determine if we should retry
      const decision = shouldRetry(error, attempt, config);
      
      if (!decision.shouldRetry) {
        console.log(`[Retry Policy] Not retrying: ${decision.reason}`);
        throw error;
      }
      
      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(decision, attempt);
      }
      
      console.log(`[Retry Policy] ${decision.reason}`);
      
      // Wait before retrying
      if (decision.delayMs && decision.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, decision.delayMs));
      }
    }
  }
  
  // Should not reach here, but throw last error if we do
  throw lastError || new Error('Unknown error in withRetry');
}

