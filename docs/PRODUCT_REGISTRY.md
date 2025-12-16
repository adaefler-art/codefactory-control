# AFU-9 Product Registry

**EPIC:** 4 - Product Registry & Templates  
**Version:** 1.0.0  
**Status:** Implementation Complete  
**Last Updated:** 2024-12-16

## Overview

The AFU-9 Product Registry establishes clear product boundaries and standardized templates for product metadata, constraints, and KPIs. This strengthens cross-product isolation and enables product-specific governance in the autonomous fabrication system.

## Key Objectives

1. **Product Isolation**: Enforce clear boundaries between products
2. **Standardized Metadata**: Provide structured templates for product information
3. **Constraint Management**: Define and enforce product-specific constraints
4. **KPI Targets**: Set and track product-level KPI targets
5. **Template System**: Reusable configuration templates for common product types

## Architecture

### Database Schema

The Product Registry is built on four main tables:

1. **`products`**: Core product registry
2. **`product_templates`**: Reusable product templates
3. **`product_constraint_history`**: Audit trail for constraint changes
4. **`product_kpi_overrides`**: Granular KPI target overrides

See [database/migrations/007_product_registry.sql](../database/migrations/007_product_registry.sql) for the complete schema.

### Components

```
Product Registry
├── Database Layer (PostgreSQL)
│   ├── products table
│   ├── product_templates table
│   ├── Views & Functions
│   └── Triggers & Automation
├── Service Layer (TypeScript)
│   ├── ProductService class
│   └── Type definitions
└── API Layer (Next.js)
    ├── /api/products
    ├── /api/products/[id]
    ├── /api/products/statistics
    └── /api/products/templates
```

## Core Concepts

### Product

A **Product** represents a repository or project managed by AFU-9. Each product has:

- **Identity**: Unique ID and product key (format: `owner/repo`)
- **Metadata**: Custom metadata fields (language, framework, platform, etc.)
- **Constraints**: Product-specific rules and limits
- **KPI Targets**: Product-level performance targets
- **Template**: Optional template for default configuration
- **Isolation Level**: `standard`, `strict`, or `relaxed`

### Product Template

A **Product Template** provides reusable configuration for common product types:

- **web-service**: Standard web service with API endpoints
- **library**: Reusable library or package
- **microservice**: Containerized microservice
- **documentation**: Documentation-only project

Templates define default constraints and KPI targets that can be overridden per product.

### Product Constraints

**Constraints** enforce product-specific rules:

```typescript
{
  // Duration limits (milliseconds)
  maxBuildDurationMs: 600000,
  maxTestDurationMs: 300000,
  maxDeploymentDurationMs: 600000,
  
  // Quality gates
  requireCodeReview: true,
  requireTests: true,
  minTestCoveragePct: 80,
  requireDocumentation: true,
  requireHealthChecks: true,
  
  // Resource limits
  maxConcurrentRuns: 5,
  maxResourceUsageMb: 2048
}
```

### Product Isolation Levels

- **standard** (default): Normal isolation with shared infrastructure
- **strict**: No shared resources, complete isolation
- **relaxed**: Allows resource sharing between products

## API Reference

### Products API

#### List Products

```http
GET /api/products?enabled=true&archived=false&limit=50&offset=0
```

**Query Parameters:**
- `enabled` (boolean): Filter by enabled status
- `archived` (boolean): Filter by archived status
- `templateId` (string): Filter by template
- `ownerTeam` (string): Filter by owner team
- `tags` (string): Comma-separated tags
- `isolationLevel` (string): Filter by isolation level
- `search` (string): Search in key, name, description
- `limit` (number): Results per page (default: 50)
- `offset` (number): Pagination offset (default: 0)
- `sortBy` (string): Sort field (default: `created_at`)
- `sortOrder` (string): `asc` or `desc` (default: `desc`)

**Response:**
```json
{
  "products": [
    {
      "id": "uuid",
      "repositoryId": "uuid",
      "productKey": "owner/repo",
      "displayName": "My Product",
      "description": "Product description",
      "metadata": {},
      "tags": ["web", "api"],
      "constraints": {},
      "kpiTargets": {},
      "templateId": "web-service",
      "enabled": true,
      "archived": false,
      "isolationLevel": "standard",
      "createdAt": "2024-12-16T00:00:00Z",
      "updatedAt": "2024-12-16T00:00:00Z"
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

#### Create Product

```http
POST /api/products
Content-Type: application/json

