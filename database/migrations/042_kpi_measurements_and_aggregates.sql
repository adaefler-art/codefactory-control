-- Migration 042: KPI Measurements and Aggregates (E78.1 / I781)
-- 
-- Deterministic KPI computation layer for AFU-9 metrics:
-- - Velocity KPIs: D2D (Decision-to-Deploy), HSH (Human Steering Hours), DCU (Delivered Capability Units), AVS (Autonomy Velocity Score)
-- - Ops KPIs: Incident Rate, MTTR (Mean Time To Resolve), Auto-fix Rate
--
-- Features:
-- - Deterministic computation: same inputs → same outputs
-- - Evidence-friendly: KPI values link to source events/records
-- - Idempotent recompute via inputs_hash
-- - Versioned aggregates with stable time windows

-- ========================================
-- Table: kpi_measurements
-- Raw/atomic measurements or event-derived facts
-- ========================================

CREATE TABLE IF NOT EXISTS kpi_measurements (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- KPI identification
  kpi_name TEXT NOT NULL,
  
  -- Entity classification
  entity_type TEXT NOT NULL CHECK (entity_type IN ('issue', 'deploy', 'incident', 'remediation', 'release')),
  entity_id TEXT NOT NULL,
  
  -- Measurement timing
  occurred_at TIMESTAMPTZ NOT NULL,
  
  -- Measurement value
  value_num NUMERIC,
  unit TEXT NOT NULL,
  
  -- Source evidence (pointers to issueId, eventId, deployId, incidentId, remediationRunId)
  -- Example: {"issueId": "123", "eventId": "evt_456", "deployId": "dep_789"}
  source_refs JSONB NOT NULL DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_source_refs CHECK (jsonb_typeof(source_refs) = 'object')
);

-- Unique constraint: prevent duplicate measurements for same entity at same time
-- Use measurement_key approach for flexibility
CREATE UNIQUE INDEX IF NOT EXISTS kpi_measurements_unique_idx
  ON kpi_measurements(kpi_name, entity_type, entity_id, occurred_at);

-- Indexes for kpi_measurements
CREATE INDEX IF NOT EXISTS kpi_measurements_kpi_name_idx ON kpi_measurements(kpi_name);
CREATE INDEX IF NOT EXISTS kpi_measurements_entity_type_idx ON kpi_measurements(entity_type);
CREATE INDEX IF NOT EXISTS kpi_measurements_occurred_at_idx ON kpi_measurements(occurred_at DESC);
CREATE INDEX IF NOT EXISTS kpi_measurements_source_refs_idx ON kpi_measurements USING GIN(source_refs);

-- ========================================
-- Table: kpi_aggregates
-- Windowed aggregates with versioning
-- ========================================

CREATE TABLE IF NOT EXISTS kpi_aggregates (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Window classification
  window_type TEXT NOT NULL CHECK (window_type IN ('daily', 'weekly', 'release', 'custom')),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  
  -- KPI identification
  kpi_name TEXT NOT NULL,
  
  -- Aggregate value
  value_num NUMERIC,
  unit TEXT NOT NULL,
  
  -- Computation metadata
  compute_version TEXT NOT NULL DEFAULT '0.7.0',
  
  -- Deterministic inputs hash (SHA-256 of canonical input refs)
  -- Ensures same inputs → same hash → idempotent recompute
  inputs_hash TEXT NOT NULL,
  
  -- Additional metadata (e.g., source measurement count, outliers, etc.)
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_metadata CHECK (metadata IS NULL OR jsonb_typeof(metadata) = 'object'),
  CONSTRAINT valid_window_times CHECK (window_start < window_end)
);

-- Unique constraint: prevent duplicate aggregates for same window/kpi/version/inputs
CREATE UNIQUE INDEX IF NOT EXISTS kpi_aggregates_unique_idx
  ON kpi_aggregates(window_type, window_start, window_end, kpi_name, compute_version, inputs_hash);

-- Indexes for kpi_aggregates
CREATE INDEX IF NOT EXISTS kpi_aggregates_kpi_name_idx ON kpi_aggregates(kpi_name);
CREATE INDEX IF NOT EXISTS kpi_aggregates_window_type_idx ON kpi_aggregates(window_type);
CREATE INDEX IF NOT EXISTS kpi_aggregates_window_start_idx ON kpi_aggregates(window_start DESC);
CREATE INDEX IF NOT EXISTS kpi_aggregates_window_end_idx ON kpi_aggregates(window_end DESC);
CREATE INDEX IF NOT EXISTS kpi_aggregates_compute_version_idx ON kpi_aggregates(compute_version);
CREATE INDEX IF NOT EXISTS kpi_aggregates_created_at_idx ON kpi_aggregates(created_at DESC);

