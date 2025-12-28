-- Migration 020: Import Runs & Epics for Backlog Import
-- Issue E0.1 — Repo File Import UI + API (MVP)
-- Creates import tracking and epic management for structured backlog imports

-- ========================================
-- AFU9 Epics Table
-- ========================================

CREATE TABLE afu9_epics (
  -- Primary identifier
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Stable external ID (for upsert logic)
  external_id VARCHAR(100) NOT NULL UNIQUE,
  
  -- Core fields
  title VARCHAR(500) NOT NULL,
  description TEXT,
  
  -- Metadata
  labels TEXT[] DEFAULT '{}',
  
  -- Audit timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_afu9_epic_external_id CHECK (external_id != '')
);

-- Indexes
CREATE INDEX idx_afu9_epics_external_id ON afu9_epics(external_id);
CREATE INDEX idx_afu9_epics_created_at ON afu9_epics(created_at DESC);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_afu9_epic_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_afu9_epic_timestamp
  BEFORE UPDATE ON afu9_epics
  FOR EACH ROW
  EXECUTE FUNCTION update_afu9_epic_timestamp();

-- ========================================
-- Import Runs Table
-- ========================================

CREATE TABLE import_runs (
  -- Primary identifier
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Source information
  source_type VARCHAR(50) NOT NULL DEFAULT 'github_file',
  source_path VARCHAR(500) NOT NULL,
  source_ref VARCHAR(200) DEFAULT 'main',
  
  -- Run statistics
  status VARCHAR(50) NOT NULL DEFAULT 'RUNNING',
  epics_created INTEGER DEFAULT 0,
  epics_updated INTEGER DEFAULT 0,
  epics_skipped INTEGER DEFAULT 0,
  issues_created INTEGER DEFAULT 0,
  issues_updated INTEGER DEFAULT 0,
  issues_skipped INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,
  
  -- Error tracking
  errors JSONB DEFAULT '[]',
  
  -- Audit timestamps
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  
  -- Constraints
  CONSTRAINT chk_import_run_status CHECK (status IN (
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'PARTIAL'
  )),
  CONSTRAINT chk_import_run_source_type CHECK (source_type IN (
    'github_file',
    'manual',
    'api'
  ))
);

-- Indexes
CREATE INDEX idx_import_runs_status ON import_runs(status);
CREATE INDEX idx_import_runs_started_at ON import_runs(started_at DESC);
CREATE INDEX idx_import_runs_source_path ON import_runs(source_path);

-- ========================================
-- Add Epic Reference to Issues
-- ========================================

-- Add epic_id column to afu9_issues (nullable for backward compatibility)
ALTER TABLE afu9_issues ADD COLUMN IF NOT EXISTS epic_id UUID;

-- Add external_id column to afu9_issues for stable upsert
ALTER TABLE afu9_issues ADD COLUMN IF NOT EXISTS external_id VARCHAR(100);

-- Add foreign key constraint
ALTER TABLE afu9_issues 
  ADD CONSTRAINT fk_afu9_issues_epic 
  FOREIGN KEY (epic_id) 
  REFERENCES afu9_epics(id) 
  ON DELETE SET NULL;

-- Create index on epic_id
CREATE INDEX idx_afu9_issues_epic_id ON afu9_issues(epic_id) WHERE epic_id IS NOT NULL;

-- Create unique index on external_id (for upsert logic)
CREATE UNIQUE INDEX idx_afu9_issues_external_id ON afu9_issues(external_id) WHERE external_id IS NOT NULL;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE afu9_epics IS 'AFU9 Epics - high-level groupings of related issues';
COMMENT ON TABLE import_runs IS 'Tracking table for backlog file imports';

COMMENT ON COLUMN afu9_epics.external_id IS 'Stable external identifier for upsert logic (e.g., "E1", "EPIC-01")';
COMMENT ON COLUMN afu9_issues.epic_id IS 'Reference to parent epic (optional)';
COMMENT ON COLUMN afu9_issues.external_id IS 'Stable external identifier for upsert logic (e.g., "I1", "E1.1")';

COMMENT ON COLUMN import_runs.source_type IS 'Type of import source: github_file, manual, or api';
COMMENT ON COLUMN import_runs.source_path IS 'Path to source file or identifier';
COMMENT ON COLUMN import_runs.source_ref IS 'Git ref (branch/tag) for github_file imports';
COMMENT ON COLUMN import_runs.status IS 'Import run status: RUNNING, COMPLETED, FAILED, or PARTIAL';
COMMENT ON COLUMN import_runs.errors IS 'JSON array of error details from the import run';
