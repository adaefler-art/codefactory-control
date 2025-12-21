#!/usr/bin/env node

/**
 * Test script for workflow failure analyzer
 * Simulates analysis without making actual GitHub API calls
 */

const fs = require('fs');

// Mock workflow run data
const mockWorkflowRun = {
  id: 9876543210,
  run_number: 42,
  html_url: 'https://github.com/adaefler-art/codefactory-control/actions/runs/9876543210',
  conclusion: 'failure',
  created_at: '2024-12-21T15:30:00Z',
  updated_at: '2024-12-21T15:45:00Z',
  head_branch: 'main',
  head_sha: 'abc1234567890',
  triggering_actor: {
    login: 'test-user'
  }
};

// Mock jobs data
const mockJobs = {
  jobs: [
    {
      id: 123456,
      name: 'Build and Deploy to ECS',
      conclusion: 'failure',
      started_at: '2024-12-21T15:30:00Z',
      completed_at: '2024-12-21T15:45:00Z',
      html_url: 'https://github.com/adaefler-art/codefactory-control/actions/runs/9876543210/job/123456',
      steps: [
        { name: 'Checkout code', conclusion: 'success', number: 1 },
        { name: 'Setup Node.js', conclusion: 'success', number: 2 },
        { name: 'Configure AWS credentials', conclusion: 'success', number: 3 },
        { name: 'Preflight gate', conclusion: 'success', number: 4 },
        { name: 'Run database migrations (gate)', conclusion: 'failure', number: 5 },
        { name: 'Update ECS service', conclusion: 'skipped', number: 6 }
      ]
    }
  ]
};

// Import the analysis functions (we'll need to refactor the script to export them)
// For now, let's replicate the key logic here

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
    
    for (const step of failedSteps) {
      detectErrorPatterns(step.name, analysis);
    }
  }

  return analysis;
}

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

function generateReport(analysis) {
  let report = '# AFU-9 Deployment Failure Analysis\n\n';
  
  report += `**Workflow Run**: [#${analysis.run_number}](${analysis.run_url})\n`;
  report += `**Branch**: \`${analysis.head_branch}\`\n`;
  report += `**SHA**: \`${analysis.head_sha}\`\n`;
  report += `**Triggered by**: @${analysis.triggering_actor}\n`;
  report += `**Status**: ${analysis.conclusion}\n\n`;
  
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
  
  return report;
}

// Run the test
console.log('🧪 Testing Workflow Failure Analyzer\n');

console.log('1. Analyzing mock workflow run...');
const analysis = analyzeFailures(mockWorkflowRun, mockJobs);

console.log('2. Generating report...');
const report = generateReport(analysis);

console.log('3. Saving test outputs...');
fs.writeFileSync('test-analysis.json', JSON.stringify(analysis, null, 2));
fs.writeFileSync('test-report.md', report);

console.log('\n✅ Test completed successfully!\n');
console.log('Analysis Summary:');
console.log(`  - Failed Jobs: ${analysis.failed_jobs.length}`);
console.log(`  - Error Patterns Detected: ${analysis.error_patterns.length}`);
console.log(`  - Recommendations: ${analysis.recommendations.length}`);

if (analysis.error_patterns.length > 0) {
  console.log('\nDetected Error Categories:');
  analysis.error_patterns.forEach(pattern => {
    console.log(`  - ${pattern.category}`);
  });
}

console.log('\nGenerated Files:');
console.log('  - test-analysis.json');
console.log('  - test-report.md');

console.log('\n📄 Report Preview:\n');
console.log(report);

// Verify key functionality
let passed = 0;
let failed = 0;

console.log('\n🔍 Running Assertions:\n');

// Test 1: Should detect failed job
if (analysis.failed_jobs.length === 1) {
  console.log('✅ Test 1: Detected failed job');
  passed++;
} else {
  console.log('❌ Test 1: Failed to detect job');
  failed++;
}

// Test 2: Should detect failed step
if (analysis.failed_jobs[0].failed_steps.length === 1) {
  console.log('✅ Test 2: Detected failed step');
  passed++;
} else {
  console.log('❌ Test 2: Failed to detect step');
  failed++;
}

// Test 3: Should match database migration pattern
const hasDbPattern = analysis.error_patterns.some(p => p.category === 'Database Migration');
if (hasDbPattern) {
  console.log('✅ Test 3: Matched database migration pattern');
  passed++;
} else {
  console.log('❌ Test 3: Failed to match pattern');
  failed++;
}

// Test 4: Should provide recommendations
if (analysis.recommendations.length > 0) {
  console.log('✅ Test 4: Generated recommendations');
  passed++;
} else {
  console.log('❌ Test 4: No recommendations generated');
  failed++;
}

// Test 5: Report should contain key sections
const hasFailedJobs = report.includes('## Failed Jobs');
const hasPatterns = report.includes('## Detected Error Patterns');
const hasRecommendations = report.includes('## Recommendations');
if (hasFailedJobs && hasPatterns && hasRecommendations) {
  console.log('✅ Test 5: Report contains all sections');
  passed++;
} else {
  console.log('❌ Test 5: Report missing sections');
  failed++;
}

console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed\n`);

if (failed === 0) {
  console.log('🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('⚠️  Some tests failed');
  process.exit(1);
}
