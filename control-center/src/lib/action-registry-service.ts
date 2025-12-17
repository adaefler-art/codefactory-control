/**
 * Action Registry Service
 * 
 * Service for managing versioned actions (tool/function definitions)
 * with schema validation and usage tracking.
 * 
 * Implements EPIC 6: Prompt & Action Canon for Factory Intelligence.
 */

import { Pool } from 'pg';
import { getPool } from './db';
import { logger } from './logger';
import {
  Action,
  ActionVersion,
  ActionWithVersion,
  ActionUsageMetrics,
  CreateActionRequest,
  CreateActionVersionRequest,
  ChangeType,
  VersionComparison,
} from './types/prompt-library';

export class ActionRegistryService {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool || getPool();
  }

  /**
   * Create a new action with its first version
   */
  async createAction(request: CreateActionRequest): Promise<ActionWithVersion> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Create action
      const actionResult = await client.query(
        `INSERT INTO actions (name, category, description, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [request.name, request.category, request.description, request.createdBy || 'system']
      );

      const action = this.mapAction(actionResult.rows[0]);

      // Create first version (1.0.0)
      const versionResult = await client.query(
        `INSERT INTO action_versions (
           action_id, version, tool_reference, input_schema, output_schema,
           change_type, change_description, validated, published, published_at, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          action.id,
          '1.0.0',
          request.toolReference,
          JSON.stringify(request.inputSchema),
          JSON.stringify(request.outputSchema || {}),
          'major',
          'Initial version',
          true,
          true,
          new Date(),
          request.createdBy || 'system',
        ]
      );

      const version = this.mapActionVersion(versionResult.rows[0]);

      // Update action with current version
      await client.query(
        'UPDATE actions SET current_version_id = $1 WHERE id = $2',
        [version.id, action.id]
      );

      await client.query('COMMIT');

      logger.info('Created action', { actionId: action.id, version: version.version }, 'ActionRegistry');

      return {
        ...action,
        currentVersionId: version.id,
        currentVersion: version,
        versionCount: 1,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create action', { error, request }, 'ActionRegistry');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create a new version of an existing action
   */
  async createActionVersion(request: CreateActionVersionRequest): Promise<ActionVersion> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Get current version
      const currentVersionResult = await client.query(
        `SELECT av.* FROM action_versions av
         JOIN actions a ON a.current_version_id = av.id
         WHERE a.id = $1`,
        [request.actionId]
      );

      if (currentVersionResult.rows.length === 0) {
        throw new Error(`Action not found: ${request.actionId}`);
      }

      const currentVersion = this.mapActionVersion(currentVersionResult.rows[0]);

      // Determine new version number
      const newVersion = request.version || this.incrementVersion(currentVersion.version, request.changeType);

      // Validate version
      const comparison = this.compareVersions(currentVersion.version, newVersion);
      if (!comparison.isValid) {
        throw new Error(`Invalid version: ${comparison.errors.join(', ')}`);
      }

      // Create new version
      const versionResult = await client.query(
        `INSERT INTO action_versions (
           action_id, version, tool_reference, input_schema, output_schema,
           change_type, change_description, breaking_changes, migration_guide,
           validated, published, published_at, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          request.actionId,
          newVersion,
          request.toolReference,
          JSON.stringify(request.inputSchema),
          JSON.stringify(request.outputSchema || {}),
          request.changeType,
          request.changeDescription,
          request.breakingChanges,
          request.migrationGuide,
          true,
          true,
          new Date(),
          request.createdBy || 'system',
        ]
      );

      const version = this.mapActionVersion(versionResult.rows[0]);

      // Update action current version
      await client.query(
        'UPDATE actions SET current_version_id = $1, updated_at = NOW() WHERE id = $2',
        [version.id, request.actionId]
      );

      await client.query('COMMIT');

      logger.info('Created action version', {
        actionId: request.actionId,
        version: version.version,
        changeType: request.changeType,
      }, 'ActionRegistry');

      return version;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create action version', { error, request }, 'ActionRegistry');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get action by name with current version
   */
  async getActionByName(name: string): Promise<ActionWithVersion | null> {
    const result = await this.pool.query(
      `SELECT 
         a.*,
         av.id as version_id, av.version, av.tool_reference, 
         av.input_schema, av.output_schema, av.change_type, 
         av.change_description, av.published_at as version_published_at,
         (SELECT COUNT(*) FROM action_versions WHERE action_id = a.id) as version_count
       FROM actions a
       LEFT JOIN action_versions av ON a.current_version_id = av.id
       WHERE a.name = $1`,
      [name]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapActionWithVersion(result.rows[0]);
  }

  /**
   * Get action by tool reference
   */
  async getActionByToolReference(toolReference: string): Promise<ActionWithVersion | null> {
    const result = await this.pool.query(
      `SELECT 
         a.*,
         av.id as version_id, av.version, av.tool_reference,
         av.input_schema, av.output_schema, av.change_type,
         av.change_description, av.published_at as version_published_at,
         (SELECT COUNT(*) FROM action_versions WHERE action_id = a.id) as version_count
       FROM actions a
       JOIN action_versions av ON a.current_version_id = av.id
       WHERE av.tool_reference = $1`,
      [toolReference]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapActionWithVersion(result.rows[0]);
  }

  /**
   * Get action by ID with current version
   */
  async getActionById(id: string): Promise<ActionWithVersion | null> {
    const result = await this.pool.query(
      `SELECT 
         a.*,
         av.id as version_id, av.version, av.tool_reference,
         av.input_schema, av.output_schema, av.change_type,
         av.change_description, av.published_at as version_published_at,
         (SELECT COUNT(*) FROM action_versions WHERE action_id = a.id) as version_count
       FROM actions a
       LEFT JOIN action_versions av ON a.current_version_id = av.id
       WHERE a.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapActionWithVersion(result.rows[0]);
  }

  /**
   * Get specific version of an action
   */
  async getActionVersion(actionId: string, version: string): Promise<ActionVersion | null> {
    const result = await this.pool.query(
      'SELECT * FROM action_versions WHERE action_id = $1 AND version = $2',
      [actionId, version]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapActionVersion(result.rows[0]);
  }

  /**
   * List all actions with their current versions
   */
  async listActions(filters?: {
    category?: string;
    deprecated?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<ActionWithVersion[]> {
    let query = `
      SELECT 
        a.*,
        av.id as version_id, av.version, av.tool_reference,
        av.input_schema, av.output_schema, av.change_type,
        av.change_description, av.published_at as version_published_at,
        (SELECT COUNT(*) FROM action_versions WHERE action_id = a.id) as version_count
      FROM actions a
      LEFT JOIN action_versions av ON a.current_version_id = av.id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.category) {
      query += ` AND a.category = $${paramIndex++}`;
      params.push(filters.category);
    }

    if (filters?.deprecated !== undefined) {
      query += ` AND a.deprecated = $${paramIndex++}`;
      params.push(filters.deprecated);
    }

    query += ` ORDER BY a.created_at DESC`;

    if (filters?.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }

    if (filters?.offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(filters.offset);
    }

    const result = await this.pool.query(query, params);
    return result.rows.map(row => this.mapActionWithVersion(row));
  }

  /**
   * List all versions of an action
   */
  async listActionVersions(actionId: string): Promise<ActionVersion[]> {
    const result = await this.pool.query(
      'SELECT * FROM action_versions WHERE action_id = $1 ORDER BY created_at DESC',
      [actionId]
    );

    return result.rows.map(row => this.mapActionVersion(row));
  }

  /**
   * Deprecate an action
   */
  async deprecateAction(actionId: string, reason: string, replacementActionId?: string): Promise<void> {
    await this.pool.query(
      `UPDATE actions 
       SET deprecated = true, deprecated_at = NOW(),
           deprecation_reason = $1, replacement_action_id = $2, updated_at = NOW()
       WHERE id = $3`,
      [reason, replacementActionId, actionId]
    );

    logger.info('Deprecated action', { actionId, reason, replacementActionId }, 'ActionRegistry');
  }

  /**
   * Get action usage metrics
   */
  async getActionUsageMetrics(filters?: {
    category?: string;
    limit?: number;
  }): Promise<ActionUsageMetrics[]> {
    let query = 'SELECT * FROM action_usage_metrics WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.category) {
      query += ` AND category = $${paramIndex++}`;
      params.push(filters.category);
    }

    query += ' ORDER BY total_calls DESC';

    if (filters?.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }

    const result = await this.pool.query(query, params);
    return result.rows.map(row => ({
      actionId: row.action_id,
      actionName: row.action_name,
      category: row.category,
      currentVersion: row.current_version,
      currentVersionPublishedAt: row.current_version_published_at,
      totalCalls: parseInt(row.total_calls || '0'),
      daysCalled: parseInt(row.days_called || '0'),
      executionsUsingAction: parseInt(row.executions_using_action || '0'),
      lastCalledAt: row.last_called_at,
      firstCalledAt: row.first_called_at,
      avgDurationMs: parseFloat(row.avg_duration_ms || '0'),
      errorCount: parseInt(row.error_count || '0'),
      versionCount: parseInt(row.version_count || '0'),
      isDeprecated: row.is_deprecated,
    }));
  }

  /**
   * Increment version based on change type
   */
  private incrementVersion(currentVersion: string, changeType: ChangeType): string {
    const [major, minor, patch] = currentVersion.split('.').map(Number);

    switch (changeType) {
      case 'major':
        return `${major + 1}.0.0`;
      case 'minor':
        return `${major}.${minor + 1}.0`;
      case 'patch':
        return `${major}.${minor}.${patch + 1}`;
      default:
        throw new Error(`Invalid change type: ${changeType}`);
    }
  }

  /**
   * Compare two versions
   */
  private compareVersions(oldVersion: string, newVersion: string): VersionComparison {
    const [oldMajor, oldMinor, oldPatch] = oldVersion.split('.').map(Number);
    const [newMajor, newMinor, newPatch] = newVersion.split('.').map(Number);

    const errors: string[] = [];

    if (newMajor < oldMajor) {
      errors.push('Major version cannot decrease');
    } else if (newMajor === oldMajor) {
      if (newMinor < oldMinor) {
        errors.push('Minor version cannot decrease');
      } else if (newMinor === oldMinor) {
        if (newPatch <= oldPatch) {
          errors.push('Patch version must increase');
        }
      }
    }

    let changeType: ChangeType;
    if (newMajor > oldMajor) {
      changeType = 'major';
    } else if (newMinor > oldMinor) {
      changeType = 'minor';
    } else {
      changeType = 'patch';
    }

    return {
      oldVersion,
      newVersion,
      changeType,
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Map database row to Action
   */
  private mapAction(row: any): Action {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
      currentVersionId: row.current_version_id,
      deprecated: row.deprecated,
      deprecatedAt: row.deprecated_at,
      deprecationReason: row.deprecation_reason,
      replacementActionId: row.replacement_action_id,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Map database row to ActionVersion
   */
  private mapActionVersion(row: any): ActionVersion {
    return {
      id: row.id,
      actionId: row.action_id,
      version: row.version,
      toolReference: row.tool_reference,
      inputSchema: row.input_schema,
      outputSchema: row.output_schema,
      changeType: row.change_type,
      changeDescription: row.change_description,
      breakingChanges: row.breaking_changes,
      migrationGuide: row.migration_guide,
      validated: row.validated,
      validationResults: row.validation_results,
      published: row.published,
      publishedAt: row.published_at,
      publishedBy: row.published_by,
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }

  /**
   * Map database row to ActionWithVersion
   */
  private mapActionWithVersion(row: any): ActionWithVersion {
    const action = this.mapAction(row);

    return {
      ...action,
      currentVersion: row.version_id ? {
        id: row.version_id,
        actionId: row.id,
        version: row.version,
        toolReference: row.tool_reference,
        inputSchema: row.input_schema,
        outputSchema: row.output_schema,
        changeType: row.change_type,
        changeDescription: row.change_description,
        breakingChanges: row.breaking_changes,
        migrationGuide: row.migration_guide,
        validated: true,
        published: true,
        publishedAt: row.version_published_at,
        publishedBy: row.published_by,
        createdBy: row.created_by,
        createdAt: row.created_at,
      } : undefined,
      versionCount: parseInt(row.version_count || '0'),
    };
  }
}

// Export singleton instance
let actionRegistryService: ActionRegistryService;

export function getActionRegistryService(): ActionRegistryService {
  if (!actionRegistryService) {
    actionRegistryService = new ActionRegistryService();
  }
  return actionRegistryService;
}
