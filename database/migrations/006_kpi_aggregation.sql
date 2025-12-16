-- AFU-9 v0.3 KPI Aggregation & Telemetry Schema
-- EPIC 3: KPI System & Telemetry
-- Issue 3.2: KPI Aggregation Pipeline

-- ========================================
-- KPI Snapshots - Historization
-- ========================================

CREATE TABLE kpi_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_name VARCHAR(100) NOT NULL,
  kpi_version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  level VARCHAR(20) NOT NULL, -- 'factory', 'product', 'run'
  scope_id UUID, -- NULL for factory, repository_id for product, execution_id for run
  value DECIMAL(15, 4),
  unit VARCHAR(50),
  metadata JSONB, -- Additional context (e.g., percentiles, breakdowns)
  calculated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_kpi_level CHECK (level IN ('factory', 'product', 'run'))
);

CREATE INDEX idx_kpi_snapshots_name_time ON kpi_snapshots(kpi_name, calculated_at DESC);
CREATE INDEX idx_kpi_snapshots_level ON kpi_snapshots(level);
CREATE INDEX idx_kpi_snapshots_scope ON kpi_snapshots(scope_id) WHERE scope_id IS NOT NULL;
CREATE INDEX idx_kpi_snapshots_period ON kpi_snapshots(period_start, period_end);
CREATE INDEX idx_kpi_snapshots_version ON kpi_snapshots(kpi_version);

-- ========================================
-- Verdict Outcomes - Steering Accuracy
-- ========================================

-- Tracks the outcomes of verdicts to measure steering accuracy
CREATE TABLE verdict_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verdict_id UUID NOT NULL REFERENCES verdicts(id) ON DELETE CASCADE,
  execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  outcome VARCHAR(50) NOT NULL, -- 'accepted', 'overridden', 'escalated', 'unknown'
  outcome_reason TEXT,
  decided_by VARCHAR(255), -- 'system', 'human:{user_id}', 'timeout'
  decided_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_verdict_outcome CHECK (outcome IN ('accepted', 'overridden', 'escalated', 'unknown'))
);

CREATE INDEX idx_verdict_outcomes_verdict ON verdict_outcomes(verdict_id);
CREATE INDEX idx_verdict_outcomes_execution ON verdict_outcomes(execution_id);
CREATE INDEX idx_verdict_outcomes_outcome ON verdict_outcomes(outcome);
CREATE INDEX idx_verdict_outcomes_decided_at ON verdict_outcomes(decided_at DESC);

-- ========================================
-- KPI Aggregation Jobs
-- ========================================

-- Tracks KPI calculation jobs for monitoring and debugging
CREATE TABLE kpi_aggregation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type VARCHAR(100) NOT NULL, -- 'full', 'incremental', 'on_demand'
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  kpi_names TEXT[], -- Array of KPI names to calculate
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  snapshots_created INTEGER DEFAULT 0,
  error TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_job_status CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);

CREATE INDEX idx_kpi_jobs_status ON kpi_aggregation_jobs(status);
CREATE INDEX idx_kpi_jobs_started_at ON kpi_aggregation_jobs(started_at DESC);
CREATE INDEX idx_kpi_jobs_type ON kpi_aggregation_jobs(job_type);

-- ========================================
-- Product Registry (for Product-Level KPIs)
-- ========================================

-- Enhance repositories table with product metadata
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS product_metadata JSONB;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS kpi_enabled BOOLEAN DEFAULT TRUE;

-- Index for product KPI queries
CREATE INDEX IF NOT EXISTS idx_repositories_kpi_enabled ON repositories(kpi_enabled) WHERE kpi_enabled = TRUE;

-- ========================================
-- Materialized Views for Performance
-- ========================================

