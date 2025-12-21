#!/usr/bin/env node

/**
 * AFU-9 Workflow Failure Analyzer
 * 
 * Analyzes GitHub Actions workflow failures and provides AI-powered debugging suggestions.
 * Can be used standalone or as part of the automated debugging workflow.
 * 
 * Usage:
 *   node scripts/analyze-workflow-failure.js --run-id <run_id> [--ai]
 *   node scripts/analyze-workflow-failure.js --latest-failure [--ai]
 * 
 * Options:
 *   --run-id <id>        Analyze specific workflow run ID
 *   --latest-failure     Analyze the latest failed deploy-ecs workflow run
 *   --ai                 Reserved for future AI/LLM integration (not yet implemented)
 *   --create-issue       Create a GitHub issue with the analysis
 *   --verbose            Enable verbose logging
 * 
 * Environment Variables:
 *   GITHUB_TOKEN         Required for GitHub API access
 *   GITHUB_REPOSITORY    Format: owner/repo (auto-detected in Actions)
 *   OPENAI_API_KEY       Optional: Use OpenAI for AI analysis
 *   ANTHROPIC_API_KEY    Optional: Use Anthropic Claude for AI analysis
 */

const https = require('https');
const fs = require('fs');

// Configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPOSITORY || 'adaefler-art/codefactory-control';
const [OWNER, REPO] = GITHUB_REPO.split('/');

// Parse command line arguments (only when run directly, not when imported)
let runId = null;
let useLatestFailure = false;
let useAI = false;
let createIssue = false;
let verbose = false;

