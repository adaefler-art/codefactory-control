/**
 * Smoke Key Diagnostics API Tests
 *
 * Tests for:
 * - GET /api/diagnostics/smoke-key/allowlist
 * - POST /api/diagnostics/smoke-key/allowlist/seed
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/diagnostics/smoke-key/allowlist/route';
import { POST } from '../../app/api/diagnostics/smoke-key/allowlist/seed/route';
import { middleware } from '../../proxy';

jest.mock('@/lib/db/smokeKeyAllowlist', () => {
  const actual = jest.requireActual('@/lib/db/smokeKeyAllowlist');
  return {
    ...actual,
    getActiveAllowlist: jest.fn(),
    seedSmokeKeyAllowlistEntries: jest.fn(),
  };
});

import {
  getActiveAllowlist,
  seedSmokeKeyAllowlistEntries,
  type SmokeKeyAllowlistEntry,
} from '@/lib/db/smokeKeyAllowlist';

const mockGetActiveAllowlist = getActiveAllowlist as jest.MockedFunction<typeof getActiveAllowlist>;
const mockSeedAllowlist = seedSmokeKeyAllowlistEntries as jest.MockedFunction<typeof seedSmokeKeyAllowlistEntries>;

describe('GET /api/diagnostics/smoke-key/allowlist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AFU9_SMOKE_KEY = 'secret';
  });

  afterEach(() => {
    delete process.env.AFU9_SMOKE_KEY;
  });

  test('returns 401 when smoke key header is missing', async () => {
    const request = new NextRequest('https://stage.afu-9.com/api/diagnostics/smoke-key/allowlist', {
      method: 'GET',
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  test('returns allowlist status with valid smoke key', async () => {
    const allowlist: SmokeKeyAllowlistEntry[] = [
      {
        id: 1,
        route_pattern: '/api/afu9/s1s3/issues/pick',
        method: 'POST',
        is_regex: false,
        description: 'AFU9 S1S3 pick issue (E9.1 smoke)',
        added_by: 'system:migration:087',
        added_at: '2026-01-25T00:00:00Z',
        removed_by: null,
        removed_at: null,
        created_at: '2026-01-25T00:00:00Z',
        updated_at: '2026-01-25T00:00:00Z',
      },
      {
        id: 2,
        route_pattern: '^/api/afu9/s1s3/issues/[^/]+/spec$',
        method: 'POST',
        is_regex: true,
        description: 'AFU9 S1S3 issue spec (E9.1 smoke)',
        added_by: 'system:migration:087',
        added_at: '2026-01-25T00:00:00Z',
        removed_by: null,
        removed_at: null,
        created_at: '2026-01-25T00:00:00Z',
        updated_at: '2026-01-25T00:00:00Z',
      },
    ];

    mockGetActiveAllowlist.mockResolvedValueOnce({ success: true, data: allowlist });

    const request = new NextRequest('https://stage.afu-9.com/api/diagnostics/smoke-key/allowlist', {
      method: 'GET',
      headers: {
        'x-afu9-smoke-key': 'secret',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stage).toBe('staging');
    expect(data.smokeKeyMatch).toBe(true);

    const pickEntry = data.allowlisted.find((entry: any) => entry.path === '/api/afu9/s1s3/issues/pick');
    const specEntry = data.allowlisted.find((entry: any) => entry.path === '/api/afu9/s1s3/issues/{id}/spec');
    const checksEntry = data.allowlisted.find((entry: any) => entry.path === '/api/afu9/s1s3/prs/{prNumber}/checks');

    expect(pickEntry?.present).toBe(true);
    expect(specEntry?.present).toBe(true);
    expect(checksEntry?.present).toBe(false);
  });
});

describe('POST /api/diagnostics/smoke-key/allowlist/seed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AFU9_SMOKE_KEY = 'secret';
  });

  afterEach(() => {
    delete process.env.AFU9_SMOKE_KEY;
  });

  test('seeds allowlist on staging with valid smoke key', async () => {
    mockSeedAllowlist.mockResolvedValueOnce({
      success: true,
      inserted: 2,
      alreadyPresent: 5,
    });

    const request = new NextRequest('https://stage.afu-9.com/api/diagnostics/smoke-key/allowlist/seed', {
      method: 'POST',
      headers: {
        'x-afu9-smoke-key': 'secret',
      },
    });

    const middlewareResponse = await middleware(request);
    expect(middlewareResponse.status).toBe(200);
    expect(middlewareResponse.headers.get('x-afu9-smoke-bypass')).toBe('1');

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.inserted).toBeGreaterThanOrEqual(0);
    expect(data.alreadyPresent).toBeGreaterThanOrEqual(0);
    expect(mockSeedAllowlist).toHaveBeenCalled();
  });

  test('blocks seed on non-staging hosts', async () => {
    const request = new NextRequest('https://afu-9.com/api/diagnostics/smoke-key/allowlist/seed', {
      method: 'POST',
      headers: {
        'x-afu9-smoke-key': 'secret',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe('STAGE_ONLY');
    expect(mockSeedAllowlist).not.toHaveBeenCalled();
  });
});