-- Materialized view for factory-level KPIs (last 24 hours)
CREATE MATERIALIZED VIEW mv_factory_kpis_24h AS
SELECT 
  -- Mean Time to Insight
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) 
    FILTER (WHERE status IN ('completed', 'failed')) as mtti_ms,
  
  -- Success Rate
  ROUND(
    (COUNT(*) FILTER (WHERE status = 'completed')::DECIMAL / 
     NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'failed')), 0)) * 100,
    2
  ) as success_rate_pct,
  
  -- Execution counts
  COUNT(*) as total_executions,
  COUNT(*) FILTER (WHERE status = 'completed') as completed_executions,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_executions,
  COUNT(*) FILTER (WHERE status = 'running') as running_executions,
  
  -- Avg duration for completed only
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) 
    FILTER (WHERE status = 'completed') as avg_duration_ms,
  
  -- Time window
  MIN(started_at) as period_start,
  MAX(started_at) as period_end,
  NOW() as calculated_at
FROM workflow_executions
WHERE started_at >= NOW() - INTERVAL '24 hours';

CREATE UNIQUE INDEX ON mv_factory_kpis_24h(calculated_at);

-- Materialized view for product-level KPIs (last 7 days)
CREATE MATERIALIZED VIEW mv_product_kpis_7d AS
SELECT 
  r.id as repository_id,
  r.owner || '/' || r.name as product_name,
  
  -- Product Success Rate
  ROUND(
    (COUNT(*) FILTER (WHERE we.status = 'completed')::DECIMAL / 
     NULLIF(COUNT(*), 0)) * 100,
    2
  ) as success_rate_pct,
  
  -- Product Throughput (runs per day)
  COUNT(*) / 7.0 as daily_throughput,
  
  -- Execution counts
  COUNT(*) as total_executions,
  COUNT(*) FILTER (WHERE we.status = 'completed') as completed_executions,
  COUNT(*) FILTER (WHERE we.status = 'failed') as failed_executions,
  
  -- Avg duration
  AVG(EXTRACT(EPOCH FROM (we.completed_at - we.started_at)) * 1000) 
    FILTER (WHERE we.status = 'completed') as avg_duration_ms,
  
  -- Time window
  MIN(we.started_at) as period_start,
  MAX(we.started_at) as period_end,
  NOW() as calculated_at
FROM repositories r
LEFT JOIN workflow_executions we ON r.id = we.repository_id
WHERE we.started_at >= NOW() - INTERVAL '7 days'
  OR we.started_at IS NULL
GROUP BY r.id, r.owner, r.name;

CREATE UNIQUE INDEX ON mv_product_kpis_7d(repository_id);

-- ========================================
-- Functions
-- ========================================

