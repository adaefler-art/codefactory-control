/**
 * Product Registry Types
 * 
 * Type definitions for the AFU-9 Product Registry
 * EPIC 4: Product Registry & Templates
 */

/**
 * Product key validation regex
 * Format: owner/repo (alphanumeric, hyphen, underscore)
 */
export const PRODUCT_KEY_REGEX = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/;

/**
 * KPI names where lower values are better
 */
export const LOWER_IS_BETTER_KPIS = ['mtti', 'executionDuration', 'mttr'] as const;

/**
 * Product Isolation Level
 */
export type ProductIsolationLevel = 'standard' | 'strict' | 'relaxed';

/**
 * Product Status
 */
export type ProductStatus = 'active' | 'archived' | 'disabled';

/**
 * Product Metadata
 * 
 * Custom metadata fields for product-specific information
 */
export interface ProductMetadata {
  autoCreated?: boolean;
  ciCdPlatform?: string;
  primaryLanguage?: string;
  framework?: string;
  deploymentTarget?: string;
  customFields?: Record<string, unknown>;
}

/**
 * Product Constraints
 * 
 * Constraints that enforce product-specific rules and limits
 */
export interface ProductConstraints {
  // Build constraints
  maxBuildDurationMs?: number;
  maxTestDurationMs?: number;
  maxDeploymentDurationMs?: number;
  
  // Quality gates
  requireCodeReview?: boolean;
  requireTests?: boolean;
  minTestCoveragePct?: number;
  requireDocumentation?: boolean;
  requireHealthChecks?: boolean;
  requireSpellCheck?: boolean;
  
  // Resource limits
  maxConcurrentRuns?: number;
  maxResourceUsageMb?: number;
  
  // Custom constraints
  [key: string]: unknown;
}

/**
 * Product KPI Targets
 * 
 * Product-specific KPI targets that override factory-level defaults
 */
export interface ProductKpiTargets {
  successRate?: number; // percentage
  mtti?: number; // milliseconds
  executionDuration?: number; // milliseconds
  factoryUptime?: number; // percentage
  steeringAccuracy?: number; // percentage
  
  // Custom KPI targets
  [key: string]: number | undefined;
}

/**
 * Product Template
 * 
 * Reusable template for product configuration
 */
export interface ProductTemplate {
  id: string; // e.g., "web-service", "library", "microservice"
  name: string;
  description: string;
  defaultMetadata: ProductMetadata;
  defaultConstraints: ProductConstraints;
  defaultKpiTargets: ProductKpiTargets;
  configSchema?: Record<string, unknown>; // JSON Schema
  enabled: boolean;
  version: string; // Semantic versioning
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/**
 * Product
 * 
 * Main product registry entity
 */
export interface Product {
  id: string;
  repositoryId: string;
  productKey: string; // "owner/repo" format
  displayName: string;
  description?: string;
  
  // Configuration
  metadata: ProductMetadata;
  tags?: string[];
  constraints: ProductConstraints;
  kpiTargets: ProductKpiTargets;
  
  // Template
  templateId?: string;
  templateConfig?: Record<string, unknown>;
  
  // Status
  enabled: boolean;
  archived: boolean;
  archivedAt?: string; // ISO 8601
  archivedReason?: string;
  
  // Isolation & Ownership
  isolationLevel: ProductIsolationLevel;
  ownerTeam?: string;
  contactEmail?: string;
  
