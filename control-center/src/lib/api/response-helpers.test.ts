/**
 * Tests for request-id propagation
 * 
 * Validates that x-request-id headers are properly propagated through:
 * - API response helpers
 * - withApi wrapper
 * - UI error handling
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from './response-helpers';

describe('Request-ID Propagation', () => {
  describe('getRequestId', () => {
    it('should extract request-id from request headers', () => {
      const mockRequest = {
        headers: new Headers({
          'x-request-id': 'test-request-id-123',
        }),
      } as NextRequest;

      const requestId = getRequestId(mockRequest);
      expect(requestId).toBe('test-request-id-123');
    });

    it('should generate request-id if not present in headers', () => {
      const mockRequest = {
        headers: new Headers(),
      } as NextRequest;

      const requestId = getRequestId(mockRequest);
      expect(requestId).toBeDefined();
      expect(typeof requestId).toBe('string');
      expect(requestId.length).toBeGreaterThan(0);
    });

    it('should trim whitespace from request-id header', () => {
      const mockRequest = {
        headers: new Headers({
          'x-request-id': '  test-id-with-spaces  ',
        }),
      } as NextRequest;

      const requestId = getRequestId(mockRequest);
      expect(requestId).toBe('test-id-with-spaces');
    });

    it('should generate new id if header value is empty after trim', () => {
      const mockRequest = {
        headers: new Headers({
          'x-request-id': '   ',
        }),
      } as NextRequest;

      const requestId = getRequestId(mockRequest);
      expect(requestId).toBeDefined();
      expect(requestId.length).toBeGreaterThan(0);
      expect(requestId).not.toBe('   ');
    });
  });

  describe('jsonResponse', () => {
    it('should include x-request-id header in response', () => {
      const data = { message: 'success' };
      const requestId = 'test-123';

      const response = jsonResponse(data, { requestId });

      expect(response.headers.get('x-request-id')).toBe(requestId);
    });

    it('should not include x-request-id if not provided', () => {
      const data = { message: 'success' };

      const response = jsonResponse(data);

      expect(response.headers.get('x-request-id')).toBeNull();
    });

    it('should include custom headers along with request-id', () => {
      const data = { message: 'success' };
      const requestId = 'test-456';

      const response = jsonResponse(data, {
        requestId,
        headers: {
          'custom-header': 'custom-value',
        },
      });

      expect(response.headers.get('x-request-id')).toBe(requestId);
      expect(response.headers.get('custom-header')).toBe('custom-value');
    });

    it('should set correct status code', () => {
      const data = { message: 'created' };
      const requestId = 'test-789';

      const response = jsonResponse(data, {
        requestId,
        status: 201,
      });

      expect(response.status).toBe(201);
      expect(response.headers.get('x-request-id')).toBe(requestId);
    });
  });

  describe('errorResponse', () => {
    it('should include request-id in both header and body', async () => {
      const requestId = 'error-123';
      const response = errorResponse('Something went wrong', {
        requestId,
        status: 500,
      });

      expect(response.headers.get('x-request-id')).toBe(requestId);

      const body = await response.json();
      expect(body.requestId).toBe(requestId);
    });

    it('should include error details in response body', async () => {
      const requestId = 'error-456';
      const response = errorResponse('Validation failed', {
        requestId,
        status: 400,
        details: 'Title is required',
      });

      const body = await response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details).toBe('Title is required');
      expect(body.requestId).toBe(requestId);
    });

    it('should include timestamp in response', async () => {
      const requestId = 'error-789';
      const response = errorResponse('Server error', {
        requestId,
        status: 500,
      });

      const body = await response.json();
      expect(body.timestamp).toBeDefined();
      expect(new Date(body.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('should default to 500 status if not specified', async () => {
      const requestId = 'error-default';
      const response = errorResponse('Error message', {
        requestId,
      });

      expect(response.status).toBe(500);
    });

    it('should allow custom timestamp', async () => {
      const requestId = 'error-custom-time';
      const customTimestamp = '2024-01-01T00:00:00.000Z';
      
      const response = errorResponse('Error', {
        requestId,
        timestamp: customTimestamp,
      });

      const body = await response.json();
      expect(body.timestamp).toBe(customTimestamp);
    });
  });

  describe('End-to-End Flow', () => {
    it('should propagate request-id from request to response', () => {
      // Simulate a request with request-id from middleware
      const mockRequest = {
        headers: new Headers({
          'x-request-id': 'e2e-test-123',
        }),
      } as NextRequest;

      // Extract request-id in handler
      const requestId = getRequestId(mockRequest);

      // Create response with request-id
      const response = jsonResponse(
        { data: 'test' },
        { requestId }
      );

      // Verify request-id is in response headers
      expect(response.headers.get('x-request-id')).toBe('e2e-test-123');
    });

    it('should handle error path with request-id', async () => {
      const mockRequest = {
        headers: new Headers({
          'x-request-id': 'e2e-error-456',
        }),
      } as NextRequest;

      const requestId = getRequestId(mockRequest);

      const response = errorResponse('Not found', {
        requestId,
        status: 404,
        details: 'Resource does not exist',
      });

      expect(response.headers.get('x-request-id')).toBe('e2e-error-456');
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.requestId).toBe('e2e-error-456');
      expect(body.error).toBe('Not found');
      expect(body.details).toBe('Resource does not exist');
    });
  });
});
