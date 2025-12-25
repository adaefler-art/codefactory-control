/**
 * Tests for safe-fetch utility
 */

import { safeFetch, isApiError, formatErrorMessage, ApiError } from './safe-fetch';

describe('safeFetch', () => {
  it('should parse successful JSON response', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: jest.fn().mockResolvedValue({ data: 'test' }),
    } as unknown as Response;

    const result = await safeFetch(mockResponse);
    expect(result).toEqual({ data: 'test' });
  });

  it('should throw ApiError for non-OK response with JSON error', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: jest.fn().mockResolvedValue({ error: 'Resource not found' }),
    } as unknown as Response;

    await expect(safeFetch(mockResponse)).rejects.toMatchObject({
      status: 404,
      message: 'Resource not found',
    });
  });

  it('should handle non-JSON error responses', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers({ 'content-type': 'text/html' }),
      text: jest.fn().mockResolvedValue('<html>Error page</html>'),
    } as unknown as Response;

    await expect(safeFetch(mockResponse)).rejects.toMatchObject({
      status: 500,
      message: 'HTTP 500: Internal Server Error',
    });
  });

  it('should handle empty error responses gracefully', async () => {
    const mockResponse = {
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers(),
      json: jest.fn().mockRejectedValue(new Error('Unexpected end of JSON input')),
      text: jest.fn().mockResolvedValue(''),
    } as unknown as Response;

    await expect(safeFetch(mockResponse)).rejects.toMatchObject({
      status: 503,
      message: 'HTTP 503: Service Unavailable',
    });
  });

  it('should throw ApiError when JSON parsing fails on OK response', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: jest.fn().mockRejectedValue(new Error('Unexpected token')),
    } as unknown as Response;

    await expect(safeFetch(mockResponse)).rejects.toMatchObject({
      status: 200,
      message: 'Antwort konnte nicht als JSON verarbeitet werden',
    });
  });
});

describe('isApiError', () => {
  it('should return true for valid ApiError', () => {
    const error: ApiError = {
      status: 404,
      message: 'Not found',
    };
    expect(isApiError(error)).toBe(true);
  });

  it('should return false for regular Error', () => {
    const error = new Error('Something went wrong');
    expect(isApiError(error)).toBe(false);
  });

  it('should return false for null', () => {
    expect(isApiError(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isApiError(undefined)).toBe(false);
  });
});

describe('formatErrorMessage', () => {
  it('should format ApiError message', () => {
    const error: ApiError = {
      status: 404,
      message: 'Resource not found',
    };
    expect(formatErrorMessage(error)).toBe('Resource not found');
  });

  it('should include details in ApiError message', () => {
    const error: ApiError = {
      status: 400,
      message: 'Validation failed',
      details: 'Title is required',
    };
    expect(formatErrorMessage(error)).toBe('Validation failed (Title is required)');
  });

  it('should format regular Error message', () => {
    const error = new Error('Network error');
    expect(formatErrorMessage(error)).toBe('Network error');
  });

  it('should handle unknown error types', () => {
    expect(formatErrorMessage('string error')).toBe('Ein unbekannter Fehler ist aufgetreten');
    expect(formatErrorMessage(null)).toBe('Ein unbekannter Fehler ist aufgetreten');
    expect(formatErrorMessage(undefined)).toBe('Ein unbekannter Fehler ist aufgetreten');
  });
});
