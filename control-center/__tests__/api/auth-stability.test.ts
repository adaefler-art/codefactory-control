/**
 * Tests for Auth Stability & Password Reset Hardening
 * 
 * Validates:
 * 1. DISABLE_PASSWORD_RESET feature flag
 * 2. Proper error codes (no 502 Bad Gateway)
 * 3. No-store headers on all auth routes
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as forgotPasswordPost } from '../../app/api/auth/forgot-password/route';
import { POST as resetPasswordPost } from '../../app/api/auth/reset-password/route';
import { POST as loginPost } from '../../app/api/auth/login/route';
import { POST as logoutPost } from '../../app/api/auth/logout/route';
import { POST as refreshPost } from '../../app/api/auth/refresh/route';

// Mock Cognito SDK
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({
    send: jest.fn(),
  })),
  InitiateAuthCommand: jest.fn(),
  ForgotPasswordCommand: jest.fn(),
  ConfirmForgotPasswordCommand: jest.fn(),
}));

describe('Auth Stability - Password Reset Hardening', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('DISABLE_PASSWORD_RESET feature flag', () => {
    test('forgot-password returns 501 when DISABLE_PASSWORD_RESET=true', async () => {
      process.env.DISABLE_PASSWORD_RESET = 'true';
      
      // Re-import to get fresh env values
      const { POST } = await import('../../app/api/auth/forgot-password/route');
      
      const req = new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ username: 'test@example.com' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(501);

      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toContain('not available');
      expect(body).toHaveProperty('requestId');
      expect(body).toHaveProperty('timestamp');
    });

    test('reset-password returns 501 when DISABLE_PASSWORD_RESET=true', async () => {
      process.env.DISABLE_PASSWORD_RESET = 'true';
      
      // Re-import to get fresh env values
      const { POST } = await import('../../app/api/auth/reset-password/route');
      
      const req = new NextRequest('http://localhost/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ 
          username: 'test@example.com',
          code: '123456',
          newPassword: 'NewPassword123!'
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(501);

      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toContain('not available');
    });

    test('forgot-password works normally when DISABLE_PASSWORD_RESET=false', async () => {
      process.env.DISABLE_PASSWORD_RESET = 'false';
      process.env.COGNITO_CLIENT_ID = 'test-client-id';
      
      const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
      const mockSend = jest.fn().mockResolvedValue({});
      CognitoIdentityProviderClient.mockImplementation(() => ({ send: mockSend }));

      // Re-import to get fresh env values
      const { POST } = await import('../../app/api/auth/forgot-password/route');
      
      const req = new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ username: 'test@example.com' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('message');
    });
  });

  describe('No 502 Bad Gateway errors', () => {
    test('forgot-password returns 500 (not 502) on Cognito errors', async () => {
      process.env.DISABLE_PASSWORD_RESET = 'false';
      process.env.COGNITO_CLIENT_ID = 'test-client-id';
      
      const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
      const mockSend = jest.fn().mockRejectedValue({
        name: 'ServiceUnavailableException',
        message: 'Service temporarily unavailable',
      });
      CognitoIdentityProviderClient.mockImplementation(() => ({ send: mockSend }));

      // Re-import to get fresh env values
      const { POST } = await import('../../app/api/auth/forgot-password/route');
      
      const req = new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ username: 'test@example.com' }),
      });

      const res = await POST(req);
      // Should be 500 (Internal Server Error), not 502 (Bad Gateway)
      expect(res.status).toBe(500);
      expect(res.status).not.toBe(502);

      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('requestId');
      expect(body).toHaveProperty('timestamp');
    });
  });

  describe('No-store headers on auth routes', () => {
    test('forgot-password has no-store headers', async () => {
      const req = new NextRequest('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ username: 'test@example.com' }),
      });

      const res = await forgotPasswordPost(req);
      
      const cacheControl = res.headers.get('cache-control');
      expect(cacheControl).toContain('no-store');
      expect(cacheControl).toContain('max-age=0');
      
      const pragma = res.headers.get('pragma');
      expect(pragma).toBe('no-cache');
    });

    test('login has no-store headers', async () => {
      const req = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const res = await loginPost(req);
      
      const cacheControl = res.headers.get('cache-control');
      expect(cacheControl).toContain('no-store');
      expect(cacheControl).toContain('max-age=0');
      
      const pragma = res.headers.get('pragma');
      expect(pragma).toBe('no-cache');
    });

    test('logout has no-store headers', async () => {
      const req = new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
      });

      const res = await logoutPost(req);
      
      const cacheControl = res.headers.get('cache-control');
      expect(cacheControl).toContain('no-store');
      expect(cacheControl).toContain('max-age=0');
      
      const pragma = res.headers.get('pragma');
      expect(pragma).toBe('no-cache');
    });

    test('refresh has no-store headers', async () => {
      const req = new NextRequest('http://localhost/api/auth/refresh', {
        method: 'POST',
      });

      const res = await refreshPost(req);
      
      const cacheControl = res.headers.get('cache-control');
      expect(cacheControl).toContain('no-store');
      expect(cacheControl).toContain('max-age=0');
      
      const pragma = res.headers.get('pragma');
      expect(pragma).toBe('no-cache');
    });

    test('reset-password has no-store headers', async () => {
      const req = new NextRequest('http://localhost/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const res = await resetPasswordPost(req);
      
      const cacheControl = res.headers.get('cache-control');
      expect(cacheControl).toContain('no-store');
      expect(cacheControl).toContain('max-age=0');
      
      const pragma = res.headers.get('pragma');
      expect(pragma).toBe('no-cache');
    });
  });
});
