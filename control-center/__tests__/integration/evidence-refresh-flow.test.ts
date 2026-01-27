/**
 * Integration Test: Evidence Refresh Flow
 * 
 * Demonstrates the end-to-end flow for I201.6:
 * 1. Create a run
 * 2. Refresh evidence reference
 * 3. Retrieve run details with evidenceRef
 * 
 * Reference: I201.6 (Evidence Link/Refresh)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import { getRunsDAO } from '../../src/lib/db/afu9Runs';
import { RunSpec } from '../../src/lib/contracts/afu9Runner';
import { v4 as uuidv4 } from 'uuid';

describe('Evidence Refresh Integration', () => {
  let pool: Pool;
  let dao: ReturnType<typeof getRunsDAO>;

  beforeAll(() => {
    // In a real integration test, this would connect to a test database
    const mockQuery = jest.fn();
    const mockClient = {
      query: mockQuery,
      release: jest.fn(),
    };

    pool = {
      query: mockQuery,
      connect: jest.fn().mockResolvedValue(mockClient),
    } as unknown as Pool;
    dao = getRunsDAO(pool);
  });

  test('Evidence refresh flow', async () => {
    const runId = uuidv4();
    const issueId = uuidv4();
    
    // Step 1: Create a run
    const spec: RunSpec = {
      title: 'Test Evidence Run',
      runtime: 'dummy',
      steps: [
        {
          name: 'Test Step',
          shell: 'bash',
          command: 'echo "test"',
        },
      ],
    };

    // Mock the database responses
    const mockQuery = pool.query as jest.Mock;
    mockQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT run
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT step
    mockQuery.mockResolvedValueOnce({ rows: [] }); // COMMIT

    await dao.createRun(runId, spec, issueId);

    // Step 2: Update evidence reference
    const evidenceUrl = 's3://bucket/evidence/run-123.json';
    const evidenceHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const evidenceVersion = '1.0';

    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE evidence

    await dao.updateEvidenceRef(runId, evidenceUrl, evidenceHash, evidenceVersion);

    // Step 3: Retrieve run with evidence reference
    const mockRun = {
      id: runId,
      issue_id: issueId,
      title: 'Test Evidence Run',
      status: 'SUCCEEDED',
      spec_json: spec,
      evidence_url: evidenceUrl,
      evidence_hash: evidenceHash,
      evidence_fetched_at: new Date('2024-01-01T12:00:00Z'),
      evidence_version: evidenceVersion,
      created_at: new Date('2024-01-01T00:00:00Z'),
      started_at: new Date('2024-01-01T00:05:00Z'),
      finished_at: new Date('2024-01-01T00:10:00Z'),
    };

    mockQuery.mockResolvedValueOnce({ rows: [mockRun] }); // SELECT run
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT steps
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT artifacts

    const result = await dao.reconstructRunResult(runId);

    // Verify the result includes evidenceRef
    expect(result).toBeDefined();
    expect(result?.evidenceRef).toBeDefined();
    expect(result?.evidenceRef?.url).toBe(evidenceUrl);
    expect(result?.evidenceRef?.evidenceHash).toBe(evidenceHash);
    expect(result?.evidenceRef?.fetchedAt).toBe('2024-01-01T12:00:00.000Z');
    expect(result?.evidenceRef?.version).toBe(evidenceVersion);
  });

  test('Run without evidence reference', async () => {
    const runId = uuidv4();
    const spec: RunSpec = {
      title: 'Test Run Without Evidence',
      runtime: 'dummy',
      steps: [
        {
          name: 'Test Step',
          shell: 'bash',
          command: 'echo "test"',
        },
      ],
    };

    const mockQuery = pool.query as jest.Mock;

    // Mock run without evidence
    const mockRun = {
      id: runId,
      issue_id: null,
      title: 'Test Run Without Evidence',
      status: 'SUCCEEDED',
      spec_json: spec,
      evidence_url: null,
      evidence_hash: null,
      evidence_fetched_at: null,
      evidence_version: null,
      created_at: new Date('2024-01-01T00:00:00Z'),
    };

    mockQuery.mockResolvedValueOnce({ rows: [mockRun] }); // SELECT run
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT steps
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT artifacts

    const result = await dao.reconstructRunResult(runId);

    // Verify the result does NOT include evidenceRef when not set
    expect(result).toBeDefined();
    expect(result?.evidenceRef).toBeUndefined();
  });
});
