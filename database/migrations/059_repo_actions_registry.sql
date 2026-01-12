-- Migration 059: Repository Actions Registry (E83.1)
--
-- Implements Epic E83: GH Workflow Orchestrator
-- Creates tables for Repository/Issue Actions Registry
--
-- This migration creates the infrastructure for storing machine-readable
-- specifications of what is automatable in a repository, including:
-- - Allowed actions (assign, label, merge, close, branch cleanup, etc.)
-- - Rules & Preconditions (checks required, approvals required, environments)
-- - Mappings to GitHub objects (labels, checks, reviewers)
--
-- Fail-closed semantics: unknown action → BLOCK

-- ========================================
-- Repository Actions Registry
-- ========================================

CREATE TABLE IF NOT EXISTS repo_actions_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Registry identification
  registry_id VARCHAR(255) NOT NULL UNIQUE,
  repository VARCHAR(500) NOT NULL, -- Format: "owner/repo"
  version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
  
  -- Registry content (full JSON document)
  content JSONB NOT NULL,
  
  -- Status
  active BOOLEAN NOT NULL DEFAULT true,
  fail_closed BOOLEAN NOT NULL DEFAULT true, -- Unknown actions blocked by default
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(255) NOT NULL,
  updated_at TIMESTAMPTZ,
  updated_by VARCHAR(255),
  notes TEXT,
  
  -- Constraints
  CONSTRAINT repo_actions_registry_repository_version_unique 
    UNIQUE (repository, version),
  CONSTRAINT repo_actions_registry_content_check 
    CHECK (jsonb_typeof(content) = 'object')
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_repo_actions_registry_repository 
  ON repo_actions_registry(repository);
CREATE INDEX IF NOT EXISTS idx_repo_actions_registry_active 
  ON repo_actions_registry(active, repository);
CREATE INDEX IF NOT EXISTS idx_repo_actions_registry_registry_id 
  ON repo_actions_registry(registry_id);

-- Active registry pointer (one active registry per repository)
CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_actions_registry_active_repo 
  ON repo_actions_registry(repository) 
  WHERE active = true;

-- ========================================
-- Registry Action Audit Log
-- ========================================

CREATE TABLE IF NOT EXISTS registry_action_audit (
  id SERIAL PRIMARY KEY,
  
  -- Registry reference
  registry_id VARCHAR(255) NOT NULL,
  registry_version VARCHAR(50) NOT NULL,
  
  -- Action details
  action_type VARCHAR(50) NOT NULL, -- e.g., 'merge_pr', 'assign_issue'
  action_status VARCHAR(20) NOT NULL, -- 'allowed', 'blocked', 'pending_approval'
  
  -- Target resource
  repository VARCHAR(500) NOT NULL,
  resource_type VARCHAR(20) NOT NULL, -- 'issue', 'pull_request'
  resource_number INTEGER NOT NULL,
  
  -- Validation result
  validation_result JSONB NOT NULL, -- ActionValidationResult JSON
  
  -- Execution tracking
  executed_at TIMESTAMPTZ,
  executed_by VARCHAR(255),
  
  -- Evidence
  evidence_id UUID, -- Reference to evidence record if applicable
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT registry_action_audit_action_status_check 
    CHECK (action_status IN ('allowed', 'blocked', 'pending_approval')),
  CONSTRAINT registry_action_audit_resource_type_check 
    CHECK (resource_type IN ('issue', 'pull_request'))
);

-- Indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_registry_action_audit_registry 
  ON registry_action_audit(registry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registry_action_audit_resource 
  ON registry_action_audit(repository, resource_type, resource_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registry_action_audit_status 
  ON registry_action_audit(action_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registry_action_audit_action_type 
  ON registry_action_audit(action_type, created_at DESC);

-- ========================================
-- Registry Version History
-- ========================================

CREATE TABLE IF NOT EXISTS repo_actions_registry_history (
  id SERIAL PRIMARY KEY,
  
  -- Registry reference
  registry_id VARCHAR(255) NOT NULL,
  repository VARCHAR(500) NOT NULL,
  
  -- Version information
  old_version VARCHAR(50),
  new_version VARCHAR(50) NOT NULL,
  
  -- Change tracking
  change_type VARCHAR(20) NOT NULL, -- 'created', 'updated', 'activated', 'deactivated'
  change_description TEXT,
  content_snapshot JSONB NOT NULL,
  
  -- Metadata
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by VARCHAR(255) NOT NULL,
  
  -- Constraints
  CONSTRAINT registry_history_change_type_check 
    CHECK (change_type IN ('created', 'updated', 'activated', 'deactivated'))
);

-- Index for version history
CREATE INDEX IF NOT EXISTS idx_registry_history_registry 
  ON repo_actions_registry_history(registry_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_registry_history_repository 
  ON repo_actions_registry_history(repository, changed_at DESC);

-- ========================================
-- Functions
-- ========================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_repo_actions_registry_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for automatic timestamp updates
CREATE TRIGGER repo_actions_registry_update_timestamp
  BEFORE UPDATE ON repo_actions_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_repo_actions_registry_timestamp();

-- Function to log registry changes to history
CREATE OR REPLACE FUNCTION log_repo_actions_registry_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO repo_actions_registry_history (
      registry_id, repository, new_version, change_type,
      content_snapshot, changed_by
    ) VALUES (
      NEW.registry_id, NEW.repository, NEW.version, 'created',
      NEW.content, NEW.created_by
    );
  ELSIF TG_OP = 'UPDATE' THEN
    -- Log version change
    IF OLD.version != NEW.version THEN
      INSERT INTO repo_actions_registry_history (
        registry_id, repository, old_version, new_version, change_type,
        content_snapshot, changed_by
      ) VALUES (
        NEW.registry_id, NEW.repository, OLD.version, NEW.version, 'updated',
        NEW.content, COALESCE(NEW.updated_by, NEW.created_by)
      );
    END IF;
    
    -- Log activation/deactivation
    IF OLD.active != NEW.active THEN
      INSERT INTO repo_actions_registry_history (
        registry_id, repository, new_version, change_type,
        content_snapshot, changed_by
      ) VALUES (
        NEW.registry_id, NEW.repository, NEW.version, 
        CASE WHEN NEW.active THEN 'activated' ELSE 'deactivated' END,
        NEW.content, COALESCE(NEW.updated_by, NEW.created_by)
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for registry change history
CREATE TRIGGER repo_actions_registry_change_history
  AFTER INSERT OR UPDATE ON repo_actions_registry
  FOR EACH ROW
  EXECUTE FUNCTION log_repo_actions_registry_change();

-- Function to update registry_action_audit timestamp
CREATE OR REPLACE FUNCTION update_registry_action_audit_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for audit timestamp updates
CREATE TRIGGER registry_action_audit_update_timestamp
  BEFORE UPDATE ON registry_action_audit
  FOR EACH ROW
  EXECUTE FUNCTION update_registry_action_audit_timestamp();

-- ========================================
-- Views
-- ========================================

-- View for active registries
CREATE OR REPLACE VIEW active_repo_actions_registries AS
SELECT 
  id,
  registry_id,
  repository,
  version,
  content,
  fail_closed,
  created_at,
  created_by,
  updated_at,
  updated_by
FROM repo_actions_registry
WHERE active = true
ORDER BY repository;

-- View for recent registry actions
CREATE OR REPLACE VIEW recent_registry_actions AS
SELECT 
  id,
  action_type,
  action_status,
  repository,
  resource_type,
  resource_number,
  validation_result->>'allowed' AS allowed,
  validation_result->>'preconditionsMet' AS preconditions_met,
  validation_result->>'approvalRequired' AS approval_required,
  executed_at,
  executed_by,
  created_at
FROM registry_action_audit
ORDER BY created_at DESC
LIMIT 100;

-- ========================================
-- Seed Data: Default Registry
-- ========================================

-- Create default registry for codefactory-control repository
DO $$
DECLARE
  v_registry_id VARCHAR(255) := 'codefactory-control-default';
  v_repository VARCHAR(500) := 'adaefler-art/codefactory-control';
BEGIN
  -- Insert default registry if not exists
  INSERT INTO repo_actions_registry (
    registry_id,
    repository,
    version,
    content,
    active,
    fail_closed,
    created_by,
    notes
  )
  VALUES (
    v_registry_id,
    v_repository,
    '1.0.0',
    jsonb_build_object(
      'version', '1.0.0',
      'registryId', v_registry_id,
      'repository', v_repository,
      'allowedActions', jsonb_build_array(
        jsonb_build_object(
          'actionType', 'assign_issue',
          'enabled', true,
          'preconditions', jsonb_build_array(),
          'requireEvidence', true,
          'description', 'Assign GitHub Copilot or user to an issue'
        ),
        jsonb_build_object(
          'actionType', 'add_label',
          'enabled', true,
          'preconditions', jsonb_build_array(),
          'requireEvidence', true,
          'description', 'Add label to issue or PR'
        ),
        jsonb_build_object(
          'actionType', 'request_review',
          'enabled', true,
          'preconditions', jsonb_build_array(),
          'requireEvidence', true,
          'description', 'Request review on a PR'
        ),
        jsonb_build_object(
          'actionType', 'wait_for_checks',
          'enabled', true,
          'preconditions', jsonb_build_array(),
          'requireEvidence', true,
          'description', 'Wait for CI/CD checks to complete'
        ),
        jsonb_build_object(
          'actionType', 'rerun_checks',
          'enabled', true,
          'preconditions', jsonb_build_array(),
          'maxRetries', 3,
          'requireEvidence', true,
          'description', 'Rerun failed checks'
        ),
        jsonb_build_object(
          'actionType', 'merge_pr',
          'enabled', true,
          'preconditions', jsonb_build_array(
            jsonb_build_object('type', 'checks_passed', 'description', 'All required checks must pass'),
            jsonb_build_object('type', 'review_approved', 'description', 'PR must be approved'),
            jsonb_build_object('type', 'pr_mergeable', 'value', true, 'description', 'PR must be mergeable'),
            jsonb_build_object('type', 'pr_not_draft', 'value', true, 'description', 'PR must not be draft')
          ),
          'approvalRule', jsonb_build_object(
            'required', true,
            'minApprovers', 1,
            'requireCodeOwners', false
          ),
          'requireEvidence', true,
          'description', 'Merge PR with approval and checks passed'
        ),
        jsonb_build_object(
          'actionType', 'cleanup_branch',
          'enabled', true,
          'preconditions', jsonb_build_array(),
          'requireEvidence', true,
          'description', 'Delete merged branch'
        )
      ),
      'requiredChecks', jsonb_build_array(
        jsonb_build_object('name', 'CI', 'required', true, 'allowedStatuses', jsonb_build_array('success')),
        jsonb_build_object('name', 'Build', 'required', true, 'allowedStatuses', jsonb_build_array('success')),
        jsonb_build_object('name', 'Tests', 'required', true, 'allowedStatuses', jsonb_build_array('success'))
      ),
      'approvalRules', jsonb_build_object(
        'required', true,
        'minApprovers', 1,
        'requireCodeOwners', false,
        'dismissStaleReviews', false
      ),
      'mergePolicy', jsonb_build_object(
        'allowedMethods', jsonb_build_array('squash', 'merge'),
        'defaultMethod', 'squash',
        'requireLinearHistory', false,
        'requireUpToDateBranch', true,
        'autoMergeEnabled', false,
        'deleteBranchOnMerge', true
      ),
      'labelMappings', jsonb_build_array(
        jsonb_build_object('name', 'v0.8', 'semantic', 'version:0.8'),
        jsonb_build_object('name', 'epic:E83', 'semantic', 'epic:83'),
        jsonb_build_object('name', 'layer:A', 'semantic', 'layer:architecture'),
        jsonb_build_object('name', 'github', 'semantic', 'category:github'),
        jsonb_build_object('name', 'policy', 'semantic', 'category:policy')
      ),
      'createdAt', NOW()::text,
      'createdBy', 'system',
      'failClosed', true
    ),
    true,
    true,
    'system',
    'Default repository actions registry for codefactory-control'
  )
  ON CONFLICT (registry_id) DO NOTHING;
END $$;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE repo_actions_registry IS 
  'E83.1: Repository Actions Registry - machine-readable specification of automatable actions';

COMMENT ON TABLE registry_action_audit IS 
  'E83.1: Audit log for all action validation and execution decisions';

COMMENT ON TABLE repo_actions_registry_history IS 
  'E83.1: Version history for registry changes';

COMMENT ON VIEW active_repo_actions_registries IS 
  'E83.1: Currently active registries per repository';

COMMENT ON VIEW recent_registry_actions IS 
  'E83.1: Recent action validations and executions';
