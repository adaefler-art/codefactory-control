-- AFU-9 v0.3 Cost Tracking & Attribution Schema
-- EPIC 9: Cost & Efficiency Engine
-- Issue 9.1: Cost Attribution per Run

-- ========================================
-- AWS Cost Attribution
-- ========================================

-- Track AWS costs per workflow execution
CREATE TABLE aws_cost_attribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  
  -- Cost breakdown by AWS service (in USD)
  lambda_cost_usd DECIMAL(10, 6) DEFAULT 0,
  ecs_cost_usd DECIMAL(10, 6) DEFAULT 0,
  rds_cost_usd DECIMAL(10, 6) DEFAULT 0,
  s3_cost_usd DECIMAL(10, 6) DEFAULT 0,
  cloudwatch_cost_usd DECIMAL(10, 6) DEFAULT 0,
  secrets_manager_cost_usd DECIMAL(10, 6) DEFAULT 0,
  other_aws_cost_usd DECIMAL(10, 6) DEFAULT 0,
  
  -- Total AWS infrastructure cost
  total_aws_cost_usd DECIMAL(10, 6) GENERATED ALWAYS AS (
    lambda_cost_usd + ecs_cost_usd + rds_cost_usd + s3_cost_usd + 
    cloudwatch_cost_usd + secrets_manager_cost_usd + other_aws_cost_usd
  ) STORED,
  
  -- LLM costs (aggregated from agent_runs)
  llm_cost_usd DECIMAL(10, 6) DEFAULT 0,
  
  -- Total cost per run
  total_cost_usd DECIMAL(10, 6) GENERATED ALWAYS AS (
    lambda_cost_usd + ecs_cost_usd + rds_cost_usd + s3_cost_usd + 
    cloudwatch_cost_usd + secrets_manager_cost_usd + other_aws_cost_usd + llm_cost_usd
  ) STORED,
  
  -- Cost calculation metadata
  calculation_method VARCHAR(50) NOT NULL DEFAULT 'estimated', -- 'estimated', 'cost_explorer', 'manual'
  cost_tags JSONB, -- AWS resource tags used for attribution
  calculated_at TIMESTAMP DEFAULT NOW(),
  
  -- Attribution period
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  
  -- Metadata for detailed breakdown
  metadata JSONB, -- Additional cost details, resources used, etc.
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT chk_calculation_method CHECK (calculation_method IN ('estimated', 'cost_explorer', 'manual'))
);

CREATE INDEX idx_cost_attribution_execution ON aws_cost_attribution(execution_id);
CREATE INDEX idx_cost_attribution_calculated_at ON aws_cost_attribution(calculated_at DESC);
CREATE INDEX idx_cost_attribution_period ON aws_cost_attribution(period_start, period_end);
CREATE INDEX idx_cost_attribution_total_cost ON aws_cost_attribution(total_cost_usd DESC);

-- ========================================
-- Cost Allocation Rules
-- ========================================

-- Configurable rules for cost allocation
CREATE TABLE cost_allocation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  
  -- Resource type this rule applies to
  aws_service VARCHAR(100) NOT NULL, -- 'ecs', 'lambda', 'rds', etc.
  
  -- Allocation strategy
  allocation_method VARCHAR(50) NOT NULL, -- 'per_execution', 'per_minute', 'per_invocation', 'shared_pool'
  
  -- Base cost information
  base_rate_usd DECIMAL(10, 6), -- e.g., cost per minute, per invocation
  shared_pool_allocation DECIMAL(5, 4), -- Percentage allocation for shared resources (0-1)
  
  -- Rule configuration
  config JSONB,
  
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT chk_allocation_method CHECK (allocation_method IN ('per_execution', 'per_minute', 'per_invocation', 'shared_pool', 'custom'))
);

CREATE INDEX idx_cost_rules_service ON cost_allocation_rules(aws_service);
CREATE INDEX idx_cost_rules_enabled ON cost_allocation_rules(enabled) WHERE enabled = TRUE;

