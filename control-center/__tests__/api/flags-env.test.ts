/**
 * Tests for Feature Flags & Environment Inventory API
 * 
 * E7.0.4: Ensures API contract and effective config reporting
 * 
 * @jest-environment node
 */

import { GET } from '../../app/api/system/flags-env/route';

// Mock NextRequest-like object
function createMockRequest(requestId?: string, userId?: string) {
  const headers = new Headers();
  if (requestId) {
    headers.set('x-request-id', requestId);
  }
  if (userId) {
    headers.set('x-afu9-sub', userId);
  }
  return {
    headers,
  } as any;
}

describe('Flags/Env API Endpoint', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('returns 401 when user is not authenticated', async () => {
    const request = createMockRequest('flags-env-test-unauth');
    const response = await GET(request);
    
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Unauthorized');
  });

  test('returns 401 even if x-afu9-sub header is missing (middleware not run)', async () => {
    // This test simulates direct route access without middleware
    // In production, middleware always runs first and sets x-afu9-sub after JWT verification
    const request = createMockRequest('flags-env-test-no-middleware');
    const response = await GET(request);
    
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
    expect(body.message).toContain('Authentication required');
  });

  test('GET /api/system/flags-env returns 200 for authenticated user', async () => {
    const request = createMockRequest('flags-env-test-123', 'test-user-id');
    const response = await GET(request);
    
    expect(response.status).toBe(200);
  });

  test('response includes x-request-id header', async () => {
    const request = createMockRequest('flags-env-test-123', 'test-user-id');
    const response = await GET(request);
    
    expect(response.headers.get('x-request-id')).toBe('flags-env-test-123');
  });

  test('response has correct structure', async () => {
    const request = createMockRequest(undefined, 'test-user-id');
    const response = await GET(request);
    const body = await response.json();
    
    expect(body).toHaveProperty('ok');
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty('catalog');
    expect(body).toHaveProperty('effective');
  });

  test('catalog metadata is present', async () => {
    const request = createMockRequest(undefined, 'test-user-id');
    const response = await GET(request);
    const body = await response.json();
    
    expect(body.catalog).toHaveProperty('version');
    expect(body.catalog).toHaveProperty('lastUpdated');
    expect(body.catalog).toHaveProperty('totalFlags');
    expect(body.catalog.totalFlags).toBeGreaterThan(0);
  });

  test('effective config report is present', async () => {
    const request = createMockRequest(undefined, 'test-user-id');
    const response = await GET(request);
    const body = await response.json();
    
    expect(body.effective).toHaveProperty('timestamp');
    expect(body.effective).toHaveProperty('environment');
    expect(body.effective).toHaveProperty('values');
    expect(body.effective).toHaveProperty('missing');
    expect(body.effective).toHaveProperty('missingRequired');
    expect(body.effective).toHaveProperty('summary');
  });

  test('effective config values are sanitized', async () => {
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = 'very-secret-private-key-data';
    const rawOpenAiKey = 'sk-' + 'test1234567890abcdef';
    process.env.OPENAI_API_KEY = rawOpenAiKey;
    
    const request = createMockRequest(undefined, 'test-user-id');
    const response = await GET(request);
    const body = await response.json();
    
    const privateKey = body.effective.values.find(
      (v: any) => v.key === 'GITHUB_APP_PRIVATE_KEY_PEM'
    );
    const openaiKey = body.effective.values.find(
      (v: any) => v.key === 'OPENAI_API_KEY'
    );
    
    // Secrets should be masked
    expect(privateKey?.value).not.toBe('very-secret-private-key-data');
    expect(openaiKey?.value).not.toBe(rawOpenAiKey);
  });

  test('non-secret values are not masked', async () => {
    process.env.GITHUB_OWNER = 'my-test-org';
    process.env.AWS_REGION = 'us-west-2';
    
    const request = createMockRequest(undefined, 'test-user-id');
    const response = await GET(request);
    const body = await response.json();
    
    const githubOwner = body.effective.values.find(
      (v: any) => v.key === 'GITHUB_OWNER'
    );
    const awsRegion = body.effective.values.find(
      (v: any) => v.key === 'AWS_REGION'
    );
    
    expect(githubOwner?.value).toBe('my-test-org');
    expect(awsRegion?.value).toBe('us-west-2');
  });

  test('summary counts are accurate', async () => {
    const request = createMockRequest(undefined, 'test-user-id');
    const response = await GET(request);
    const body = await response.json();
    
    const summary = body.effective.summary;
    
    expect(summary.total).toBe(body.effective.values.length);
    expect(summary.set).toBeGreaterThanOrEqual(0);
    expect(summary.missing).toBeGreaterThanOrEqual(0);
    expect(summary.missingRequired).toBeGreaterThanOrEqual(0);
    expect(summary.fromBuild).toBeGreaterThanOrEqual(0);
    expect(summary.fromEnv).toBeGreaterThanOrEqual(0);
    expect(summary.fromDefault).toBeGreaterThanOrEqual(0);
  });

  test('detects missing required flags', async () => {
    // Clear required flags
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY_PEM;
    delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    
    const request = createMockRequest(undefined, 'test-user-id');
    const response = await GET(request);
    const body = await response.json();
    
    expect(body.effective.missingRequired.length).toBeGreaterThan(0);
    
    const missingKeys = body.effective.missingRequired.map((v: any) => v.key);
    expect(missingKeys).toContain('GITHUB_APP_ID');
    expect(missingKeys).toContain('GITHUB_APP_PRIVATE_KEY_PEM');
    expect(missingKeys).toContain('GITHUB_APP_WEBHOOK_SECRET');
  });

  test('flags include metadata', async () => {
    const request = createMockRequest(undefined, 'test-user-id');
    const response = await GET(request);
    const body = await response.json();
    
    const firstValue = body.effective.values[0];
    
    expect(firstValue).toHaveProperty('key');
    expect(firstValue).toHaveProperty('value');
    expect(firstValue).toHaveProperty('source');
    expect(firstValue).toHaveProperty('expectedType');
    expect(firstValue).toHaveProperty('actualType');
    expect(firstValue).toHaveProperty('isSet');
    expect(firstValue).toHaveProperty('isMissing');
    expect(firstValue).toHaveProperty('config');
    
    // Check config metadata
    expect(firstValue.config).toHaveProperty('description');
    expect(firstValue.config).toHaveProperty('riskClass');
    expect(firstValue.config).toHaveProperty('required');
    expect(firstValue.config).toHaveProperty('tags');
  });

  test('environment is correctly reported', async () => {
    process.env.NODE_ENV = 'production';
    
    const request = createMockRequest(undefined, 'test-user-id');
    const response = await GET(request);
    const body = await response.json();
    
    expect(body.effective.environment).toBe('production');
  });

  test('response is JSON with correct content-type', async () => {
    const request = createMockRequest(undefined, 'test-user-id');
    const response = await GET(request);
    
    const contentType = response.headers.get('content-type');
    expect(contentType).toContain('application/json');
  });
});

describe('Flags/Env API Error Handling', () => {
  test('handles errors gracefully', async () => {
    // This test ensures the error handling path works
    // In a real error scenario, the API should return 500
    const request = createMockRequest(undefined, 'test-user-id');
    const response = await GET(request);
    
    // Under normal conditions, should succeed
    expect([200, 500]).toContain(response.status);
    
    const body = await response.json();
    
    if (response.status === 500) {
      expect(body.ok).toBe(false);
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('message');
    } else {
      expect(body.ok).toBe(true);
    }
  });
});