{
  "repositoryId": "uuid",
  "productKey": "owner/repo",
  "displayName": "My Product",
  "description": "Product description",
  "templateId": "web-service",
  "metadata": {
    "primaryLanguage": "TypeScript",
    "framework": "Next.js"
  },
  "tags": ["web", "api"],
  "constraints": {
    "maxBuildDurationMs": 600000
  },
  "kpiTargets": {
    "successRate": 95
  },
  "ownerTeam": "platform-team",
  "contactEmail": "team@example.com"
}
```

#### Get Product

```http
GET /api/products/{id}?withTemplate=true
```

**Query Parameters:**
- `withTemplate` (boolean): Include resolved template values

#### Update Product

```http
PUT /api/products/{id}
Content-Type: application/json

{
  "displayName": "Updated Name",
  "constraints": {
    "maxBuildDurationMs": 900000
  }
}
```

#### Archive Product

```http
DELETE /api/products/{id}?archive=true&reason=No%20longer%20needed
```

**Query Parameters:**
- `archive` (boolean): Archive instead of hard delete
- `reason` (string): Reason for archiving
- `archivedBy` (string): User archiving the product

#### Delete Product

```http
DELETE /api/products/{id}
```

### Templates API

#### List Templates

```http
GET /api/products/templates?enabled=true
```

**Response:**
```json
{
  "templates": [
    {
      "id": "web-service",
      "name": "Web Service",
      "description": "Standard web service with API endpoints",
      "defaultConstraints": {},
      "defaultKpiTargets": {},
      "enabled": true,
      "version": "1.0.0"
    }
  ],
  "total": 4,
  "limit": 50,
  "offset": 0
}
```

### Statistics API

#### Get Product Statistics

```http
GET /api/products/statistics
```

**Response:**
```json
{
  "totalProducts": 25,
  "activeProducts": 20,
  "archivedProducts": 5,
  "productsByTemplate": {
    "web-service": 10,
    "library": 5,
    "microservice": 8,
    "documentation": 2
  },
  "productsByIsolationLevel": {
    "standard": 20,
    "strict": 3,
    "relaxed": 2
  },
  "averageExecutionsPerProduct": 45
}
```

## Usage Examples

### Creating a Product

```typescript
import { ProductService } from '@/lib/product-service';
import { getPool } from '@/lib/db';

const pool = getPool();
const productService = new ProductService(pool);

const product = await productService.createProduct({
  repositoryId: 'repo-uuid',
  productKey: 'acme/my-service',
  displayName: 'My Service',
  description: 'A microservice for processing data',
  templateId: 'microservice',
  constraints: {
    maxBuildDurationMs: 900000,
    requireTests: true,
    minTestCoveragePct: 85,
  },
  kpiTargets: {
    successRate: 90,
    mtti: 300000,
  },
  ownerTeam: 'data-platform',
  contactEmail: 'data-platform@acme.com',
});
```

### Validating Constraints

```typescript
import { validateExecutionAgainstConstraints } from '@/lib/types/product';

const product = await productService.getProduct(productId);
const execution = {
  buildDurationMs: 700000,
  testDurationMs: 200000,
  testCoveragePct: 88,
  hasCodeReview: true,
  hasTests: true,
};

const errors = validateExecutionAgainstConstraints(
  product.constraints,
  execution
);

if (errors.length > 0) {
  console.error('Constraint violations:', errors);
}
```

### Querying Products

```typescript
// Get all active web services
const response = await productService.listProducts({
  enabled: true,
  archived: false,
  templateId: 'web-service',
  limit: 100,
});

// Search for products
const searchResults = await productService.listProducts({
  search: 'payment',
  limit: 20,
});

// Get products by team
const teamProducts = await productService.listProducts({
  ownerTeam: 'platform-team',
});
```

## Database Functions

### Auto-create Product from Repository

When a new repository is added to the system, a product is automatically created:

```sql
-- Triggered automatically on repository INSERT
INSERT INTO repositories (owner, name) VALUES ('acme', 'my-repo');
-- Creates product with key 'acme/my-repo'
```

### Get Product with Template

Merge template defaults with product overrides:

```sql
SELECT * FROM get_product_with_template('product-uuid');
```

### Validate Product Constraints

```sql
SELECT * FROM validate_product_constraints('product-uuid');
```

## Integration Points

### Workflow Executions

Workflow executions should reference the product via `repository_id`:

```sql
SELECT 
  we.*,
  p.product_key,
  p.constraints,
  p.kpi_targets
FROM workflow_executions we
JOIN products p ON p.repository_id = we.repository_id
WHERE we.id = 'execution-uuid';
```

### KPI System

Product-level KPIs are scoped by `repository_id`:

```sql
SELECT *
FROM kpi_snapshots
WHERE level = 'product'
  AND scope_id = 'repository-uuid';
```

### Factory Status API

Include product context in factory status:

```sql
SELECT 
  we.*,
  p.product_key,
  p.display_name,
  p.owner_team
