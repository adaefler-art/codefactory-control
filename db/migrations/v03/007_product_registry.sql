-- AFU-9 v0.3 Product Registry Schema
-- EPIC 4: Product Registry & Templates
-- Issue 4.1: AFU Product Registry
--
-- Establishes a dedicated product registry for clear product isolation,
-- metadata management, KPI targets, and constraints enforcement.

-- ========================================
-- Products Table
-- ========================================
--
-- This table defines products (repositories) managed by AFU-9.
-- Each product has:
-- - Unique identity and metadata
-- - KPI targets and constraints
-- - Template configuration
-- - Cross-product isolation enforcement

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Product Identification
  repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  product_key VARCHAR(255) NOT NULL UNIQUE, -- e.g., "owner/repo"
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Product Metadata
  metadata JSONB NOT NULL DEFAULT '{}', -- Custom metadata fields
  tags TEXT[], -- Product categorization tags
  
  -- Product Constraints
  constraints JSONB NOT NULL DEFAULT '{}', -- Product-specific constraints
  
  -- KPI Targets (overrides factory-level defaults)
  kpi_targets JSONB NOT NULL DEFAULT '{}', -- Product-specific KPI targets
  
  -- Template Configuration
  template_id VARCHAR(100), -- References a template type
  template_config JSONB, -- Template-specific configuration
  
  -- Product Status
  enabled BOOLEAN DEFAULT TRUE,
  archived BOOLEAN DEFAULT FALSE,
  archived_at TIMESTAMP,
  archived_reason TEXT,
  
  -- Isolation & Security
  isolation_level VARCHAR(50) DEFAULT 'standard', -- 'standard', 'strict', 'relaxed'
  owner_team VARCHAR(255), -- Owning team identifier
  contact_email VARCHAR(255),
  
  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(255),
  updated_by VARCHAR(255),
  
  CONSTRAINT chk_product_isolation_level CHECK (isolation_level IN ('standard', 'strict', 'relaxed'))
);

-- Indexes for performance
CREATE INDEX idx_products_repository ON products(repository_id);
CREATE INDEX idx_products_product_key ON products(product_key);
CREATE INDEX idx_products_enabled ON products(enabled) WHERE enabled = TRUE;
CREATE INDEX idx_products_archived ON products(archived) WHERE archived = FALSE;
CREATE INDEX idx_products_template ON products(template_id) WHERE template_id IS NOT NULL;
CREATE INDEX idx_products_owner_team ON products(owner_team);
CREATE INDEX idx_products_tags ON products USING gin(tags);

-- ========================================
-- Product Templates
-- ========================================
--
-- Defines reusable templates for products with standard configurations,
-- constraints, and KPI targets.

CREATE TABLE product_templates (
  id VARCHAR(100) PRIMARY KEY, -- e.g., "web-service", "library", "microservice"
  name VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Template Definition
  default_metadata JSONB NOT NULL DEFAULT '{}',
  default_constraints JSONB NOT NULL DEFAULT '{}',
  default_kpi_targets JSONB NOT NULL DEFAULT '{}',
  
  -- Template Configuration Schema
  config_schema JSONB, -- JSON Schema for template_config validation
  
  -- Template Status
  enabled BOOLEAN DEFAULT TRUE,
  version VARCHAR(20) DEFAULT '1.0.0',
  
  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT chk_template_version_format CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$')
);

CREATE INDEX idx_product_templates_enabled ON product_templates(enabled) WHERE enabled = TRUE;

-- ========================================
-- Product Constraints History
-- ========================================
--
-- Tracks changes to product constraints for audit and compliance.

CREATE TABLE product_constraint_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  
  -- Constraint Changes
  constraint_key VARCHAR(255) NOT NULL, -- e.g., "max_build_duration_ms"
  old_value JSONB,
  new_value JSONB,
  change_reason TEXT,
  
  -- Audit
  changed_at TIMESTAMP DEFAULT NOW(),
  changed_by VARCHAR(255) NOT NULL,
  
  -- Context
  metadata JSONB
);

CREATE INDEX idx_product_constraint_history_product ON product_constraint_history(product_id);
CREATE INDEX idx_product_constraint_history_changed_at ON product_constraint_history(changed_at DESC);
CREATE INDEX idx_product_constraint_history_key ON product_constraint_history(constraint_key);

-- ========================================
-- Product KPI Overrides
-- ========================================
--
-- Allows products to override factory-level KPI targets with custom thresholds.
-- This table provides granular control over KPI targets per product.

CREATE TABLE product_kpi_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kpi_name VARCHAR(100) NOT NULL,
  
  -- Override Values
  target_value DECIMAL(15, 4) NOT NULL,
  warning_threshold DECIMAL(15, 4),
  critical_threshold DECIMAL(15, 4),
  
  -- Override Metadata
  override_reason TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  
  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(255),
  
  CONSTRAINT uq_product_kpi_override UNIQUE(product_id, kpi_name)
);