-- Function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_kpi_materialized_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_factory_kpis_24h;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_kpis_7d;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate KPI freshness
CREATE OR REPLACE FUNCTION get_kpi_freshness(p_kpi_name VARCHAR DEFAULT NULL)
RETURNS TABLE(
  kpi_name VARCHAR,
  freshness_seconds NUMERIC,
  last_calculated_at TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ks.kpi_name::VARCHAR,
    EXTRACT(EPOCH FROM (NOW() - MAX(ks.calculated_at)))::NUMERIC as freshness_seconds,
    MAX(ks.calculated_at) as last_calculated_at
  FROM kpi_snapshots ks
  WHERE (p_kpi_name IS NULL OR ks.kpi_name = p_kpi_name)
    AND ks.level = 'factory'
  GROUP BY ks.kpi_name;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate steering accuracy
CREATE OR REPLACE FUNCTION calculate_steering_accuracy(p_period_hours INTEGER DEFAULT 24)
RETURNS TABLE(
  steering_accuracy_pct NUMERIC,
  total_decisions BIGINT,
  accepted_decisions BIGINT,
  overridden_decisions BIGINT,
  escalated_decisions BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ROUND(
      (COUNT(*) FILTER (WHERE outcome = 'accepted')::DECIMAL / 
       NULLIF(COUNT(*), 0)) * 100,
      2
    ) as steering_accuracy_pct,
    COUNT(*) as total_decisions,
    COUNT(*) FILTER (WHERE outcome = 'accepted') as accepted_decisions,
    COUNT(*) FILTER (WHERE outcome = 'overridden') as overridden_decisions,
    COUNT(*) FILTER (WHERE outcome = 'escalated') as escalated_decisions
  FROM verdict_outcomes
  WHERE decided_at >= NOW() - INTERVAL '1 hour' * p_period_hours;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- Triggers
-- ========================================

-- Auto-create run-level KPI snapshots on execution completion
CREATE OR REPLACE FUNCTION create_run_kpi_snapshot()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create snapshot when execution completes
  IF NEW.status IN ('completed', 'failed') AND OLD.status NOT IN ('completed', 'failed') THEN
    -- Run Duration
    INSERT INTO kpi_snapshots (
      kpi_name, kpi_version, level, scope_id, value, unit,
      calculated_at, period_start, period_end
    ) VALUES (
      'run_duration',
      '1.0.0',
      'run',
      NEW.id,
      EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) * 1000,
      'milliseconds',
      NOW(),
      NEW.started_at,
      NEW.completed_at
    );
    
    -- Run Status (0 = failed, 1 = completed)
    INSERT INTO kpi_snapshots (
      kpi_name, kpi_version, level, scope_id, value, unit,
      calculated_at, period_start, period_end
    ) VALUES (
      'run_success',
      '1.0.0',
      'run',
      NEW.id,
      CASE WHEN NEW.status = 'completed' THEN 1 ELSE 0 END,
      'boolean',
      NOW(),
      NEW.started_at,
      NEW.completed_at
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_run_kpi_snapshot
AFTER UPDATE ON workflow_executions
FOR EACH ROW
EXECUTE FUNCTION create_run_kpi_snapshot();

-- ========================================
-- Initial Data
-- ========================================

-- Create initial KPI aggregation job (will be picked up by scheduler)
INSERT INTO kpi_aggregation_jobs (
  job_type, status, kpi_names, period_start, period_end, metadata
) VALUES (
  'full',
  'pending',
  ARRAY['mtti', 'success_rate', 'steering_accuracy', 'kpi_freshness', 'verdict_consistency'],
  NOW() - INTERVAL '24 hours',
  NOW(),
  '{"reason": "initial_migration", "auto_scheduled": true}'::jsonb
);

-- ========================================
-- Indexes for Performance
-- ========================================

-- Add index on workflow_executions for KPI calculations
CREATE INDEX IF NOT EXISTS idx_executions_started_completed 
  ON workflow_executions(started_at, completed_at) 
  WHERE status IN ('completed', 'failed');

-- Add index for repository-scoped queries
CREATE INDEX IF NOT EXISTS idx_executions_repository_time 
  ON workflow_executions(repository_id, started_at DESC)
  WHERE repository_id IS NOT NULL;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE kpi_snapshots IS 
  'Time-series storage for historized KPI values at factory, product, and run levels';

COMMENT ON TABLE verdict_outcomes IS 
  'Tracks verdict outcomes for calculating steering accuracy KPI';

COMMENT ON TABLE kpi_aggregation_jobs IS 
  'Tracks KPI calculation jobs for monitoring the aggregation pipeline';

COMMENT ON COLUMN kpi_snapshots.kpi_version IS 
  'KPI definition version (semantic versioning: MAJOR.MINOR.PATCH)';

COMMENT ON COLUMN kpi_snapshots.level IS 
  'Aggregation level: factory (global), product (per repo), or run (per execution)';

COMMENT ON COLUMN kpi_snapshots.scope_id IS 
  'NULL for factory, repository_id for product, execution_id for run';

COMMENT ON COLUMN verdict_outcomes.outcome IS 
  'accepted: verdict followed without override; overridden: human changed decision; escalated: required human intervention';

-- ========================================
-- Grants (uncomment and adjust as needed)
-- ========================================

-- GRANT SELECT ON kpi_snapshots TO afu9_readonly;
-- GRANT SELECT, INSERT ON kpi_snapshots TO afu9_service;
-- GRANT SELECT ON verdict_outcomes TO afu9_readonly;
-- GRANT SELECT, INSERT, UPDATE ON verdict_outcomes TO afu9_service;
