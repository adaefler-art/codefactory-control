/**
 * Incident Ingestion Orchestrator (E76.2 / I762)
 * 
 * Idempotent ingestion functions that:
 * 1. Transform signals into incidents via mappers
 * 2. Upsert incidents by stable key
 * 3. Attach evidence with deduplication
 * 4. Log lifecycle events
 * 
 * All operations are safe to retry - same input produces same result.
 * 
 * E79.3 / I793: All incidents include lawbookVersion from active lawbook.
 * Passive ingestion: sets null + warning if lawbook not configured.
 * 
 * Reference: I762 (E76.2 - Incident Ingestion Pipelines)
 */

import { Pool } from 'pg';
import { createHash } from 'crypto';
import {
  IncidentDAO,
  getIncidentDAO,
} from '../db/incidents';
import {
  Incident,
  Evidence,
  EvidenceInput,
} from '../contracts/incident';
import {
  mapDeployStatusToIncident,
  mapVerificationFailureToIncident,
  mapEcsStoppedTaskToIncident,
  mapRunnerStepFailureToIncident,
  DeployStatusSignal,
  VerificationSignal,
  EcsStoppedTaskSignal,
  RunnerStepFailureSignal,
} from './mappers';
import { getActiveLawbookVersion } from '../lawbook-version-helper';
import { logger } from '../logger';

// ========================================
// Ingestion Result Types
// ========================================

export interface IncidentIngestionResult {
  incident: Incident | null;
  isNew: boolean; // true if incident was created, false if updated
  evidenceAdded: number;
  error?: string;
}

// ========================================
// SHA-256 Evidence Hashing
// ========================================

/**
 * Stable JSON stringification with sorted keys
 * Ensures deterministic hash computation
 */
function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj);
  }
  
  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  
  // Sort keys alphabetically for stable ordering
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(key => {
    return JSON.stringify(key) + ':' + stableStringify(obj[key]);
  });
  
  return '{' + pairs.join(',') + '}';
}

/**
 * Compute SHA-256 hash of evidence for deduplication
 * Uses stable JSON stringification to ensure deterministic hashes
 */
function computeEvidenceHash(evidence: EvidenceInput): string {
  const payload = stableStringify({
    incident_id: evidence.incident_id,
    kind: evidence.kind,
    ref: evidence.ref,
  });
  return createHash('sha256').update(payload).digest('hex');
}

// ========================================
// Core Ingestion Function
// ========================================

/**
 * Generic incident ingestion function
 * 
 * E79.3 / I793: Attaches lawbookVersion from active lawbook.
 * If no active lawbook, sets null and logs warning (passive ingestion).
 * 
 * @param dao - Incident DAO instance
 * @param pool - PostgreSQL connection pool
 * @param incident - IncidentInput from mapper
 * @param additionalEvidence - Optional array of additional evidence to attach
 * @returns IncidentIngestionResult with incident and metadata
 */
