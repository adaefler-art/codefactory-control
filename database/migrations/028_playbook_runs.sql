-- E65.2: Post-Deploy Verification Playbook Runs
-- PostgreSQL 15+

-- ========================================
-- Playbook Runs
-- ========================================
-- Stores execution records for playbook runs (post-deploy verification, etc.)
CREATE TABLE playbook_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id TEXT NOT NULL,
  playbook_version TEXT NOT NULL,
  env TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'timeout', 'cancelled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT playbook_runs_timestamps_order CHECK (
    (started_at IS NULL) OR 
    (completed_at IS NULL) OR 
    (started_at <= completed_at)
  ),
  CONSTRAINT playbook_runs_completed_requires_started CHECK (
    (completed_at IS NULL) OR (started_at IS NOT NULL)
  )
);

-- Index for listing runs by playbook and environment
CREATE INDEX idx_playbook_runs_playbook_env ON playbook_runs(playbook_id, env, created_at DESC);

-- Index for listing recent runs
CREATE INDEX idx_playbook_runs_created_at_desc ON playbook_runs(created_at DESC);

-- ========================================
-- Playbook Run Steps
-- ========================================
-- Stores individual step execution results within a playbook run
CREATE TABLE playbook_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES playbook_runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'timeout', 'skipped')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  evidence JSONB,
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT playbook_run_steps_timestamps_order CHECK (
    (started_at IS NULL) OR 
    (completed_at IS NULL) OR 
    (started_at <= completed_at)
  ),
  CONSTRAINT playbook_run_steps_completed_requires_started CHECK (
    (completed_at IS NULL) OR (started_at IS NOT NULL)
  ),
  CONSTRAINT playbook_run_steps_unique_per_run CHECK (
    step_index >= 0
  )
);

-- Index for fetching steps by run
CREATE INDEX idx_playbook_run_steps_run_id ON playbook_run_steps(run_id, step_index);

-- Unique constraint: one step per step_id per run
CREATE UNIQUE INDEX idx_playbook_run_steps_unique ON playbook_run_steps(run_id, step_id);
