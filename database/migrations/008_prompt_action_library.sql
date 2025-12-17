-- Migration 008: Prompt & Action Library
-- Implements EPIC 6: Prompt & Action Canon for Factory Intelligence
--
-- This migration creates tables for versioned prompts, actions, and their usage tracking
-- to enable transparency, quality control, and stability in Factory intelligence operations.

-- ========================================
-- Prompt Library
-- ========================================

-- Main prompts table: stores prompt definitions
CREATE TABLE prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  category VARCHAR(100) NOT NULL,
  description TEXT,
  purpose TEXT,
  current_version_id UUID,
  deprecated BOOLEAN DEFAULT FALSE,
  deprecated_at TIMESTAMP,
  deprecation_reason TEXT,
  replacement_prompt_id UUID,
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_replacement_prompt FOREIGN KEY (replacement_prompt_id) 
    REFERENCES prompts(id) ON DELETE SET NULL
);

CREATE INDEX idx_prompts_name ON prompts(name);
CREATE INDEX idx_prompts_category ON prompts(category);
CREATE INDEX idx_prompts_deprecated ON prompts(deprecated);

-- Prompt versions table: stores each version of a prompt
CREATE TABLE prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  version VARCHAR(50) NOT NULL, -- Semantic version: major.minor.patch
  content TEXT NOT NULL,
  system_prompt TEXT,
  user_prompt_template TEXT,
  variables JSONB, -- Expected variables for template substitution
  model_config JSONB, -- Default model configuration (temperature, max_tokens, etc.)
  change_type VARCHAR(50) NOT NULL, -- 'major', 'minor', 'patch'
  change_description TEXT NOT NULL,
  breaking_changes TEXT, -- Description of breaking changes for major versions
  migration_guide TEXT, -- How to migrate from previous version
  validated BOOLEAN DEFAULT FALSE,
  validation_results JSONB,
  published BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMP,
  published_by VARCHAR(255),
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(prompt_id, version),
  CONSTRAINT chk_change_type CHECK (change_type IN ('major', 'minor', 'patch'))
);

CREATE INDEX idx_prompt_versions_prompt_id ON prompt_versions(prompt_id);
CREATE INDEX idx_prompt_versions_version ON prompt_versions(version);
CREATE INDEX idx_prompt_versions_published ON prompt_versions(published);
CREATE INDEX idx_prompt_versions_created_at ON prompt_versions(created_at DESC);

-- Add foreign key from prompts to current version
ALTER TABLE prompts ADD CONSTRAINT fk_current_version 
  FOREIGN KEY (current_version_id) REFERENCES prompt_versions(id) ON DELETE SET NULL;

-- ========================================
-- Action Registry
-- ========================================

-- Actions table: stores action definitions (tool/function definitions)
CREATE TABLE actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  category VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  current_version_id UUID,
  deprecated BOOLEAN DEFAULT FALSE,
  deprecated_at TIMESTAMP,
  deprecation_reason TEXT,
  replacement_action_id UUID,
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_replacement_action FOREIGN KEY (replacement_action_id) 
    REFERENCES actions(id) ON DELETE SET NULL
);

CREATE INDEX idx_actions_name ON actions(name);
CREATE INDEX idx_actions_category ON actions(category);
CREATE INDEX idx_actions_deprecated ON actions(deprecated);

-- Action versions table: stores each version of an action
CREATE TABLE action_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  version VARCHAR(50) NOT NULL, -- Semantic version: major.minor.patch
  tool_reference VARCHAR(255) NOT NULL, -- e.g., "github.createIssue"
  input_schema JSONB NOT NULL, -- JSON Schema for input parameters
  output_schema JSONB, -- JSON Schema for output
  change_type VARCHAR(50) NOT NULL,
  change_description TEXT NOT NULL,
  breaking_changes TEXT,
  migration_guide TEXT,
  validated BOOLEAN DEFAULT FALSE,
  validation_results JSONB,
  published BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMP,
  published_by VARCHAR(255),
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(action_id, version),
  CONSTRAINT chk_action_change_type CHECK (change_type IN ('major', 'minor', 'patch'))
);

CREATE INDEX idx_action_versions_action_id ON action_versions(action_id);
CREATE INDEX idx_action_versions_version ON action_versions(version);
CREATE INDEX idx_action_versions_published ON action_versions(published);
CREATE INDEX idx_action_versions_created_at ON action_versions(created_at DESC);

-- Add foreign key from actions to current version
ALTER TABLE actions ADD CONSTRAINT fk_action_current_version 
  FOREIGN KEY (current_version_id) REFERENCES action_versions(id) ON DELETE SET NULL;

-- ========================================
-- Prompt Usage Tracking
-- ========================================

-- Track prompt usage in agent runs for traceability
ALTER TABLE agent_runs ADD COLUMN prompt_version_id UUID REFERENCES prompt_versions(id) ON DELETE SET NULL;
ALTER TABLE agent_runs ADD COLUMN prompt_content TEXT; -- Snapshot of prompt used
ALTER TABLE agent_runs ADD COLUMN prompt_variables JSONB; -- Variables used in prompt

