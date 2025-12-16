/**
 * Product Service
 * 
 * Service layer for managing products in the AFU-9 Product Registry
 * EPIC 4: Product Registry & Templates
 */

import { Pool } from 'pg';
import {
  Product,
  ProductWithTemplate,
  ProductTemplate,
  ProductKpiOverride,
  ProductConstraintHistory,
  CreateProductRequest,
  UpdateProductRequest,
  ArchiveProductRequest,
  ProductQueryParams,
  ProductListResponse,
  ProductValidationResult,
  ProductStatistics,
  TemplateQueryParams,
  TemplateListResponse,
  ProductKpiPerformance,
} from './types/product';

export class ProductService {
  constructor(private db: Pool) {}

  /**
   * Get a product by ID
   */
  async getProduct(productId: string): Promise<Product | null> {
    const result = await this.db.query(
      `SELECT 
        id, repository_id, product_key, display_name, description,
        metadata, tags, constraints, kpi_targets,
        template_id, template_config,
        enabled, archived, archived_at, archived_reason,
        isolation_level, owner_team, contact_email,
        created_at, updated_at, created_by, updated_by
      FROM products
      WHERE id = $1`,
      [productId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToProduct(result.rows[0]);
  }

  /**
   * Get a product by product key (owner/repo)
   */
  async getProductByKey(productKey: string): Promise<Product | null> {
    const result = await this.db.query(
      `SELECT 
        id, repository_id, product_key, display_name, description,
        metadata, tags, constraints, kpi_targets,
        template_id, template_config,
        enabled, archived, archived_at, archived_reason,
        isolation_level, owner_team, contact_email,
        created_at, updated_at, created_by, updated_by
      FROM products
      WHERE product_key = $1`,
      [productKey]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToProduct(result.rows[0]);
  }

  /**
   * Get a product with resolved template values
   */
  async getProductWithTemplate(productId: string): Promise<ProductWithTemplate | null> {
    const result = await this.db.query(
      `SELECT * FROM get_product_with_template($1)`,
      [productId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const product = await this.getProduct(productId);
    if (!product) return null;

    return {
      ...product,
      templateName: row.template_id ? (await this.getTemplate(row.template_id))?.name : undefined,
      resolvedConstraints: row.resolved_constraints || {},
      resolvedKpiTargets: row.resolved_kpi_targets || {},
    };
  }

  /**
   * List products with filtering and pagination
   */
  async listProducts(params: ProductQueryParams = {}): Promise<ProductListResponse> {
    const {
      enabled,
      archived,
      templateId,
      ownerTeam,
      tags,
      isolationLevel,
      search,
      limit = 50,
      offset = 0,
      sortBy = 'created_at',
      sortOrder = 'desc',
    } = params;

    const conditions: string[] = [];
    const values: any[] = [];
    let valueIndex = 1;

    if (enabled !== undefined) {
      conditions.push(`enabled = $${valueIndex++}`);
      values.push(enabled);
    }

    if (archived !== undefined) {
      conditions.push(`archived = $${valueIndex++}`);
      values.push(archived);
    }

    if (templateId) {
      conditions.push(`template_id = $${valueIndex++}`);
      values.push(templateId);
    }

    if (ownerTeam) {
      conditions.push(`owner_team = $${valueIndex++}`);
      values.push(ownerTeam);
    }

    if (tags && tags.length > 0) {
      conditions.push(`tags && $${valueIndex++}`);
      values.push(tags);
    }

    if (isolationLevel) {
      conditions.push(`isolation_level = $${valueIndex++}`);
      values.push(isolationLevel);
    }

    if (search) {
      conditions.push(`(
        product_key ILIKE $${valueIndex} OR 
        display_name ILIKE $${valueIndex} OR 
        description ILIKE $${valueIndex}
      )`);
      values.push(`%${search}%`);
      valueIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await this.db.query(
      `SELECT COUNT(*) as total FROM products ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // Get products
    values.push(limit, offset);
    const result = await this.db.query(
      `SELECT 
        id, repository_id, product_key, display_name, description,
        metadata, tags, constraints, kpi_targets,
        template_id, template_config,
        enabled, archived, archived_at, archived_reason,
        isolation_level, owner_team, contact_email,
        created_at, updated_at, created_by, updated_by
      FROM products
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT $${valueIndex} OFFSET $${valueIndex + 1}`,
      values
    );

    const products = result.rows.map(row => this.mapRowToProduct(row));

    return {
      products,
      total,
      limit,
      offset,
    };
  }

  /**
   * Create a new product
   */
  async createProduct(request: CreateProductRequest): Promise<Product> {
    const result = await this.db.query(
      `INSERT INTO products (
        repository_id, product_key, display_name, description,
        metadata, tags, constraints, kpi_targets,
        template_id, template_config,
        isolation_level, owner_team, contact_email, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        request.repositoryId,
        request.productKey,
        request.displayName,
        request.description || null,
        JSON.stringify(request.metadata || {}),
        request.tags || [],
        JSON.stringify(request.constraints || {}),
        JSON.stringify(request.kpiTargets || {}),
        request.templateId || null,
        request.templateConfig ? JSON.stringify(request.templateConfig) : null,
        request.isolationLevel || 'standard',
        request.ownerTeam || null,
        request.contactEmail || null,
        request.createdBy || 'system',
      ]
    );

    return this.mapRowToProduct(result.rows[0]);
  }

  /**
   * Update a product
   */
  async updateProduct(productId: string, request: UpdateProductRequest): Promise<Product> {
    const updates: string[] = [];
    const values: any[] = [];
    let valueIndex = 1;

    if (request.displayName !== undefined) {
      updates.push(`display_name = $${valueIndex++}`);
      values.push(request.displayName);
    }

    if (request.description !== undefined) {
      updates.push(`description = $${valueIndex++}`);
      values.push(request.description);
    }

    if (request.metadata !== undefined) {
      updates.push(`metadata = $${valueIndex++}`);
      values.push(JSON.stringify(request.metadata));
    }

    if (request.tags !== undefined) {
      updates.push(`tags = $${valueIndex++}`);
      values.push(request.tags);
    }

    if (request.constraints !== undefined) {
      updates.push(`constraints = $${valueIndex++}`);
      values.push(JSON.stringify(request.constraints));
    }

    if (request.kpiTargets !== undefined) {
      updates.push(`kpi_targets = $${valueIndex++}`);
      values.push(JSON.stringify(request.kpiTargets));
    }

    if (request.templateId !== undefined) {
      updates.push(`template_id = $${valueIndex++}`);
      values.push(request.templateId);
    }

    if (request.templateConfig !== undefined) {
      updates.push(`template_config = $${valueIndex++}`);
      values.push(request.templateConfig ? JSON.stringify(request.templateConfig) : null);
    }

    if (request.enabled !== undefined) {
      updates.push(`enabled = $${valueIndex++}`);
      values.push(request.enabled);
    }

    if (request.isolationLevel !== undefined) {
      updates.push(`isolation_level = $${valueIndex++}`);
      values.push(request.isolationLevel);
    }

    if (request.ownerTeam !== undefined) {
      updates.push(`owner_team = $${valueIndex++}`);
      values.push(request.ownerTeam);
    }

    if (request.contactEmail !== undefined) {
      updates.push(`contact_email = $${valueIndex++}`);
      values.push(request.contactEmail);
    }

    if (request.updatedBy !== undefined) {
      updates.push(`updated_by = $${valueIndex++}`);
      values.push(request.updatedBy);
    }

    if (updates.length === 0) {
      throw new Error('No fields to update');
    }

    values.push(productId);
    const result = await this.db.query(
      `UPDATE products
      SET ${updates.join(', ')}
      WHERE id = $${valueIndex}
      RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      throw new Error('Product not found');
    }

    return this.mapRowToProduct(result.rows[0]);
  }

  /**
   * Archive a product
   */
  async archiveProduct(productId: string, request: ArchiveProductRequest): Promise<Product> {
    const result = await this.db.query(
      `UPDATE products
      SET archived = true, archived_at = NOW(), archived_reason = $1, updated_by = $2
      WHERE id = $3
      RETURNING *`,
      [request.reason, request.archivedBy || 'system', productId]
    );

    if (result.rows.length === 0) {
      throw new Error('Product not found');
    }

    return this.mapRowToProduct(result.rows[0]);
  }

  /**
   * Delete a product (hard delete)
   */
  async deleteProduct(productId: string): Promise<void> {
    await this.db.query('DELETE FROM products WHERE id = $1', [productId]);
  }

  /**
   * Validate product constraints
   */
  async validateProduct(productId: string): Promise<ProductValidationResult> {
    const result = await this.db.query(
      `SELECT * FROM validate_product_constraints($1)`,
      [productId]
    );

    const row = result.rows[0];
    return {
      isValid: row.is_valid,
      errors: row.validation_errors || [],
    };
  }

  /**
   * Get product statistics
   */
  async getProductStatistics(): Promise<ProductStatistics> {
    const result = await this.db.query(`
      SELECT 
        COUNT(*) as total_products,
        COUNT(*) FILTER (WHERE enabled = true AND archived = false) as active_products,
        COUNT(*) FILTER (WHERE archived = true) as archived_products,
        AVG(exec_count)::INTEGER as avg_executions_per_product
      FROM (
        SELECT 
          p.id,
          COUNT(we.id) as exec_count
        FROM products p
        LEFT JOIN workflow_executions we ON we.repository_id = p.repository_id
        GROUP BY p.id
      ) stats
    `);

    const row = result.rows[0];

    // Get products by template
    const templateResult = await this.db.query(`
      SELECT template_id, COUNT(*) as count
      FROM products
      WHERE template_id IS NOT NULL
      GROUP BY template_id
    `);
    const productsByTemplate: Record<string, number> = {};
    templateResult.rows.forEach(r => {
      productsByTemplate[r.template_id] = parseInt(r.count, 10);
    });

    // Get products by isolation level
    const isolationResult = await this.db.query(`
      SELECT isolation_level, COUNT(*) as count
      FROM products
      GROUP BY isolation_level
    `);
    const productsByIsolationLevel: Record<string, number> = {};
    isolationResult.rows.forEach(r => {
      productsByIsolationLevel[r.isolation_level] = parseInt(r.count, 10);
    });

    return {
      totalProducts: parseInt(row.total_products, 10),
      activeProducts: parseInt(row.active_products, 10),
      archivedProducts: parseInt(row.archived_products, 10),
      productsByTemplate,
      productsByIsolationLevel: productsByIsolationLevel as any,
      averageExecutionsPerProduct: parseInt(row.avg_executions_per_product, 10) || 0,
    };
  }

  /**
   * Get product KPI performance
   */
  async getProductKpiPerformance(productId: string): Promise<ProductKpiPerformance[]> {
    const result = await this.db.query(
      `SELECT * FROM v_product_kpi_performance WHERE product_id = $1 ORDER BY calculated_at DESC`,
      [productId]
    );

    return result.rows.map(row => ({
      productId: row.product_id,
      productKey: row.product_key,
      displayName: row.display_name,
      kpiName: row.kpi_name,
      actualValue: parseFloat(row.actual_value),
      unit: row.unit,
      targetValue: row.target_value ? parseFloat(row.target_value) : undefined,
      meetsTarget: row.meets_target,
      calculatedAt: row.calculated_at.toISOString(),
      periodStart: row.period_start.toISOString(),
      periodEnd: row.period_end.toISOString(),
    }));
  }

  /**
   * Get constraint history for a product
   */
  async getConstraintHistory(productId: string, limit = 50): Promise<ProductConstraintHistory[]> {
    const result = await this.db.query(
      `SELECT 
        id, product_id, constraint_key, old_value, new_value,
        change_reason, changed_at, changed_by, metadata
      FROM product_constraint_history
      WHERE product_id = $1
      ORDER BY changed_at DESC
      LIMIT $2`,
      [productId, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      productId: row.product_id,
      constraintKey: row.constraint_key,
      oldValue: row.old_value,
      newValue: row.new_value,
      changeReason: row.change_reason,
      changedAt: row.changed_at.toISOString(),
      changedBy: row.changed_by,
      metadata: row.metadata,
    }));
  }

  // ========================================
  // Template Management
  // ========================================

  /**
   * Get a template by ID
   */
  async getTemplate(templateId: string): Promise<ProductTemplate | null> {
    const result = await this.db.query(
      `SELECT 
        id, name, description, default_metadata, default_constraints,
        default_kpi_targets, config_schema, enabled, version,
        created_at, updated_at
      FROM product_templates
      WHERE id = $1`,
      [templateId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToTemplate(result.rows[0]);
  }

  /**
   * List templates
   */
  async listTemplates(params: TemplateQueryParams = {}): Promise<TemplateListResponse> {
    const { enabled, limit = 50, offset = 0 } = params;

    const conditions: string[] = [];
    const values: any[] = [];
    let valueIndex = 1;

    if (enabled !== undefined) {
      conditions.push(`enabled = $${valueIndex++}`);
      values.push(enabled);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await this.db.query(
      `SELECT COUNT(*) as total FROM product_templates ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // Get templates
    values.push(limit, offset);
    const result = await this.db.query(
      `SELECT 
        id, name, description, default_metadata, default_constraints,
        default_kpi_targets, config_schema, enabled, version,
        created_at, updated_at
      FROM product_templates
      ${whereClause}
      ORDER BY name ASC
      LIMIT $${valueIndex} OFFSET $${valueIndex + 1}`,
      values
    );

    const templates = result.rows.map(row => this.mapRowToTemplate(row));

    return {
      templates,
      total,
      limit,
      offset,
    };
  }

  // ========================================
  // Helper Methods
  // ========================================

  private mapRowToProduct(row: any): Product {
    return {
      id: row.id,
      repositoryId: row.repository_id,
      productKey: row.product_key,
      displayName: row.display_name,
      description: row.description,
      metadata: row.metadata || {},
      tags: row.tags || [],
      constraints: row.constraints || {},
      kpiTargets: row.kpi_targets || {},
      templateId: row.template_id,
      templateConfig: row.template_config,
      enabled: row.enabled,
      archived: row.archived,
      archivedAt: row.archived_at?.toISOString(),
      archivedReason: row.archived_reason,
      isolationLevel: row.isolation_level,
      ownerTeam: row.owner_team,
      contactEmail: row.contact_email,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      createdBy: row.created_by,
      updatedBy: row.updated_by,
    };
  }

  private mapRowToTemplate(row: any): ProductTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      defaultMetadata: row.default_metadata || {},
      defaultConstraints: row.default_constraints || {},
      defaultKpiTargets: row.default_kpi_targets || {},
      configSchema: row.config_schema,
      enabled: row.enabled,
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
