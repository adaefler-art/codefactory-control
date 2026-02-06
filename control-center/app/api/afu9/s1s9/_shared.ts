type ResponseProvider = () => Promise<Response>;

type ScopeFallbackOptions = {
  primary: ResponseProvider;
  fallback: ResponseProvider;
  primaryScope: 's1s9' | 's1s3';
  fallbackScope: 's1s9' | 's1s3';
};

export async function isIssueNotFound(response: Response): Promise<boolean> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return false;
  }

  try {
    const body = await response.clone().json();
    return Boolean(body && typeof body === 'object' && body.errorCode === 'issue_not_found');
  } catch {
    return false;
  }
}

export async function withAfu9ScopeFallback(options: ScopeFallbackOptions): Promise<Response> {
  const primaryResponse = await options.primary();
  const needsFallback = await isIssueNotFound(primaryResponse);

  if (!needsFallback) {
    primaryResponse.headers.set('x-afu9-scope-resolved', options.primaryScope);
    return primaryResponse;
  }

  const fallbackResponse = await options.fallback();
  fallbackResponse.headers.set('x-afu9-scope-resolved', options.fallbackScope);
  return fallbackResponse;
}
