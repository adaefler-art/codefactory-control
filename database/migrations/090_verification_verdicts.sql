-- Migration 090: Verification Verdicts (E9.3-CTRL-06)
-- 
-- Creates tables for S7 Verify Gate:
-- - verification_evidence: Stores evidence for verification
-- - verification_verdicts: Stores explicit verdicts (GREEN/RED)
-- - evidence_links: Immutable links between verdicts and evidence
--
-- Guarantees:
-- - No implicit success: Verdict must be explicitly set
-- - Evidence is linked: Immutable link between verdict and evidence
-- - Idempotent: Evidence hash prevents duplicates
-- - Deterministic: Same evidence → Same verdict

-- Create verification_evidence table
CREATE TABLE IF NOT EXISTS verification_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES afu9_issues(id) ON DELETE CASCADE,
  evidence_hash TEXT NOT NULL,
  evidence_data JSONB NOT NULL,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Index for fast lookup by hash (idempotency)
  CONSTRAINT verification_evidence_hash_unique UNIQUE(evidence_hash)
);

-- Index for querying evidence by issue
CREATE INDEX idx_verification_evidence_issue_id ON verification_evidence(issue_id);

-- Create verification_verdicts table
CREATE TABLE IF NOT EXISTS verification_verdicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES afu9_issues(id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('GREEN', 'RED')),
  evidence_id UUID NOT NULL REFERENCES verification_evidence(id) ON DELETE CASCADE,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evaluation_rules TEXT[] NOT NULL DEFAULT '{}',
  decision_rationale TEXT NOT NULL,
  failed_checks TEXT[] NOT NULL DEFAULT '{}',
  
  -- One verdict per run (idempotency)
  CONSTRAINT verification_verdicts_run_unique UNIQUE(run_id)
);

-- Index for querying verdicts by issue
CREATE INDEX idx_verification_verdicts_issue_id ON verification_verdicts(issue_id);

-- Index for querying verdicts by evidence
CREATE INDEX idx_verification_verdicts_evidence_id ON verification_verdicts(evidence_id);

-- Create evidence_links table (immutable links)
CREATE TABLE IF NOT EXISTS evidence_links (
  verdict_id UUID NOT NULL REFERENCES verification_verdicts(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES verification_evidence(id) ON DELETE CASCADE,
  evidence_hash TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Primary key: one link per verdict-evidence pair
  PRIMARY KEY (verdict_id, evidence_id)
);

-- Index for querying links by evidence
CREATE INDEX idx_evidence_links_evidence_id ON evidence_links(evidence_id);

-- Add comment explaining the tables
COMMENT ON TABLE verification_evidence IS 'E9.3-CTRL-06: Stores verification evidence for S7 Verify Gate';
COMMENT ON TABLE verification_verdicts IS 'E9.3-CTRL-06: Stores explicit verdicts (GREEN/RED) with no implicit success';
COMMENT ON TABLE evidence_links IS 'E9.3-CTRL-06: Immutable links between verdicts and evidence for full traceability';

COMMENT ON COLUMN verification_verdicts.verdict IS 'Explicit verdict: GREEN or RED (never null/undefined)';
COMMENT ON COLUMN verification_evidence.evidence_hash IS 'SHA256 hash of evidence for idempotency and integrity';
COMMENT ON COLUMN evidence_links.evidence_hash IS 'Copy of evidence hash for integrity verification';