FROM workflow_executions we
JOIN products p ON p.repository_id = we.repository_id
ORDER BY we.started_at DESC
LIMIT 10;
```

## Best Practices

### 1. Use Templates

Start with a template that matches your product type:

```typescript
const product = await productService.createProduct({
  repositoryId: repoId,
  productKey: 'owner/repo',
  displayName: 'My Service',
  templateId: 'microservice', // Use template
  // Override specific constraints
  constraints: {
    maxBuildDurationMs: 1200000, // Override template default
  },
});
```

### 2. Set Realistic Targets

Base KPI targets on historical data:

```typescript
// Query historical performance
const history = await kpiService.getProductKPIs(repositoryId, {
  periodDays: 30,
});

// Set targets based on P90
const p90SuccessRate = calculatePercentile(history, 0.9);
product.kpiTargets.successRate = p90SuccessRate * 0.95; // Target 95% of P90
```

### 3. Track Constraint Changes

Monitor constraint history for compliance:

```typescript
const history = await productService.getConstraintHistory(productId);
console.log('Recent constraint changes:', history);
```

### 4. Use Tags for Organization

Tag products for easy filtering:

```typescript
const product = await productService.createProduct({
  // ...
  tags: ['production', 'critical', 'payment-domain', 'pci-compliant'],
});

// Query by tags
const criticalProducts = await productService.listProducts({
  tags: ['critical'],
});
```

### 5. Enforce Isolation Levels

Use strict isolation for sensitive products:

```typescript
const product = await productService.createProduct({
  // ...
  isolationLevel: 'strict', // No shared resources
  constraints: {
    requireCodeReview: true,
    requireTests: true,
    minTestCoveragePct: 95,
  },
});
```

## Migration Guide

### Adding Products to Existing System

1. **Run Migration**: Apply `007_product_registry.sql`
2. **Auto-creation**: Existing repositories automatically get products
3. **Configure Products**: Update metadata, constraints, and targets
4. **Assign Templates**: Apply appropriate templates to products
5. **Set Ownership**: Assign teams and contacts

```sql
-- Update auto-created products
UPDATE products
SET 
  template_id = 'microservice',
  owner_team = 'platform-team',
  contact_email = 'platform@example.com',
  metadata = jsonb_set(metadata, '{primaryLanguage}', '"TypeScript"')
WHERE product_key LIKE 'acme/%';
```

## Monitoring & Observability

### Key Metrics

1. **Total Products**: Track total products in registry
2. **Active Products**: Monitor actively used products
3. **Constraint Violations**: Track constraint breaches
4. **KPI Target Achievement**: Monitor products meeting targets
5. **Template Usage**: Understand template adoption

### Dashboards

Create dashboards to visualize:

- Products by template distribution
- Products by isolation level
- Constraint violation trends
- KPI target achievement rates
- Product lifecycle (created, archived)

## Troubleshooting

### Product Not Found

```typescript
const product = await productService.getProduct(id);
if (!product) {
  // Check if product was archived
  const archived = await productService.listProducts({
    archived: true,
    search: 'product-key',
  });
}
```

### Constraint Validation Failures

```typescript
const validation = await productService.validateProduct(productId);
if (!validation.isValid) {
  console.error('Validation errors:', validation.errors);
}
```

### Template Not Applied

```typescript
// Get product with resolved template
const product = await productService.getProductWithTemplate(productId);
console.log('Resolved constraints:', product.resolvedConstraints);
console.log('Resolved KPI targets:', product.resolvedKpiTargets);
```

## Security Considerations

1. **Access Control**: Implement team-based access control
2. **Audit Trail**: All constraint changes are logged
3. **Isolation Enforcement**: Strict isolation for sensitive products
4. **Data Validation**: Input validation on all API endpoints
5. **Secrets Management**: Never store secrets in product metadata

## Future Enhancements

1. **Product Lifecycle**: Automated archiving of inactive products
2. **Constraint Validation**: Real-time constraint validation in workflows
3. **KPI Anomaly Detection**: Alert on products deviating from targets
4. **Template Versioning**: Support multiple template versions
5. **Cross-Product Dependencies**: Track dependencies between products
6. **Cost Attribution**: Track AWS costs per product
7. **Compliance Checks**: Automated compliance validation per product

## References

- [KPI Definitions](./KPI_DEFINITIONS.md) - Factory KPI system
- [Workflow Schema](./WORKFLOW-SCHEMA.md) - Workflow structure
- [Database Schema](./architecture/database-schema.md) - Complete database schema
- [Factory Status API](./FACTORY_STATUS_API.md) - Factory status endpoint

## Changelog

### Version 1.0.0 (2024-12-16)

- Initial implementation
- Database schema with products, templates, history, and overrides
- TypeScript types and service layer
- REST API endpoints
- Four standard templates (web-service, library, microservice, documentation)
- Automated product creation from repositories
- Constraint validation and history tracking
- KPI target management and performance tracking
