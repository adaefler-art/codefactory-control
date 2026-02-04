-- Migration 089: Deployment Observations (E9.3-CTRL-05)
-- Creates deployment_observations table for S6 step executor
-- Stores read-only observations of GitHub deployments linked to AFU-9 issues

-- ========================================
-- Deployment Observations Table
-- ========================================

CREATE TABLE IF NOT EXISTS deployment_observations (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References
  issue_id UUID NOT NULL REFERENCES afu9_issues(id) ON DELETE CASCADE,
  
  -- GitHub Deployment Data
  github_deployment_id BIGINT NOT NULL,
  environment TEXT NOT NULL,
  sha TEXT NOT NULL,
  target_url TEXT,
  description TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL,        -- When deployment was created in GitHub
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- When we observed it
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Status and Validation
  deployment_status TEXT,                 -- Latest status (success, failure, pending, etc.)
  is_authentic BOOLEAN NOT NULL DEFAULT false,  -- Validation result
  
  -- Raw Data
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Constraints
  CONSTRAINT valid_environment CHECK (environment ~ '^[a-z0-9_-]+$'),
  CONSTRAINT valid_sha CHECK (sha ~ '^[a-f0-9]{40}$'),
  CONSTRAINT valid_raw_payload CHECK (jsonb_typeof(raw_payload) = 'object'),
  
  -- Unique constraint: one observation per deployment per issue
  UNIQUE(issue_id, github_deployment_id)
);

-- ========================================
-- Indexes
-- ========================================

-- Performance indexes for common queries
CREATE INDEX idx_deployment_observations_issue_id 
  ON deployment_observations(issue_id);

CREATE INDEX idx_deployment_observations_sha 
  ON deployment_observations(sha);

CREATE INDEX idx_deployment_observations_environment 
  ON deployment_observations(environment);

CREATE INDEX idx_deployment_observations_created_at_desc 
  ON deployment_observations(created_at DESC);

CREATE INDEX idx_deployment_observations_observed_at_desc 
  ON deployment_observations(observed_at DESC);

CREATE INDEX idx_deployment_observations_is_authentic 
  ON deployment_observations(is_authentic);

-- Composite index for querying by issue and environment
CREATE INDEX idx_deployment_observations_issue_env 
  ON deployment_observations(issue_id, environment);

-- ========================================
-- Trigger: Update Timestamp
-- ========================================

CREATE OR REPLACE FUNCTION update_deployment_observations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_deployment_observations_updated_at
  BEFORE UPDATE ON deployment_observations
  FOR EACH ROW
  EXECUTE FUNCTION update_deployment_observations_updated_at();

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE deployment_observations IS 'S6 deployment observations: read-only capture of GitHub deployments for AFU-9 issues';

COMMENT ON COLUMN deployment_observations.id IS 'Unique observation identifier (UUID)';
COMMENT ON COLUMN deployment_observations.issue_id IS 'Foreign key to afu9_issues';
COMMENT ON COLUMN deployment_observations.github_deployment_id IS 'GitHub deployment ID from GitHub API';
COMMENT ON COLUMN deployment_observations.environment IS 'Deployment environment (e.g., production, staging)';
COMMENT ON COLUMN deployment_observations.sha IS 'Commit SHA (must be 40-char hex)';
COMMENT ON COLUMN deployment_observations.target_url IS 'Deployment target URL (optional)';
COMMENT ON COLUMN deployment_observations.description IS 'Deployment description from GitHub (optional)';
COMMENT ON COLUMN deployment_observations.created_at IS 'When deployment was created in GitHub';
COMMENT ON COLUMN deployment_observations.observed_at IS 'When we observed this deployment';
COMMENT ON COLUMN deployment_observations.updated_at IS 'Last update timestamp (auto-updated)';
COMMENT ON COLUMN deployment_observations.deployment_status IS 'Latest deployment status from GitHub';
COMMENT ON COLUMN deployment_observations.is_authentic IS 'Whether deployment passed authenticity validation';
COMMENT ON COLUMN deployment_observations.raw_payload IS 'Full GitHub deployment data (JSONB)';

COMMENT ON CONSTRAINT deployment_observations_issue_id_github_deployment_id_key 
  ON deployment_observations IS 'Ensures one observation per deployment per issue (idempotency)';