-- Insert default allocation rules
INSERT INTO cost_allocation_rules (rule_name, description, aws_service, allocation_method, base_rate_usd, config) VALUES
  (
    'ECS Fargate Per Minute',
    'ECS Fargate task cost allocation based on runtime duration',
    'ecs',
    'per_minute',
    0.0000116667, -- $0.0007/minute for 0.25 vCPU, 0.5 GB (approximate)
    '{"vcpu": 0.25, "memory_gb": 0.5, "pricing_model": "fargate"}'::jsonb
  ),
  (
    'RDS PostgreSQL Shared',
    'RDS database cost allocated as shared pool across all executions',
    'rds',
    'shared_pool',
    0.0001, -- Approximate per-minute cost shared across all runs
    '{"instance_type": "db.t3.micro", "storage_gb": 20}'::jsonb
  ),
  (
    'Lambda Invocation',
    'Lambda function invocation cost',
    'lambda',
    'per_invocation',
    0.0000002, -- $0.20 per 1M requests
    '{"memory_mb": 512, "duration_ms": 1000}'::jsonb
  ),
  (
    'CloudWatch Logs',
    'CloudWatch Logs ingestion and storage',
    'cloudwatch',
    'per_execution',
    0.00001, -- Approximate per-execution cost
    '{"log_volume_mb": 1}'::jsonb
  ),
  (
    'S3 Storage Operations',
    'S3 bucket operations and storage',
    's3',
    'per_execution',
    0.000001, -- Minimal per-execution cost
    '{"operations": ["PUT", "GET"]}'::jsonb
  ),
  (
    'Secrets Manager',
    'AWS Secrets Manager secret access',
    'secrets_manager',
    'shared_pool',
    0.00001, -- Shared cost across all runs
    '{"secrets_count": 5}'::jsonb
  );

-- ========================================
-- Cost Per Outcome KPI
-- ========================================

-- Materialized view for Cost per Outcome KPI
CREATE MATERIALIZED VIEW mv_cost_per_outcome AS
SELECT 
  -- Factory-level cost per outcome
  SUM(ac.total_cost_usd) / NULLIF(COUNT(*) FILTER (WHERE we.status = 'completed'), 0) as cost_per_outcome_usd,
  
  -- Cost breakdown
  SUM(ac.lambda_cost_usd) as total_lambda_cost_usd,
  SUM(ac.ecs_cost_usd) as total_ecs_cost_usd,
  SUM(ac.rds_cost_usd) as total_rds_cost_usd,
  SUM(ac.s3_cost_usd) as total_s3_cost_usd,
  SUM(ac.cloudwatch_cost_usd) as total_cloudwatch_cost_usd,
  SUM(ac.llm_cost_usd) as total_llm_cost_usd,
  SUM(ac.total_aws_cost_usd) as total_aws_cost_usd,
  SUM(ac.total_cost_usd) as total_cost_usd,
  
  -- Execution counts
  COUNT(*) as total_executions,
  COUNT(*) FILTER (WHERE we.status = 'completed') as successful_outcomes,
  COUNT(*) FILTER (WHERE we.status = 'failed') as failed_executions,
  
  -- Time period
  MIN(we.started_at) as period_start,
  MAX(we.started_at) as period_end,
  NOW() as calculated_at
FROM workflow_executions we
LEFT JOIN aws_cost_attribution ac ON we.id = ac.execution_id
WHERE we.started_at >= NOW() - INTERVAL '24 hours';

CREATE UNIQUE INDEX ON mv_cost_per_outcome(calculated_at);

-- Materialized view for product-level cost analysis
CREATE MATERIALIZED VIEW mv_product_cost_analysis AS
SELECT 
  r.id as repository_id,
  r.owner || '/' || r.name as product_name,
  
  -- Cost metrics
  SUM(ac.total_cost_usd) as total_cost_usd,
  AVG(ac.total_cost_usd) as avg_cost_per_run_usd,
  SUM(ac.total_cost_usd) / NULLIF(COUNT(*) FILTER (WHERE we.status = 'completed'), 0) as cost_per_outcome_usd,
  
  -- Cost breakdown
  SUM(ac.lambda_cost_usd) as lambda_cost_usd,
  SUM(ac.ecs_cost_usd) as ecs_cost_usd,
  SUM(ac.rds_cost_usd) as rds_cost_usd,
  SUM(ac.llm_cost_usd) as llm_cost_usd,
  
  -- Execution metrics
  COUNT(*) as total_executions,
  COUNT(*) FILTER (WHERE we.status = 'completed') as successful_outcomes,
  
  -- Time period
  MIN(we.started_at) as period_start,
  MAX(we.started_at) as period_end,
  NOW() as calculated_at