async function ingestIncident(
  dao: IncidentDAO,
  pool: Pool,
  incident: any, // IncidentInput
  additionalEvidence: Omit<EvidenceInput, 'incident_id' | 'sha256'>[] = []
): Promise<IncidentIngestionResult> {
  try {
    // E79.3 / I793: Attach lawbookVersion from active lawbook (passive ingestion)
    const lawbookVersion = await getActiveLawbookVersion(pool);
    
    if (lawbookVersion === null) {
      logger.warn('No active lawbook configured - incident lawbookVersion will be null', {
        incidentKey: incident.incident_key,
      }, 'IncidentIngestion');
    }
    
    // Attach lawbookVersion to incident
    const incidentWithLawbook = {
      ...incident,
      lawbook_version: lawbookVersion,
    };

    // Check if incident already exists
    const existing = await dao.getIncidentByKey(incident.incident_key);
    const isNew = !existing;

    // Upsert incident (idempotent)
    const upserted = await dao.upsertIncidentByKey(incidentWithLawbook);

    // Prepare evidence list
    const evidenceList: EvidenceInput[] = [];

    // Add source_primary as evidence
    const primaryEvidence: EvidenceInput = {
      incident_id: upserted.id,
      kind: incident.source_primary.kind,
      ref: incident.source_primary.ref,
      sha256: computeEvidenceHash({
        incident_id: upserted.id,
        kind: incident.source_primary.kind,
        ref: incident.source_primary.ref,
        sha256: null,
      }),
    };
    evidenceList.push(primaryEvidence);

    // Add additional evidence
    for (const evidence of additionalEvidence) {
      const evidenceInput: EvidenceInput = {
        incident_id: upserted.id,
        kind: evidence.kind,
        ref: evidence.ref,
        sha256: computeEvidenceHash({
          incident_id: upserted.id,
          kind: evidence.kind,
          ref: evidence.ref,
          sha256: null,
        }),
      };
      evidenceList.push(evidenceInput);
    }

    // Add evidence (idempotent - deduplication via sha256)
    const addedEvidence = await dao.addEvidence(evidenceList);

    // Create lifecycle event
    if (isNew) {
      await dao.createEvent({
        incident_id: upserted.id,
        event_type: 'CREATED',
        payload: {
          signal_type: incident.source_primary.kind,
          incident_key: incident.incident_key,
          lawbookVersion,
        },
      });
    } else {
      await dao.createEvent({
        incident_id: upserted.id,
        event_type: 'UPDATED',
        payload: {
          signal_type: incident.source_primary.kind,
          incident_key: incident.incident_key,
          lawbookVersion,
        },
      });
    }

    return {
      incident: upserted,
      isNew,
      evidenceAdded: addedEvidence.length,
    };
  } catch (error) {
    return {
      incident: null,
      isNew: false,
      evidenceAdded: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ========================================
// 1. Deploy Status Ingestion
// ========================================

/**
 * Ingest Deploy Status signal into incidents table
 * 
 * @param pool - PostgreSQL connection pool
 * @param signal - Deploy status signal from E65.1
 * @returns IncidentIngestionResult
 */
export async function ingestDeployStatusSignal(
  pool: Pool,
  signal: DeployStatusSignal
): Promise<IncidentIngestionResult> {
  const dao = getIncidentDAO(pool);

  // Map signal to incident (returns null for GREEN)
  const incident = mapDeployStatusToIncident(signal);

  if (!incident) {
    return {
      incident: null,
      isNew: false,
      evidenceAdded: 0,
    };
  }

  // Additional evidence: attach deploy_status snapshot
  const additionalEvidence: Omit<EvidenceInput, 'incident_id' | 'sha256'>[] = [
    {
      kind: 'deploy_status',
      ref: {
        env: signal.env,
        status: signal.status,
        changedAt: signal.changedAt,
        signals: signal.signals,
      },
    },
  ];

  return ingestIncident(dao, pool, incident, additionalEvidence);
}

// ========================================
// 2. Verification Failure Ingestion
// ========================================

/**
 * Ingest Verification failure signal into incidents table
 * 
 * @param pool - PostgreSQL connection pool
 * @param signal - Verification signal from E65.2
 * @returns IncidentIngestionResult
 */
export async function ingestVerificationFailureSignal(
  pool: Pool,
  signal: VerificationSignal
): Promise<IncidentIngestionResult> {
  const dao = getIncidentDAO(pool);

  // Map signal to incident
  const incident = mapVerificationFailureToIncident(signal);

  if (!incident) {
    return {
      incident: null,
      isNew: false,
      evidenceAdded: 0,
    };
  }

  // Additional evidence: attach verification run details
  const additionalEvidence: Omit<EvidenceInput, 'incident_id' | 'sha256'>[] = [
    {
      kind: 'verification',
      ref: {
        runId: signal.runId,
        playbookId: signal.playbookId,
        env: signal.env,
        status: signal.status,
        completedAt: signal.completedAt,
      },
    },
  ];

  return ingestIncident(dao, pool, incident, additionalEvidence);
}

// ========================================
// 3. ECS Stopped Task Ingestion
// ========================================

/**
 * Ingest ECS stopped task signal into incidents table
 * 
 * @param pool - PostgreSQL connection pool
 * @param signal - ECS stopped task signal
 * @returns IncidentIngestionResult
 */
export async function ingestEcsStoppedTaskSignal(
  pool: Pool,
  signal: EcsStoppedTaskSignal
): Promise<IncidentIngestionResult> {
  const dao = getIncidentDAO(pool);

  // Map signal to incident
  const incident = mapEcsStoppedTaskToIncident(signal);

  if (!incident) {
    return {
      incident: null,
      isNew: false,
      evidenceAdded: 0,
    };
  }

  // Additional evidence: attach ECS task details
  const additionalEvidence: Omit<EvidenceInput, 'incident_id' | 'sha256'>[] = [
    {
      kind: 'ecs',
      ref: {
        cluster: signal.cluster,
        taskArn: signal.taskArn,
        stoppedAt: signal.stoppedAt,
        stoppedReason: signal.stoppedReason,
        exitCode: signal.exitCode,
      },
    },
  ];

  return ingestIncident(dao, pool, incident, additionalEvidence);
}

// ========================================
// 4. Runner Step Failure Ingestion
// ========================================

/**
 * Ingest GitHub Actions runner step failure into incidents table
 * 
 * @param pool - PostgreSQL connection pool
 * @param signal - Runner step failure signal
 * @returns IncidentIngestionResult
 */
export async function ingestRunnerStepFailureSignal(
  pool: Pool,
  signal: RunnerStepFailureSignal
): Promise<IncidentIngestionResult> {
  const dao = getIncidentDAO(pool);

  // Map signal to incident
  const incident = mapRunnerStepFailureToIncident(signal);

  if (!incident) {
    return {
      incident: null,
      isNew: false,
      evidenceAdded: 0,
    };
  }

  // Additional evidence: attach GitHub Actions run details
  const additionalEvidence: Omit<EvidenceInput, 'incident_id' | 'sha256'>[] = [
    {
      kind: 'github_run',
      ref: {
        runId: signal.runId,
        runUrl: signal.runUrl,
        stepName: signal.stepName,
        conclusion: signal.conclusion,
        completedAt: signal.completedAt,
      },
    },
  ];

  return ingestIncident(dao, pool, incident, additionalEvidence);
}

// ========================================
// Batch Ingestion (for efficiency)
// ========================================

/**
 * Batch ingest multiple Deploy Status signals
 * Useful for backfill or bulk processing
 */
export async function batchIngestDeployStatusSignals(
  pool: Pool,
  signals: DeployStatusSignal[]
): Promise<IncidentIngestionResult[]> {
  const results: IncidentIngestionResult[] = [];

  for (const signal of signals) {
    const result = await ingestDeployStatusSignal(pool, signal);
    results.push(result);
  }

  return results;
}

/**
 * Batch ingest multiple Verification failure signals
 */
export async function batchIngestVerificationFailureSignals(
  pool: Pool,
  signals: VerificationSignal[]
): Promise<IncidentIngestionResult[]> {
  const results: IncidentIngestionResult[] = [];

  for (const signal of signals) {
    const result = await ingestVerificationFailureSignal(pool, signal);
    results.push(result);
  }

  return results;
}

/**
 * Batch ingest multiple ECS stopped task signals
 */
export async function batchIngestEcsStoppedTaskSignals(
  pool: Pool,
  signals: EcsStoppedTaskSignal[]
): Promise<IncidentIngestionResult[]> {
  const results: IncidentIngestionResult[] = [];

  for (const signal of signals) {
    const result = await ingestEcsStoppedTaskSignal(pool, signal);
    results.push(result);
  }

  return results;
}

/**
 * Batch ingest multiple Runner step failure signals
 */
export async function batchIngestRunnerStepFailureSignals(
  pool: Pool,
  signals: RunnerStepFailureSignal[]
): Promise<IncidentIngestionResult[]> {
  const results: IncidentIngestionResult[] = [];

  for (const signal of signals) {
    const result = await ingestRunnerStepFailureSignal(pool, signal);
    results.push(result);
  }

  return results;
}
