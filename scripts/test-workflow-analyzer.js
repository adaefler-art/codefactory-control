#!/usr/bin/env node

/**
 * Test script for workflow failure analyzer
 * Tests the analysis logic by importing functions from the main script
 */

const fs = require('fs');
const path = require('path');

const { getDocsOutputDir } = require('./docs/get-docs-output-dir');

// Import analysis functions from the main script
const analyzer = require('./analyze-workflow-failure.js');

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

// Run the test
console.log('🧪 Testing Workflow Failure Analyzer\n');

console.log('1. Analyzing mock workflow run...');
const analysis = analyzer.analyzeFailures(mockWorkflowRun, mockJobs);

console.log('2. Generating report...');
const report = analyzer.generateReport(analysis);

console.log('3. Saving test outputs...');
const repoRoot = path.resolve(__dirname, '..');
const outputDir = getDocsOutputDir(repoRoot);
fs.mkdirSync(outputDir, { recursive: true });

const analysisPath = path.join(outputDir, 'test-analysis.json');
const reportPath = path.join(outputDir, 'test-report.md');

fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
fs.writeFileSync(reportPath, report);

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
console.log(`  - ${path.relative(repoRoot, analysisPath)}`);
console.log(`  - ${path.relative(repoRoot, reportPath)}`);

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