-- ========================================
-- Helper Functions
-- ========================================

-- Function to calculate D2D (Decision-to-Deploy) hours for an issue
-- Decision = Issue state enters SPEC_READY
-- Deploy = deploy event timestamp for that issue/PR
-- Note: Division by 3600.0 converts seconds to hours (1 hour = 3600 seconds)
CREATE OR REPLACE FUNCTION calculate_d2d_hours(p_issue_id UUID)
RETURNS TABLE(
  d2d_hours NUMERIC,
  decision_at TIMESTAMPTZ,
  deploy_at TIMESTAMPTZ,
  source_refs JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH decision_time AS (
    -- Get timestamp when issue entered SPEC_READY state
    SELECT 
      e.at as decision_at,
      e.issue_id
    FROM afu9_issue_events e
    WHERE e.issue_id = p_issue_id
      AND e.to_status = 'SPEC_READY'
    ORDER BY e.at ASC
    LIMIT 1
  ),
  deploy_time AS (
    -- Get deploy event for this issue via timeline linkage
    -- Link: ISSUE -> PR -> RUN -> DEPLOY
    SELECT 
      de.created_at as deploy_at,
      de.id as deploy_id
    FROM timeline_nodes tn_issue
    INNER JOIN timeline_edges e1 ON e1.from_node_id = tn_issue.id AND e1.edge_type = 'ISSUE_HAS_PR'
    INNER JOIN timeline_nodes tn_pr ON tn_pr.id = e1.to_node_id
    INNER JOIN timeline_edges e2 ON e2.from_node_id = tn_pr.id AND e2.edge_type = 'PR_HAS_RUN'
    INNER JOIN timeline_nodes tn_run ON tn_run.id = e2.to_node_id
    INNER JOIN timeline_edges e3 ON e3.from_node_id = tn_run.id AND e3.edge_type = 'RUN_HAS_DEPLOY'
    INNER JOIN timeline_nodes tn_deploy ON tn_deploy.id = e3.to_node_id
    INNER JOIN deploy_events de ON de.id::TEXT = tn_deploy.source_id
    WHERE tn_issue.source_type = 'issue'
      AND tn_issue.source_id = (SELECT github_issue_number::TEXT FROM afu9_issues WHERE id = p_issue_id)
      AND de.status = 'success'
    ORDER BY de.created_at ASC
    LIMIT 1
  )
  SELECT 
    EXTRACT(EPOCH FROM (dt.deploy_at - dect.decision_at)) / 3600.0 as d2d_hours,
    dect.decision_at,
    dt.deploy_at,
    jsonb_build_object(
      'issueId', p_issue_id,
      'decisionAt', dect.decision_at,
      'deployAt', dt.deploy_at,
      'deployId', dt.deploy_id
    ) as source_refs
  FROM decision_time dect
  CROSS JOIN deploy_time dt
  WHERE dect.decision_at IS NOT NULL
    AND dt.deploy_at IS NOT NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to calculate MTTR (Mean Time To Resolve) for incidents in a window
-- MTTR = AVG(CLOSED.created_at - OPEN.created_at) for closed incidents
-- Note: Division by 3600.0 converts seconds to hours (1 hour = 3600 seconds)
CREATE OR REPLACE FUNCTION calculate_mttr_for_window(
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ
)
RETURNS TABLE(
  mttr_hours NUMERIC,
  incident_count BIGINT,
  source_refs JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH closed_incidents AS (
    SELECT 
      i.id,
      i.incident_key,
      i.created_at as opened_at,
      ie.created_at as closed_at
    FROM incidents i
    INNER JOIN incident_events ie ON ie.incident_id = i.id AND ie.event_type = 'CLOSED'
    WHERE ie.created_at >= p_window_start
      AND ie.created_at < p_window_end
      AND i.status = 'CLOSED'
  )
  SELECT 
    AVG(EXTRACT(EPOCH FROM (closed_at - opened_at)) / 3600.0) as mttr_hours,  -- Convert seconds to hours
    COUNT(*) as incident_count,
    jsonb_build_object(
      'incidentIds', jsonb_agg(id),
      'windowStart', p_window_start,
      'windowEnd', p_window_end
    ) as source_refs
  FROM closed_incidents
  WHERE closed_at IS NOT NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to calculate Incident Rate (incidents per day) for a window
-- Note: Division by 86400.0 converts seconds to days (1 day = 86400 seconds)
CREATE OR REPLACE FUNCTION calculate_incident_rate_for_window(
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ
)
RETURNS TABLE(
  incidents_per_day NUMERIC,
  total_incidents BIGINT,
  window_days NUMERIC,
  source_refs JSONB
) AS $$
DECLARE
  v_window_days NUMERIC;
BEGIN
  -- Calculate window duration in days (1 day = 86400 seconds)
  v_window_days := EXTRACT(EPOCH FROM (p_window_end - p_window_start)) / 86400.0;
  
  RETURN QUERY
  WITH incident_count AS (
    SELECT COUNT(*) as total_incidents
    FROM incidents
    WHERE created_at >= p_window_start
      AND created_at < p_window_end
  )
  SELECT 
    CASE 
      WHEN v_window_days > 0 THEN ic.total_incidents / v_window_days
      ELSE 0
    END as incidents_per_day,
    ic.total_incidents,
    v_window_days as window_days,
    jsonb_build_object(
      'windowStart', p_window_start,
      'windowEnd', p_window_end,
      'totalIncidents', ic.total_incidents,
      'windowDays', v_window_days
    ) as source_refs
  FROM incident_count ic;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to calculate Auto-fix Rate for a window
-- Auto-fix Rate = (SUCCEEDED remediation runs without human intervention) / total remediation runs
CREATE OR REPLACE FUNCTION calculate_autofix_rate_for_window(
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ
)
RETURNS TABLE(
  autofix_rate_pct NUMERIC,
  autofix_count BIGINT,
  total_runs BIGINT,
  source_refs JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH remediation_stats AS (
    SELECT 
      COUNT(*) FILTER (WHERE status = 'SUCCEEDED') as succeeded_count,
      COUNT(*) as total_runs
    FROM remediation_runs
    WHERE created_at >= p_window_start
      AND created_at < p_window_end
  )
  SELECT 
    CASE 
      WHEN rs.total_runs > 0 THEN (rs.succeeded_count::NUMERIC / rs.total_runs::NUMERIC) * 100
      ELSE 0
    END as autofix_rate_pct,
    rs.succeeded_count as autofix_count,
    rs.total_runs,
    jsonb_build_object(
      'windowStart', p_window_start,
      'windowEnd', p_window_end,
      'succeededCount', rs.succeeded_count,
      'totalRuns', rs.total_runs
    ) as source_refs
  FROM remediation_stats rs;
END;
$$ LANGUAGE plpgsql STABLE;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE kpi_measurements IS 'E78.1: Atomic KPI measurements with evidence linkage';
COMMENT ON COLUMN kpi_measurements.kpi_name IS 'KPI identifier (e.g., d2d, hsh, dcu, avs, incident_rate, mttr, autofix_rate)';
COMMENT ON COLUMN kpi_measurements.entity_type IS 'Entity type: issue, deploy, incident, remediation, release';
COMMENT ON COLUMN kpi_measurements.entity_id IS 'Entity ID (issue ID, deploy ID, incident ID, etc.)';
COMMENT ON COLUMN kpi_measurements.occurred_at IS 'When the measurement occurred (decision time, deploy time, incident close time, etc.)';
COMMENT ON COLUMN kpi_measurements.value_num IS 'Numeric measurement value';
COMMENT ON COLUMN kpi_measurements.unit IS 'Measurement unit (hours, count, ratio, percentage)';
COMMENT ON COLUMN kpi_measurements.source_refs IS 'JSONB pointers to source records (issueId, eventId, deployId, incidentId, remediationRunId)';

COMMENT ON TABLE kpi_aggregates IS 'E78.1: Windowed KPI aggregates with deterministic computation and versioning';
COMMENT ON COLUMN kpi_aggregates.window_type IS 'Aggregation window: daily, weekly, release, custom';
COMMENT ON COLUMN kpi_aggregates.window_start IS 'Window start timestamp (inclusive)';
COMMENT ON COLUMN kpi_aggregates.window_end IS 'Window end timestamp (exclusive)';
COMMENT ON COLUMN kpi_aggregates.kpi_name IS 'KPI identifier';
COMMENT ON COLUMN kpi_aggregates.value_num IS 'Aggregated value';
COMMENT ON COLUMN kpi_aggregates.compute_version IS 'Computation version (semantic versioning)';
COMMENT ON COLUMN kpi_aggregates.inputs_hash IS 'SHA-256 hash of canonical input refs for idempotent recompute';

COMMENT ON FUNCTION calculate_d2d_hours IS 'E78.1: Calculate Decision-to-Deploy hours for an issue (SPEC_READY → deploy success)';
COMMENT ON FUNCTION calculate_mttr_for_window IS 'E78.1: Calculate Mean Time To Resolve for closed incidents in a time window';
COMMENT ON FUNCTION calculate_incident_rate_for_window IS 'E78.1: Calculate Incident Rate (incidents per day) for a time window';
COMMENT ON FUNCTION calculate_autofix_rate_for_window IS 'E78.1: Calculate Auto-fix Rate (% SUCCEEDED remediation runs) for a time window';
