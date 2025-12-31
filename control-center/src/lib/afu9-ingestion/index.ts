/**
 * AFU-9 Ingestion - Core Functions
 * 
 * Server-side ingestion of AFU-9 internal artifacts (Runs, Deploys, Verdicts, Verification Reports)
 * into the Timeline/Linkage Model with idempotent upsert semantics.
 * 
 * Reference: I723 (E72.3 - AFU-9 Ingestion)
 * 
 * NON-NEGOTIABLES:
 * - Determinism: stable node/edge mapping; stable timestamps; stable ordering
 * - Idempotency: ingestion is upsert; unique constraints prevent duplicates
 * - Evidence-first: store source refs back to AFU-9 DB rows/artifact IDs + hashes
 * - Lawbook transparency: propagate lawbookVersion into VERDICT nodes/events
 * - No trial-and-error: ingestion must not mutate original run/deploy records
 */

import { Pool } from 'pg';
import { TimelineDAO } from '../db/timeline';
import { createHash } from 'crypto';
import {
  IngestRunParams,
  IngestRunParamsSchema,
  IngestDeployParams,
  IngestDeployParamsSchema,
  IngestVerdictParams,
  IngestVerdictParamsSchema,
  IngestVerificationParams,
  IngestVerificationParamsSchema,
  IngestRunResult,
  IngestDeployResult,
  IngestVerdictResult,
  IngestVerificationResult,
  RunNotFoundError,
  DeployNotFoundError,
  VerdictNotFoundError,
  VerificationNotFoundError,
  AFU9IngestionError,
} from './types';

// ========================================
// Helper Functions
// ========================================

/**
 * Generate deterministic source_id for AFU-9 objects
 * Format: run:{runId}, deploy:{deployId}, verdict:{verdictId}, verification:{reportId}
 */
function generateAFU9SourceId(type: string, id: string): string {
  return `${type}:${id}`;
}

/**
 * Compute SHA-256 hash of content for evidence
 */
function computeSha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Check if node was already fetched recently (to track isNew)
 */
async function checkIfNodeExists(
  dao: TimelineDAO,
  source_system: string,
  source_type: string,
  source_id: string
): Promise<boolean> {
  const existing = await dao.getNodeByNaturalKey(source_system, source_type, source_id);
  return existing !== null;
}

// ========================================
// Core Ingestion Functions
// ========================================

/**
 * Ingest a single AFU-9 Run into the Timeline/Linkage Model
 * 
 * Creates/updates:
 * - RUN node with run metadata
 * - ARTIFACT nodes for run_steps and run_artifacts
 * - Edges linking artifacts to run (RUN_HAS_ARTIFACT)
 * - Source reference with DB row identifier and hash
 * 
 * @param params - Run parameters
 * @param pool - Database connection pool
 * @returns Ingestion result with node ID and metadata
 * @throws RunNotFoundError if run doesn't exist
 */