  // Audit
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  createdBy?: string;
  updatedBy?: string;
}

/**
 * Product with resolved template values
 */
export interface ProductWithTemplate extends Product {
  templateName?: string;
  resolvedConstraints: ProductConstraints;
  resolvedKpiTargets: ProductKpiTargets;
}

/**
 * Product Constraint History Entry
 */
export interface ProductConstraintHistory {
  id: string;
  productId: string;
  constraintKey: string;
  oldValue: unknown;
  newValue: unknown;
  changeReason?: string;
  changedAt: string; // ISO 8601
  changedBy: string;
  metadata?: Record<string, unknown>;
}

/**
 * Product KPI Override
 * 
 * Allows granular control over individual KPI targets
 */
export interface ProductKpiOverride {
  id: string;
  productId: string;
  kpiName: string;
  targetValue: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  overrideReason?: string;
  enabled: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  createdBy?: string;
}

/**
 * Product KPI Performance
 * 
 * Compares actual KPI values against product targets
 */
export interface ProductKpiPerformance {
  productId: string;
  productKey: string;
  displayName: string;
  kpiName: string;
  actualValue: number;
  unit: string;
  targetValue?: number;
  meetsTarget?: boolean;
  calculatedAt: string; // ISO 8601
  periodStart: string; // ISO 8601
  periodEnd: string; // ISO 8601
}

/**
 * Create Product Request
 */
export interface CreateProductRequest {
  repositoryId: string;
  productKey: string;
  displayName: string;
  description?: string;
  metadata?: ProductMetadata;
  tags?: string[];
  constraints?: ProductConstraints;
  kpiTargets?: ProductKpiTargets;
  templateId?: string;
  templateConfig?: Record<string, unknown>;
  isolationLevel?: ProductIsolationLevel;
  ownerTeam?: string;
  contactEmail?: string;
  createdBy?: string;
}

/**
 * Update Product Request
 */
export interface UpdateProductRequest {
  displayName?: string;
  description?: string;
  metadata?: ProductMetadata;
  tags?: string[];
  constraints?: ProductConstraints;
  kpiTargets?: ProductKpiTargets;
  templateId?: string;
  templateConfig?: Record<string, unknown>;
  enabled?: boolean;
  isolationLevel?: ProductIsolationLevel;
  ownerTeam?: string;
  contactEmail?: string;
  updatedBy?: string;
}

/**
 * Archive Product Request
 */
export interface ArchiveProductRequest {
  reason: string;
  archivedBy?: string;
}

/**
 * Product Query Parameters
 */
export interface ProductQueryParams {
  enabled?: boolean;
  archived?: boolean;
  templateId?: string;
  ownerTeam?: string;
  tags?: string[];
  isolationLevel?: ProductIsolationLevel;
  search?: string; // Search in product_key, display_name, description
  limit?: number;
  offset?: number;
  sortBy?: 'created_at' | 'updated_at' | 'product_key' | 'display_name';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Product List Response
 */
export interface ProductListResponse {
  products: Product[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Product Validation Result
 */
export interface ProductValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Product Statistics
 */
export interface ProductStatistics {
  totalProducts: number;
  activeProducts: number;
  archivedProducts: number;
  productsByTemplate: Record<string, number>;
  productsByIsolationLevel: Record<ProductIsolationLevel, number>;
  averageExecutionsPerProduct: number;
}

/**
 * Template Query Parameters
 */
export interface TemplateQueryParams {
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Template List Response
 */
export interface TemplateListResponse {
  templates: ProductTemplate[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Product Constraint Validation Error
 */
export interface ConstraintValidationError {
  constraintKey: string;
  message: string;
  actualValue?: unknown;
  expectedValue?: unknown;
}

/**
 * Validate product constraints against execution
 */
export function validateExecutionAgainstConstraints(
  constraints: ProductConstraints,
  execution: {
    durationMs?: number;
    buildDurationMs?: number;
    testDurationMs?: number;
    deploymentDurationMs?: number;
    testCoveragePct?: number;
    hasCodeReview?: boolean;
    hasTests?: boolean;
    hasDocumentation?: boolean;
    hasHealthChecks?: boolean;
  }
): ConstraintValidationError[] {
  const errors: ConstraintValidationError[] = [];
  
  // Validate duration constraints
  if (constraints.maxBuildDurationMs && execution.buildDurationMs) {
    if (execution.buildDurationMs > constraints.maxBuildDurationMs) {
      errors.push({
        constraintKey: 'maxBuildDurationMs',
        message: `Build duration exceeded limit`,
        actualValue: execution.buildDurationMs,
        expectedValue: constraints.maxBuildDurationMs,
      });
    }
  }
  
  if (constraints.maxTestDurationMs && execution.testDurationMs) {
    if (execution.testDurationMs > constraints.maxTestDurationMs) {
      errors.push({
        constraintKey: 'maxTestDurationMs',
        message: `Test duration exceeded limit`,
        actualValue: execution.testDurationMs,
        expectedValue: constraints.maxTestDurationMs,
      });
    }
  }
  
  if (constraints.maxDeploymentDurationMs && execution.deploymentDurationMs) {
    if (execution.deploymentDurationMs > constraints.maxDeploymentDurationMs) {
      errors.push({
        constraintKey: 'maxDeploymentDurationMs',
        message: `Deployment duration exceeded limit`,
        actualValue: execution.deploymentDurationMs,
        expectedValue: constraints.maxDeploymentDurationMs,
      });
    }
  }
  
  // Validate quality gate constraints
  if (constraints.requireCodeReview && !execution.hasCodeReview) {
    errors.push({
      constraintKey: 'requireCodeReview',
      message: 'Code review is required',
      actualValue: false,
      expectedValue: true,
    });
  }
  
  if (constraints.requireTests && !execution.hasTests) {
    errors.push({
      constraintKey: 'requireTests',
      message: 'Tests are required',
      actualValue: false,
      expectedValue: true,
    });
  }
  
  if (constraints.minTestCoveragePct && execution.testCoveragePct !== undefined) {
    if (execution.testCoveragePct < constraints.minTestCoveragePct) {
      errors.push({
        constraintKey: 'minTestCoveragePct',
        message: 'Test coverage below minimum',
        actualValue: execution.testCoveragePct,
        expectedValue: constraints.minTestCoveragePct,
      });
    }
  }
  
  if (constraints.requireDocumentation && !execution.hasDocumentation) {
    errors.push({
      constraintKey: 'requireDocumentation',
      message: 'Documentation is required',
      actualValue: false,
      expectedValue: true,
    });
  }
  
  if (constraints.requireHealthChecks && !execution.hasHealthChecks) {
    errors.push({
      constraintKey: 'requireHealthChecks',
      message: 'Health checks are required',
      actualValue: false,
      expectedValue: true,
    });
  }
  
  return errors;
}

/**
 * Check if product KPI meets target
 */
export function checkKpiMeetsTarget(
  kpiName: string,
  actualValue: number,
  targetValue: number
): boolean {
  if (LOWER_IS_BETTER_KPIS.includes(kpiName as typeof LOWER_IS_BETTER_KPIS[number])) {
    return actualValue <= targetValue;
  }
  
  // KPIs where higher is better (default)
  return actualValue >= targetValue;
}

/**
 * Merge template defaults with product overrides
 */
export function mergeTemplateWithProduct(
  template: ProductTemplate | null,
  product: Partial<Product>
): {
  constraints: ProductConstraints;
  kpiTargets: ProductKpiTargets;
  metadata: ProductMetadata;
} {
  return {
    constraints: {
      ...(template?.defaultConstraints || {}),
      ...(product.constraints || {}),
    },
    kpiTargets: {
      ...(template?.defaultKpiTargets || {}),
      ...(product.kpiTargets || {}),
    },
    metadata: {
      ...(template?.defaultMetadata || {}),
      ...(product.metadata || {}),
    },
  };
}