CREATE INDEX idx_agent_runs_prompt_version ON agent_runs(prompt_version_id);

-- ========================================
-- Action Usage Tracking
-- ========================================

-- Track action versions used in tool calls
ALTER TABLE mcp_tool_calls ADD COLUMN action_version_id UUID REFERENCES action_versions(id) ON DELETE SET NULL;

CREATE INDEX idx_tool_calls_action_version ON mcp_tool_calls(action_version_id);

-- ========================================
-- Prompt Stability Metrics View
-- ========================================

-- View to track prompt stability and usage metrics
CREATE OR REPLACE VIEW prompt_stability_metrics AS
SELECT 
  p.id AS prompt_id,
  p.name AS prompt_name,
  p.category,
  pv.version AS current_version,
  pv.published_at AS current_version_published_at,
  COUNT(DISTINCT ar.id) AS total_uses,
  COUNT(DISTINCT DATE(ar.started_at)) AS days_used,
  COUNT(DISTINCT ar.execution_id) AS executions_using_prompt,
  MAX(ar.started_at) AS last_used_at,
  MIN(ar.started_at) AS first_used_at,
  (
    SELECT COUNT(*) 
    FROM prompt_versions pv2 
    WHERE pv2.prompt_id = p.id AND pv2.published = true
  ) AS version_count,
  (
    SELECT MAX(created_at) 
    FROM prompt_versions pv3 
    WHERE pv3.prompt_id = p.id AND pv3.change_type = 'major'
  ) AS last_breaking_change_at,
  p.deprecated AS is_deprecated
FROM prompts p
LEFT JOIN prompt_versions pv ON p.current_version_id = pv.id
LEFT JOIN agent_runs ar ON ar.prompt_version_id = pv.id
GROUP BY p.id, p.name, p.category, pv.version, pv.published_at, p.deprecated;

-- View for action usage metrics
CREATE OR REPLACE VIEW action_usage_metrics AS
SELECT 
  a.id AS action_id,
  a.name AS action_name,
  a.category,
  av.version AS current_version,
  av.published_at AS current_version_published_at,
  COUNT(DISTINCT tc.id) AS total_calls,
  COUNT(DISTINCT DATE(tc.started_at)) AS days_called,
  COUNT(DISTINCT tc.execution_id) AS executions_using_action,
  MAX(tc.started_at) AS last_called_at,
  MIN(tc.started_at) AS first_called_at,
  AVG(tc.duration_ms) AS avg_duration_ms,
  COUNT(CASE WHEN tc.error IS NOT NULL THEN 1 END) AS error_count,
  (
    SELECT COUNT(*) 
    FROM action_versions av2 
    WHERE av2.action_id = a.id AND av2.published = true
  ) AS version_count,
  a.deprecated AS is_deprecated
FROM actions a
LEFT JOIN action_versions av ON a.current_version_id = av.id
LEFT JOIN mcp_tool_calls tc ON tc.action_version_id = av.id
GROUP BY a.id, a.name, a.category, av.version, av.published_at, a.deprecated;

-- ========================================
-- Update Triggers
-- ========================================

CREATE TRIGGER update_prompts_updated_at BEFORE UPDATE ON prompts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_actions_updated_at BEFORE UPDATE ON actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- Seed Data: Example Prompts
-- ========================================

-- Example: Issue Analysis Prompt
INSERT INTO prompts (name, category, description, purpose, created_by) VALUES (
  'issue_analyzer',
  'analysis',
  'Analyzes GitHub issues to determine scope, complexity, and suggested fixes',
  'Used by the issue interpretation step to understand issue requirements and generate specifications',
  'system'
) RETURNING id AS prompt_id \gset

INSERT INTO prompt_versions (
  prompt_id, version, content, system_prompt, user_prompt_template,
  variables, model_config, change_type, change_description, 
  validated, published, published_at, created_by
) VALUES (
  :'prompt_id', '1.0.0',
  'You are an expert software engineer analyzing GitHub issues for the AFU-9 autonomous code fabrication system.',
  'You are an expert software engineer analyzing GitHub issues for the AFU-9 autonomous code fabrication system. Your task is to analyze the issue and provide a structured assessment including scope, complexity, and suggested implementation approach.',
  'Analyze the following GitHub issue:\n\nTitle: ${title}\nBody: ${body}\n\nLabels: ${labels}\n\nProvide a structured analysis including:\n1. Issue scope and requirements\n2. Estimated complexity (low/medium/high)\n3. Suggested implementation approach\n4. Potential risks or dependencies',
  '{"title": "Issue title", "body": "Issue description", "labels": "Comma-separated labels"}'::jsonb,
  '{"temperature": 0.2, "max_tokens": 2000}'::jsonb,
  'major', 'Initial version of issue analyzer prompt',
  true, true, NOW(), 'system'
) RETURNING id AS version_id \gset

