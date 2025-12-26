/**
 * API Response Helpers
 * 
 * Centralized utilities for creating API responses with consistent x-request-id propagation.
 * Ensures all API responses include the request-id header for traceability.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

/**
 * Extract or generate request ID from the request
 */
export function getRequestId(request: NextRequest): string {
  const headerValue = request.headers.get('x-request-id');
  if (headerValue && headerValue.trim()) {
    return headerValue.trim();
  }
  
  try {
    return randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

/**
 * Attach request-id header to a NextResponse
 */
export function withRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  return response;
}

/**
 * Create a JSON response with x-request-id header
 */
export function jsonResponse<T>(
  data: T,
  options?: {
    status?: number;
    requestId?: string;
    headers?: Record<string, string>;
  }
): NextResponse<T> {
  const response = NextResponse.json(data, { 
    status: options?.status ?? 200,
  });
  
  if (options?.requestId) {
    response.headers.set('x-request-id', options.requestId);
  }
  
  if (options?.headers) {
    Object.entries(options.headers).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
  }
  
  return response;
}

/**
 * Error response structure
 */
export interface ErrorResponseData {
  error: string;
  details?: string;
  requestId?: string;
  timestamp: string;
}

/**
 * Create an error response with x-request-id header
 */
export function errorResponse(
  error: string,
  options?: {
    status?: number;
    requestId?: string;
    details?: string;
    timestamp?: string;
  }
): NextResponse<ErrorResponseData> {
  const responseData: ErrorResponseData = {
    error,
    timestamp: options?.timestamp ?? new Date().toISOString(),
  };
  
  if (options?.details) {
    responseData.details = options.details;
  }
  
  if (options?.requestId) {
    responseData.requestId = options.requestId;
  }
  
  return jsonResponse(responseData, {
    status: options?.status ?? 500,
    requestId: options?.requestId,
  });
}
