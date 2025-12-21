#!/usr/bin/env node

/**
 * AFU-9 Debug Agent Pattern Matcher
 * 
 * Analyzes workflow failure logs and identifies root causes using pattern matching.
 * Used for testing and validating the debug agent's root cause detection.
 * 
 * Usage: node scripts/debug-agent-pattern-matcher.js <log-file>
 */

const fs = require('fs');
const path = require('path');

// Pattern definitions for different failure types
const FAILURE_PATTERNS = {
  ecs_service_not_active: {
    pattern: /ServiceNotActiveException.*Service was not ACTIVE/i,
    rootCause: 'ECS Service is not in ACTIVE state - likely stuck in DRAINING or UPDATE_IN_PROGRESS',
    affectedResources: ['ECS Service'],
    fixStrategy: 'Check ECS service status, verify no pending deployments, check cluster capacity',
    severity: 'high'
  },
  
  ecs_task_definition_invalid: {
    pattern: /InvalidParameterException.*task definition/i,
    rootCause: 'ECS Task Definition validation failed - invalid configuration',
    affectedResources: ['Task Definition'],
    fixStrategy: 'Review task definition JSON, check container definitions, memory/CPU limits',
    severity: 'high'
  },
  
  ecs_insufficient_capacity: {
    pattern: /service.*was unable to place a task/i,
    rootCause: 'ECS cluster has insufficient capacity to run tasks',
    affectedResources: ['ECS Cluster', 'Container Instances'],
    fixStrategy: 'Add container instances to cluster, check resource reservations',
    severity: 'critical'
  },
  
  secret_not_found: {
    pattern: /ResourceNotFoundException.*Secrets Manager/i,
    rootCause: 'Required secret not found in AWS Secrets Manager',
    affectedResources: ['Secrets Manager'],
    fixStrategy: 'Create missing secret or update secret ARN references',
    severity: 'high'
  },
  
  iam_permission_denied: {
    pattern: /(AccessDeniedException|UnauthorizedOperation|not authorized)/i,
    rootCause: 'IAM permissions insufficient for required operation',
    affectedResources: ['IAM Role', 'IAM Policy'],
    fixStrategy: 'Review IAM policies, add missing permissions (avoid wildcards)',
    severity: 'high'
  },
  
  cdk_synth_error: {
    pattern: /Error: Synthesis failed/i,
    rootCause: 'CDK synthesis failed - stack configuration error',
    affectedResources: ['CDK Stack'],
    fixStrategy: 'Review CDK code, check construct configurations, validate context values',
    severity: 'high'
  },
  
  cdk_missing_module: {
    pattern: /Error: Cannot find module/i,
    rootCause: 'CDK construct error - missing dependency or module',
    affectedResources: ['CDK Stack', 'Dependencies'],
    fixStrategy: 'Check imports, run npm install, verify package.json',
    severity: 'medium'
  },
  
  cdk_undefined_property: {
    pattern: /Cannot read property.*of undefined/i,
    rootCause: 'CDK construct error - undefined property access',
    affectedResources: ['CDK Stack'],
    fixStrategy: 'Check construct property initialization, verify construct dependencies',
    severity: 'medium'
  },
  
  build_compilation_error: {
    pattern: /(error TS\d+|Compilation failed|SyntaxError)/i,
    rootCause: 'TypeScript/JavaScript compilation error',
    affectedResources: ['Source Code'],
    fixStrategy: 'Fix syntax errors, resolve type issues, check imports',
    severity: 'medium'
  },
  
  npm_install_failed: {
    pattern: /npm ERR!.*install/i,
    rootCause: 'NPM package installation failed',
    affectedResources: ['Dependencies', 'package.json'],
    fixStrategy: 'Check package.json, clear npm cache, verify package availability',
    severity: 'medium'
  },
  
  docker_build_failed: {
    pattern: /ERROR \[.*\] failed to solve/i,
    rootCause: 'Docker image build failed',
    affectedResources: ['Dockerfile', 'Docker Image'],
    fixStrategy: 'Review Dockerfile, check base image availability, verify build context',
    severity: 'high'
  },
  
  healthcheck_failed: {
    pattern: /(health check failed|unhealthy target)/i,
    rootCause: 'Application health check failed - service not responding correctly',
    affectedResources: ['Application', 'ALB', 'Target Group'],
    fixStrategy: 'Check application logs, verify health endpoint, check network connectivity',
    severity: 'critical'
  },
  
  database_migration_failed: {
    pattern: /(migration failed|database.*error)/i,
    rootCause: 'Database migration failed',
    affectedResources: ['Database', 'Migration Scripts'],
    fixStrategy: 'Review migration scripts, check database connectivity, verify permissions',
    severity: 'high'
  },
  
  timeout: {
    pattern: /(timeout|timed out|operation.*exceeded)/i,
    rootCause: 'Operation timed out - exceeded maximum wait time',
    affectedResources: ['Various'],
    fixStrategy: 'Increase timeout values, check resource availability, verify network',
    severity: 'medium'
  }
};

