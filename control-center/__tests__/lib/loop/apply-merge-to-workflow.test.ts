/**
 * Unit Tests: applyMergeToWorkflow
 *
 * @jest-environment node
 */

import { applyMergeToWorkflow } from '../../../src/lib/loop/applyMergeToWorkflow';
import { IssueState } from '../../../src/lib/loop/stateMachine';
import { recordEvidence } from '../../../src/lib/db/issueEvidence';
import { logTimelineEvent } from '../../../src/lib/db/issueTimeline';
import { recordTimelineEvent } from '../../../src/lib/db/unifiedTimelineEvents';

jest.mock('../../../src/lib/db/issueEvidence', () => ({
  recordEvidence: jest.fn(),
}));

jest.mock('../../../src/lib/db/issueTimeline', () => ({
  logTimelineEvent: jest.fn(),
}));

jest.mock('../../../src/lib/db/unifiedTimelineEvents', () => ({
  recordTimelineEvent: jest.fn(),
}));

describe('applyMergeToWorkflow', () => {
  const mockRecordEvidence = recordEvidence as jest.Mock;
  const mockLogTimelineEvent = logTimelineEvent as jest.Mock;
  const mockRecordTimelineEvent = recordTimelineEvent as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRecordEvidence.mockResolvedValue({ success: true });
    mockLogTimelineEvent.mockResolvedValue({ success: true });
    mockRecordTimelineEvent.mockResolvedValue({ id: 'evt-1' });
  });

  it('updates issue state and records mesh events', async () => {
    const client = {
      query: jest.fn(async (query: string) => {
        if (query.startsWith('BEGIN')) {
          return { rows: [] };
        }
        if (query.includes('SELECT id, status, pr_url')) {
          return {
            rows: [
              {
                id: 'issue-1',
                status: IssueState.REVIEW_READY,
                pr_url: 'https://github.com/org/repo/pull/123',
              },
            ],
          };
        }
        if (query.startsWith('UPDATE afu9_issues')) {
          return { rows: [] };
        }
        if (query.startsWith('COMMIT')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };

    const pool = {
      connect: jest.fn(async () => client),
    } as any;

    const result = await applyMergeToWorkflow({
      pool,
      issueId: 'issue-1',
      repository: { owner: 'org', repo: 'repo' },
      prNumber: 123,
      prUrl: 'https://github.com/org/repo/pull/123',
      mergeSha: 'merge-sha-1',
      mergedAt: '2026-02-07T10:00:00.000Z',
      requestId: 'req-merge-1',
      source: 'executor',
    });

    expect(result.ok).toBe(true);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE afu9_issues'),
      [IssueState.DONE, 'issue-1']
    );
    expect(mockRecordEvidence).toHaveBeenCalled();
    expect(mockLogTimelineEvent).toHaveBeenCalled();
    expect(mockRecordTimelineEvent).toHaveBeenCalled();
  });

  it('returns MESH_UPDATE_FAILED when issue is missing', async () => {
    const client = {
      query: jest.fn(async (query: string) => {
        if (query.startsWith('BEGIN')) {
          return { rows: [] };
        }
        if (query.includes('SELECT id, status, pr_url')) {
          return { rows: [] };
        }
        if (query.startsWith('ROLLBACK')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };

    const pool = {
      connect: jest.fn(async () => client),
    } as any;

    const result = await applyMergeToWorkflow({
      pool,
      repository: { owner: 'org', repo: 'repo' },
      prNumber: 123,
      requestId: 'req-merge-2',
      source: 'webhook',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('MESH_UPDATE_FAILED');
    }
  });
});
