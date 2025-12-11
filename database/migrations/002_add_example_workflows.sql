-- AFU-9 v0.2 Example Workflows Migration
-- PostgreSQL 15+
-- 
-- This migration adds example workflows for common AFU-9 use cases:
-- 1. fix_deploy_failure - Diagnose and fix deployment failures
-- 2. pr_review_workflow - Automated PR review and feedback
-- 3. ci_failure_handler - Handle CI/CD pipeline failures

-- ========================================
-- Example Workflow: fix_deploy_failure
-- ========================================

INSERT INTO workflows (name, description, definition, enabled) VALUES (
  'fix_deploy_failure',
  'Diagnose and fix deployment failures by analyzing logs and creating a fix PR',
  '{
    "steps": [
      {
        "name": "get_service_status",
        "tool": "deploy.getServiceStatus",
        "params": {
          "cluster": "${input.cluster}",
          "service": "${input.service}"
        },
        "assign": "service_status"
      },
      {
        "name": "fetch_logs",
        "tool": "observability.getServiceLogs",
        "params": {
          "logGroup": "/ecs/${input.cluster}/${input.service}",
          "startTime": "${input.failure_time}",
          "limit": 100
        },
        "assign": "logs"
      },
      {
        "name": "analyze_failure",
        "tool": "agent.analyze",
        "params": {
          "prompt": "Analyze these deployment logs and identify the root cause: ${logs}",
          "context": {
            "service": "${input.service}",
            "cluster": "${input.cluster}",
            "status": "${service_status}"
          }
        },
        "assign": "analysis"
      },
      {
        "name": "create_fix_branch",
        "tool": "github.createBranch",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "branch": "fix/deploy-${input.service}",
          "from": "${repo.default_branch}"
        },
        "assign": "fix_branch"
      },
      {
        "name": "create_fix_pr",
        "tool": "github.createPullRequest",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "title": "Fix: ${input.service} deployment failure",
          "body": "Automated fix for deployment failure\\n\\n## Analysis\\n${analysis.description}\\n\\n## Root Cause\\n${analysis.root_cause}\\n\\n## Proposed Fix\\n${analysis.fix_description}",
          "head": "fix/deploy-${input.service}",
          "base": "${repo.default_branch}",
          "labels": ["automated-fix", "deployment"]
        },
        "assign": "fix_pr"
      },
      {
        "name": "rollback_deployment",
        "tool": "deploy.rollbackService",
        "params": {
          "cluster": "${input.cluster}",
          "service": "${input.service}",
          "targetRevision": "${service_status.previous_revision}"
        },
        "assign": "rollback_result"
      }
    ]
  }'::jsonb,
  true
);

-- ========================================
-- Example Workflow: pr_review_workflow
-- ========================================

INSERT INTO workflows (name, description, definition, enabled) VALUES (
  'pr_review_workflow',
  'Automatically review pull requests and provide feedback',
  '{
    "steps": [
      {
        "name": "fetch_pr",
        "tool": "github.getPullRequest",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "number": "${input.pr_number}"
        },
        "assign": "pr"
      },
      {
        "name": "get_pr_diff",
        "tool": "github.getPRDiff",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "number": "${input.pr_number}"
        },
        "assign": "diff"
      },
      {
        "name": "get_pr_files",
        "tool": "github.getPRFiles",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "number": "${input.pr_number}"
        },
        "assign": "files"
      },
      {
        "name": "code_review",
        "tool": "agent.reviewCode",
        "params": {
          "diff": "${diff}",
          "files": "${files}",
          "context": {
            "title": "${pr.title}",
            "description": "${pr.body}",
            "author": "${pr.user.login}"
          }
        },
        "assign": "review"
      },
      {
        "name": "post_review_comment",
        "tool": "github.createReviewComment",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "number": "${input.pr_number}",
          "body": "${review.summary}",
          "event": "COMMENT"
        }
      }
    ]
  }'::jsonb,
  true
);

-- ========================================
-- Example Workflow: ci_failure_handler
-- ========================================