CREATE INDEX idx_product_kpi_overrides_product ON product_kpi_overrides(product_id);
CREATE INDEX idx_product_kpi_overrides_kpi_name ON product_kpi_overrides(kpi_name);
CREATE INDEX idx_product_kpi_overrides_enabled ON product_kpi_overrides(enabled) WHERE enabled = TRUE;

-- ========================================
-- Functions
-- ========================================

-- Function to automatically create product from repository
CREATE OR REPLACE FUNCTION auto_create_product_from_repository()
RETURNS TRIGGER AS $$
BEGIN
  -- Create a default product entry when a new repository is added
  INSERT INTO products (
    repository_id,
    product_key,
    display_name,
    description,
    metadata,
    constraints,
    kpi_targets,
    enabled,
    created_by
  ) VALUES (
    NEW.id,
    NEW.owner || '/' || NEW.name,
    NEW.name,
    'Auto-generated product from repository',
    '{"auto_created": true}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    TRUE,
    'system'
  )
  ON CONFLICT (product_key) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-create products for new repositories
CREATE TRIGGER trigger_auto_create_product
AFTER INSERT ON repositories
FOR EACH ROW
EXECUTE FUNCTION auto_create_product_from_repository();

-- Function to update product updated_at timestamp
CREATE OR REPLACE FUNCTION update_product_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update product updated_at
CREATE TRIGGER trigger_update_product_timestamp
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION update_product_updated_at();

-- Function to log constraint changes
CREATE OR REPLACE FUNCTION log_product_constraint_change()
RETURNS TRIGGER AS $$
DECLARE
  constraint_key TEXT;
  old_val JSONB;
  new_val JSONB;
BEGIN
  -- Only log if constraints changed
  IF NEW.constraints IS DISTINCT FROM OLD.constraints THEN
    -- Log changes to constraint_history
    -- Note: This is a simplified version. For production, iterate through JSON keys
    INSERT INTO product_constraint_history (
      product_id,
      constraint_key,
      old_value,
      new_value,
      changed_by,
      change_reason
    ) VALUES (
      NEW.id,
      'constraints',
      OLD.constraints,
      NEW.constraints,
      NEW.updated_by,
      'Constraint update'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to log constraint changes
CREATE TRIGGER trigger_log_product_constraint_change
AFTER UPDATE ON products
FOR EACH ROW
WHEN (OLD.constraints IS DISTINCT FROM NEW.constraints)
EXECUTE FUNCTION log_product_constraint_change();

-- Function to validate product constraints
CREATE OR REPLACE FUNCTION validate_product_constraints(p_product_id UUID)
RETURNS TABLE(
  is_valid BOOLEAN,
  validation_errors TEXT[]
) AS $$
DECLARE
  product_record RECORD;
  errors TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT * INTO product_record FROM products WHERE id = p_product_id;
  
  IF NOT FOUND THEN
    errors := array_append(errors, 'Product not found');
    RETURN QUERY SELECT FALSE, errors;
    RETURN;
  END IF;
  
  -- Validate constraint structure (extensible)
  -- Add custom validation logic here as needed
  
  IF array_length(errors, 1) > 0 THEN
    RETURN QUERY SELECT FALSE, errors;
  ELSE
    RETURN QUERY SELECT TRUE, ARRAY[]::TEXT[];
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to get product with resolved template
CREATE OR REPLACE FUNCTION get_product_with_template(p_product_id UUID)
RETURNS TABLE(
  product_id UUID,
  product_key VARCHAR,
  display_name VARCHAR,
  description TEXT,
  metadata JSONB,
  constraints JSONB,
  kpi_targets JSONB,
  template_id VARCHAR,
  resolved_constraints JSONB,
  resolved_kpi_targets JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id as product_id,
    p.product_key,
    p.display_name,
    p.description,
    p.metadata,
    p.constraints,
    p.kpi_targets,
    p.template_id,
    -- Merge template defaults with product overrides (product takes precedence)
    COALESCE(pt.default_constraints, '{}'::jsonb) || COALESCE(p.constraints, '{}'::jsonb) as resolved_constraints,
    COALESCE(pt.default_kpi_targets, '{}'::jsonb) || COALESCE(p.kpi_targets, '{}'::jsonb) as resolved_kpi_targets
  FROM products p
  LEFT JOIN product_templates pt ON p.template_id = pt.id
  WHERE p.id = p_product_id;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- Initial Product Templates
-- ========================================

-- Insert standard product templates
INSERT INTO product_templates (id, name, description, default_constraints, default_kpi_targets, version) VALUES
  (
    'web-service',
    'Web Service',
    'Standard web service with API endpoints',
    '{
      "max_build_duration_ms": 600000,
      "max_test_duration_ms": 300000,
      "max_deployment_duration_ms": 600000,
      "require_code_review": true,
      "require_tests": true,
      "min_test_coverage_pct": 80
    }'::jsonb,
    '{
      "success_rate": 90,
      "mtti": 300000,
      "execution_duration": 600000
    }'::jsonb,
    '1.0.0'
  ),
  (
    'library',
    'Library',
    'Reusable library or package',
    '{
      "max_build_duration_ms": 300000,
      "max_test_duration_ms": 180000,
      "require_code_review": true,
      "require_tests": true,
      "min_test_coverage_pct": 90,
      "require_documentation": true
    }'::jsonb,
    '{
      "success_rate": 95,
      "mtti": 180000,
      "execution_duration": 300000
    }'::jsonb,
    '1.0.0'
  ),
  (
    'microservice',
    'Microservice',
    'Containerized microservice',
    '{
      "max_build_duration_ms": 900000,
      "max_test_duration_ms": 600000,
      "max_deployment_duration_ms": 900000,
      "require_code_review": true,
      "require_tests": true,
      "min_test_coverage_pct": 85,
      "require_health_checks": true
    }'::jsonb,
    '{
      "success_rate": 90,
      "mtti": 300000,
      "execution_duration": 900000,
      "factory_uptime": 99.5
    }'::jsonb,
    '1.0.0'
  ),
  (
    'documentation',
    'Documentation',
    'Documentation-only project',
    '{
      "max_build_duration_ms": 120000,
      "require_code_review": false,
      "require_tests": false,
      "require_spell_check": true
    }'::jsonb,
    '{
      "success_rate": 95,
      "mtti": 120000,
      "execution_duration": 120000
    }'::jsonb,
    '1.0.0'
  );

