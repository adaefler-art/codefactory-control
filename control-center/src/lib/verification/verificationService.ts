/**
 * Verification Service
 * 
 * E9.3-CTRL-06: Verify Gate (S7 Verdict)
 * 
 * Implements explicit verification of deployment success.
 * Evaluates evidence and sets explicit verdict (GREEN/RED) with no implicit success.
 * 
 * Guarantees:
 * - Deterministic: Same evidence → Same verdict
 * - Fail-closed: No implicit success
 * - Idempotent: Multiple evaluations → Same result
 */

import { Pool } from 'pg';
import crypto from 'crypto';
import { createUnifiedTimelineEvent } from '@/lib/db/unifiedTimelineEvents';

/**
 * Verification Evidence Schema
 */
export interface VerificationEvidence {
  deploymentObservations: Array<{
    deploymentId: number;
    environment: string;
    sha: string;
    status: string;
    isAuthentic: boolean;
    observedAt: string;
  }>;
  healthChecks?: Array<{
    endpoint: string;
    status: number;
    responseTime: number;
    timestamp: string;
  }>;
  integrationTests?: {
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
  errorRates?: {
    current: number;
    threshold: number;
  };
}

/**
 * Verdict type (explicit GREEN or RED, never null/undefined)
 */
export type Verdict = 'GREEN' | 'RED';

/**
 * Evaluation result
 */
export interface EvaluationResult {
  verdict: Verdict;
  rationale: string;
  failedChecks: string[];
  evaluationRules: string[];
}

/**
 * Validate verification evidence structure
 */
export function validateVerificationEvidence(evidence: unknown): { valid: boolean; error?: string } {
  if (!evidence || typeof evidence !== 'object') {
    return { valid: false, error: 'Evidence must be an object' };
  }

  const ev = evidence as Record<string, unknown>;

  // deploymentObservations is required
  if (!ev.deploymentObservations || !Array.isArray(ev.deploymentObservations)) {
    return { valid: false, error: 'deploymentObservations is required and must be an array' };
  }

  // Validate each deployment observation
  for (const obs of ev.deploymentObservations) {
    if (!obs || typeof obs !== 'object') {
      return { valid: false, error: 'Each deployment observation must be an object' };
    }
    const o = obs as Record<string, unknown>;
    if (typeof o.deploymentId !== 'number') {
      return { valid: false, error: 'deploymentId must be a number' };
    }
    if (typeof o.environment !== 'string') {
      return { valid: false, error: 'environment must be a string' };
    }
    if (typeof o.sha !== 'string') {
      return { valid: false, error: 'sha must be a string' };
    }
    if (typeof o.status !== 'string') {
      return { valid: false, error: 'status must be a string' };
    }
    if (typeof o.isAuthentic !== 'boolean') {
      return { valid: false, error: 'isAuthentic must be a boolean' };
    }
    if (typeof o.observedAt !== 'string') {
      return { valid: false, error: 'observedAt must be a string' };
    }
  }

  // healthChecks is optional
  if (ev.healthChecks !== undefined) {
    if (!Array.isArray(ev.healthChecks)) {
      return { valid: false, error: 'healthChecks must be an array if provided' };
    }
    for (const hc of ev.healthChecks) {
      if (!hc || typeof hc !== 'object') {
        return { valid: false, error: 'Each health check must be an object' };
      }
      const h = hc as Record<string, unknown>;
      if (typeof h.endpoint !== 'string') {
        return { valid: false, error: 'Health check endpoint must be a string' };
      }
      if (typeof h.status !== 'number') {
        return { valid: false, error: 'Health check status must be a number' };
      }
    }
  }

  // integrationTests is optional
  if (ev.integrationTests !== undefined) {
    if (!ev.integrationTests || typeof ev.integrationTests !== 'object') {
      return { valid: false, error: 'integrationTests must be an object if provided' };
    }
    const it = ev.integrationTests as Record<string, unknown>;
    if (typeof it.passed !== 'number') {
      return { valid: false, error: 'integrationTests.passed must be a number' };
    }
    if (typeof it.failed !== 'number') {
      return { valid: false, error: 'integrationTests.failed must be a number' };
    }
  }

  // errorRates is optional
  if (ev.errorRates !== undefined) {
    if (!ev.errorRates || typeof ev.errorRates !== 'object') {
      return { valid: false, error: 'errorRates must be an object if provided' };
    }
    const er = ev.errorRates as Record<string, unknown>;
    if (typeof er.current !== 'number') {
      return { valid: false, error: 'errorRates.current must be a number' };
    }
    if (typeof er.threshold !== 'number') {
      return { valid: false, error: 'errorRates.threshold must be a number' };
    }
  }

  return { valid: true };
}

/**
 * Evaluate verdict based on evidence
 * 
 * Deterministic evaluation rules:
 * 1. RULE_AUTHENTIC_DEPLOYMENT: At least one authentic, successful deployment
 * 2. RULE_HEALTH_CHECKS: All health checks return 2xx (if present)
 * 3. RULE_INTEGRATION_TESTS: Zero test failures (if present)
 * 4. RULE_ERROR_RATES: Below threshold (if present)
 * 
 * First failure → RED verdict (fail-closed)
 */
export function evaluateVerdict(evidence: VerificationEvidence): EvaluationResult {
  const failedChecks: string[] = [];
  const evaluationRules: string[] = [];

  // RULE 1: At least one authentic, successful deployment
  evaluationRules.push('RULE_AUTHENTIC_DEPLOYMENT');
  const hasAuthenticDeployment = evidence.deploymentObservations.some(
    d => d.isAuthentic && d.status === 'success'
  );
  
  if (!hasAuthenticDeployment) {
    failedChecks.push('No authentic successful deployment found');
    return {
      verdict: 'RED',
      rationale: 'Deployment verification failed: No authentic successful deployment',
      failedChecks,
      evaluationRules,
    };
  }

  // RULE 2: All health checks must pass (if present)
  if (evidence.healthChecks && evidence.healthChecks.length > 0) {
    evaluationRules.push('RULE_HEALTH_CHECKS');
    for (const hc of evidence.healthChecks) {
      if (hc.status < 200 || hc.status >= 300) {
        failedChecks.push(`Health check failed: ${hc.endpoint} returned ${hc.status}`);
      }
    }
    
    if (failedChecks.length > 0) {
      return {
        verdict: 'RED',
        rationale: 'Health checks failed',
        failedChecks,
        evaluationRules,
      };
    }
  }

  // RULE 3: Integration tests must have zero failures (if present)
  if (evidence.integrationTests) {
    evaluationRules.push('RULE_INTEGRATION_TESTS');
    if (evidence.integrationTests.failed > 0) {
      failedChecks.push(`Integration tests failed: ${evidence.integrationTests.failed} failures`);
      return {
        verdict: 'RED',
        rationale: 'Integration tests failed',
        failedChecks,
        evaluationRules,
      };
    }
  }

  // RULE 4: Error rates must be below threshold (if present)
  if (evidence.errorRates) {
    evaluationRules.push('RULE_ERROR_RATES');
    if (evidence.errorRates.current > evidence.errorRates.threshold) {
      failedChecks.push(`Error rate ${evidence.errorRates.current} exceeds threshold ${evidence.errorRates.threshold}`);
      return {
        verdict: 'RED',
        rationale: 'Error rate exceeds threshold',
        failedChecks,
        evaluationRules,
      };
    }
  }

  // All checks passed
  return {
    verdict: 'GREEN',
    rationale: 'All verification checks passed',
    failedChecks: [],
    evaluationRules,
  };
}

/**
 * Store verdict with evidence
 * 
 * Idempotent: If verdict with same evidence hash exists, return existing
 */
export async function storeVerdict(
  pool: Pool,
  params: {
    issueId: string;
    runId: string;
    verdict: Verdict;
    evidence: VerificationEvidence;
    rationale: string;
    failedChecks: string[];
    evaluationRules: string[];
    requestId: string;
  }
): Promise<{
  success: boolean;
  verdictId?: string;
  evidenceId?: string;
  evaluatedAt?: string;
  error?: string;
}> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Calculate evidence hash for idempotency
    const evidenceHash = calculateEvidenceHash(params.evidence);