export async function ingestRun(
  params: IngestRunParams,
  pool: Pool
): Promise<IngestRunResult> {
  // Validate input
  const validated = IngestRunParamsSchema.parse(params);
  const { runId } = validated;

  const dao = new TimelineDAO(pool);
  const fetchedAt = new Date().toISOString(); // Consistent timestamp for this ingestion operation

  try {
    // Fetch run from database
    const runResult = await pool.query(
      `SELECT id, issue_id, title, playbook_id, parent_run_id, status, 
              spec_json, result_json, created_at, started_at, finished_at
       FROM runs
       WHERE id = $1`,
      [runId]
    );

    if (runResult.rows.length === 0) {
      throw new RunNotFoundError(runId);
    }

    const run = runResult.rows[0];

    // Check if node already exists
    const source_id = generateAFU9SourceId('run', runId);
    const isNew = !(await checkIfNodeExists(dao, 'afu9', 'run', source_id));

    // Create/update RUN node
    const runNode = await dao.upsertNode({
      source_system: 'afu9',
      source_type: 'run',
      source_id,
      node_type: 'RUN',
      title: run.title || `Run ${runId}`,
      url: null,
      payload_json: {
        runId: run.id,
        issueId: run.issue_id,
        playbookId: run.playbook_id,
        parentRunId: run.parent_run_id,
        status: run.status,
        spec: run.spec_json,
        result: run.result_json,
        createdAt: run.created_at?.toISOString(),
        startedAt: run.started_at?.toISOString(),
        finishedAt: run.finished_at?.toISOString(),
      },
      lawbook_version: null,
    });

    // Create source reference
    await dao.createSource({
      node_id: runNode.id,
      source_kind: 'afu9_db',
      ref_json: {
        table: 'runs',
        id: run.id,
        fetched_at: fetchedAt,
      },
      sha256: computeSha256(JSON.stringify(run)),
      content_hash: null,
    });

    // Fetch and ingest run steps as ARTIFACT nodes
    const stepsResult = await pool.query(
      `SELECT id, run_id, idx, name, status, exit_code, duration_ms, stdout_tail, stderr_tail
       FROM run_steps
       WHERE run_id = $1
       ORDER BY idx ASC`,
      [runId]
    );

    const stepNodeIds: string[] = [];
    for (const step of stepsResult.rows) {
      const stepSourceId = generateAFU9SourceId('run_step', step.id);
      const stepNode = await dao.upsertNode({
        source_system: 'afu9',
        source_type: 'run_step',
        source_id: stepSourceId,
        node_type: 'ARTIFACT',
        title: `Step ${step.idx}: ${step.name}`,
        url: null,
        payload_json: {
          stepId: step.id,
          runId: step.run_id,
          idx: step.idx,
          name: step.name,
          status: step.status,
          exitCode: step.exit_code,
          durationMs: step.duration_ms,
          stdoutTail: step.stdout_tail,
          stderrTail: step.stderr_tail,
        },
        lawbook_version: null,
      });

      stepNodeIds.push(stepNode.id);

      // Create source reference for step
      await dao.createSource({
        node_id: stepNode.id,
        source_kind: 'afu9_db',
        ref_json: {
          table: 'run_steps',
          id: step.id,
          fetched_at: fetchedAt,
        },
        sha256: computeSha256(JSON.stringify(step)),
        content_hash: null,
      });
    }

    // Fetch and ingest run artifacts as ARTIFACT nodes
    const artifactsResult = await pool.query(
      `SELECT id, run_id, step_idx, kind, name, ref, bytes, sha256, created_at
       FROM run_artifacts
       WHERE run_id = $1
       ORDER BY created_at ASC`,
      [runId]
    );

    const artifactNodeIds: string[] = [];
    for (const artifact of artifactsResult.rows) {
      const artifactSourceId = generateAFU9SourceId('run_artifact', artifact.id);
      const artifactNode = await dao.upsertNode({
        source_system: 'afu9',
        source_type: 'run_artifact',
        source_id: artifactSourceId,
        node_type: 'ARTIFACT',
        title: `${artifact.kind}: ${artifact.name}`,
        url: null,
        payload_json: {
          artifactId: artifact.id,
          runId: artifact.run_id,
          stepIdx: artifact.step_idx,
          kind: artifact.kind,
          name: artifact.name,
          ref: artifact.ref,
          bytes: artifact.bytes,
          sha256: artifact.sha256,
          createdAt: artifact.created_at?.toISOString(),
        },
        lawbook_version: null,
      });

      artifactNodeIds.push(artifactNode.id);

      // Create source reference for artifact
      await dao.createSource({
        node_id: artifactNode.id,
        source_kind: 'afu9_db',
        ref_json: {
          table: 'run_artifacts',
          id: artifact.id,
          fetched_at: fetchedAt,
        },
        sha256: computeSha256(JSON.stringify(artifact)),
        content_hash: null,
      });
    }

    // Create edges: RUN_HAS_ARTIFACT for both steps and artifacts
    const edgeIds: string[] = [];
    for (const stepNodeId of stepNodeIds) {
      const edge = await dao.createEdge({
        from_node_id: runNode.id,
        to_node_id: stepNodeId,
        edge_type: 'RUN_HAS_ARTIFACT',
        payload_json: { type: 'step' },
      });
      edgeIds.push(edge.id);
    }

    for (const artifactNodeId of artifactNodeIds) {
      const edge = await dao.createEdge({
        from_node_id: runNode.id,
        to_node_id: artifactNodeId,
        edge_type: 'RUN_HAS_ARTIFACT',
        payload_json: { type: 'artifact' },
      });
      edgeIds.push(edge.id);
    }

    // Return result
    return {
      nodeId: runNode.id,
      naturalKey: `afu9:run:${source_id}`,
      isNew,
      source_system: 'afu9',
      source_type: 'run',
      source_id,
      runId,
      stepNodeIds,
      artifactNodeIds,
      edgeIds,
    };
  } catch (error) {
    if (error instanceof RunNotFoundError) {
      throw error;
    }
    throw new AFU9IngestionError(
      `Failed to ingest run: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'INGESTION_FAILED',
      { runId, error: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Ingest a Deploy Event into the Timeline/Linkage Model
 * 
 * Creates/updates:
 * - DEPLOY node with deploy metadata
 * - Source reference with DB row identifier and hash
 * 
 * @param params - Deploy parameters
 * @param pool - Database connection pool
 * @returns Ingestion result with node ID and metadata
 * @throws DeployNotFoundError if deploy event doesn't exist
 */
export async function ingestDeploy(
  params: IngestDeployParams,
  pool: Pool
): Promise<IngestDeployResult> {
  // Validate input
  const validated = IngestDeployParamsSchema.parse(params);
  const { deployId } = validated;

  const dao = new TimelineDAO(pool);
  const fetchedAt = new Date().toISOString(); // Consistent timestamp for this ingestion operation

  try {
    // Fetch deploy event from database
    const deployResult = await pool.query(
      `SELECT id, created_at, env, service, version, commit_hash, status, message
       FROM deploy_events
       WHERE id = $1`,
      [deployId]
    );

    if (deployResult.rows.length === 0) {
      throw new DeployNotFoundError(deployId);
    }

    const deploy = deployResult.rows[0];

    // Check if node already exists
    const source_id = generateAFU9SourceId('deploy', deployId);
    const isNew = !(await checkIfNodeExists(dao, 'afu9', 'deploy_event', source_id));

    // Create/update DEPLOY node
    const deployNode = await dao.upsertNode({
      source_system: 'afu9',
      source_type: 'deploy_event',
      source_id,
      node_type: 'DEPLOY',
      title: `Deploy ${deploy.service} to ${deploy.env}`,
      url: null,
      payload_json: {
        deployId: deploy.id,
        env: deploy.env,
        service: deploy.service,
        version: deploy.version,
        commitHash: deploy.commit_hash,
        status: deploy.status,
        message: deploy.message,
        createdAt: deploy.created_at?.toISOString(),
      },
      lawbook_version: null,
    });

    // Create source reference
    await dao.createSource({
      node_id: deployNode.id,
      source_kind: 'afu9_db',
      ref_json: {
        table: 'deploy_events',
        id: deploy.id,
        fetched_at: fetchedAt,
      },
      sha256: computeSha256(JSON.stringify(deploy)),
      content_hash: null,
    });

    // Return result
    return {
      nodeId: deployNode.id,
      naturalKey: `afu9:deploy_event:${source_id}`,
      isNew,
      source_system: 'afu9',
      source_type: 'deploy_event',
      source_id,
      deployId,
    };
  } catch (error) {
    if (error instanceof DeployNotFoundError) {
      throw error;
    }
    throw new AFU9IngestionError(
      `Failed to ingest deploy: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'INGESTION_FAILED',
      { deployId, error: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Ingest a Verdict into the Timeline/Linkage Model
 * 
 * Creates/updates:
 * - VERDICT node with verdict metadata and lawbookVersion
 * - Source reference with DB row identifier and hash
 * 
 * @param params - Verdict parameters
 * @param pool - Database connection pool
 * @returns Ingestion result with node ID and metadata
 * @throws VerdictNotFoundError if verdict doesn't exist
 */
export async function ingestVerdict(
  params: IngestVerdictParams,
  pool: Pool
): Promise<IngestVerdictResult> {
  // Validate input
  const validated = IngestVerdictParamsSchema.parse(params);
  const { verdictId } = validated;

  const dao = new TimelineDAO(pool);
  const fetchedAt = new Date().toISOString(); // Consistent timestamp for this ingestion operation

  try {
    // Fetch verdict from database with policy snapshot (for lawbook version)
    const verdictResult = await pool.query(
      `SELECT v.id, v.execution_id, v.policy_snapshot_id, v.fingerprint_id, 
              v.error_class, v.service, v.confidence_score, v.proposed_action,
              v.tokens, v.signals, v.playbook_id, v.created_at, v.metadata,
              ps.version as lawbook_version
       FROM verdicts v
       LEFT JOIN policy_snapshots ps ON v.policy_snapshot_id = ps.id
       WHERE v.id = $1`,
      [verdictId]
    );

    if (verdictResult.rows.length === 0) {
      throw new VerdictNotFoundError(verdictId);
    }

    const verdict = verdictResult.rows[0];

    // Check if node already exists
    const source_id = generateAFU9SourceId('verdict', verdictId);
    const isNew = !(await checkIfNodeExists(dao, 'afu9', 'verdict', source_id));

    // Create/update VERDICT node with lawbookVersion
    const verdictNode = await dao.upsertNode({
      source_system: 'afu9',
      source_type: 'verdict',
      source_id,
      node_type: 'VERDICT',
      title: `Verdict: ${verdict.error_class}`,
      url: null,
      payload_json: {
        verdictId: verdict.id,
        executionId: verdict.execution_id,
        policySnapshotId: verdict.policy_snapshot_id,
        fingerprintId: verdict.fingerprint_id,
        errorClass: verdict.error_class,
        service: verdict.service,
        confidenceScore: verdict.confidence_score,
        proposedAction: verdict.proposed_action,
        tokens: verdict.tokens,
        signals: verdict.signals,
        playbookId: verdict.playbook_id,
        metadata: verdict.metadata,
        createdAt: verdict.created_at?.toISOString(),
      },
      lawbook_version: verdict.lawbook_version || null,
    });

    // Create source reference
    await dao.createSource({
      node_id: verdictNode.id,
      source_kind: 'afu9_db',
      ref_json: {
        table: 'verdicts',
        id: verdict.id,
        fetched_at: fetchedAt,
      },
      sha256: computeSha256(JSON.stringify(verdict)),
      content_hash: null,
    });

    // Return result
    return {
      nodeId: verdictNode.id,
      naturalKey: `afu9:verdict:${source_id}`,
      isNew,
      source_system: 'afu9',
      source_type: 'verdict',
      source_id,
      verdictId,
      lawbookVersion: verdict.lawbook_version || null,
    };
  } catch (error) {
    if (error instanceof VerdictNotFoundError) {
      throw error;
    }
    throw new AFU9IngestionError(
      `Failed to ingest verdict: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'INGESTION_FAILED',
      { verdictId, error: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Ingest a Verification Report into the Timeline/Linkage Model
 * 
 * Creates/updates:
 * - ARTIFACT node with verification report metadata
 * - Source reference with DB row identifier and hash
 * 
 * Note: Verification reports are stored as deploy_status_snapshots in v0.6
 * 
 * @param params - Verification parameters
 * @param pool - Database connection pool
 * @returns Ingestion result with node ID and metadata
 * @throws VerificationNotFoundError if verification report doesn't exist
 */
export async function ingestVerification(
  params: IngestVerificationParams,
  pool: Pool
): Promise<IngestVerificationResult> {
  // Validate input
  const validated = IngestVerificationParamsSchema.parse(params);
  const { reportId } = validated;

  const dao = new TimelineDAO(pool);
  const fetchedAt = new Date().toISOString(); // Consistent timestamp for this ingestion operation

  try {
    // Fetch verification report from database (deploy_status_snapshots)
    const reportResult = await pool.query(
      `SELECT id, snapshot_time, env, status, details, created_at
       FROM deploy_status_snapshots
       WHERE id = $1`,
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      throw new VerificationNotFoundError(reportId);
    }

    const report = reportResult.rows[0];

    // Check if node already exists
    const source_id = generateAFU9SourceId('verification', reportId);
    const isNew = !(await checkIfNodeExists(dao, 'afu9', 'verification_report', source_id));

    // Create/update ARTIFACT node for verification report
    const reportNode = await dao.upsertNode({
      source_system: 'afu9',
      source_type: 'verification_report',
      source_id,
      node_type: 'ARTIFACT',
      title: `Verification Report: ${report.env} - ${report.status}`,
      url: null,
      payload_json: {
        reportId: report.id,
        snapshotTime: report.snapshot_time?.toISOString(),
        env: report.env,
        status: report.status,
        details: report.details,
        createdAt: report.created_at?.toISOString(),
      },
      lawbook_version: null,
    });

    // Create source reference
    await dao.createSource({
      node_id: reportNode.id,
      source_kind: 'afu9_db',
      ref_json: {
        table: 'deploy_status_snapshots',
        id: report.id,
        fetched_at: fetchedAt,
      },
      sha256: computeSha256(JSON.stringify(report)),
      content_hash: null,
    });

    // Return result
    return {
      nodeId: reportNode.id,
      naturalKey: `afu9:verification_report:${source_id}`,
      isNew,
      source_system: 'afu9',
      source_type: 'verification_report',
      source_id,
      reportId,
    };
  } catch (error) {
    if (error instanceof VerificationNotFoundError) {
      throw error;
    }
    throw new AFU9IngestionError(
      `Failed to ingest verification: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'INGESTION_FAILED',
      { reportId, error: error instanceof Error ? error.message : String(error) }
    );
  }
}
