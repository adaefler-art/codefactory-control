-- Migration 086: S1-S3 Live Flow Persistence (E9.1_F1)
-- 
-- Adds persistent storage for S1-S3 GitHub issue flow:
-- - afu9_s1s3_issues: AFU9 issue records linked to GitHub issues
-- - s1s3_runs: Run tracking for S1-S3 actions
-- - s1s3_run_steps: Step-level events with evidence refs
--
-- Intent: Evidence-first flow for GitHub Issue Pick → Spec Ready → PR Create
-- No mocks, all data persisted with request IDs and timestamps

-- ========================================
-- Table: afu9_s1s3_issues
-- ========================================

CREATE TABLE IF NOT EXISTS afu9_s1s3_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Public identifiers
  public_id VARCHAR(16) GENERATED ALWAYS AS (replace(substring(id::text, 1, 9), '-', '')) STORED,
  canonical_id VARCHAR(20),
  
  -- GitHub source
  repo_full_name VARCHAR(255) NOT NULL,
  github_issue_number INTEGER NOT NULL,
  github_issue_url VARCHAR(500) NOT NULL,
  
  -- Ownership
  owner VARCHAR(100) NOT NULL DEFAULT 'afu9',
  
  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'CREATED' CHECK (status IN (
    'CREATED',
    'SPEC_READY',
    'IMPLEMENTING',
    'PR_CREATED',
    'CHECKS_PASSING',
    'CHECKS_FAILING',
    'DONE',
    'FAILED',
    'CANCELLED'
  )),
  
  -- Spec fields
  problem TEXT,
  scope TEXT,
  acceptance_criteria JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  
  -- PR tracking
  pr_number INTEGER,
  pr_url VARCHAR(500),
  branch_name VARCHAR(255),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  spec_ready_at TIMESTAMPTZ,
  pr_created_at TIMESTAMPTZ,
  
  -- Unique constraint: one AFU9 issue per GitHub issue
  CONSTRAINT uq_s1s3_github_issue UNIQUE (repo_full_name, github_issue_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS s1s3_issues_status_idx ON afu9_s1s3_issues(status);
CREATE INDEX IF NOT EXISTS s1s3_issues_repo_idx ON afu9_s1s3_issues(repo_full_name);
CREATE INDEX IF NOT EXISTS s1s3_issues_canonical_id_idx ON afu9_s1s3_issues(canonical_id) WHERE canonical_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS s1s3_issues_created_at_idx ON afu9_s1s3_issues(created_at DESC);
CREATE INDEX IF NOT EXISTS s1s3_issues_pr_number_idx ON afu9_s1s3_issues(pr_number) WHERE pr_number IS NOT NULL;

-- ========================================
-- Table: s1s3_runs
-- ========================================

CREATE TABLE IF NOT EXISTS s1s3_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Run metadata
  type VARCHAR(50) NOT NULL CHECK (type IN (
    'S1_PICK_ISSUE',
    'S2_SPEC_READY',
    'S3_IMPLEMENT',
    'S1S3_FLOW'
  )),
  
  -- Issue linkage
  issue_id UUID NOT NULL,
  
  -- Request tracking
  request_id VARCHAR(100) NOT NULL,
  actor VARCHAR(100) NOT NULL DEFAULT 'system',
  
  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'CREATED' CHECK (status IN (
    'CREATED',
    'RUNNING',
    'DONE',
    'FAILED'
  )),
  
  -- Error tracking
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Foreign key
  CONSTRAINT fk_s1s3_runs_issue FOREIGN KEY (issue_id) REFERENCES afu9_s1s3_issues(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS s1s3_runs_issue_id_idx ON s1s3_runs(issue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS s1s3_runs_type_idx ON s1s3_runs(type);
CREATE INDEX IF NOT EXISTS s1s3_runs_status_idx ON s1s3_runs(status);
CREATE INDEX IF NOT EXISTS s1s3_runs_request_id_idx ON s1s3_runs(request_id);
CREATE INDEX IF NOT EXISTS s1s3_runs_created_at_idx ON s1s3_runs(created_at DESC);

-- ========================================
-- Table: s1s3_run_steps
-- ========================================

CREATE TABLE IF NOT EXISTS s1s3_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Run linkage
  run_id UUID NOT NULL,
  
  -- Step identification
  step_id VARCHAR(50) NOT NULL,
  step_name VARCHAR(255) NOT NULL,
  
  -- Status
  status VARCHAR(50) NOT NULL CHECK (status IN (
    'STARTED',
    'SUCCEEDED',
    'FAILED'
  )),
  
  -- Evidence refs (append-only)
  evidence_refs JSONB DEFAULT '{}'::jsonb,
  
  -- Error tracking
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Foreign key
  CONSTRAINT fk_s1s3_run_steps_run FOREIGN KEY (run_id) REFERENCES s1s3_runs(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS s1s3_run_steps_run_id_idx ON s1s3_run_steps(run_id, created_at);
CREATE INDEX IF NOT EXISTS s1s3_run_steps_step_id_idx ON s1s3_run_steps(step_id);
CREATE INDEX IF NOT EXISTS s1s3_run_steps_status_idx ON s1s3_run_steps(status);

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE afu9_s1s3_issues IS 'AFU9 issue records linked to GitHub issues for S1-S3 flow (E9.1_F1)';
COMMENT ON TABLE s1s3_runs IS 'Run tracking for S1-S3 actions with request IDs';
COMMENT ON TABLE s1s3_run_steps IS 'Step-level events with evidence refs (append-only)';

COMMENT ON COLUMN afu9_s1s3_issues.public_id IS '8-hex public identifier';
COMMENT ON COLUMN afu9_s1s3_issues.canonical_id IS 'Canonical ID (e.g., E89.6, I811)';
COMMENT ON COLUMN afu9_s1s3_issues.acceptance_criteria IS 'Array of acceptance criteria (required for SPEC_READY)';
COMMENT ON COLUMN s1s3_run_steps.evidence_refs IS 'JSON object with links (issue_url, pr_url, checks_url, etc.)';
