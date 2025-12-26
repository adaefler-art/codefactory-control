/**
 * Utility for safe API response handling
 * Prevents "Unexpected JSON end" errors by checking response status before parsing
 */

// Error messages
const ERROR_MESSAGES = {
  JSON_PARSE_FAILED: 'Antwort konnte nicht als JSON verarbeitet werden',
  UNKNOWN_ERROR: 'Ein unbekannter Fehler ist aufgetreten',
} as const;

export interface ApiError {
  status: number;
  message: string;
  details?: unknown;
  requestId?: string;
}

/**
 * Safely parse JSON from a response, handling errors gracefully
 * @param response - Fetch API response
 * @returns Parsed JSON data or throws ApiError
 */
export async function safeFetch<T = unknown>(response: Response): Promise<T> {
  // Check if response is OK first
  if (!response.ok) {
    const statusText = typeof response.statusText === 'string' ? response.statusText.trim() : '';
    let errorMessage = statusText ? `HTTP ${response.status}: ${statusText}` : `HTTP ${response.status}`;
    let errorDetails: unknown = null;
    let requestId: string | undefined = undefined;

    // Extract request-id from response headers
    const headerRequestId = response.headers.get('x-request-id');
    if (headerRequestId) {
      requestId = headerRequestId;
    }

    // Try to parse error details from JSON
    try {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const errorData = await response.json();
        if (errorData?.error) {
          errorMessage = String(errorData.error);
        }
        if (errorData?.details) {
          errorDetails = errorData.details;
        }
        // Also check for requestId in response body
        if (errorData?.requestId && !requestId) {
          requestId = String(errorData.requestId);
        }
      } else {
        // Non-JSON response (e.g., HTML error page)
        const text = await response.text();
        if (text) {
          errorDetails = text.substring(0, 200); // Limit error text length
        }
      }
    } catch {
      // Ignore JSON parsing errors for error responses
      // Fall back to basic error message
    }

    const apiError: ApiError = {
      status: response.status,
      message: errorMessage,
      details: errorDetails,
      requestId,
    };

    throw apiError;
  }

  // Response is OK, parse JSON
  try {
    const data = await response.json();
    return data as T;
  } catch (error) {
    // JSON parsing failed on successful response
    throw {
      status: response.status,
      message: ERROR_MESSAGES.JSON_PARSE_FAILED,
      details: error instanceof Error ? error.message : 'JSON parse error',
    } as ApiError;
  }
}

/**
 * Check if an error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    'message' in error &&
    typeof (error as ApiError).status === 'number' &&
    typeof (error as ApiError).message === 'string'
  );
}

/**
 * Format an error for display to the user
 * @param error - Error object (could be ApiError, Error, or unknown)
 * @returns User-friendly error message
 */
export function formatErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    let message = error.message;
    
    // Include details if available
    if (error.details && typeof error.details === 'string') {
      message = `${message} (${error.details})`;
    }
    
    // Include request-id if available
    if (error.requestId) {
      message = `${message} [Request-ID: ${error.requestId}]`;
    }
    
    return message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return ERROR_MESSAGES.UNKNOWN_ERROR;
}
