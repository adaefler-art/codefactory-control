-- Migration 060: Implementation Summaries (E83.3)
--
-- Implements Epic E83: GH Workflow Orchestrator
-- Creates table for storing implementation summaries from PR descriptions,
-- comments, and check runs with deterministic hashing and versioning.
--
-- This migration creates the infrastructure for:
-- - Storing PR-based implementation summaries
-- - Deterministic content hashing
-- - Append-only versioning
-- - Source reference tracking

-- ========================================
-- Implementation Summaries Table
-- ========================================

CREATE TABLE IF NOT EXISTS implementation_summaries (
  id SERIAL PRIMARY KEY,
  
  -- Summary identification
  summary_id UUID NOT NULL DEFAULT gen_random_uuid(),
  
  -- PR/Repository reference
  repository VARCHAR(500) NOT NULL, -- Format: "owner/repo"
  owner VARCHAR(255) NOT NULL,
  repo VARCHAR(255) NOT NULL,
  pr_number INTEGER NOT NULL,
  
  -- Content and hashing
  content_hash VARCHAR(64) NOT NULL, -- SHA-256 hash of normalized content
  content JSONB NOT NULL, -- Full summary content
  
  -- Source references
  sources JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of source references with URLs and timestamps
  
  -- Versioning
  version INTEGER NOT NULL DEFAULT 1,
  
  -- Metadata
  request_id VARCHAR(255), -- Optional correlation ID
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  collected_by VARCHAR(255), -- User or system that triggered collection
  
  -- Constraints
  CONSTRAINT implementation_summaries_content_check 
    CHECK (jsonb_typeof(content) = 'object'),
  CONSTRAINT implementation_summaries_sources_check 
    CHECK (jsonb_typeof(sources) = 'array'),
  CONSTRAINT implementation_summaries_version_check
    CHECK (version > 0)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_implementation_summaries_repository_pr 
  ON implementation_summaries(repository, pr_number, version DESC);

CREATE INDEX IF NOT EXISTS idx_implementation_summaries_summary_id 
  ON implementation_summaries(summary_id);

CREATE INDEX IF NOT EXISTS idx_implementation_summaries_content_hash 
  ON implementation_summaries(content_hash);

CREATE INDEX IF NOT EXISTS idx_implementation_summaries_collected_at 
  ON implementation_summaries(collected_at DESC);

CREATE INDEX IF NOT EXISTS idx_implementation_summaries_owner_repo_pr 
  ON implementation_summaries(owner, repo, pr_number);

-- ========================================
-- Views
-- ========================================

-- View for latest summaries per PR
CREATE OR REPLACE VIEW latest_implementation_summaries AS
SELECT DISTINCT ON (repository, pr_number)
  id,
  summary_id,
  repository,
  owner,
  repo,
  pr_number,
  content_hash,
  content,
  sources,
  version,
  request_id,
  collected_at,
  collected_by
FROM implementation_summaries
ORDER BY repository, pr_number, version DESC, collected_at DESC;

-- View for recent summaries
CREATE OR REPLACE VIEW recent_implementation_summaries AS
SELECT 
  id,
  summary_id,
  repository,
  pr_number,
  content_hash,
  version,
  collected_at,
  collected_by
FROM implementation_summaries
ORDER BY collected_at DESC
LIMIT 100;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE implementation_summaries IS 
  'E83.3: Implementation summaries collected from PR descriptions, comments, and check runs';

COMMENT ON COLUMN implementation_summaries.content_hash IS 
  'SHA-256 hash of normalized content for deterministic change detection';

COMMENT ON COLUMN implementation_summaries.sources IS 
  'Array of source references: [{ type, url, timestamp, etag? }]';

COMMENT ON COLUMN implementation_summaries.version IS 
  'Version number for this PR (increments on content changes)';

COMMENT ON VIEW latest_implementation_summaries IS 
  'E83.3: Latest version of implementation summary for each PR';

COMMENT ON VIEW recent_implementation_summaries IS 
  'E83.3: Recently collected implementation summaries';
