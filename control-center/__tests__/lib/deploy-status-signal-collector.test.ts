/**
 * E65.1 Signal Collector Tests
 *
 * Focus: baseUrl candidate selection (prefer loopback) and error evidence.
 *
 * @jest-environment node
 */

import { collectStatusSignals } from '@/lib/deploy-status/signal-collector';

function setFetchMock(mock: jest.MockedFunction<typeof fetch>) {
  globalThis.fetch = mock as unknown as typeof fetch;
}

describe('deploy-status signal-collector', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.resetAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('prefers loopback baseUrl (no egress) when no explicit baseUrl is provided', async () => {
    process.env.PORT = '3000';
    process.env.NEXT_PUBLIC_APP_URL = 'https://control-center.stage.afu9.cloud';

    const fetchMock = jest.fn(async (url: string) => {
      if (url.startsWith('http://127.0.0.1:3000/api/health')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'ok' }),
        };
      }

      if (url.startsWith('http://127.0.0.1:3000/api/ready')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ready: true }),
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as jest.MockedFunction<typeof fetch>;

    setFetchMock(fetchMock);

    const signals = await collectStatusSignals(null, {
      env: 'stage',
      includeDeployEvents: false,
    });

    expect(signals.health?.ok).toBe(true);
    expect(signals.ready?.ready).toBe(true);
    expect(signals.health?.base_url).toBe('http://127.0.0.1:3000');
    expect(signals.ready?.base_url).toBe('http://127.0.0.1:3000');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/health',
      expect.any(Object)
    );
  });

  test('falls back to NEXT_PUBLIC_APP_URL if loopback fetch fails with network error', async () => {
    process.env.PORT = '3000';
    process.env.NEXT_PUBLIC_APP_URL = 'https://control-center.stage.afu9.cloud';

    type FetchFailedError = TypeError & { cause?: { code?: string } };
    const networkError = new TypeError('fetch failed') as FetchFailedError;
    networkError.cause = { code: 'ECONNREFUSED' };

    const fetchMock = jest.fn(async (url: string) => {
      if (url.startsWith('http://127.0.0.1:3000/api/health')) {
        throw networkError;
      }
      if (url.startsWith('https://control-center.stage.afu9.cloud/api/health')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'ok' }),
        };
      }
      if (url.startsWith('http://127.0.0.1:3000/api/ready')) {
        throw networkError;
      }
      if (url.startsWith('https://control-center.stage.afu9.cloud/api/ready')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ready: true }),
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as jest.MockedFunction<typeof fetch>;

    setFetchMock(fetchMock);

    const signals = await collectStatusSignals(null, {
      env: 'stage',
      includeDeployEvents: false,
    });

    expect(signals.health?.ok).toBe(true);
    expect(signals.health?.base_url).toBe('https://control-center.stage.afu9.cloud');
    expect(signals.health?.attempted_urls).toEqual([
      'http://127.0.0.1:3000/api/health',
      'https://control-center.stage.afu9.cloud/api/health',
    ]);

    expect(signals.ready?.ready).toBe(true);
    expect(signals.ready?.base_url).toBe('https://control-center.stage.afu9.cloud');

    // Ensure we attempted loopback first.
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:3000/api/health');
  });

  test('uses explicit baseUrl when provided (no fallback)', async () => {
    process.env.PORT = '3000';
    process.env.NEXT_PUBLIC_APP_URL = 'https://should-not-be-used.example.com';

    const fetchMock = jest.fn(async (url: string) => {
      if (url.startsWith('http://explicit.example/api/health')) {
        return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
      }
      if (url.startsWith('http://explicit.example/api/ready')) {
        return { ok: true, status: 200, json: async () => ({ ready: true }) };
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as jest.MockedFunction<typeof fetch>;

    setFetchMock(fetchMock);

    const signals = await collectStatusSignals(null, {
      env: 'prod',
      baseUrl: 'http://explicit.example',
      includeDeployEvents: false,
    });

    expect(signals.health?.base_url).toBe('http://explicit.example');
    expect(signals.ready?.base_url).toBe('http://explicit.example');
    expect(signals.health?.attempted_urls).toEqual(['http://explicit.example/api/health']);
  });
});
