/**
 * Tests for GitHub Retry Policy
 * 
 * Tests deterministic exponential backoff, rate-limit handling, and bounded retries.
 */

import {
  calculateBackoff,
  calculateRateLimitDelay,
  classifyError,
  shouldRetry,
  withRetry,
  ErrorType,
  DEFAULT_RETRY_CONFIG,
  extractRateLimitInfo,
} from '../../src/lib/github/retry-policy';

describe('GitHub Retry Policy', () => {
  describe('classifyError', () => {
    it('should classify rate limit errors', () => {
      const error1 = new Error('GitHub API rate limit exceeded');
      expect(classifyError(error1)).toBe(ErrorType.RATE_LIMIT_PRIMARY);
      
      const error2 = new Error('HTTP 429 Too Many Requests');
      expect(classifyError(error2)).toBe(ErrorType.RATE_LIMIT_PRIMARY);
      
      const error3 = new Error('secondary rate limit detected');
      expect(classifyError(error3)).toBe(ErrorType.RATE_LIMIT_SECONDARY);
    });
    
    it('should classify server errors', () => {
      const error1 = new Error('HTTP 500 Internal Server Error');
      expect(classifyError(error1)).toBe(ErrorType.SERVER_ERROR);
      
      const error2 = new Error('HTTP 503 Service Unavailable');
      expect(classifyError(error2)).toBe(ErrorType.SERVER_ERROR);
    });
    
    it('should classify network errors', () => {
      const error1 = new Error('Network timeout');
      expect(classifyError(error1)).toBe(ErrorType.NETWORK_ERROR);
      
      const error2 = new Error('ECONNREFUSED');
      expect(classifyError(error2)).toBe(ErrorType.NETWORK_ERROR);
      
      const error3 = new Error('fetch failed');
      expect(classifyError(error3)).toBe(ErrorType.NETWORK_ERROR);
    });
    
    it('should classify client errors', () => {
      const error1 = new Error('HTTP 400 Bad Request');
      expect(classifyError(error1)).toBe(ErrorType.CLIENT_ERROR);
      
      const error2 = new Error('HTTP 404 Not Found');
      expect(classifyError(error2)).toBe(ErrorType.CLIENT_ERROR);
    });
    
    it('should classify unknown errors', () => {
      const error1 = new Error('Something went wrong');
      expect(classifyError(error1)).toBe(ErrorType.UNKNOWN);
      
      expect(classifyError(null)).toBe(ErrorType.UNKNOWN);
    });
  });
  
  describe('calculateBackoff', () => {
    it('should calculate exponential backoff', () => {
      const config = DEFAULT_RETRY_CONFIG;
      
      // Attempt 0: 1000ms (base)
      const delay0 = calculateBackoff(0, config);
      expect(delay0).toBeGreaterThanOrEqual(750); // 1000 - 25%
      expect(delay0).toBeLessThanOrEqual(1250); // 1000 + 25%
      
      // Attempt 1: 2000ms (1000 * 2^1)
      const delay1 = calculateBackoff(1, config);
      expect(delay1).toBeGreaterThanOrEqual(1500);
      expect(delay1).toBeLessThanOrEqual(2500);
      
      // Attempt 2: 4000ms (1000 * 2^2)
      const delay2 = calculateBackoff(2, config);
      expect(delay2).toBeGreaterThanOrEqual(3000);
      expect(delay2).toBeLessThanOrEqual(5000);
    });
    
    it('should cap at maxDelayMs', () => {
      const config = {
        ...DEFAULT_RETRY_CONFIG,
        maxDelayMs: 5000,
      };
      
      // Attempt 5 would be 32000ms, but should cap at 5000ms
      const delay = calculateBackoff(5, config);
      expect(delay).toBeLessThanOrEqual(config.maxDelayMs * 1.25); // Allow jitter
    });
    
    it('should be deterministic with zero jitter', () => {
      const config = {
        ...DEFAULT_RETRY_CONFIG,
        jitterFactor: 0,
      };
      
      const delay1 = calculateBackoff(1, config);
      const delay2 = calculateBackoff(1, config);
      expect(delay1).toBe(delay2);
      expect(delay1).toBe(2000); // Exactly 1000 * 2^1
    });
  });
  
  describe('calculateRateLimitDelay', () => {
    it('should calculate delay from reset timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      const resetTimestamp = now + 60; // 60 seconds in future
      
      const delay = calculateRateLimitDelay(resetTimestamp, undefined, 300000);
      
      // Should be ~61 seconds (60 + 1 buffer)
      expect(delay).toBeGreaterThanOrEqual(60000);
      expect(delay).toBeLessThanOrEqual(62000);
    });
    
    it('should use retry-after header when provided', () => {
      const now = Math.floor(Date.now() / 1000);
      const resetTimestamp = now + 300; // 5 minutes in future
      const retryAfter = 30; // But retry-after says 30 seconds
      
      const delay = calculateRateLimitDelay(resetTimestamp, retryAfter, 300000);
      
      expect(delay).toBe(30000); // Should use retry-after
    });
    
    it('should cap at maxDelayMs', () => {
      const now = Math.floor(Date.now() / 1000);
      const resetTimestamp = now + 1000; // 1000 seconds in future
      
      const delay = calculateRateLimitDelay(resetTimestamp, undefined, 60000);
      
      expect(delay).toBe(60000); // Capped at 60s
    });
  });
  
  describe('extractRateLimitInfo', () => {
    it('should extract rate limit info from headers', () => {
      const headers = new Headers({
        'x-ratelimit-remaining': '0',
        'x-ratelimit-limit': '5000',
        'x-ratelimit-reset': '1234567890',
        'retry-after': '60',
      });
      
      const info = extractRateLimitInfo(null, headers);
      
      expect(info).toEqual({
        remaining: 0,
        limit: 5000,
        reset: 1234567890,
        retryAfter: 60,
      });
    });
    
    it('should extract retry-after from error message', () => {
      const error = new Error('Rate limit exceeded. Retry after 120 seconds');
      
      const info = extractRateLimitInfo(error);
      
      expect(info?.retryAfter).toBe(120);
    });
    
    it('should return null when no info available', () => {
      const info = extractRateLimitInfo(new Error('Generic error'));
      expect(info).toBeNull();
    });
  });
  
  describe('shouldRetry', () => {
    it('should retry rate limit errors', () => {
      const error = new Error('HTTP 429 Rate limit exceeded');
      const decision = shouldRetry(error, 0, DEFAULT_RETRY_CONFIG);
      
      expect(decision.shouldRetry).toBe(true);
      expect(decision.errorType).toBe(ErrorType.RATE_LIMIT_PRIMARY);
      expect(decision.delayMs).toBeGreaterThan(0);
    });
    
    it('should retry server errors', () => {
      const error = new Error('HTTP 503 Service Unavailable');
      const decision = shouldRetry(error, 0, DEFAULT_RETRY_CONFIG);
      
      expect(decision.shouldRetry).toBe(true);
      expect(decision.errorType).toBe(ErrorType.SERVER_ERROR);
      expect(decision.delayMs).toBeGreaterThan(0);
    });
    
    it('should not retry client errors', () => {
      const error = new Error('HTTP 404 Not Found');
      const decision = shouldRetry(error, 0, DEFAULT_RETRY_CONFIG);
      
      expect(decision.shouldRetry).toBe(false);
      expect(decision.errorType).toBe(ErrorType.CLIENT_ERROR);
    });
    
    it('should not retry after max attempts', () => {
      const error = new Error('HTTP 503 Service Unavailable');
      const decision = shouldRetry(error, 3, DEFAULT_RETRY_CONFIG);
      
      expect(decision.shouldRetry).toBe(false);
      expect(decision.reason).toContain('Max retries');
    });
    
    it('should use rate limit info when available', () => {
      const error = new Error('HTTP 429 Rate limit exceeded');
      const headers = new Headers({
        'x-ratelimit-remaining': '0',
        'x-ratelimit-limit': '5000',
        'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
      });
      
      const decision = shouldRetry(error, 0, DEFAULT_RETRY_CONFIG, headers);
      
      expect(decision.shouldRetry).toBe(true);
      expect(decision.delayMs).toBeGreaterThanOrEqual(60000); // ~60s
    });
  });
  
  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      
      const result = await withRetry(fn, DEFAULT_RETRY_CONFIG);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });
    
    it('should retry on retryable errors', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('HTTP 503 Service Unavailable'))
        .mockRejectedValueOnce(new Error('HTTP 503 Service Unavailable'))
        .mockResolvedValue('success');
      
      const config = {
        ...DEFAULT_RETRY_CONFIG,
        initialDelayMs: 10, // Speed up test
        maxDelayMs: 100,
        jitterFactor: 0, // Deterministic
      };
      
      const result = await withRetry(fn, config);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });
    
    it('should not retry on non-retryable errors', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('HTTP 404 Not Found'));
      
      await expect(withRetry(fn, DEFAULT_RETRY_CONFIG)).rejects.toThrow('HTTP 404 Not Found');
      expect(fn).toHaveBeenCalledTimes(1);
    });
    
    it('should throw after max retries', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('HTTP 503 Service Unavailable'));
      
      const config = {
        ...DEFAULT_RETRY_CONFIG,
        maxRetries: 2,
        initialDelayMs: 10,
        jitterFactor: 0,
      };
      
      await expect(withRetry(fn, config)).rejects.toThrow('HTTP 503 Service Unavailable');
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
    
    it('should call onRetry callback', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValue('success');
      
      const onRetry = jest.fn();
      const config = {
        ...DEFAULT_RETRY_CONFIG,
        initialDelayMs: 10,
        jitterFactor: 0,
      };
      
      await withRetry(fn, config, onRetry);
      
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          shouldRetry: true,
          errorType: ErrorType.NETWORK_ERROR,
        }),
        0
      );
    });
  });
});
