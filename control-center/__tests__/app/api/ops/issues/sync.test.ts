/**
 * Tests for POST /api/ops/issues/sync
 *
 * Focus: GitHub status parity fields persistence + truthful counts
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST } from '../../../../../app/api/ops/issues/sync/route';

import { getPool } from '../../../../../src/lib/db';
import { searchIssues, getIssue } from '../../../../../src/lib/github';
import {
  createIssueSyncRun,
  updateIssueSyncRun,
  upsertIssueSnapshot,
} from '../../../../../src/lib/db/issueSync';
import { listAfu9Issues, updateAfu9Issue } from '@/lib/db/afu9Issues';
import { isRepoAllowed } from '@/lib/github/auth-wrapper';

jest.mock('../../../../../src/lib/db');
jest.mock('../../../../../src/lib/github');
jest.mock('../../../../../src/lib/db/issueSync');
jest.mock('@/lib/db/afu9Issues');
jest.mock('@/lib/github/auth-wrapper');

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;
const mockSearchIssues = searchIssues as jest.MockedFunction<typeof searchIssues>;
const mockGetIssue = getIssue as jest.MockedFunction<typeof getIssue>;
const mockCreateIssueSyncRun = createIssueSyncRun as jest.MockedFunction<typeof createIssueSyncRun>;
const mockUpdateIssueSyncRun = updateIssueSyncRun as jest.MockedFunction<typeof updateIssueSyncRun>;
const mockUpsertIssueSnapshot = upsertIssueSnapshot as jest.MockedFunction<typeof upsertIssueSnapshot>;
const mockListAfu9Issues = listAfu9Issues as jest.MockedFunction<typeof listAfu9Issues>;
const mockUpdateAfu9Issue = updateAfu9Issue as jest.MockedFunction<typeof updateAfu9Issue>;
const mockIsRepoAllowed = isRepoAllowed as jest.MockedFunction<typeof isRepoAllowed>;

describe('POST /api/ops/issues/sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetPool.mockReturnValue({} as never);
    mockIsRepoAllowed.mockReturnValue(true);

    mockCreateIssueSyncRun.mockResolvedValue({ success: true, data: 'run-1' } as never);
    mockUpdateIssueSyncRun.mockResolvedValue({ success: true } as never);

    mockSearchIssues.mockResolvedValue({ total_count: 0, issues: [] } as never);
    mockUpsertIssueSnapshot.mockResolvedValue({ success: true } as never);

    mockUpdateAfu9Issue.mockResolvedValue({ success: true, data: {} } as never);
  });

  it('persists github_status_raw=open/closed even when mirror is UNKNOWN', async () => {
    mockListAfu9Issues.mockResolvedValue({
      success: true,
      data: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          github_issue_number: 383,
          github_mirror_status: 'UNKNOWN',
        },
      ],
    } as never);

    mockGetIssue.mockResolvedValue({
      state: 'closed',
      updated_at: '2026-01-04T00:00:00.000Z',
      labels: [],
    } as never);

    const request = new NextRequest('http://localhost:3000/api/ops/issues/sync', {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'tester',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);

    expect(data.ok).toBe(true);
    expect(data.statusSyncAttempted).toBe(1);
    expect(data.statusFetchOk).toBe(1);
    expect(data.statusFetchFailed).toBe(0);
    expect(data.statusSynced).toBe(1);

    expect(mockUpdateAfu9Issue).toHaveBeenCalledTimes(1);
    const [, , updates] = mockUpdateAfu9Issue.mock.calls[0];

    expect(updates.github_mirror_status).toBe('UNKNOWN');
    expect(updates.github_status_raw).toBe('closed');
    expect(updates.github_status_updated_at).toBe('2026-01-04T00:00:00.000Z');
    expect(updates.status_source).toBe('github_state');
    expect(updates.github_sync_error).toBeNull();
    expect(typeof updates.github_issue_last_sync_at).toBe('string');
  });

  it('uses status: label as raw value and sets status_source=github_label', async () => {
    mockListAfu9Issues.mockResolvedValue({
      success: true,
      data: [
        {
          id: '22222222-2222-2222-2222-222222222222',
          github_issue_number: 12,
          github_mirror_status: 'UNKNOWN',
        },
      ],
    } as never);

    mockGetIssue.mockResolvedValue({
      state: 'open',
      updated_at: '2026-01-04T01:02:03.000Z',
      labels: [{ name: 'status: in progress' }],
    } as never);

    const request = new NextRequest('http://localhost:3000/api/ops/issues/sync', {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'tester',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.statusFetchOk).toBe(1);

    const [, , updates] = mockUpdateAfu9Issue.mock.calls[0];

    expect(updates.github_mirror_status).toBe('IN_PROGRESS');
    expect(updates.github_status_raw).toBe('status: in progress');
    expect(updates.github_status_updated_at).toBe('2026-01-04T01:02:03.000Z');
    expect(updates.status_source).toBe('github_label');
  });

  it('records sync error and increments fetchFailed on GitHub fetch failure', async () => {
    mockListAfu9Issues.mockResolvedValue({
      success: true,
      data: [
        {
          id: '33333333-3333-3333-3333-333333333333',
          github_issue_number: 99,
          github_mirror_status: 'UNKNOWN',
        },
      ],
    } as never);

    mockGetIssue.mockRejectedValue(new Error('Boom'));

    const request = new NextRequest('http://localhost:3000/api/ops/issues/sync', {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'tester',
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.statusSyncAttempted).toBe(1);
    expect(data.statusFetchOk).toBe(0);
    expect(data.statusFetchFailed).toBe(1);
    expect(data.statusSynced).toBe(1);

    const [, , updates] = mockUpdateAfu9Issue.mock.calls[0];
    expect(updates.github_mirror_status).toBe('UNKNOWN');
    expect(updates.github_status_raw).toBeNull();
    expect(updates.github_status_updated_at).toBeNull();
    expect(updates.status_source).toBeNull();
    expect(updates.github_sync_error).toBeTruthy();
  });
});
