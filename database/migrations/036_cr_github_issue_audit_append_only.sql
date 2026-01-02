-- Migration 036: Append-Only Enforcement for CR GitHub Issue Audit
-- Issue E75.4: Hardening - Prevent UPDATE/DELETE on audit table
-- Ensures immutability of audit trail at database level

-- ========================================
-- Trigger Function: Block UPDATE/DELETE
-- ========================================

CREATE OR REPLACE FUNCTION fn_prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit trail is append-only. UPDATE and DELETE operations are not allowed on cr_github_issue_audit table.';
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- Triggers: Enforce Append-Only
-- ========================================

-- Prevent UPDATE operations
CREATE TRIGGER trg_prevent_cr_github_issue_audit_update
BEFORE UPDATE ON cr_github_issue_audit
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_audit_modification();

-- Prevent DELETE operations
CREATE TRIGGER trg_prevent_cr_github_issue_audit_delete
BEFORE DELETE ON cr_github_issue_audit
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_audit_modification();

-- ========================================
-- Comments
-- ========================================

COMMENT ON FUNCTION fn_prevent_audit_modification() IS 
'Trigger function that prevents any UPDATE or DELETE operations on audit tables to ensure immutability.';

COMMENT ON TRIGGER trg_prevent_cr_github_issue_audit_update ON cr_github_issue_audit IS 
'Enforces append-only constraint by blocking UPDATE operations on the audit trail.';

COMMENT ON TRIGGER trg_prevent_cr_github_issue_audit_delete ON cr_github_issue_audit IS 
'Enforces append-only constraint by blocking DELETE operations on the audit trail.';
