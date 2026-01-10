/**
 * Tests for PATCH /api/admin/cost-control/settings env guard
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { PATCH } from '../../../../../app/api/admin/cost-control/settings/route';
import { getPool } from '../../../../../src/lib/db';

jest.mock('../../../../../src/lib/db');

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

describe('PATCH /api/admin/cost-control/settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPool.mockReturnValue({} as never);
    process.env.AFU9_ADMIN_SUBS = 'admin-user';
  });

  afterEach(() => {
    delete process.env.AFU9_ADMIN_SUBS;
  });

  it('blocks env != staging with 403 before DB', async () => {
    const request = new NextRequest('http://localhost:3000/api/admin/cost-control/settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-afu9-sub': 'admin-user',
      },
      body: JSON.stringify({ env: 'production', key: 'stagingEcsDesiredCount', value: 0 }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe('ENV_FORBIDDEN');
    expect(mockGetPool).not.toHaveBeenCalled();
  });
});
