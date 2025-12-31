/**
 * AFU-9 Ingestion - Type Definitions
 * 
 * Type definitions and Zod schemas for AFU-9 artifact ingestion into Timeline/Linkage Model.
 * Supports ingestion of Runs, Deploys, Verdicts, and Verification Reports.
 * 
 * Reference: I723 (E72.3 - AFU-9 Ingestion)
 * 
 * NON-NEGOTIABLES:
 * - Determinism: stable node/edge mapping, stable timestamps
 * - Idempotency: upsert semantics via natural keys
 * - Evidence-first: source refs with hashes back to AFU-9 DB
 * - Lawbook transparency: propagate lawbookVersion into VERDICT nodes
 */

import { z } from 'zod';

// ========================================
// Input Parameter Schemas
// ========================================

/**
 * Parameters for ingesting a Run
 */
export const IngestRunParamsSchema = z.object({
  runId: z.string().min(1),
});

/**
 * Parameters for ingesting a Deploy Event
 */
export const IngestDeployParamsSchema = z.object({
  deployId: z.string().uuid(),
});

/**
 * Parameters for ingesting a Verdict
 */
export const IngestVerdictParamsSchema = z.object({
  verdictId: z.string().uuid(),
});

/**
 * Parameters for ingesting a Verification Report
 */
export const IngestVerificationParamsSchema = z.object({
  reportId: z.string().uuid(),
});

// ========================================
// Result Schemas
// ========================================

/**
 * Base ingestion result
 */
export interface IngestionResult {
  nodeId: string;
  naturalKey: string;
  isNew: boolean;
  source_system: string;
  source_type: string;
  source_id: string;
}

/**
 * Result from ingesting a Run
 */
export interface IngestRunResult extends IngestionResult {
  runId: string;
  stepNodeIds: string[];
  artifactNodeIds: string[];
  edgeIds: string[];
}

/**
 * Result from ingesting a Deploy Event
 */
export interface IngestDeployResult extends IngestionResult {
  deployId: string;
}

/**
 * Result from ingesting a Verdict
 */
export interface IngestVerdictResult extends IngestionResult {
  verdictId: string;
  lawbookVersion: string | null;
}

/**
 * Result from ingesting a Verification Report
 */
export interface IngestVerificationResult extends IngestionResult {
  reportId: string;
}

// ========================================
// Error Classes
// ========================================

/**
 * Base error class for AFU-9 ingestion errors
 */
export class AFU9IngestionError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AFU9IngestionError';
  }
}

/**
 * Thrown when a Run is not found in the database
 */
export class RunNotFoundError extends AFU9IngestionError {
  constructor(runId: string) {
    super(
      `Run not found: ${runId}`,
      'RUN_NOT_FOUND',
      { runId }
    );
    this.name = 'RunNotFoundError';
  }
}

/**
 * Thrown when a Deploy Event is not found in the database
 */
export class DeployNotFoundError extends AFU9IngestionError {
  constructor(deployId: string) {
    super(
      `Deploy event not found: ${deployId}`,
      'DEPLOY_NOT_FOUND',
      { deployId }
    );
    this.name = 'DeployNotFoundError';
  }
}

/**
 * Thrown when a Verdict is not found in the database
 */
export class VerdictNotFoundError extends AFU9IngestionError {
  constructor(verdictId: string) {
    super(
      `Verdict not found: ${verdictId}`,
      'VERDICT_NOT_FOUND',
      { verdictId }
    );
    this.name = 'VerdictNotFoundError';
  }
}

/**
 * Thrown when a Verification Report is not found in the database
 */
export class VerificationNotFoundError extends AFU9IngestionError {
  constructor(reportId: string) {
    super(
      `Verification report not found: ${reportId}`,
      'VERIFICATION_NOT_FOUND',
      { reportId }
    );
    this.name = 'VerificationNotFoundError';
  }
}

// ========================================
// Type Exports
// ========================================

export type IngestRunParams = z.infer<typeof IngestRunParamsSchema>;
export type IngestDeployParams = z.infer<typeof IngestDeployParamsSchema>;
export type IngestVerdictParams = z.infer<typeof IngestVerdictParamsSchema>;
export type IngestVerificationParams = z.infer<typeof IngestVerificationParamsSchema>;
