/**
 * Policy Manager
 * 
 * Manages policy snapshots for workflow executions.
 * Implements Issue 2.1: Policy Snapshotting per Run for immutable auditability.
 */

import { Pool } from 'pg';
import { 
  PolicySnapshot,
  storePolicySnapshot,
  getLatestPolicySnapshot,
} from '@codefactory/verdict-engine';
import { logger } from './logger';

// Import classification rules from deploy-memory
// These define the current policy state
// TODO: Move to configuration file for easier version management
const CURRENT_POLICY_VERSION = 'v1.0.0';

/**
 * Get current classification policy definition
 * This represents the "source of truth" for classification rules
 */
function getCurrentPolicyDefinition() {
  return {
    classification_rules: [
      {
        errorClass: 'ACM_DNS_VALIDATION_PENDING',
        service: 'ACM',
        patterns: ['DNS validation.*pending', 'Certificate.*validation.*not complete'],
        confidence: 0.9,
        tokens: ['ACM', 'DNS', 'validation', 'pending'],
      },
      {
        errorClass: 'ROUTE53_DELEGATION_PENDING',
        service: 'Route53',
        patterns: ['delegation.*pending', 'NS.*records.*not.*configured'],
        confidence: 0.9,
        tokens: ['Route53', 'delegation', 'NS', 'pending'],
      },
      {
        errorClass: 'CFN_ROLLBACK_LOCK',
        service: 'CloudFormation',
        patterns: ['Stack.*is in.*ROLLBACK', 'rollback.*in progress'],
        confidence: 0.95,
        tokens: ['CloudFormation', 'ROLLBACK', 'locked'],
      },
      {
        errorClass: 'CFN_IN_PROGRESS_LOCK',
        service: 'CloudFormation',
        patterns: ['Stack.*is in.*IN_PROGRESS', 'cannot.*update.*stack.*in progress'],
        confidence: 0.95,
        tokens: ['CloudFormation', 'IN_PROGRESS', 'locked'],
      },
      {
        errorClass: 'MISSING_SECRET',
        service: 'SecretsManager',
        patterns: ['ResourceNotFoundException.*Secrets Manager', 'secret.*not found'],
        confidence: 0.85,
        tokens: ['SecretsManager', 'secret', 'not found'],
      },
      {
        errorClass: 'MISSING_ENV_VAR',
        service: 'Configuration',
        patterns: ['missing required configuration', 'environment variable.*not set'],
        confidence: 0.8,
        tokens: ['configuration', 'environment', 'missing'],
      },
      {
        errorClass: 'DEPRECATED_CDK_API',
        service: 'CDK',
        patterns: ['deprecated.*API', 'method.*deprecated'],
        confidence: 0.75,
        tokens: ['CDK', 'deprecated', 'API'],
      },
      {
        errorClass: 'UNIT_MISMATCH',
        service: 'Configuration',
        patterns: ['expected.*MB.*but got.*KB', 'unit mismatch'],
        confidence: 0.8,
        tokens: ['unit', 'mismatch', 'configuration'],
      },
    ],
    playbooks: {
      ACM_DNS_VALIDATION_PENDING: 'WAIT_AND_RETRY',
      ROUTE53_DELEGATION_PENDING: 'HUMAN_REQUIRED',
      CFN_IN_PROGRESS_LOCK: 'WAIT_AND_RETRY',
      CFN_ROLLBACK_LOCK: 'OPEN_ISSUE',
      MISSING_SECRET: 'OPEN_ISSUE',
      MISSING_ENV_VAR: 'OPEN_ISSUE',
      DEPRECATED_CDK_API: 'OPEN_ISSUE',
      UNIT_MISMATCH: 'OPEN_ISSUE',
      UNKNOWN: 'OPEN_ISSUE',
    },
    confidence_normalization: {
      scale: '0-100',
      formula: 'raw_confidence * 100',
      deterministic: true,
    },
  };
}

/**
 * Create a policy snapshot for a workflow execution
 * 
 * This function ensures that every workflow execution has an immutable
 * policy snapshot that can be referenced for auditability.
 * 
 * @param pool Database connection pool
 * @param executionId Workflow execution ID
 * @returns Policy snapshot ID
 */
export async function createPolicySnapshotForExecution(
  pool: Pool,
  executionId: string
): Promise<string> {
  try {
    logger.info('Creating policy snapshot for execution', {
      executionId,
      version: CURRENT_POLICY_VERSION,
    }, 'PolicyManager');

    const policies = getCurrentPolicyDefinition();
    
    const snapshot = await storePolicySnapshot(pool, {
      version: CURRENT_POLICY_VERSION,
      policies,
      metadata: {
        created_by: 'AFU-9 Workflow Engine',
        execution_id: executionId,
        description: `Policy snapshot for execution ${executionId}`,
        timestamp: new Date().toISOString(),
      },
    });

    logger.info('Policy snapshot created', {
      executionId,
      snapshotId: snapshot.id,
      version: snapshot.version,
    }, 'PolicyManager');

    return snapshot.id;
  } catch (error) {
    logger.error('Failed to create policy snapshot', {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    }, 'PolicyManager');
    throw error;
  }
}

/**
 * Get or create policy snapshot for execution
 * 
 * This is the main entry point for workflow executions.
 * Currently creates a new snapshot for each execution to ensure complete immutability.
 * 
 * Future optimization: Could reuse recent snapshots with the same version
 * to reduce database load while maintaining auditability.
 * 
 * @param pool Database connection pool
 * @param executionId Workflow execution ID
 * @returns Policy snapshot ID
 */
export async function ensurePolicySnapshotForExecution(
  pool: Pool,
  executionId: string
): Promise<string> {
  try {
    // Always create a new snapshot per execution for complete immutability
    // This ensures each execution has its own policy record for audit purposes
    const snapshotId = await createPolicySnapshotForExecution(pool, executionId);
    
    return snapshotId;
  } catch (error) {
    logger.error('Failed to ensure policy snapshot', {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    }, 'PolicyManager');
    throw error;
  }
}

/**
 * Get policy snapshot for an execution
 * 
 * @param pool Database connection pool
 * @param executionId Workflow execution ID
 * @returns Policy snapshot or null if not found
 */
export async function getPolicySnapshotForExecution(
  pool: Pool,
  executionId: string
): Promise<PolicySnapshot | null> {
  try {
    // Query the workflow_executions table to get the policy_snapshot_id
    const query = `
      SELECT policy_snapshot_id
      FROM workflow_executions
      WHERE id = $1
    `;
    
    const result = await pool.query(query, [executionId]);
    
    if (result.rows.length === 0 || !result.rows[0].policy_snapshot_id) {
      return null;
    }
    
    const snapshotId = result.rows[0].policy_snapshot_id;
    
    // Get the policy snapshot
    const snapshotQuery = `
      SELECT id, version, policies, created_at, metadata
      FROM policy_snapshots
      WHERE id = $1
    `;
    
    const snapshotResult = await pool.query(snapshotQuery, [snapshotId]);
    
    if (snapshotResult.rows.length === 0) {
      return null;
    }
    
    const row = snapshotResult.rows[0];
    return {
      id: row.id,
      version: row.version,
      policies: row.policies,
      created_at: row.created_at.toISOString(),
      metadata: row.metadata,
    };
  } catch (error) {
    logger.error('Failed to get policy snapshot for execution', {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    }, 'PolicyManager');
    return null;
  }
}
