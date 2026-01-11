/**
 * Repository Actions Registry Service (E83.1)
 * 
 * Service for managing and validating repository action registries.
 * Implements fail-closed semantics: unknown actions are blocked.
 * 
 * Epic E83: GH Workflow Orchestrator
 */

import { Pool } from 'pg';
import { getPool } from './db';
import { logger } from './logger';
import {
  RepoActionsRegistry,
  RepoActionsRegistrySchema,
  RepoActionsRegistryRecord,
  RegistryAuditLog,
  ActionValidationResult,
  ActionType,
  ActionConfig,
  Precondition,
} from './types/repo-actions-registry';

export class RepoActionsRegistryService {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool || getPool();
  }

  /**
   * Get active registry for a repository
   */
  async getActiveRegistry(repository: string): Promise<RepoActionsRegistryRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM repo_actions_registry 
       WHERE repository = $1 AND active = true
       LIMIT 1`,
      [repository]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRegistryRecord(result.rows[0]);
  }

  /**
   * Get registry by ID
   */
  async getRegistryById(id: string): Promise<RepoActionsRegistryRecord | null> {
    const result = await this.pool.query(
      'SELECT * FROM repo_actions_registry WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRegistryRecord(result.rows[0]);
  }

  /**
   * Get registry by registry ID
   */
  async getRegistryByRegistryId(registryId: string): Promise<RepoActionsRegistryRecord | null> {
    const result = await this.pool.query(
      'SELECT * FROM repo_actions_registry WHERE registry_id = $1',
      [registryId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRegistryRecord(result.rows[0]);
  }

  /**
   * Create a new registry
   */
  async createRegistry(registry: RepoActionsRegistry): Promise<RepoActionsRegistryRecord> {
    // Validate schema
    const validated = RepoActionsRegistrySchema.parse(registry);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Deactivate any existing active registries for this repository
      await client.query(
        'UPDATE repo_actions_registry SET active = false WHERE repository = $1 AND active = true',
        [validated.repository]
      );

      // Insert new registry
      const result = await client.query(
        `INSERT INTO repo_actions_registry (
          registry_id, repository, version, content, active, fail_closed, 
          created_by, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          validated.registryId,
          validated.repository,
          validated.version,
          JSON.stringify(validated),
          true,
          validated.failClosed,
          validated.createdBy,
          validated.notes,
        ]
      );

      await client.query('COMMIT');

      logger.info('Created repository actions registry', {
        registryId: validated.registryId,
        repository: validated.repository,
        version: validated.version,
      }, 'RepoActionsRegistry');

      return this.mapRegistryRecord(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(
        'Failed to create repository actions registry',
        error instanceof Error ? error : new Error(String(error)),
        { repository: validated.repository },
        'RepoActionsRegistry'
      );
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update an existing registry
   */
  async updateRegistry(
    registryId: string,
    updates: Partial<RepoActionsRegistry>,
    updatedBy: string
  ): Promise<RepoActionsRegistryRecord> {
    const existing = await this.getRegistryByRegistryId(registryId);
    if (!existing) {
      throw new Error(`Registry not found: ${registryId}`);
    }

    const updated = RepoActionsRegistrySchema.parse({
      ...existing.content,
      ...updates,
      updatedAt: new Date().toISOString(),
      updatedBy,
    });

    const result = await this.pool.query(
      `UPDATE repo_actions_registry 
       SET content = $1, version = $2, updated_by = $3, updated_at = NOW()
       WHERE registry_id = $4
       RETURNING *`,
      [JSON.stringify(updated), updated.version, updatedBy, registryId]
    );

    logger.info('Updated repository actions registry', {
      registryId,
      version: updated.version,
    }, 'RepoActionsRegistry');

    return this.mapRegistryRecord(result.rows[0]);
  }

  /**
   * Activate a registry (deactivating others for the same repository)
   */
  async activateRegistry(registryId: string): Promise<void> {
    const registry = await this.getRegistryByRegistryId(registryId);
    if (!registry) {
      throw new Error(`Registry not found: ${registryId}`);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Deactivate all other registries for this repository
      await client.query(
        'UPDATE repo_actions_registry SET active = false WHERE repository = $1 AND registry_id != $2',
        [registry.repository, registryId]
      );

      // Activate this registry
      await client.query(
        'UPDATE repo_actions_registry SET active = true WHERE registry_id = $1',
        [registryId]
      );

      await client.query('COMMIT');

      logger.info('Activated repository actions registry', {
        registryId,
        repository: registry.repository,
      }, 'RepoActionsRegistry');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Validate an action against the registry
   * Implements fail-closed semantics: unknown actions are blocked
   */
  async validateAction(
    repository: string,
    actionType: ActionType,
    context: {
      resourceType: 'issue' | 'pull_request';
      resourceNumber: number;
      checks?: { name: string; status: string }[];
      reviews?: { state: string; user: string }[];
      labels?: string[];
      assignees?: string[];
      mergeable?: boolean;
      draft?: boolean;
    }
  ): Promise<ActionValidationResult> {
    const registry = await this.getActiveRegistry(repository);

    // If no registry exists, fail closed
    if (!registry) {
      logger.warn('No active registry found for repository', { repository }, 'RepoActionsRegistry');
      return {
        allowed: false,
        actionType,
        preconditionsMet: false,
        missingPreconditions: [],
        approvalRequired: false,
        approvalMet: false,
        errors: ['No active registry found for repository'],
        warnings: [],
      };
    }

    // Find action configuration
    const actionConfig = registry.content.allowedActions.find(
      (a) => a.actionType === actionType
    );

    // If action not in allowedActions and fail-closed, block
    if (!actionConfig) {
      if (registry.content.failClosed) {
        logger.warn('Action not found in registry (fail-closed)', {
          repository,
          actionType,
          registryId: registry.registryId,
        }, 'RepoActionsRegistry');
        return {
          allowed: false,
          actionType,
          preconditionsMet: false,
          missingPreconditions: [],
          approvalRequired: false,
          approvalMet: false,
          errors: [`Action "${actionType}" not found in registry (fail-closed mode)`],
          warnings: [],
        };
      } else {
        // Fail-open mode (allow unknown actions)
        logger.info('Action not found in registry (fail-open)', {
          repository,
          actionType,
          registryId: registry.registryId,
        }, 'RepoActionsRegistry');
        return {
          allowed: true,
          actionType,
          preconditionsMet: true,
          missingPreconditions: [],
          approvalRequired: false,
          approvalMet: true,
          errors: [],
          warnings: [`Action "${actionType}" not found in registry (fail-open mode)`],
        };
      }
    }

    // Check if action is enabled
    if (!actionConfig.enabled) {
      return {
        allowed: false,
        actionType,
        actionConfig,
        preconditionsMet: false,
        missingPreconditions: [],
        approvalRequired: false,
        approvalMet: false,
        errors: [`Action "${actionType}" is disabled in registry`],
        warnings: [],
      };
    }

    // Check preconditions
    const missingPreconditions: Precondition[] = [];
    for (const precondition of actionConfig.preconditions) {
      if (!this.checkPrecondition(precondition, context)) {
        missingPreconditions.push(precondition);
      }
    }

    const preconditionsMet = missingPreconditions.length === 0;

    // Check approval requirements
    const approvalRequired = actionConfig.approvalRule?.required ?? false;
    let approvalMet = !approvalRequired;

    if (approvalRequired && context.reviews) {
      const approvedReviews = context.reviews.filter((r) => r.state === 'APPROVED');
      const minApprovers = actionConfig.approvalRule?.minApprovers ?? 1;
      approvalMet = approvedReviews.length >= minApprovers;
    }

    const allowed = preconditionsMet && approvalMet;

    const errors: string[] = [];
    if (!preconditionsMet) {
      errors.push(
        `Preconditions not met: ${missingPreconditions.map((p) => p.type).join(', ')}`
      );
    }
    if (!approvalMet) {
      errors.push('Approval requirements not met');
    }

    return {
      allowed,
      actionType,
      actionConfig,
      preconditionsMet,
      missingPreconditions,
      approvalRequired,
      approvalMet,
      errors,
      warnings: [],
    };
  }

  /**
   * Log action validation to audit trail
   */
  async logActionValidation(
    registryId: string,
    repository: string,
    resourceType: 'issue' | 'pull_request',
    resourceNumber: number,
    validationResult: ActionValidationResult,
    executedBy?: string
  ): Promise<void> {
    const registry = await this.getRegistryByRegistryId(registryId);
    if (!registry) {
      throw new Error(`Registry not found: ${registryId}`);
    }

    await this.pool.query(
      `INSERT INTO registry_action_audit (
        registry_id, registry_version, action_type, action_status,
        repository, resource_type, resource_number,
        validation_result, executed_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        registryId,
        registry.version,
        validationResult.actionType,
        validationResult.allowed
          ? 'allowed'
          : validationResult.approvalRequired && !validationResult.approvalMet
          ? 'pending_approval'
          : 'blocked',
        repository,
        resourceType,
        resourceNumber,
        JSON.stringify(validationResult),
        executedBy,
      ]
    );

    logger.info('Logged action validation to audit trail', {
      registryId,
      actionType: validationResult.actionType,
      allowed: validationResult.allowed,
      repository,
      resourceType,
      resourceNumber,
    }, 'RepoActionsRegistry');
  }

  /**
   * Get audit logs for a registry
   */
  async getAuditLogs(
    registryId: string,
    filters?: {
      actionType?: ActionType;
      actionStatus?: 'allowed' | 'blocked' | 'pending_approval';
      limit?: number;
    }
  ): Promise<RegistryAuditLog[]> {
    let query = 'SELECT * FROM registry_action_audit WHERE registry_id = $1';
    const params: any[] = [registryId];
    let paramIndex = 2;

    if (filters?.actionType) {
      query += ` AND action_type = $${paramIndex++}`;
      params.push(filters.actionType);
    }

    if (filters?.actionStatus) {
      query += ` AND action_status = $${paramIndex++}`;
      params.push(filters.actionStatus);
    }

    query += ' ORDER BY created_at DESC';

    if (filters?.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => this.mapAuditLog(row));
  }

  /**
   * Check if a precondition is met
   */
  private checkPrecondition(
    precondition: Precondition,
    context: {
      checks?: { name: string; status: string }[];
      reviews?: { state: string; user: string }[];
      labels?: string[];
      assignees?: string[];
      mergeable?: boolean;
      draft?: boolean;
    }
  ): boolean {
    switch (precondition.type) {
      case 'checks_passed':
        return context.checks?.every((c) => c.status === 'success') ?? false;

      case 'checks_status':
        if (typeof precondition.value === 'string') {
          return context.checks?.every((c) => c.status === precondition.value) ?? false;
        }
        return false;

      case 'review_approved':
        return context.reviews?.some((r) => r.state === 'APPROVED') ?? false;

      case 'review_count':
        if (typeof precondition.value === 'number') {
          return (context.reviews?.filter((r) => r.state === 'APPROVED').length ?? 0) >= precondition.value;
        }
        return false;

      case 'label_present':
        if (typeof precondition.value === 'string') {
          return context.labels?.includes(precondition.value) ?? false;
        }
        return false;

      case 'label_absent':
        if (typeof precondition.value === 'string') {
          return !context.labels?.includes(precondition.value) ?? true;
        }
        return false;

      case 'assignee_set':
        return (context.assignees?.length ?? 0) > 0;

      case 'pr_mergeable':
        return context.mergeable === true;

      case 'pr_not_draft':
        return context.draft === false;

      default:
        logger.warn('Unknown precondition type', { type: precondition.type }, 'RepoActionsRegistry');
        return false;
    }
  }

  /**
   * Map database row to RegistryRecord
   */
  private mapRegistryRecord(row: any): RepoActionsRegistryRecord {
    return {
      id: row.id,
      registryId: row.registry_id,
      repository: row.repository,
      version: row.version,
      content: row.content,
      active: row.active,
      createdAt: row.created_at,
      createdBy: row.created_by,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }

  /**
   * Map database row to AuditLog
   */
  private mapAuditLog(row: any): RegistryAuditLog {
    return {
      id: row.id,
      registryId: row.registry_id,
      actionType: row.action_type,
      actionStatus: row.action_status,
      repository: row.repository,
      resourceType: row.resource_type,
      resourceNumber: row.resource_number,
      validationResult: row.validation_result,
      executedAt: row.executed_at,
      executedBy: row.executed_by,
      createdAt: row.created_at,
    };
  }
}

// Export singleton instance
let repoActionsRegistryService: RepoActionsRegistryService;

export function getRepoActionsRegistryService(): RepoActionsRegistryService {
  if (!repoActionsRegistryService) {
    repoActionsRegistryService = new RepoActionsRegistryService();
  }
  return repoActionsRegistryService;
}