-- ========================================
-- Product-Specific Views
-- ========================================

-- View for active products with resolved templates
CREATE OR REPLACE VIEW v_active_products_with_templates AS
SELECT 
  p.id,
  p.repository_id,
  p.product_key,
  p.display_name,
  p.description,
  p.metadata,
  p.tags,
  p.template_id,
  pt.name as template_name,
  -- Merge template defaults with product overrides
  COALESCE(pt.default_constraints, '{}'::jsonb) || COALESCE(p.constraints, '{}'::jsonb) as resolved_constraints,
  COALESCE(pt.default_kpi_targets, '{}'::jsonb) || COALESCE(p.kpi_targets, '{}'::jsonb) as resolved_kpi_targets,
  p.isolation_level,
  p.owner_team,
  p.contact_email,
  p.created_at,
  p.updated_at
FROM products p
LEFT JOIN product_templates pt ON p.template_id = pt.id
WHERE p.enabled = TRUE 
  AND p.archived = FALSE;

-- View for product KPI performance
CREATE OR REPLACE VIEW v_product_kpi_performance AS
SELECT 
  p.id as product_id,
  p.product_key,
  p.display_name,
  ks.kpi_name,
  ks.value as actual_value,
  ks.unit,
  (p.kpi_targets->ks.kpi_name)::decimal as target_value,
  CASE 
    WHEN (p.kpi_targets->ks.kpi_name)::decimal IS NOT NULL THEN
      ks.value <= (p.kpi_targets->ks.kpi_name)::decimal
    ELSE NULL
  END as meets_target,
  ks.calculated_at,
  ks.period_start,
  ks.period_end
FROM products p
JOIN kpi_snapshots ks ON ks.scope_id = p.repository_id
WHERE ks.level = 'product'
  AND p.enabled = TRUE
  AND p.archived = FALSE;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE products IS 
  'Product registry for cross-product isolation and metadata management';

COMMENT ON TABLE product_templates IS 
  'Reusable templates for product configuration, constraints, and KPI targets';

COMMENT ON TABLE product_constraint_history IS 
  'Audit trail for product constraint changes';

COMMENT ON TABLE product_kpi_overrides IS 
  'Product-specific KPI target overrides';

COMMENT ON COLUMN products.product_key IS 
  'Unique product identifier in format "owner/repo"';

COMMENT ON COLUMN products.isolation_level IS 
  'Cross-product isolation level: standard (default), strict (no shared resources), relaxed (allows sharing)';

COMMENT ON COLUMN products.constraints IS 
  'Product-specific constraints (build time limits, test requirements, etc.)';

COMMENT ON COLUMN products.kpi_targets IS 
  'Product-specific KPI targets that override factory-level defaults';

COMMENT ON COLUMN products.template_id IS 
  'References a product template for default configuration';

-- ========================================
-- Grants (uncomment and adjust as needed)
-- ========================================

-- GRANT SELECT ON products TO afu9_readonly;
-- GRANT SELECT, INSERT, UPDATE ON products TO afu9_service;
-- GRANT SELECT ON product_templates TO afu9_readonly;
-- GRANT SELECT ON product_templates TO afu9_service;
