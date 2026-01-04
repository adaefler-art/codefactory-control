/**
 * INTENT Agent Hardening Tests
 * 
 * Tests for security, bounding, rate limiting, and fail-closed behavior
 * 
 * @jest-environment node
 */

import { generateIntentResponse, isIntentEnabled } from '../../src/lib/intent-agent';

// Mock OpenAI
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: 'Test response',
                },
              },
            ],
            usage: {
              total_tokens: 100,
            },
          }),
        },
      },
    })),
  };
});

describe('INTENT Agent Hardening', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.AFU9_INTENT_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'test-openai-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Feature Flag Fail-Closed', () => {
    test('throws error when AFU9_INTENT_ENABLED is false', async () => {
      process.env.AFU9_INTENT_ENABLED = 'false';
      
      // Need to reload module to pick up new env
      jest.resetModules();
      const { generateIntentResponse: freshFunc } = require('../../src/lib/intent-agent');
      
      await expect(freshFunc('test message')).rejects.toThrow('INTENT agent is not enabled');
    });

    test('isIntentEnabled returns false when disabled', () => {
      process.env.AFU9_INTENT_ENABLED = 'false';
      jest.resetModules();
      const { isIntentEnabled: freshCheck } = require('../../src/lib/intent-agent');
      
      expect(freshCheck()).toBe(false);
    });
  });

  describe('Input Bounding', () => {
    test('rejects empty message', async () => {
      await expect(generateIntentResponse('')).rejects.toThrow('User message cannot be empty');
    });

    test('truncates very long messages', async () => {
      const longMessage = 'a'.repeat(5000); // Exceeds MAX_MESSAGE_LENGTH
      
      // Should not throw, message gets truncated
      const response = await generateIntentResponse(longMessage);
      expect(response).toBeDefined();
      expect(response.content).toBeDefined();
    });

    test('bounds conversation history to max messages', async () => {
      const OpenAI = require('openai').default;
      const mockCreate = OpenAI.mock.results[0].value.chat.completions.create;
      
      const manyMessages = Array(20).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant' as const,
        content: `Message ${i}`,
      }));
      
      await generateIntentResponse('test', manyMessages);
      
      // Check that OpenAI was called with bounded messages
      const call = mockCreate.mock.calls[0][0];
      // Should have: 1 system + max 10 history + 1 user = max 12 messages
      expect(call.messages.length).toBeLessThanOrEqual(12);
    });
  });

  describe('Rate Limiting', () => {
    test('allows requests within rate limit', async () => {
      const userId = 'test-user-1';
      
      // Should succeed for first few requests
      for (let i = 0; i < 3; i++) {
        const response = await generateIntentResponse('test', [], userId);
        expect(response).toBeDefined();
      }
    });

    test('blocks requests exceeding rate limit', async () => {
      const userId = 'test-user-2';
      
      // Make 20 requests (at the limit)
      for (let i = 0; i < 20; i++) {
        await generateIntentResponse('test', [], userId);
      }
      
      // 21st request should be rate limited
      await expect(generateIntentResponse('test', [], userId))
        .rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('Deterministic Settings', () => {
    test('uses temperature=0 for deterministic responses', async () => {
      const OpenAI = require('openai').default;
      const mockCreate = OpenAI.mock.results[0].value.chat.completions.create;
      
      await generateIntentResponse('test');
      
      const call = mockCreate.mock.calls[0][0];
      expect(call.temperature).toBe(0);
    });

    test('sets max_tokens to bounded value', async () => {
      const OpenAI = require('openai').default;
      const mockCreate = OpenAI.mock.results[0].value.chat.completions.create;
      
      await generateIntentResponse('test');
      
      const call = mockCreate.mock.calls[0][0];
      expect(call.max_tokens).toBeDefined();
      expect(call.max_tokens).toBeLessThanOrEqual(1000);
    });
  });

  describe('Secret Sanitization', () => {
    test('redacts API keys from response', async () => {
      const OpenAI = require('openai').default;
      const apiKey = 'sk-' + '1234567890abcdefghijklmnop';
      OpenAI.mock.results[0].value.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Here is an API key: ' + apiKey,
            },
          },
        ],
        usage: { total_tokens: 50 },
      });
      
      const response = await generateIntentResponse('test');
      expect(response.content).not.toContain(apiKey);
      expect(response.content).toContain('[REDACTED_API_KEY]');
    });

    test('redacts GitHub tokens from response', async () => {
      const OpenAI = require('openai').default;
      const ghToken = 'ghp_' + '1234567890abcdefghijklmnopqrstuvwxyz';
      OpenAI.mock.results[0].value.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Token: ' + ghToken,
            },
          },
        ],
        usage: { total_tokens: 50 },
      });
      
      const response = await generateIntentResponse('test');
      expect(response.content).not.toContain(ghToken);
      expect(response.content).toContain('[REDACTED_GITHUB_TOKEN]');
    });

    test('redacts URLs with query strings', async () => {
      const OpenAI = require('openai').default;
      const secret = 'sec' + 'ret123';
      OpenAI.mock.results[0].value.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Visit https://example.com?token=' + secret + '&key=abc',
            },
          },
        ],
        usage: { total_tokens: 50 },
      });
      
      const response = await generateIntentResponse('test');
      expect(response.content).toContain('https://example.com?[REDACTED_QUERY]');
      expect(response.content).not.toContain(secret);
    });

    test('redacts Bearer tokens', async () => {
      const OpenAI = require('openai').default;
      const jwtHeader = 'eyJ' + 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      OpenAI.mock.results[0].value.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Authorization: Bearer ' + jwtHeader,
            },
          },
        ],
        usage: { total_tokens: 50 },
      });
      
      const response = await generateIntentResponse('test');
      expect(response.content).not.toContain(jwtHeader);
      expect(response.content).toContain('[REDACTED');
    });
  });

  describe('Error Handling', () => {
    test('handles timeout gracefully', async () => {
      const OpenAI = require('openai').default;
      OpenAI.mock.results[0].value.chat.completions.create.mockRejectedValueOnce(
        Object.assign(new Error('Aborted'), { name: 'AbortError' })
      );
      
      await expect(generateIntentResponse('test')).rejects.toThrow('timed out');
    });

    test('does not leak stack traces in logs', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const OpenAI = require('openai').default;
      OpenAI.mock.results[0].value.chat.completions.create.mockRejectedValueOnce(
        new Error('Test error')
      );
      
      await expect(generateIntentResponse('test')).rejects.toThrow();
      
      // Check that error log doesn't contain stack
      const errorCall = consoleSpy.mock.calls.find(call => 
        call[0] === '[INTENT Agent] Error generating response:'
      );
      expect(errorCall).toBeDefined();
      expect(errorCall![1]).not.toHaveProperty('stack');
      
      consoleSpy.mockRestore();
    });
  });

  describe('Response Structure', () => {
    test('returns deterministic response structure', async () => {
      const response = await generateIntentResponse('test');
      
      expect(response).toHaveProperty('content');
      expect(response).toHaveProperty('requestId');
      expect(response).toHaveProperty('timestamp');
      expect(response).toHaveProperty('model');
      expect(typeof response.requestId).toBe('string');
      expect(typeof response.timestamp).toBe('string');
    });
  });
});