/**
 * Analyze log content and identify failure patterns
 */
function analyzeLog(logContent) {
  const results = {
    matches: [],
    rootCause: null,
    affectedResources: [],
    fixStrategy: null,
    severity: null,
    logExtract: []
  };
  
  const logLines = logContent.split('\n');
  
  // Find matching patterns
  for (const [patternName, patternDef] of Object.entries(FAILURE_PATTERNS)) {
    for (let i = 0; i < logLines.length; i++) {
      const line = logLines[i];
      if (patternDef.pattern.test(line)) {
        results.matches.push({
          pattern: patternName,
          line: i + 1,
          text: line.trim()
        });
        
        // Use the first (most specific) match for root cause
        if (!results.rootCause) {
          results.rootCause = patternDef.rootCause;
          results.affectedResources = patternDef.affectedResources;
          results.fixStrategy = patternDef.fixStrategy;
          results.severity = patternDef.severity;
          
          // Extract context (5 lines before and after)
          const start = Math.max(0, i - 5);
          const end = Math.min(logLines.length, i + 6);
          results.logExtract = logLines.slice(start, end);
        }
      }
    }
  }
  
  // If no patterns matched, provide generic analysis
  if (!results.rootCause) {
    results.rootCause = 'Unknown failure - manual investigation required';
    results.fixStrategy = 'Review full workflow logs and error messages';
    results.severity = 'unknown';
    
    // Find lines with error-like content
    const errorLines = logLines.filter(line => 
      /error|fail|exception|fatal/i.test(line)
    );
    results.logExtract = errorLines.slice(0, 10);
  }
  
  return results;
}

/**
 * Format analysis results for output
 */
function formatResults(results) {
  console.log('\n=== AFU-9 Debug Agent Pattern Matcher ===\n');
  
  if (results.matches.length > 0) {
    console.log('✓ Pattern Matches Found:');
    results.matches.forEach(match => {
      console.log(`  - ${match.pattern} (line ${match.line})`);
      console.log(`    "${match.text}"`);
    });
    console.log();
  } else {
    console.log('⚠ No known patterns matched\n');
  }
  
  console.log('Root Cause Analysis:');
  console.log(`  Hypothesis: ${results.rootCause}`);
  console.log(`  Severity: ${results.severity}`);
  console.log(`  Affected Resources: ${results.affectedResources.join(', ')}`);
  console.log(`  Fix Strategy: ${results.fixStrategy}`);
  console.log();
  
  if (results.logExtract.length > 0) {
    console.log('Relevant Log Extract:');
    results.logExtract.forEach((line, idx) => {
      console.log(`  ${idx + 1}. ${line}`);
    });
    console.log();
  }
  
  // Generate JSON output for automation
  const jsonOutput = {
    root_cause: results.rootCause,
    affected_resources: results.affectedResources,
    fix_strategy: results.fixStrategy,
    severity: results.severity,
    pattern_matches: results.matches.length,
    log_extract: results.logExtract.join('\n')
  };
  
  console.log('JSON Output (for automation):');
  console.log(JSON.stringify(jsonOutput, null, 2));
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node debug-agent-pattern-matcher.js <log-file>');
    console.error('\nExample:');
    console.error('  node scripts/debug-agent-pattern-matcher.js test-failure.log');
    process.exit(1);
  }
  
  const logFile = args[0];
  
  if (!fs.existsSync(logFile)) {
    console.error(`Error: Log file not found: ${logFile}`);
    process.exit(1);
  }
  
  const logContent = fs.readFileSync(logFile, 'utf8');
  const results = analyzeLog(logContent);
  formatResults(results);
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export for testing
module.exports = { analyzeLog, FAILURE_PATTERNS };
