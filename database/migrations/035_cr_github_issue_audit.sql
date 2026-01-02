-- Migration 035: CR → GitHub Issue Audit Trail
-- Issue E75.4: Audit Trail (CR↔Issue mapping, hashes, timestamps, lawbookVersion)
-- Creates append-only audit table for CR → GitHub Issue generation

-- ========================================
-- CR GitHub Issue Audit (append-only)
-- ========================================
CREATE TABLE cr_github_issue_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_id TEXT NOT NULL,
  session_id UUID DEFAULT NULL REFERENCES intent_sessions(id) ON DELETE SET NULL,
  cr_version_id UUID DEFAULT NULL REFERENCES intent_cr_versions(id) ON DELETE SET NULL,
  cr_hash TEXT NOT NULL,
  lawbook_version TEXT DEFAULT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update')),
  rendered_issue_hash TEXT NOT NULL,
  used_sources_hash TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  result_json JSONB NOT NULL,
  
  CONSTRAINT chk_cr_github_issue_audit_issue_number_positive CHECK (issue_number > 0)
);

-- ========================================
-- Indexes
-- ========================================

-- Primary query pattern: by canonical_id, newest first
CREATE INDEX idx_cr_github_issue_audit_canonical_id 
ON cr_github_issue_audit(canonical_id, created_at DESC);

-- Query by repo + issue number
CREATE INDEX idx_cr_github_issue_audit_repo_issue 
ON cr_github_issue_audit(owner, repo, issue_number);

-- Query by session
CREATE INDEX idx_cr_github_issue_audit_session 
ON cr_github_issue_audit(session_id)
WHERE session_id IS NOT NULL;

-- Query by CR version
CREATE INDEX idx_cr_github_issue_audit_cr_version 
ON cr_github_issue_audit(cr_version_id)
WHERE cr_version_id IS NOT NULL;

-- ========================================
-- Comments for documentation
-- ========================================

COMMENT ON TABLE cr_github_issue_audit IS 
'Append-only audit trail for CR → GitHub Issue generation. Records every create/update operation with hashes and timestamps for governance compliance.';

COMMENT ON COLUMN cr_github_issue_audit.canonical_id IS 
'CR canonical ID (e.g., CR-2026-01-02-001). Stable identifier for tracking CR across versions.';

COMMENT ON COLUMN cr_github_issue_audit.session_id IS 
'Optional reference to INTENT session that generated this CR. NULL for admin-created CRs.';

COMMENT ON COLUMN cr_github_issue_audit.cr_version_id IS 
'Optional reference to specific CR version. NULL if CR not stored in versions table.';

COMMENT ON COLUMN cr_github_issue_audit.cr_hash IS 
'SHA256 hash of canonical CR JSON. Used for detecting content changes across versions.';

COMMENT ON COLUMN cr_github_issue_audit.lawbook_version IS 
'Lawbook version from CR constraints. NULL if not specified in CR.';

COMMENT ON COLUMN cr_github_issue_audit.action IS 
'Operation type: "create" for new issues, "update" for existing issues.';

COMMENT ON COLUMN cr_github_issue_audit.rendered_issue_hash IS 
'SHA256 hash of rendered issue (title + body). Used for detecting rendering changes.';

COMMENT ON COLUMN cr_github_issue_audit.used_sources_hash IS 
'SHA256 hash of used_sources from CR evidence. NULL if CR has no used_sources.';

COMMENT ON COLUMN cr_github_issue_audit.result_json IS 
'Sanitized operation result: { url, labelsApplied, warnings }. No secrets.';