if (require.main === module) {
  const args = process.argv.slice(2);
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--run-id':
        runId = args[++i];
        break;
      case '--latest-failure':
        useLatestFailure = true;
        break;
      case '--ai':
        useAI = true;
        break;
      case '--create-issue':
        createIssue = true;
        break;
      case '--verbose':
        verbose = true;
        break;
      case '--help':
        console.log('Usage: node analyze-workflow-failure.js [options]');
        console.log('Options:');
        console.log('  --run-id <id>         Analyze specific workflow run ID');
        console.log('  --latest-failure      Analyze latest failed deploy-ecs run');
        console.log('  --ai                  Use AI for analysis');
        console.log('  --create-issue        Create GitHub issue with analysis');
        console.log('  --verbose             Enable verbose logging');
        process.exit(0);
    }
  }

  if (!GITHUB_TOKEN) {
    console.error('ERROR: GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }

  if (!runId && !useLatestFailure) {
    console.error('ERROR: Either --run-id or --latest-failure must be specified');
    console.error('Use --help for usage information');
    process.exit(1);
  }
}

// GitHub API helper
async function githubAPI(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'AFU9-Workflow-Debugger',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };

    if (body) {
      options.headers['Content-Type'] = 'application/json';
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`GitHub API error: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Find latest failed workflow run
async function findLatestFailedRun() {
  if (verbose) console.log('Searching for latest failed deploy-ecs workflow run...');
  
  const runs = await githubAPI(`/repos/${OWNER}/${REPO}/actions/workflows/deploy-ecs.yml/runs?status=failure&per_page=1`);
  
  if (runs.workflow_runs.length === 0) {
    throw new Error('No failed workflow runs found for deploy-ecs.yml');
  }
  
  return runs.workflow_runs[0].id;
}

// Get workflow run details
async function getWorkflowRunDetails(runId) {
  if (verbose) console.log(`Fetching workflow run ${runId}...`);
  return await githubAPI(`/repos/${OWNER}/${REPO}/actions/runs/${runId}`);
}

// Get jobs for workflow run
async function getWorkflowJobs(runId) {
  if (verbose) console.log(`Fetching jobs for run ${runId}...`);
  return await githubAPI(`/repos/${OWNER}/${REPO}/actions/runs/${runId}/jobs`);
}

// Analyze failures
function analyzeFailures(run, jobs) {
  const analysis = {
    run_id: run.id,
    run_number: run.run_number,
    run_url: run.html_url,
    conclusion: run.conclusion,
    created_at: run.created_at,
    updated_at: run.updated_at,
    head_branch: run.head_branch,
    head_sha: run.head_sha,
    triggering_actor: run.triggering_actor?.login,
    failed_jobs: [],
    error_patterns: [],
    recommendations: []
  };

  // Find failed jobs and steps
  const failedJobs = jobs.jobs.filter(job => job.conclusion === 'failure');
  
  for (const job of failedJobs) {
    const failedSteps = job.steps?.filter(step => step.conclusion === 'failure') || [];
    
    const jobAnalysis = {
      name: job.name,
      conclusion: job.conclusion,
      started_at: job.started_at,
      completed_at: job.completed_at,
      html_url: job.html_url,
      failed_steps: failedSteps.map(step => ({
        name: step.name,
        conclusion: step.conclusion,
        number: step.number
      }))
    };
    
    analysis.failed_jobs.push(jobAnalysis);
    
    // Pattern matching for common errors
    for (const step of failedSteps) {
      detectErrorPatterns(step.name, analysis);
    }
  }

  return analysis;
}

// Detect common error patterns
function detectErrorPatterns(stepName, analysis) {
  const patterns = [
    {
      pattern: /AWS.*credentials|Configure AWS/i,
      category: 'AWS Authentication',
      recommendation: 'Check AWS_DEPLOY_ROLE_ARN secret and OIDC configuration'
    },
    {
      pattern: /database.*migration|db:migrate/i,
      category: 'Database Migration',
      recommendation: 'Check database connectivity, migration scripts, and RDS security groups'
    },
    {
      pattern: /ECS.*service|Update ECS/i,
      category: 'ECS Deployment',
      recommendation: 'Check ECS service exists, task definition is valid, and IAM roles are correct'
    },
    {
      pattern: /task.*definition|Create.*task/i,
      category: 'Task Definition',
      recommendation: 'Verify task definition JSON, container images, and secret ARNs'
    },
    {
      pattern: /preflight|gate/i,
      category: 'Preflight Check',
      recommendation: 'Review preflight.sh output and CDK diff for infrastructure changes'
    },
    {
      pattern: /health|ready|readiness/i,
      category: 'Health Check',
      recommendation: 'Check ALB target health, container health checks, and application startup'
    },
    {
      pattern: /secret|Secrets Manager/i,
      category: 'Secrets Management',
      recommendation: 'Verify secrets exist in AWS Secrets Manager and have correct keys'
    },
    {
      pattern: /Docker|ECR|build.*push/i,
      category: 'Container Build',
      recommendation: 'Check Dockerfile, build context, and ECR permissions'
    }
  ];

  for (const p of patterns) {
    if (p.pattern.test(stepName)) {
      if (!analysis.error_patterns.find(ep => ep.category === p.category)) {
        analysis.error_patterns.push({
          category: p.category,
          detected_in: stepName
        });
        analysis.recommendations.push(p.recommendation);
      }
    }
  }
}

// Generate human-readable report
function generateReport(analysis) {
  let report = '# AFU-9 Deployment Failure Analysis\n\n';
  
  report += `**Workflow Run**: [#${analysis.run_number}](${analysis.run_url})\n`;
  report += `**Branch**: \`${analysis.head_branch}\`\n`;
  report += `**SHA**: \`${analysis.head_sha}\`\n`;
  report += `**Triggered by**: @${analysis.triggering_actor}\n`;
  report += `**Status**: ${analysis.conclusion}\n`;
  report += `**Created**: ${analysis.created_at}\n\n`;
  
  report += '## Failed Jobs\n\n';
  for (const job of analysis.failed_jobs) {
    report += `### ${job.name}\n\n`;
    report += `- **Status**: ${job.conclusion}\n`;
    report += `- [View Job Logs](${job.html_url})\n\n`;
    
    if (job.failed_steps.length > 0) {
      report += '**Failed Steps**:\n';
      for (const step of job.failed_steps) {
        report += `- ${step.number}. \`${step.name}\`\n`;
      }
      report += '\n';
    }
  }
  
  if (analysis.error_patterns.length > 0) {
    report += '## Detected Error Patterns\n\n';
    for (const pattern of analysis.error_patterns) {
      report += `- **${pattern.category}** (detected in: ${pattern.detected_in})\n`;
    }
    report += '\n';
  }
  
  if (analysis.recommendations.length > 0) {
    report += '## Recommendations\n\n';
    for (let i = 0; i < analysis.recommendations.length; i++) {
      report += `${i + 1}. ${analysis.recommendations[i]}\n`;
    }
    report += '\n';
  }
  
  report += '## Next Steps\n\n';
  report += '1. Review the [workflow run logs](' + analysis.run_url + ')\n';
  report += '2. Check the specific failed steps listed above\n';
  report += '3. Consult the deployment documentation:\n';
  report += '   - [Deployment Guide](../blob/main/docs/DEPLOYMENT_CONSOLIDATED.md)\n';
  report += '   - [Deploy System Prompt](../blob/main/docs/deploy/AFU9_DEPLOY_SYSTEM_PROMPT.md)\n';
  report += '   - [ECS Deployment Guide](../blob/main/docs/ECS-DEPLOYMENT.md)\n';
  report += '4. Use ECS debugging script: `./scripts/ecs_debug.ps1 -Service <service-name>`\n\n';
  
  report += '---\n';
  report += '*This analysis was generated by the AFU-9 automated debugging system.*\n';
  
  return report;
}

// Main execution
async function main() {
  try {
    // Determine which run to analyze
    if (useLatestFailure) {
      runId = await findLatestFailedRun();
      console.log(`Found latest failed run: ${runId}`);
    }
    
    // Fetch run details and jobs
    const run = await getWorkflowRunDetails(runId);
    const jobs = await getWorkflowJobs(runId);
    
    // Analyze failures
    const analysis = analyzeFailures(run, jobs);
    
    // Generate report
    const report = generateReport(analysis);
    
    // Save analysis to files
    fs.writeFileSync('workflow-failure-analysis.json', JSON.stringify(analysis, null, 2));
    fs.writeFileSync('workflow-failure-report.md', report);
    
    console.log('\n' + report);
    console.log('\n✅ Analysis saved to:');
    console.log('   - workflow-failure-analysis.json');
    console.log('   - workflow-failure-report.md');
    
    // Create issue if requested
    if (createIssue) {
      console.log('\n📝 Creating GitHub issue...');
      const issue = await githubAPI(`/repos/${OWNER}/${REPO}/issues`, 'POST', {
        title: `🔴 Deploy Failure: ${run.head_branch} (Run #${run.run_number})`,
        body: report,
        labels: ['deployment', 'automated-debugging', 'needs-triage']
      });
      console.log(`✅ Created issue #${issue.number}: ${issue.html_url}`);
    }
    
    // Exit with error code if there were failures
    process.exit(analysis.failed_jobs.length > 0 ? 1 : 0);
    
  } catch (error) {
    console.error('ERROR:', error.message);
    if (verbose) console.error(error.stack);
    process.exit(1);
  }
}

// Export functions for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    analyzeFailures,
    detectErrorPatterns,
    generateReport,
    githubAPI,
    findLatestFailedRun,
    getWorkflowRunDetails,
    getWorkflowJobs
  };
}

// Only run main if executed directly
if (require.main === module) {
  main();
}