    // Check if evidence already exists
    let evidenceId: string;
    const existingEvidence = await client.query(
      `SELECT id FROM verification_evidence WHERE evidence_hash = $1`,
      [evidenceHash]
    );

    if (existingEvidence.rows.length > 0) {
      // Evidence already exists, reuse it
      evidenceId = existingEvidence.rows[0].id;
    } else {
      // Store new evidence
      const evidenceResult = await client.query(
        `INSERT INTO verification_evidence (issue_id, evidence_hash, evidence_data, collected_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id`,
        [params.issueId, evidenceHash, JSON.stringify(params.evidence)]
      );
      evidenceId = evidenceResult.rows[0].id;
    }

    // Check if verdict for this run already exists
    const existingVerdict = await client.query(
      `SELECT id, evaluated_at FROM verification_verdicts WHERE run_id = $1`,
      [params.runId]
    );

    let verdictId: string;
    let evaluatedAt: string;

    if (existingVerdict.rows.length > 0) {
      // Verdict already exists for this run, return existing
      verdictId = existingVerdict.rows[0].id;
      evaluatedAt = existingVerdict.rows[0].evaluated_at;
    } else {
      // Store new verdict
      const verdictResult = await client.query(
        `INSERT INTO verification_verdicts 
         (issue_id, run_id, verdict, evidence_id, evaluation_rules, decision_rationale, failed_checks)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, evaluated_at`,
        [
          params.issueId,
          params.runId,
          params.verdict,
          evidenceId,
          params.evaluationRules,
          params.rationale,
          params.failedChecks,
        ]
      );
      verdictId = verdictResult.rows[0].id;
      evaluatedAt = verdictResult.rows[0].evaluated_at;

      // Update issue status based on verdict
      const newStatus = params.verdict === 'GREEN' ? 'VERIFIED' : 'HOLD';
      await client.query(
        `UPDATE afu9_issues SET status = $1 WHERE id = $2`,
        [newStatus, params.issueId]
      );

      // Log timeline event
      await createUnifiedTimelineEvent(client, {
        issue_id: params.issueId,
        event_type: 'verification_completed',
        event_data: {
          runId: params.runId,
          step: 'S7_VERIFY_GATE',
          verdict: params.verdict,
          evidenceId,
          verdictId,
          rationale: params.rationale,
          evaluationRules: params.evaluationRules,
          ...(params.failedChecks.length > 0 ? { failedChecks: params.failedChecks } : {}),
        },
        metadata: {
          requestId: params.requestId,
        },
      });
    }

    await client.query('COMMIT');

    return {
      success: true,
      verdictId,
      evidenceId,
      evaluatedAt,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[verificationService.storeVerdict] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    client.release();
  }
}

/**
 * Link evidence to verdict (immutable)
 */
export async function linkEvidence(
  pool: Pool,
  verdictId: string,
  evidenceId: string,
  evidence: VerificationEvidence
): Promise<void> {
  const evidenceHash = calculateEvidenceHash(evidence);
  
  // Insert link (idempotent with ON CONFLICT DO NOTHING)
  await pool.query(
    `INSERT INTO evidence_links (verdict_id, evidence_id, evidence_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (verdict_id, evidence_id) DO NOTHING`,
    [verdictId, evidenceId, evidenceHash]
  );
}

/**
 * Calculate deterministic hash of evidence for integrity and idempotency
 */
function calculateEvidenceHash(evidence: VerificationEvidence): string {
  // Sort keys to ensure deterministic serialization
  const normalized = JSON.stringify(evidence, Object.keys(evidence).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