UPDATE prompts SET current_version_id = :'version_id' WHERE id = :'prompt_id';

-- Example: Code Review Prompt
INSERT INTO prompts (name, category, description, purpose, created_by) VALUES (
  'code_reviewer',
  'review',
  'Reviews code changes and provides feedback on quality, style, and potential issues',
  'Used in PR review workflows to provide automated code review feedback',
  'system'
) RETURNING id AS prompt_id \gset

INSERT INTO prompt_versions (
  prompt_id, version, content, system_prompt, user_prompt_template,
  variables, model_config, change_type, change_description,
  validated, published, published_at, created_by
) VALUES (
  :'prompt_id', '1.0.0',
  'You are an expert code reviewer for the AFU-9 system.',
  'You are an expert code reviewer. Analyze the provided code changes and provide constructive feedback focusing on correctness, performance, security, and maintainability.',
  'Review the following code changes:\n\n${diff}\n\nContext:\nPR Title: ${pr_title}\nDescription: ${pr_description}\n\nProvide feedback on:\n1. Code correctness and logic\n2. Potential bugs or edge cases\n3. Security concerns\n4. Performance considerations\n5. Code style and best practices',
  '{"diff": "Git diff content", "pr_title": "PR title", "pr_description": "PR description"}'::jsonb,
  '{"temperature": 0.3, "max_tokens": 3000}'::jsonb,
  'major', 'Initial version of code reviewer prompt',
  true, true, NOW(), 'system'
) RETURNING id AS version_id \gset

UPDATE prompts SET current_version_id = :'version_id' WHERE id = :'prompt_id';

-- ========================================
-- Seed Data: Example Actions
-- ========================================

-- Example: Create GitHub Issue Action
INSERT INTO actions (name, category, description, created_by) VALUES (
  'create_github_issue',
  'github',
  'Creates a new GitHub issue in a repository',
  'system'
) RETURNING id AS action_id \gset

INSERT INTO action_versions (
  action_id, version, tool_reference, input_schema, output_schema,
  change_type, change_description, validated, published, published_at, created_by
) VALUES (
  :'action_id', '1.0.0', 'github.createIssue',
  '{
    "type": "object",
    "properties": {
      "owner": {"type": "string", "description": "Repository owner"},
      "repo": {"type": "string", "description": "Repository name"},
      "title": {"type": "string", "description": "Issue title"},
      "body": {"type": "string", "description": "Issue body/description"},
      "labels": {"type": "array", "items": {"type": "string"}, "description": "Issue labels"}
    },
    "required": ["owner", "repo", "title"]
  }'::jsonb,
  '{
    "type": "object",
    "properties": {
      "number": {"type": "integer", "description": "Issue number"},
      "url": {"type": "string", "description": "Issue URL"},
      "html_url": {"type": "string", "description": "Issue HTML URL"}
    }
  }'::jsonb,
  'major', 'Initial version of create GitHub issue action',
  true, true, NOW(), 'system'
) RETURNING id AS version_id \gset

UPDATE actions SET current_version_id = :'version_id' WHERE id = :'action_id';

-- Example: Create Pull Request Action
INSERT INTO actions (name, category, description, created_by) VALUES (
  'create_pull_request',
  'github',
  'Creates a new pull request in a repository',
  'system'
) RETURNING id AS action_id \gset

INSERT INTO action_versions (
  action_id, version, tool_reference, input_schema, output_schema,
  change_type, change_description, validated, published, published_at, created_by
) VALUES (
  :'action_id', '1.0.0', 'github.createPullRequest',
  '{
    "type": "object",
    "properties": {
      "owner": {"type": "string", "description": "Repository owner"},
      "repo": {"type": "string", "description": "Repository name"},
      "title": {"type": "string", "description": "PR title"},
      "body": {"type": "string", "description": "PR body/description"},
      "head": {"type": "string", "description": "Head branch"},
      "base": {"type": "string", "description": "Base branch"}
    },
    "required": ["owner", "repo", "title", "head", "base"]
  }'::jsonb,
  '{
    "type": "object",
    "properties": {
      "number": {"type": "integer", "description": "PR number"},
      "url": {"type": "string", "description": "PR URL"},
      "html_url": {"type": "string", "description": "PR HTML URL"}
    }
  }'::jsonb,
  'major', 'Initial version of create pull request action',
  true, true, NOW(), 'system'
) RETURNING id AS version_id \gset

UPDATE actions SET current_version_id = :'version_id' WHERE id = :'action_id';

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE prompts IS 'Prompt library: versioned prompts for Factory intelligence operations';
COMMENT ON TABLE prompt_versions IS 'Version history for prompts with semantic versioning';
COMMENT ON TABLE actions IS 'Action registry: versioned action/tool definitions';
COMMENT ON TABLE action_versions IS 'Version history for actions with schema definitions';
COMMENT ON VIEW prompt_stability_metrics IS 'KPI metrics for prompt stability and usage tracking';
COMMENT ON VIEW action_usage_metrics IS 'Usage metrics and performance tracking for actions';