FROM repositories r
LEFT JOIN workflow_executions we ON r.id = we.repository_id
LEFT JOIN aws_cost_attribution ac ON we.id = ac.execution_id
WHERE we.started_at >= NOW() - INTERVAL '7 days'
  OR we.started_at IS NULL
GROUP BY r.id, r.owner, r.name;

CREATE UNIQUE INDEX ON mv_product_cost_analysis(repository_id);

-- ========================================
-- Functions
-- ========================================

-- Function to calculate estimated costs for an execution
CREATE OR REPLACE FUNCTION calculate_estimated_cost(p_execution_id UUID)
RETURNS DECIMAL(10, 6) AS $$
DECLARE
  v_duration_minutes DECIMAL(10, 4);
  v_ecs_cost DECIMAL(10, 6);
  v_rds_cost DECIMAL(10, 6);
  v_cloudwatch_cost DECIMAL(10, 6);
  v_llm_cost DECIMAL(10, 6);
  v_total_cost DECIMAL(10, 6);
BEGIN
  -- Get execution duration in minutes
  SELECT EXTRACT(EPOCH FROM (completed_at - started_at)) / 60.0
  INTO v_duration_minutes
  FROM workflow_executions
  WHERE id = p_execution_id;
  
  -- Calculate ECS cost (per minute)
  SELECT base_rate_usd * COALESCE(v_duration_minutes, 0)
  INTO v_ecs_cost
  FROM cost_allocation_rules
  WHERE aws_service = 'ecs' AND allocation_method = 'per_minute' AND enabled = TRUE
  LIMIT 1;
  
  -- Calculate shared RDS cost (fixed per execution)
  SELECT base_rate_usd * COALESCE(v_duration_minutes, 0)
  INTO v_rds_cost
  FROM cost_allocation_rules
  WHERE aws_service = 'rds' AND allocation_method = 'shared_pool' AND enabled = TRUE
  LIMIT 1;
  
  -- Calculate CloudWatch cost (per execution)
  SELECT base_rate_usd
  INTO v_cloudwatch_cost
  FROM cost_allocation_rules
  WHERE aws_service = 'cloudwatch' AND allocation_method = 'per_execution' AND enabled = TRUE
  LIMIT 1;
  
  -- Get LLM cost from agent_runs
  SELECT COALESCE(SUM(cost_usd), 0)
  INTO v_llm_cost
  FROM agent_runs
  WHERE execution_id = p_execution_id;
  
  -- Calculate total cost
  v_total_cost := COALESCE(v_ecs_cost, 0) + COALESCE(v_rds_cost, 0) + 
                  COALESCE(v_cloudwatch_cost, 0) + COALESCE(v_llm_cost, 0);
  
  RETURN v_total_cost;
END;
$$ LANGUAGE plpgsql;

-- Function to refresh cost materialized views
CREATE OR REPLACE FUNCTION refresh_cost_materialized_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_cost_per_outcome;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_cost_analysis;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- Triggers
-- ========================================

-- Auto-calculate estimated costs on execution completion
CREATE OR REPLACE FUNCTION auto_calculate_execution_cost()
RETURNS TRIGGER AS $$
DECLARE
  v_estimated_cost DECIMAL(10, 6);
  v_duration_minutes DECIMAL(10, 4);
  v_ecs_cost DECIMAL(10, 6);
  v_rds_cost DECIMAL(10, 6);
  v_cloudwatch_cost DECIMAL(10, 6);
  v_s3_cost DECIMAL(10, 6);
  v_secrets_cost DECIMAL(10, 6);
  v_llm_cost DECIMAL(10, 6);
