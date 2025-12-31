/**
 * AFU-9 Ingestion Tests
 * 
 * Tests for AFU-9 ingestion functions:
 * - Idempotency (safe to re-run)
 * - Deterministic node IDs
 * - Evidence-first source references
 * - Lawbook version propagation
 * - Error handling
 * 
 * Reference: I723 (E72.3 - AFU-9 Ingestion)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  ingestRun,
  ingestDeploy,
  ingestVerdict,
  ingestVerification,
  RunNotFoundError,
  DeployNotFoundError,
  VerdictNotFoundError,
  VerificationNotFoundError,
} from '../../src/lib/afu9-ingestion';
import { TimelineDAO } from '../../src/lib/db/timeline';

// Mock dependencies
jest.mock('../../src/lib/db/timeline');

// Mock TimelineDAO
const mockUpsertNode = jest.fn();
const mockGetNodeByNaturalKey = jest.fn();
const mockCreateSource = jest.fn();
const mockCreateEdge = jest.fn();

const MockTimelineDAO = TimelineDAO as jest.MockedClass<typeof TimelineDAO>;

describe('AFU-9 Ingestion', () => {
  let mockPool: jest.Mocked<Pool>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup TimelineDAO mock
    MockTimelineDAO.mockImplementation(() => ({
      upsertNode: mockUpsertNode,
      getNodeByNaturalKey: mockGetNodeByNaturalKey,
      createSource: mockCreateSource,
      createEdge: mockCreateEdge,
    } as any));

    // Mock pool.query
    mockPool = {
      query: jest.fn(),
    } as any;
  });

  describe('ingestRun', () => {
    test('creates new RUN node with steps and artifacts', async () => {
      const runId = 'test-run-123';
      const mockRunData = {
        id: runId,
        issue_id: 'issue-456',
        title: 'Test Run',
        playbook_id: 'playbook-1',
        parent_run_id: null,
        status: 'SUCCEEDED',
        spec_json: { steps: [] },
        result_json: { exitCode: 0 },
        created_at: new Date('2024-01-01T00:00:00Z'),
        started_at: new Date('2024-01-01T00:01:00Z'),
        finished_at: new Date('2024-01-01T00:10:00Z'),
      };

      const mockSteps = [
        {
          id: 'step-1',
          run_id: runId,
          idx: 0,
          name: 'Step 1',
          status: 'SUCCEEDED',
          exit_code: 0,
          duration_ms: 1000,
          stdout_tail: 'output',
          stderr_tail: null,
        },
      ];

      const mockArtifacts = [
        {
          id: 'artifact-1',
          run_id: runId,
          step_idx: 0,
          kind: 'log',
          name: 'step1.log',
          ref: 's3://bucket/step1.log',
          bytes: 1024,
          sha256: 'abc123',
          created_at: new Date('2024-01-01T00:02:00Z'),
        },
      ];

      // Mock database queries
      mockPool.query
        .mockResolvedValueOnce({ rows: [mockRunData] } as any) // runs query
        .mockResolvedValueOnce({ rows: mockSteps } as any) // run_steps query
        .mockResolvedValueOnce({ rows: mockArtifacts } as any); // run_artifacts query

      mockGetNodeByNaturalKey.mockResolvedValue(null); // Node doesn't exist

      mockUpsertNode
        .mockResolvedValueOnce({
          id: 'node-uuid-run',
          source_system: 'afu9',
          source_type: 'run',
          source_id: 'run:test-run-123',
          node_type: 'RUN',
          title: 'Test Run',
          url: null,
          payload_json: {},
          lawbook_version: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        })
        .mockResolvedValueOnce({
          id: 'node-uuid-step',
          source_system: 'afu9',
          source_type: 'run_step',
          source_id: 'run_step:step-1',
          node_type: 'ARTIFACT',
          title: 'Step 0: Step 1',
          url: null,
          payload_json: {},
          lawbook_version: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        })
        .mockResolvedValueOnce({
          id: 'node-uuid-artifact',
          source_system: 'afu9',
          source_type: 'run_artifact',
          source_id: 'run_artifact:artifact-1',
          node_type: 'ARTIFACT',
          title: 'log: step1.log',
          url: null,
          payload_json: {},
          lawbook_version: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        });

      mockCreateSource.mockResolvedValue({
        id: 'source-uuid',
        node_id: 'node-uuid',
        source_kind: 'afu9_db',
        ref_json: {},
        sha256: null,
        content_hash: null,
        created_at: '2024-01-01T00:00:00Z',
      });

      mockCreateEdge.mockResolvedValue({
        id: 'edge-uuid',
        from_node_id: 'node-uuid-run',
        to_node_id: 'node-uuid-step',
        edge_type: 'RUN_HAS_ARTIFACT',
        payload_json: {},
        created_at: '2024-01-01T00:00:00Z',
      });

      const result = await ingestRun({ runId }, mockPool as any);

      expect(result).toEqual({
        nodeId: 'node-uuid-run',
        naturalKey: 'afu9:run:run:test-run-123',
        isNew: true,
        source_system: 'afu9',
        source_type: 'run',
        source_id: 'run:test-run-123',
        runId,
        stepNodeIds: ['node-uuid-step'],
        artifactNodeIds: ['node-uuid-artifact'],
        edgeIds: expect.arrayContaining(['edge-uuid']),
      });

      expect(mockUpsertNode).toHaveBeenCalledTimes(3); // run + step + artifact
      expect(mockCreateSource).toHaveBeenCalledTimes(3);
      expect(mockCreateEdge).toHaveBeenCalledTimes(2); // step edge + artifact edge
    });

    test('is idempotent - returns existing node on re-run', async () => {
      const runId = 'test-run-123';
      const mockRunData = {
        id: runId,
        issue_id: null,
        title: 'Test Run',
        playbook_id: null,
        parent_run_id: null,
        status: 'SUCCEEDED',
        spec_json: {},
        result_json: {},
        created_at: new Date('2024-01-01T00:00:00Z'),
        started_at: null,
        finished_at: null,
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [mockRunData] } as any)
        .mockResolvedValueOnce({ rows: [] } as any) // no steps
        .mockResolvedValueOnce({ rows: [] } as any); // no artifacts

      mockGetNodeByNaturalKey.mockResolvedValue({
        id: 'existing-node-uuid',
        source_system: 'afu9',
        source_type: 'run',
        source_id: 'run:test-run-123',
        node_type: 'RUN',
        title: 'Test Run',
        url: null,
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      mockUpsertNode.mockResolvedValue({
        id: 'existing-node-uuid',
        source_system: 'afu9',
        source_type: 'run',
        source_id: 'run:test-run-123',
        node_type: 'RUN',
        title: 'Test Run',
        url: null,
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      mockCreateSource.mockResolvedValue({
        id: 'source-uuid',
        node_id: 'existing-node-uuid',
        source_kind: 'afu9_db',
        ref_json: {},
        sha256: null,
        content_hash: null,
        created_at: '2024-01-01T00:00:00Z',
      });

      const result = await ingestRun({ runId }, mockPool as any);

      expect(result.isNew).toBe(false);
      expect(result.nodeId).toBe('existing-node-uuid');
    });

    test('throws RunNotFoundError when run does not exist', async () => {
      const runId = 'nonexistent-run';

      mockPool.query.mockResolvedValueOnce({ rows: [] } as any);

      await expect(ingestRun({ runId }, mockPool as any)).rejects.toThrow(RunNotFoundError);
    });

    test('generates stable source_id for same run', async () => {
      const runId = 'test-run-123';
      const mockRunData = {
        id: runId,
        title: 'Test',
        status: 'SUCCEEDED',
        spec_json: {},
        created_at: new Date(),
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [mockRunData] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      mockGetNodeByNaturalKey.mockResolvedValue(null);
      mockUpsertNode.mockResolvedValue({
        id: 'node-uuid',
        source_system: 'afu9',
        source_type: 'run',
        source_id: 'run:test-run-123',
        node_type: 'RUN',
        title: 'Test',
        url: null,
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });
      mockCreateSource.mockResolvedValue({} as any);

      const result1 = await ingestRun({ runId }, mockPool as any);
      
      // Reset mocks and run again
      jest.clearAllMocks();
      mockPool.query
        .mockResolvedValueOnce({ rows: [mockRunData] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);
      mockGetNodeByNaturalKey.mockResolvedValue(null);
      mockUpsertNode.mockResolvedValue({
        id: 'node-uuid',
        source_system: 'afu9',
        source_type: 'run',
        source_id: 'run:test-run-123',
        node_type: 'RUN',
        title: 'Test',
        url: null,
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });
      mockCreateSource.mockResolvedValue({} as any);

      const result2 = await ingestRun({ runId }, mockPool as any);

      expect(result1.source_id).toBe(result2.source_id);
      expect(result1.source_id).toBe('run:test-run-123');
    });
  });

  describe('ingestDeploy', () => {
    test('creates new DEPLOY node with metadata', async () => {
      const deployId = '550e8400-e29b-41d4-a716-446655440000';
      const mockDeployData = {
        id: deployId,
        created_at: new Date('2024-01-01T00:00:00Z'),
        env: 'production',
        service: 'api',
        version: 'v1.0.0',
        commit_hash: 'abc123',
        status: 'SUCCESS',
        message: 'Deployed successfully',
      };

      mockPool.query.mockResolvedValueOnce({ rows: [mockDeployData] } as any);

      mockGetNodeByNaturalKey.mockResolvedValue(null);

      mockUpsertNode.mockResolvedValue({
        id: 'node-uuid-deploy',
        source_system: 'afu9',
        source_type: 'deploy_event',
        source_id: `deploy:${deployId}`,
        node_type: 'DEPLOY',
        title: 'Deploy api to production',
        url: null,
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      mockCreateSource.mockResolvedValue({
        id: 'source-uuid',
        node_id: 'node-uuid-deploy',
        source_kind: 'afu9_db',
        ref_json: {},
        sha256: null,
        content_hash: null,
        created_at: '2024-01-01T00:00:00Z',
      });

      const result = await ingestDeploy({ deployId }, mockPool as any);

      expect(result).toEqual({
        nodeId: 'node-uuid-deploy',
        naturalKey: `afu9:deploy_event:deploy:${deployId}`,
        isNew: true,
        source_system: 'afu9',
        source_type: 'deploy_event',
        source_id: `deploy:${deployId}`,
        deployId,
      });

      expect(mockUpsertNode).toHaveBeenCalledTimes(1);
      expect(mockCreateSource).toHaveBeenCalledTimes(1);
    });

    test('throws DeployNotFoundError when deploy does not exist', async () => {
      const deployId = '550e8400-e29b-41d4-a716-446655440000';

      mockPool.query.mockResolvedValueOnce({ rows: [] } as any);

      await expect(ingestDeploy({ deployId }, mockPool as any)).rejects.toThrow(DeployNotFoundError);
    });
  });

  describe('ingestVerdict', () => {
    test('creates new VERDICT node with lawbookVersion', async () => {
      const verdictId = '550e8400-e29b-41d4-a716-446655440001';
      const mockVerdictData = {
        id: verdictId,
        execution_id: '550e8400-e29b-41d4-a716-446655440002',
        policy_snapshot_id: '550e8400-e29b-41d4-a716-446655440003',
        fingerprint_id: 'fp-123',
        error_class: 'ACM_DNS_VALIDATION_PENDING',
        service: 'ACM',
        confidence_score: 90,
        proposed_action: 'WAIT_AND_RETRY',
        tokens: ['ACM', 'DNS', 'validation'],
        signals: { pattern: 'DNS validation.*pending' },
        playbook_id: 'pb-1',
        created_at: new Date('2024-01-01T00:00:00Z'),
        metadata: {},
        lawbook_version: 'v1.0.0',
      };

      mockPool.query.mockResolvedValueOnce({ rows: [mockVerdictData] } as any);

      mockGetNodeByNaturalKey.mockResolvedValue(null);

      mockUpsertNode.mockResolvedValue({
        id: 'node-uuid-verdict',
        source_system: 'afu9',
        source_type: 'verdict',
        source_id: `verdict:${verdictId}`,
        node_type: 'VERDICT',
        title: 'Verdict: ACM_DNS_VALIDATION_PENDING',
        url: null,
        payload_json: {},
        lawbook_version: 'v1.0.0',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      mockCreateSource.mockResolvedValue({
        id: 'source-uuid',
        node_id: 'node-uuid-verdict',
        source_kind: 'afu9_db',
        ref_json: {},
        sha256: null,
        content_hash: null,
        created_at: '2024-01-01T00:00:00Z',
      });

      const result = await ingestVerdict({ verdictId }, mockPool as any);

      expect(result).toEqual({
        nodeId: 'node-uuid-verdict',
        naturalKey: `afu9:verdict:verdict:${verdictId}`,
        isNew: true,
        source_system: 'afu9',
        source_type: 'verdict',
        source_id: `verdict:${verdictId}`,
        verdictId,
        lawbookVersion: 'v1.0.0',
      });

      expect(mockUpsertNode).toHaveBeenCalledWith(
        expect.objectContaining({
          lawbook_version: 'v1.0.0',
        })
      );
    });

    test('throws VerdictNotFoundError when verdict does not exist', async () => {
      const verdictId = '550e8400-e29b-41d4-a716-446655440001';

      mockPool.query.mockResolvedValueOnce({ rows: [] } as any);

      await expect(ingestVerdict({ verdictId }, mockPool as any)).rejects.toThrow(VerdictNotFoundError);
    });
  });

  describe('ingestVerification', () => {
    test('creates new ARTIFACT node for verification report', async () => {
      const reportId = '550e8400-e29b-41d4-a716-446655440004';
      const mockReportData = {
        id: reportId,
        snapshot_time: new Date('2024-01-01T00:00:00Z'),
        env: 'production',
        status: 'GREEN',
        details: { checks: [] },
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      mockPool.query.mockResolvedValueOnce({ rows: [mockReportData] } as any);

      mockGetNodeByNaturalKey.mockResolvedValue(null);

      mockUpsertNode.mockResolvedValue({
        id: 'node-uuid-verification',
        source_system: 'afu9',
        source_type: 'verification_report',
        source_id: `verification:${reportId}`,
        node_type: 'ARTIFACT',
        title: 'Verification Report: production - GREEN',
        url: null,
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      mockCreateSource.mockResolvedValue({
        id: 'source-uuid',
        node_id: 'node-uuid-verification',
        source_kind: 'afu9_db',
        ref_json: {},
        sha256: null,
        content_hash: null,
        created_at: '2024-01-01T00:00:00Z',
      });

      const result = await ingestVerification({ reportId }, mockPool as any);

      expect(result).toEqual({
        nodeId: 'node-uuid-verification',
        naturalKey: `afu9:verification_report:verification:${reportId}`,
        isNew: true,
        source_system: 'afu9',
        source_type: 'verification_report',
        source_id: `verification:${reportId}`,
        reportId,
      });

      expect(mockUpsertNode).toHaveBeenCalledTimes(1);
      expect(mockCreateSource).toHaveBeenCalledTimes(1);
    });

    test('throws VerificationNotFoundError when report does not exist', async () => {
      const reportId = '550e8400-e29b-41d4-a716-446655440004';

      mockPool.query.mockResolvedValueOnce({ rows: [] } as any);

      await expect(ingestVerification({ reportId }, mockPool as any)).rejects.toThrow(VerificationNotFoundError);
    });
  });
});
