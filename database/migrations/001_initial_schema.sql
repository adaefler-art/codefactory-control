-- AFU-9 v0.2 Initial Database Schema
-- PostgreSQL 15+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ========================================
-- Workflows
-- ========================================

CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  definition JSONB NOT NULL,
  version INTEGER DEFAULT 1,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_workflows_name ON workflows(name);
CREATE INDEX idx_workflows_enabled ON workflows(enabled);

-- ========================================
-- Workflow Executions
-- ========================================

CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
  repository_id UUID,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  input JSONB,
  output JSONB,
  context JSONB,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  error TEXT,
  triggered_by VARCHAR(255),
  github_run_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_execution_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX idx_executions_workflow_id ON workflow_executions(workflow_id);
CREATE INDEX idx_executions_repository_id ON workflow_executions(repository_id);
CREATE INDEX idx_executions_status ON workflow_executions(status);
CREATE INDEX idx_executions_started_at ON workflow_executions(started_at DESC);

-- ========================================
-- Workflow Steps
-- ========================================

CREATE TABLE workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES workflow_executions(id) ON DELETE CASCADE,
  step_name VARCHAR(255) NOT NULL,
  step_index INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  input JSONB,
  output JSONB,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_step_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped'))
);

CREATE INDEX idx_steps_execution_id ON workflow_steps(execution_id);
CREATE INDEX idx_steps_status ON workflow_steps(status);
CREATE INDEX idx_steps_execution_step ON workflow_steps(execution_id, step_index);

-- ========================================
-- MCP Servers
-- ========================================

CREATE TABLE mcp_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  endpoint VARCHAR(500) NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  config JSONB,
  health_check_url VARCHAR(500),
  last_health_check TIMESTAMP,
  health_status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_mcp_servers_name ON mcp_servers(name);
CREATE INDEX idx_mcp_servers_enabled ON mcp_servers(enabled);

-- Insert default MCP servers
INSERT INTO mcp_servers (name, description, endpoint, enabled, health_check_url) VALUES
  ('github', 'GitHub operations MCP server', 'http://localhost:3001', true, 'http://localhost:3001/health'),
  ('deploy', 'AWS ECS deployment MCP server', 'http://localhost:3002', true, 'http://localhost:3002/health'),
  ('observability', 'CloudWatch observability MCP server', 'http://localhost:3003', true, 'http://localhost:3003/health');

-- ========================================
-- Repositories
-- ========================================

CREATE TABLE repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  full_name VARCHAR(511) GENERATED ALWAYS AS (owner || '/' || name) STORED,
  default_branch VARCHAR(255) DEFAULT 'main',
  enabled BOOLEAN DEFAULT TRUE,
  config JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(owner, name)
);

CREATE INDEX idx_repos_owner_name ON repositories(owner, name);
CREATE INDEX idx_repos_enabled ON repositories(enabled);
CREATE INDEX idx_repos_full_name ON repositories(full_name);

-- ========================================
-- Agent Runs
-- ========================================

CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES workflow_executions(id) ON DELETE CASCADE,
  step_id UUID REFERENCES workflow_steps(id) ON DELETE CASCADE,
  agent_type VARCHAR(100) NOT NULL,
  model VARCHAR(100),
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER,
  cost_usd DECIMAL(10, 6),
  input JSONB,
  output JSONB,
  tool_calls JSONB,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_agent_runs_execution_id ON agent_runs(execution_id);
CREATE INDEX idx_agent_runs_agent_type ON agent_runs(agent_type);
CREATE INDEX idx_agent_runs_started_at ON agent_runs(started_at DESC);

-- ========================================
-- MCP Tool Calls
-- ========================================

CREATE TABLE mcp_tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES workflow_executions(id) ON DELETE CASCADE,
  agent_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  server_name VARCHAR(255) NOT NULL,
  tool_name VARCHAR(255) NOT NULL,
  params JSONB,
  result JSONB,
  error TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tool_calls_execution_id ON mcp_tool_calls(execution_id);
CREATE INDEX idx_tool_calls_server_tool ON mcp_tool_calls(server_name, tool_name);
CREATE INDEX idx_tool_calls_started_at ON mcp_tool_calls(started_at DESC);

-- ========================================
-- Update Triggers
-- ========================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers to tables with updated_at
CREATE TRIGGER update_workflows_updated_at BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workflow_executions_updated_at BEFORE UPDATE ON workflow_executions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workflow_steps_updated_at BEFORE UPDATE ON workflow_steps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mcp_servers_updated_at BEFORE UPDATE ON mcp_servers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_repositories_updated_at BEFORE UPDATE ON repositories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- Initial Data
-- ========================================

-- Example workflow: Issue to PR
INSERT INTO workflows (name, description, definition, enabled) VALUES (
  'issue_to_pr',
  'Convert a GitHub issue into a pull request with automated fix',
  '{
    "steps": [
      {
        "name": "fetch_issue",
        "tool": "github.getIssue",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "number": "${input.issue_number}"
        },
        "assign": "issue"
      },
      {
        "name": "create_branch",
        "tool": "github.createBranch",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "branch": "fix/${issue.number}",
          "from": "${repo.default_branch}"
        },
        "assign": "branch"
      },
      {
        "name": "create_pull_request",
        "tool": "github.createPullRequest",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "title": "Fix: ${issue.title}",
          "body": "Automated fix for #${issue.number}\n\n${issue.body}",
          "head": "fix/${issue.number}",
          "base": "${repo.default_branch}"
        },
        "assign": "pull_request"
      }
    ]
  }'::jsonb,
  true
);

-- Grant permissions (adjust user as needed)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO afu9_admin;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO afu9_admin;
