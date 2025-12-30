-- AFU-9 E65.1: Deploy Status Monitor (GREEN/YELLOW/RED)
-- PostgreSQL 15+

-- ========================================
-- Deploy Status Snapshots
-- ========================================

CREATE TABLE deploy_status_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Environment being monitored (prod, stage, etc)
  env TEXT NOT NULL,
  
  -- Status: GREEN, YELLOW, or RED
  status TEXT NOT NULL CHECK (status IN ('GREEN', 'YELLOW', 'RED')),
  
  -- Timestamp when this status was observed
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Array of reason codes explaining the status
  -- Format: [{"code": "READY_FAIL", "severity": "error", "message": "...", "evidence": {...}}]
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Raw signal data used to determine status
  -- Format: {"health": {...}, "ready": {...}, "deploy_events": [...], ...}
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Optional reference to related deploy event
  related_deploy_event_id UUID REFERENCES deploy_events(id),
  
  -- Staleness indicator (seconds since observation)
  staleness_seconds INTEGER,
  
  CONSTRAINT valid_env CHECK (env ~ '^[a-z0-9_-]+$'),
  CONSTRAINT valid_reasons CHECK (jsonb_typeof(reasons) = 'array'),
  CONSTRAINT valid_signals CHECK (jsonb_typeof(signals) = 'object')
);

-- Index for efficiently fetching latest status per environment
CREATE INDEX idx_deploy_status_snapshots_env_observed_at 
  ON deploy_status_snapshots(env, observed_at DESC);

-- Index for efficiently querying by status
CREATE INDEX idx_deploy_status_snapshots_status 
  ON deploy_status_snapshots(status);

-- Index for time-based queries
CREATE INDEX idx_deploy_status_snapshots_created_at_desc 
  ON deploy_status_snapshots(created_at DESC);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_deploy_status_snapshots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_deploy_status_snapshots_updated_at
  BEFORE UPDATE ON deploy_status_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION update_deploy_status_snapshots_updated_at();
