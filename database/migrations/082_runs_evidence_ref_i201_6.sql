-- Migration 082: Add Evidence Reference to Runs (I201.6)
-- 
-- Adds evidence reference fields to the runs table for linking
-- runs to Engine evidence without duplication.
-- 
-- Evidence Reference includes:
-- - evidence_url: URL to Engine evidence
-- - evidence_hash: SHA256 hash of evidence for verification
-- - evidence_fetched_at: Timestamp when evidence was fetched
-- - evidence_version: Version string for evidence format/schema

-- Add evidence reference columns to runs table
ALTER TABLE runs 
  ADD COLUMN IF NOT EXISTS evidence_url TEXT,
  ADD COLUMN IF NOT EXISTS evidence_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS evidence_fetched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_version VARCHAR(50);

-- Create index for evidence hash lookups (deduplication)
CREATE INDEX IF NOT EXISTS runs_evidence_hash_idx ON runs(evidence_hash) WHERE evidence_hash IS NOT NULL;

-- Create index for evidence fetch tracking
CREATE INDEX IF NOT EXISTS runs_evidence_fetched_at_idx ON runs(evidence_fetched_at DESC) WHERE evidence_fetched_at IS NOT NULL;

-- Comments
COMMENT ON COLUMN runs.evidence_url IS 'I201.6: URL reference to Engine evidence (e.g., s3://, https://)';
COMMENT ON COLUMN runs.evidence_hash IS 'I201.6: SHA256 hash of evidence for verification and deduplication';
COMMENT ON COLUMN runs.evidence_fetched_at IS 'I201.6: Timestamp when evidence was fetched from Engine';
COMMENT ON COLUMN runs.evidence_version IS 'I201.6: Evidence format/schema version for compatibility tracking';
