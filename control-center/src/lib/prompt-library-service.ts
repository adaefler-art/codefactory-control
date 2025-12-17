/**
 * Prompt Library Service
 * 
 * Service for managing versioned prompts with semantic versioning,
 * breaking change detection, and usage tracking.
 * 
 * Implements EPIC 6: Prompt & Action Canon for Factory Intelligence.
 */

import { Pool } from 'pg';
import { getPool } from './db';
import { logger } from './logger';
import {
  Prompt,
  PromptVersion,
  PromptWithVersion,
  PromptStabilityMetrics,
  CreatePromptRequest,
  CreatePromptVersionRequest,
  BreakingChangeAnalysis,
  ChangeType,
  VersionComparison,
} from './types/prompt-library';

export class PromptLibraryService {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool || getPool();
  }

  /**
   * Create a new prompt with its first version
   */
  async createPrompt(request: CreatePromptRequest): Promise<PromptWithVersion> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Create prompt
      const promptResult = await client.query(
        `INSERT INTO prompts (name, category, description, purpose, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [request.name, request.category, request.description, request.purpose, request.createdBy || 'system']
      );

      const prompt = this.mapPrompt(promptResult.rows[0]);

      // Create first version (1.0.0)
      const versionResult = await client.query(
        `INSERT INTO prompt_versions (
           prompt_id, version, content, system_prompt, user_prompt_template,
           variables, model_config, change_type, change_description,
           validated, published, published_at, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          prompt.id,
          '1.0.0',
          request.systemPrompt || '',
          request.systemPrompt,
          request.userPromptTemplate,
          JSON.stringify(request.variables || {}),
          JSON.stringify(request.modelConfig || {}),
          'major',
          'Initial version',
          true,
          true,
          new Date(),
          request.createdBy || 'system',
        ]
      );

      const version = this.mapPromptVersion(versionResult.rows[0]);

      // Update prompt with current version
      await client.query(
        'UPDATE prompts SET current_version_id = $1 WHERE id = $2',
        [version.id, prompt.id]
      );

      await client.query('COMMIT');

      logger.info('Created prompt', { promptId: prompt.id, version: version.version }, 'PromptLibrary');

      return {
        ...prompt,
        currentVersionId: version.id,
        currentVersion: version,
        versionCount: 1,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(
        'Failed to create prompt',
        error instanceof Error ? error : new Error(String(error)),
        { request: request.name },
        'PromptLibrary'
      );
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create a new version of an existing prompt
   */
  async createPromptVersion(request: CreatePromptVersionRequest): Promise<PromptVersion> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Get current version for comparison
      const currentVersionResult = await client.query(
        `SELECT pv.* FROM prompt_versions pv
         JOIN prompts p ON p.current_version_id = pv.id
         WHERE p.id = $1`,
        [request.promptId]
      );

      if (currentVersionResult.rows.length === 0) {
        throw new Error(`Prompt not found: ${request.promptId}`);
      }

      const currentVersion = this.mapPromptVersion(currentVersionResult.rows[0]);

      // Detect breaking changes if not explicitly provided
      let breakingChanges = request.breakingChanges;
      if (!breakingChanges && request.changeType === 'major') {
        const analysis = this.detectBreakingChanges(currentVersion, request);
        if (analysis.hasBreakingChanges) {
          breakingChanges = analysis.changes.map(c => c.description).join('\n');
        }
      }

      // Determine new version number
      const newVersion = request.version || this.incrementVersion(currentVersion.version, request.changeType);

      // Validate version is greater than current
      const comparison = this.compareVersions(currentVersion.version, newVersion);
      if (!comparison.isValid) {
        throw new Error(`Invalid version: ${comparison.errors.join(', ')}`);
      }

      // Create new version
      const versionResult = await client.query(
        `INSERT INTO prompt_versions (
           prompt_id, version, content, system_prompt, user_prompt_template,
           variables, model_config, change_type, change_description,
           breaking_changes, migration_guide, validated, published, published_at, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING *`,
        [
          request.promptId,
          newVersion,
          request.content,
          request.systemPrompt,
          request.userPromptTemplate,
          JSON.stringify(request.variables || {}),
          JSON.stringify(request.modelConfig || {}),
          request.changeType,
          request.changeDescription,
          breakingChanges,
          request.migrationGuide,
          true,
          true,
          new Date(),
          request.createdBy || 'system',
        ]
      );

      const version = this.mapPromptVersion(versionResult.rows[0]);

      // Update prompt current version
      await client.query(
        'UPDATE prompts SET current_version_id = $1, updated_at = NOW() WHERE id = $2',
        [version.id, request.promptId]
      );

      await client.query('COMMIT');

      logger.info('Created prompt version', {
        promptId: request.promptId,
        version: version.version,
        changeType: request.changeType,
      }, 'PromptLibrary');

      return version;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(
        'Failed to create prompt version',
        error instanceof Error ? error : new Error(String(error)),
        { promptId: request.promptId },
        'PromptLibrary'
      );
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get prompt by name with current version
   */
  async getPromptByName(name: string): Promise<PromptWithVersion | null> {
    const result = await this.pool.query(
      `SELECT 
         p.*,
         pv.id as version_id, pv.version, pv.content, pv.system_prompt, 
         pv.user_prompt_template, pv.variables, pv.model_config,
         pv.change_type, pv.change_description, pv.breaking_changes,
         pv.published_at as version_published_at,
         (SELECT COUNT(*) FROM prompt_versions WHERE prompt_id = p.id) as version_count
       FROM prompts p
       LEFT JOIN prompt_versions pv ON p.current_version_id = pv.id
       WHERE p.name = $1`,
      [name]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapPromptWithVersion(result.rows[0]);
  }

  /**
   * Get prompt by ID with current version
   */
  async getPromptById(id: string): Promise<PromptWithVersion | null> {
    const result = await this.pool.query(
      `SELECT 
         p.*,
         pv.id as version_id, pv.version, pv.content, pv.system_prompt,
         pv.user_prompt_template, pv.variables, pv.model_config,
         pv.change_type, pv.change_description, pv.breaking_changes,
         pv.published_at as version_published_at,
         (SELECT COUNT(*) FROM prompt_versions WHERE prompt_id = p.id) as version_count
       FROM prompts p
       LEFT JOIN prompt_versions pv ON p.current_version_id = pv.id
       WHERE p.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapPromptWithVersion(result.rows[0]);
  }

  /**
   * Get specific version of a prompt
   */
  async getPromptVersion(promptId: string, version: string): Promise<PromptVersion | null> {
    const result = await this.pool.query(
      'SELECT * FROM prompt_versions WHERE prompt_id = $1 AND version = $2',
      [promptId, version]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapPromptVersion(result.rows[0]);
  }

  /**
   * List all prompts with their current versions
   */
  async listPrompts(filters?: {
    category?: string;
    deprecated?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<PromptWithVersion[]> {
    let query = `
      SELECT 
        p.*,
        pv.id as version_id, pv.version, pv.content, pv.system_prompt,
        pv.user_prompt_template, pv.variables, pv.model_config,
        pv.change_type, pv.change_description,
        pv.published_at as version_published_at,
        (SELECT COUNT(*) FROM prompt_versions WHERE prompt_id = p.id) as version_count
      FROM prompts p
      LEFT JOIN prompt_versions pv ON p.current_version_id = pv.id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.category) {
      query += ` AND p.category = $${paramIndex++}`;
      params.push(filters.category);
    }

    if (filters?.deprecated !== undefined) {
      query += ` AND p.deprecated = $${paramIndex++}`;
      params.push(filters.deprecated);
    }

    query += ` ORDER BY p.created_at DESC`;

    if (filters?.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }

    if (filters?.offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(filters.offset);
    }

    const result = await this.pool.query(query, params);
    return result.rows.map(row => this.mapPromptWithVersion(row));
  }

  /**
   * List all versions of a prompt
   */
  async listPromptVersions(promptId: string): Promise<PromptVersion[]> {
    const result = await this.pool.query(
      'SELECT * FROM prompt_versions WHERE prompt_id = $1 ORDER BY created_at DESC',
      [promptId]
    );

    return result.rows.map(row => this.mapPromptVersion(row));
  }

  /**
   * Deprecate a prompt
   */
  async deprecatePrompt(promptId: string, reason: string, replacementPromptId?: string): Promise<void> {
    await this.pool.query(
      `UPDATE prompts 
       SET deprecated = true, deprecated_at = NOW(), 
           deprecation_reason = $1, replacement_prompt_id = $2, updated_at = NOW()
       WHERE id = $3`,
      [reason, replacementPromptId, promptId]
    );

    logger.info('Deprecated prompt', { promptId, reason, replacementPromptId }, 'PromptLibrary');
  }

  /**
   * Get prompt stability metrics (KPI)
   */
  async getPromptStabilityMetrics(filters?: {
    category?: string;
    limit?: number;
  }): Promise<PromptStabilityMetrics[]> {
    let query = 'SELECT * FROM prompt_stability_metrics WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.category) {
      query += ` AND category = $${paramIndex++}`;
      params.push(filters.category);
    }

    query += ' ORDER BY total_uses DESC';

    if (filters?.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }

    const result = await this.pool.query(query, params);
    return result.rows.map(row => ({
      promptId: row.prompt_id,
      promptName: row.prompt_name,
      category: row.category,
      currentVersion: row.current_version,
      currentVersionPublishedAt: row.current_version_published_at,
      totalUses: parseInt(row.total_uses || '0'),
      daysUsed: parseInt(row.days_used || '0'),
      executionsUsingPrompt: parseInt(row.executions_using_prompt || '0'),
      lastUsedAt: row.last_used_at,
      firstUsedAt: row.first_used_at,
      versionCount: parseInt(row.version_count || '0'),
      lastBreakingChangeAt: row.last_breaking_change_at,
      isDeprecated: row.is_deprecated,
    }));
  }

  /**
   * Detect breaking changes between versions
   */
  private detectBreakingChanges(
    currentVersion: PromptVersion,
    newRequest: CreatePromptVersionRequest
  ): BreakingChangeAnalysis {
    const changes: BreakingChangeAnalysis['changes'] = [];

    // Check for removed variables
    const currentVars = currentVersion.variables || {};
    const newVars = newRequest.variables || {};

    for (const key of Object.keys(currentVars)) {
      if (!(key in newVars)) {
        changes.push({
          type: 'variable_removed',
          description: `Variable '${key}' was removed`,
          impact: 'high',
        });
      }
    }

    // Check for significant content changes
    if (currentVersion.systemPrompt !== newRequest.systemPrompt) {
      const changeRatio = this.calculateChangeRatio(
        currentVersion.systemPrompt || '',
        newRequest.systemPrompt || ''
      );
      
      if (changeRatio > 0.5) {
        changes.push({
          type: 'output_changed',
          description: 'System prompt changed significantly (>50% difference)',
          impact: 'high',
        });
      }
    }

    const hasBreakingChanges = changes.some(c => c.impact === 'high');
    const recommendedChangeType: ChangeType = 
      hasBreakingChanges ? 'major' : 
      changes.length > 0 ? 'minor' : 
      'patch';

    return {
      hasBreakingChanges,
      changes,
      recommendedChangeType,
      migrationRequired: hasBreakingChanges,
    };
  }

  /**
   * Calculate similarity ratio between two strings
   */
  private calculateChangeRatio(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    
    if (len1 === 0 && len2 === 0) return 0;
    if (len1 === 0 || len2 === 0) return 1;
    
    // Simple character-based difference
    const maxLen = Math.max(len1, len2);
    const minLen = Math.min(len1, len2);
    const lengthDiff = maxLen - minLen;
    
    return lengthDiff / maxLen;
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

    // New version must be greater than old version
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

    // Determine change type
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
   * Map database row to Prompt
   */
  private mapPrompt(row: any): Prompt {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
      purpose: row.purpose,
      currentVersionId: row.current_version_id,
      deprecated: row.deprecated,
      deprecatedAt: row.deprecated_at,
      deprecationReason: row.deprecation_reason,
      replacementPromptId: row.replacement_prompt_id,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Map database row to PromptVersion
   */
  private mapPromptVersion(row: any): PromptVersion {
    return {
      id: row.id,
      promptId: row.prompt_id,
      version: row.version,
      content: row.content,
      systemPrompt: row.system_prompt,
      userPromptTemplate: row.user_prompt_template,
      variables: row.variables,
      modelConfig: row.model_config,
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
   * Map database row to PromptWithVersion
   */
  private mapPromptWithVersion(row: any): PromptWithVersion {
    const prompt = this.mapPrompt(row);
    
    return {
      ...prompt,
      currentVersion: row.version_id ? {
        id: row.version_id,
        promptId: row.id,
        version: row.version,
        content: row.content,
        systemPrompt: row.system_prompt,
        userPromptTemplate: row.user_prompt_template,
        variables: row.variables,
        modelConfig: row.model_config,
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
let promptLibraryService: PromptLibraryService;

export function getPromptLibraryService(): PromptLibraryService {
  if (!promptLibraryService) {
    promptLibraryService = new PromptLibraryService();
  }
  return promptLibraryService;
}