INSERT INTO workflows (name, description, definition, enabled) VALUES (
  'ci_failure_handler',
  'Handle CI/CD pipeline failures by analyzing errors and attempting fixes',
  '{
    "steps": [
      {
        "name": "fetch_workflow_run",
        "tool": "github.getWorkflowRun",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "runId": "${input.run_id}"
        },
        "assign": "workflow_run"
      },
      {
        "name": "fetch_failed_jobs",
        "tool": "github.getWorkflowJobs",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "runId": "${input.run_id}",
          "filter": "failed"
        },
        "assign": "failed_jobs"
      },
      {
        "name": "get_job_logs",
        "tool": "github.getJobLogs",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "jobId": "${failed_jobs[0].id}"
        },
        "assign": "logs"
      },
      {
        "name": "analyze_failure",
        "tool": "agent.analyze",
        "params": {
          "prompt": "Analyze this CI failure and suggest a fix: ${logs}",
          "context": {
            "workflow": "${workflow_run.name}",
            "branch": "${workflow_run.head_branch}",
            "commit": "${workflow_run.head_sha}"
          }
        },
        "assign": "analysis"
      },
      {
        "name": "create_fix_branch",
        "tool": "github.createBranch",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "branch": "fix/ci-${workflow_run.id}",
          "from": "${workflow_run.head_branch}"
        },
        "assign": "fix_branch"
      },
      {
        "name": "apply_fix",
        "tool": "agent.applyFix",
        "params": {
          "branch": "fix/ci-${workflow_run.id}",
          "fix": "${analysis.fix_instructions}",
          "context": {
            "logs": "${logs}",
            "files": "${analysis.affected_files}"
          }
        },
        "assign": "fix_result"
      },
      {
        "name": "create_fix_pr",
        "tool": "github.createPullRequest",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "title": "Fix: CI failure in ${workflow_run.name}",
          "body": "Automated fix for CI failure\\n\\n## Failed Job\\n${failed_jobs[0].name}\\n\\n## Analysis\\n${analysis.description}\\n\\n## Fix Applied\\n${analysis.fix_description}",
          "head": "fix/ci-${workflow_run.id}",
          "base": "${workflow_run.head_branch}",
          "labels": ["automated-fix", "ci"]
        },
        "assign": "fix_pr"
      },
      {
        "name": "add_pr_comment",
        "tool": "github.createIssueComment",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "issueNumber": "${fix_pr.number}",
          "body": "🤖 Automated CI fix created. Please review the changes before merging.\\n\\nOriginal failure: ${workflow_run.html_url}"
        }
      }
    ]
  }'::jsonb,
  true
);

-- ========================================
-- Example Workflow: issue_triage
-- ========================================

INSERT INTO workflows (name, description, definition, enabled) VALUES (
  'issue_triage',
  'Automatically triage and label incoming GitHub issues',
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
        "name": "classify_issue",
        "tool": "agent.classifyIssue",
        "params": {
          "title": "${issue.title}",
          "body": "${issue.body}",
          "labels": "${issue.labels}"
        },
        "assign": "classification"
      },
      {
        "name": "add_labels",
        "tool": "github.addLabels",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "issueNumber": "${input.issue_number}",
          "labels": "${classification.suggested_labels}"
        }
      },
      {
        "name": "set_priority",
        "tool": "github.updateIssue",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "issueNumber": "${input.issue_number}",
          "milestone": "${classification.milestone}"
        }
      },
      {
        "name": "add_triage_comment",
        "tool": "github.createIssueComment",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "issueNumber": "${input.issue_number}",
          "body": "🤖 **Automated Triage**\\n\\n**Type:** ${classification.type}\\n**Priority:** ${classification.priority}\\n**Category:** ${classification.category}\\n\\n${classification.notes}"
        }
      }
    ]
  }'::jsonb,
  true
);

-- ========================================
-- Example Workflow: dependency_update
-- ========================================

INSERT INTO workflows (name, description, definition, enabled) VALUES (
  'dependency_update',
  'Automatically update project dependencies and create PR',
  '{
    "steps": [
      {
        "name": "create_update_branch",
        "tool": "github.createBranch",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "branch": "chore/dependency-update-${input.timestamp}",
          "from": "${repo.default_branch}"
        },
        "assign": "update_branch"
      },
      {
        "name": "check_updates",
        "tool": "agent.checkDependencies",
        "params": {
          "branch": "chore/dependency-update-${input.timestamp}",
          "packageManager": "${input.package_manager}"
        },
        "assign": "updates"
      },
      {
        "name": "apply_updates",
        "tool": "agent.updateDependencies",
        "params": {
          "branch": "chore/dependency-update-${input.timestamp}",
          "updates": "${updates.available}",
          "strategy": "${input.update_strategy}"
        },
        "assign": "update_result"
      },
      {
        "name": "run_tests",
        "tool": "github.triggerWorkflow",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "workflow": "test.yml",
          "ref": "chore/dependency-update-${input.timestamp}"
        },
        "assign": "test_run"
      },
      {
        "name": "create_pr",
        "tool": "github.createPullRequest",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "title": "chore: Update dependencies",
          "body": "Automated dependency update\\n\\n## Updated Packages\\n${update_result.summary}\\n\\n## Breaking Changes\\n${update_result.breaking_changes}\\n\\n## Test Results\\nTest run: ${test_run.html_url}",
          "head": "chore/dependency-update-${input.timestamp}",
          "base": "${repo.default_branch}",
          "labels": ["dependencies", "automated"]
        },
        "assign": "update_pr"
      }
    ]
  }'::jsonb,
  true
);

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE workflows IS 'Workflow definitions (templates) for AFU-9 orchestration';
COMMENT ON COLUMN workflows.definition IS 'JSONB workflow definition with steps, params, and config';
COMMENT ON COLUMN workflows.version IS 'Workflow version number for tracking changes';
COMMENT ON COLUMN workflows.enabled IS 'Whether this workflow can be executed';

-- Update the existing issue_to_pr workflow with better description
UPDATE workflows 
SET description = 'Convert a GitHub issue into a pull request with automated fix - basic workflow example'
WHERE name = 'issue_to_pr';