BEGIN
  -- Only calculate on completion
  IF NEW.status IN ('completed', 'failed') AND OLD.status NOT IN ('completed', 'failed') THEN
    
    -- Calculate duration in minutes
    v_duration_minutes := EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) / 60.0;
    
    -- Get ECS cost (per minute)
    SELECT base_rate_usd * v_duration_minutes
    INTO v_ecs_cost
    FROM cost_allocation_rules
    WHERE aws_service = 'ecs' AND allocation_method = 'per_minute' AND enabled = TRUE
    LIMIT 1;
    
    -- Get shared RDS cost
    SELECT base_rate_usd * v_duration_minutes
    INTO v_rds_cost
    FROM cost_allocation_rules
    WHERE aws_service = 'rds' AND allocation_method = 'shared_pool' AND enabled = TRUE
    LIMIT 1;
    
    -- Get CloudWatch cost
    SELECT base_rate_usd
    INTO v_cloudwatch_cost
    FROM cost_allocation_rules
    WHERE aws_service = 'cloudwatch' AND allocation_method = 'per_execution' AND enabled = TRUE
    LIMIT 1;
    
    -- Get S3 cost
    SELECT base_rate_usd
    INTO v_s3_cost
    FROM cost_allocation_rules
    WHERE aws_service = 's3' AND allocation_method = 'per_execution' AND enabled = TRUE
    LIMIT 1;
    
    -- Get Secrets Manager cost
    SELECT base_rate_usd
    INTO v_secrets_cost
    FROM cost_allocation_rules
    WHERE aws_service = 'secrets_manager' AND allocation_method = 'shared_pool' AND enabled = TRUE
    LIMIT 1;
    
    -- Get LLM cost from agent_runs
    SELECT COALESCE(SUM(cost_usd), 0)
    INTO v_llm_cost
    FROM agent_runs
    WHERE execution_id = NEW.id;
    
    -- Insert cost attribution record
    INSERT INTO aws_cost_attribution (
      execution_id,
      lambda_cost_usd,
      ecs_cost_usd,
      rds_cost_usd,
      s3_cost_usd,
      cloudwatch_cost_usd,
      secrets_manager_cost_usd,
      other_aws_cost_usd,
      llm_cost_usd,
      calculation_method,
      period_start,
      period_end,
      metadata
    ) VALUES (
      NEW.id,
      0, -- No Lambda in v0.2 ECS architecture
      COALESCE(v_ecs_cost, 0),
      COALESCE(v_rds_cost, 0),
      COALESCE(v_s3_cost, 0),
      COALESCE(v_cloudwatch_cost, 0),
      COALESCE(v_secrets_cost, 0),
      0,
      COALESCE(v_llm_cost, 0),
      'estimated',
      NEW.started_at,
      NEW.completed_at,
      jsonb_build_object(
        'duration_minutes', v_duration_minutes,
        'execution_status', NEW.status,
        'triggered_by', NEW.triggered_by
      )
    );
    
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_calculate_execution_cost
AFTER UPDATE ON workflow_executions
FOR EACH ROW
EXECUTE FUNCTION auto_calculate_execution_cost();

-- ========================================
-- Update Trigger for cost_allocation_rules
-- ========================================

CREATE TRIGGER update_cost_allocation_rules_updated_at BEFORE UPDATE ON cost_allocation_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cost_attribution_updated_at BEFORE UPDATE ON aws_cost_attribution
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE aws_cost_attribution IS 
  'AWS cost attribution per workflow execution for economic steering and transparency';

COMMENT ON TABLE cost_allocation_rules IS 
  'Configurable rules for allocating AWS costs to workflow executions';

COMMENT ON COLUMN aws_cost_attribution.calculation_method IS 
  'estimated: Calculated using allocation rules; cost_explorer: From AWS Cost Explorer API; manual: Manually entered';

COMMENT ON COLUMN aws_cost_attribution.total_cost_usd IS 
  'Total cost including AWS infrastructure + LLM costs';

COMMENT ON FUNCTION calculate_estimated_cost IS 
  'Calculate estimated cost for a workflow execution based on allocation rules';

COMMENT ON MATERIALIZED VIEW mv_cost_per_outcome IS 
  'KPI: Cost per Outcome - Total costs divided by successful outcomes (last 24 hours)';

COMMENT ON MATERIALIZED VIEW mv_product_cost_analysis IS 
  'Product-level cost analysis aggregated per repository (last 7 days)';

-- ========================================
-- Grants (uncomment and adjust as needed)
-- ========================================

-- GRANT SELECT ON aws_cost_attribution TO afu9_readonly;
-- GRANT SELECT, INSERT, UPDATE ON aws_cost_attribution TO afu9_service;
-- GRANT SELECT ON cost_allocation_rules TO afu9_readonly;
-- GRANT SELECT, INSERT, UPDATE ON cost_allocation_rules TO afu9_admin;
