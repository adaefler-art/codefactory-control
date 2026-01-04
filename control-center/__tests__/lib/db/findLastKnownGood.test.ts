/**
 * Last Known Good (LKG) Query Tests (I773 / E77.3)
 * 
 * Tests for findLastKnownGood database query:
 * - Returns null when no GREEN snapshots exist
 * - Returns null when no verification PASS exists
 * - Returns most recent GREEN+PASS snapshot
 * - Filters by service when provided
 * - Includes all required deployment metadata
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  findLastKnownGood,
  LastKnownGoodDeploy,
} from '@/lib/db/deployStatusSnapshots';

// Mock pool for testing
const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
} as unknown as Pool;

describe('findLastKnownGood', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return null when no snapshots exist', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await findLastKnownGood(mockPool, 'prod');

    expect(result.success).toBe(true);
    expect(result.lkg).toBeNull();
  });

  it('should return null when no GREEN snapshots exist', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await findLastKnownGood(mockPool, 'prod');

    expect(result.success).toBe(true);
    expect(result.lkg).toBeNull();
    
    // Verify query filters for GREEN status
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("dss.status = 'GREEN'"),
      expect.any(Array)
    );
  });

  it('should return null when verification is not PASS', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await findLastKnownGood(mockPool, 'prod');

    expect(result.success).toBe(true);
    expect(result.lkg).toBeNull();
    
    // Verify query filters for verification success
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("'{verificationRun,status}' = 'success'"),
      expect.any(Array)
    );
  });

  it('should return null when reportHash is missing', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await findLastKnownGood(mockPool, 'prod');

    expect(result.success).toBe(true);
    expect(result.lkg).toBeNull();
    
    // Verify query requires reportHash
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("'{verificationRun,reportHash}' IS NOT NULL"),
      expect.any(Array)
    );
  });

  it('should return most recent LKG when multiple exist', async () => {
    const lkgRow = {
      snapshot_id: 'snap-123',
      deploy_event_id: 'deploy-456',
      env: 'prod',
      service: 'api',
      version: 'v1.2.3',
      commit_hash: 'abc123def456',
      observed_at: '2025-01-04T12:00:00Z',
      verification_run_id: 'ver-789',
      verification_report_hash: 'hash-abc',
      image_digest: null,
      cfn_changeset_id: null,
    };

    mockQuery.mockResolvedValue({ rows: [lkgRow] });

    const result = await findLastKnownGood(mockPool, 'prod');

    expect(result.success).toBe(true);
    expect(result.lkg).toEqual({
      snapshotId: 'snap-123',
      deployEventId: 'deploy-456',
      env: 'prod',
      service: 'api',
      version: 'v1.2.3',
      commitHash: 'abc123def456',
      imageDigest: null,
      imageDigests: null,
      imageDigests: null, // Added field
      cfnChangeSetId: null,
      observedAt: '2025-01-04T12:00:00Z',
      verificationRunId: 'ver-789',
      verificationReportHash: 'hash-abc',
    });
    
    // Verify query orders by observed_at DESC and limits to 1
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY dss.observed_at DESC'),
      expect.any(Array)
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT 1'),
      expect.any(Array)
    );
  });

  it('should filter by service when provided', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await findLastKnownGood(mockPool, 'prod', 'api');

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('AND de.service = $2'),
      ['prod', 'api']
    );
  });

  it('should not filter by service when not provided', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await findLastKnownGood(mockPool, 'prod');

    expect(mockQuery).toHaveBeenCalledWith(
      expect.not.stringContaining('AND de.service'),
      ['prod']
    );
  });

  it('should return LKG with image digest when commit hash is missing', async () => {
    const lkgRow = {
      snapshot_id: 'snap-123',
      deploy_event_id: null,
      env: 'prod',
      service: 'api',
      version: 'v1.2.3',
      commit_hash: null,
      observed_at: '2025-01-04T12:00:00Z',
      verification_run_id: 'ver-789',
      verification_report_hash: 'hash-abc',
      image_digest: 'sha256:abcd1234',
      cfn_changeset_id: null,
    };

    mockQuery.mockResolvedValue({ rows: [lkgRow] });

    const result = await findLastKnownGood(mockPool, 'prod');

    expect(result.success).toBe(true);
    expect(result.lkg?.commitHash).toBeNull();
    expect(result.lkg?.imageDigest).toBe('sha256:abcd1234');
  });

  it('should return LKG with CFN changeset ID when present', async () => {
    const lkgRow = {
      snapshot_id: 'snap-123',
      deploy_event_id: 'deploy-456',
      env: 'prod',
      service: 'api',
      version: 'v1.2.3',
      commit_hash: 'abc123def456',
      observed_at: '2025-01-04T12:00:00Z',
      verification_run_id: 'ver-789',
      verification_report_hash: 'hash-abc',
      image_digest: null,
      cfn_changeset_id: 'arn:aws:cloudformation:...',
    };

    mockQuery.mockResolvedValue({ rows: [lkgRow] });

    const result = await findLastKnownGood(mockPool, 'prod');

    expect(result.success).toBe(true);
    expect(result.lkg?.cfnChangeSetId).toBe('arn:aws:cloudformation:...');
  });

  it('should handle database errors gracefully', async () => {
    mockQuery.mockRejectedValue(new Error('Database connection failed'));

    const result = await findLastKnownGood(mockPool, 'prod');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Database');
  });

  it('should join with deploy_events to get commit and version', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await findLastKnownGood(mockPool, 'prod');

    // Verify LEFT JOIN with deploy_events
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('LEFT JOIN deploy_events de'),
      expect.any(Array)
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON dss.related_deploy_event_id = de.id'),
      expect.any(Array)
    );
  });

  it('should select all required LKG metadata fields', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await findLastKnownGood(mockPool, 'prod');

    const queryString = mockQuery.mock.calls[0][0];
    
    // Verify all required fields are selected
    expect(queryString).toContain('dss.id as snapshot_id');
    expect(queryString).toContain('dss.related_deploy_event_id as deploy_event_id');
    expect(queryString).toContain('dss.env');
    expect(queryString).toContain('de.service');
    expect(queryString).toContain('de.version');
    expect(queryString).toContain('de.commit_hash');
    expect(queryString).toContain('dss.observed_at');
    expect(queryString).toContain('{verificationRun,runId}');
    expect(queryString).toContain('{verificationRun,reportHash}');
    expect(queryString).toContain('{deploy,imageDigest}');
    expect(queryString).toContain('{deploy,cfnChangeSetId}');
  });
});
