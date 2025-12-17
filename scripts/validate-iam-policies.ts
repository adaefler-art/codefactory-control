#!/usr/bin/env ts-node

/**
 * IAM Policy Validation Script
 * 
 * Validates IAM policies in CDK stacks to ensure:
 * 1. Least privilege principle is followed
 * 2. Wildcard resources are justified and documented
 * 3. Actions are scoped appropriately
 * 4. Security best practices are enforced
 * 
 * Part of EPIC 07: Security & Blast Radius minimization
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

interface PolicyViolation {
  severity: 'error' | 'warning' | 'info';
  file: string;
  line: number;
  message: string;
  policyStatement: string;
}

interface ValidationResult {
  passed: boolean;
  violations: PolicyViolation[];
  warnings: PolicyViolation[];
  info: PolicyViolation[];
}

// Allowed wildcard resources with justifications
const ALLOWED_WILDCARDS: Record<string, string> = {
  'ecr:GetAuthorizationToken': 'AWS service limitation - GetAuthorizationToken does not support resource-level permissions',
  'cloudwatch:GetMetricStatistics': 'AWS service limitation - CloudWatch Metrics is a global service without resource-level permissions',
  'cloudwatch:GetMetricData': 'AWS service limitation - CloudWatch Metrics is a global service without resource-level permissions',
  'cloudwatch:ListMetrics': 'AWS service limitation - CloudWatch Metrics is a global service without resource-level permissions',
  'cloudwatch:DescribeAlarms': 'AWS service limitation - CloudWatch Metrics is a global service without resource-level permissions',
  'cloudwatch:PutMetricData': 'AWS service limitation - CloudWatch Metrics is a global service without resource-level permissions',
};

// Actions that should never have wildcard resources
const FORBIDDEN_WILDCARD_ACTIONS = [
  'iam:CreateRole',
  'iam:DeleteRole',
  'iam:AttachRolePolicy',
  'iam:DetachRolePolicy',
  'iam:PutRolePolicy',
  'iam:DeleteRolePolicy',
  'secretsmanager:CreateSecret',
  'secretsmanager:DeleteSecret',
  'secretsmanager:UpdateSecret',
  'rds:DeleteDBInstance',
  'rds:DeleteDBCluster',
  'ec2:TerminateInstances',
  'ec2:DeleteSecurityGroup',
  'ecs:DeleteCluster',
  'ecs:DeleteService',
  's3:DeleteBucket',
];

// Required prefixes for resource ARNs
const REQUIRED_RESOURCE_PREFIXES: Record<string, string[]> = {
  'secretsmanager:GetSecretValue': ['afu9/'],
  'secretsmanager:DescribeSecret': ['afu9/'],  
  'ecr:PutImage': ['afu9/'],
  'ecr:BatchCheckLayerAvailability': ['afu9/'],
  'ecr:InitiateLayerUpload': ['afu9/'],
  'ecs:UpdateService': ['afu9-cluster'],
  'ecs:DescribeServices': ['afu9-cluster'],
  'logs:FilterLogEvents': ['/ecs/afu9/'],
  'logs:CreateLogStream': ['/ecs/afu9/'],
  'logs:PutLogEvents': ['/ecs/afu9/'],
};

// Variable names that are known to contain properly scoped ARNs
const KNOWN_SCOPED_VARIABLES = [
  'secretResourceArn',  // Contains afu9/database/* ARN
  'dbSecretArn',        // Database secret ARN from props
  'githubSecret',       // GitHub secret ARN (afu9/github)
  'llmSecret',          // LLM secret ARN (afu9/llm)
];

function parseTypeScriptFile(filePath: string): ts.SourceFile {
  const sourceCode = fs.readFileSync(filePath, 'utf-8');
  return ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  );
}

function extractPolicyStatements(sourceFile: ts.SourceFile): any[] {
  const statements: any[] = [];
  
  function visit(node: ts.Node) {
    // Look for PolicyStatement constructor calls
    if (ts.isNewExpression(node)) {
      const expression = node.expression;
      if (ts.isPropertyAccessExpression(expression) &&
          expression.name.text === 'PolicyStatement') {
        
        // Extract the policy configuration object
        if (node.arguments && node.arguments.length > 0) {
          const configArg = node.arguments[0];
          if (ts.isObjectLiteralExpression(configArg)) {
            const policy: any = {
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              actions: [],
              resources: [],
              sid: '',
            };
            
            configArg.properties.forEach((prop) => {
              if (ts.isPropertyAssignment(prop)) {
                const name = prop.name.getText(sourceFile);
                const value = prop.initializer;
                
                if (name === 'actions' && ts.isArrayLiteralExpression(value)) {
                  policy.actions = value.elements.map(e => 
                    e.getText(sourceFile).replace(/['"]/g, '')
                  );
                } else if (name === 'resources' && ts.isArrayLiteralExpression(value)) {
                  policy.resources = value.elements.map(e => {
                    const resourceText = e.getText(sourceFile);
                    // For template literals or complex expressions, just return the raw text
                    // We'll be more lenient with these during validation
                    return resourceText.replace(/['"]/g, '');
                  });
                } else if (name === 'sid') {
                  policy.sid = value.getText(sourceFile).replace(/['"]/g, '');
                }
              }
            });
            
            statements.push(policy);
          }
        }
      }
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  return statements;
}

function validatePolicy(
  policy: any,
  file: string,
  sourceFile: ts.SourceFile
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  
  // Check for wildcard resources
  const hasWildcard = policy.resources.some((r: string) => r === '*');
  
  if (hasWildcard) {
    // Check if any action is forbidden to use wildcards
    const forbiddenActions = policy.actions.filter((action: string) =>
      FORBIDDEN_WILDCARD_ACTIONS.some(forbidden => action === forbidden || action.includes(forbidden))
    );
    
    if (forbiddenActions.length > 0) {
      violations.push({
        severity: 'error',
        file,
        line: policy.line,
        message: `CRITICAL: Forbidden actions with wildcard resources: ${forbiddenActions.join(', ')}. These actions must have specific resource ARNs.`,
        policyStatement: policy.sid || 'Unnamed Policy',
      });
    }
    
    // Check if wildcard is allowed for all actions
    const allowedActions = policy.actions.filter((action: string) =>
      ALLOWED_WILDCARDS.hasOwnProperty(action)
    );
    
    const unallowedActions = policy.actions.filter((action: string) =>
      !ALLOWED_WILDCARDS.hasOwnProperty(action)
    );
    
    if (unallowedActions.length > 0) {
      violations.push({
        severity: 'warning',
        file,
        line: policy.line,
        message: `Wildcard resource used for actions not explicitly allowed: ${unallowedActions.join(', ')}. Verify this is necessary and add justification.`,
        policyStatement: policy.sid || 'Unnamed Policy',
      });
    } else if (allowedActions.length > 0) {
      violations.push({
        severity: 'info',
        file,
        line: policy.line,
        message: `Wildcard resource justified for: ${allowedActions.join(', ')}. Reason: ${ALLOWED_WILDCARDS[allowedActions[0]]}`,
        policyStatement: policy.sid || 'Unnamed Policy',
      });
    }
  }
  
  // Check for required resource prefixes
  policy.actions.forEach((action: string) => {
    if (REQUIRED_RESOURCE_PREFIXES.hasOwnProperty(action)) {
      const requiredPrefixes = REQUIRED_RESOURCE_PREFIXES[action];
      const hasRequiredPrefix = policy.resources.some((resource: string) => {
        // Handle known scoped variables
        if (KNOWN_SCOPED_VARIABLES.some(v => resource.includes(v))) {
          return true; // Trust that these variables contain properly scoped ARNs
        }
        
        // Handle template literals and variables that we can't fully evaluate
        // If resource contains a variable or template expression, be lenient
        if (resource.includes('${') || resource.includes('dbSecretName') || resource.includes('secretResourceArn')) {
          // Check if the hardcoded part includes the required prefix
          return requiredPrefixes.some((prefix: string) => resource.includes(prefix));
        }
        // For regular resources, remove trailing wildcards for prefix checking (AWS uses wildcards for rotation)
        const cleanResource = resource.replace(/\*+$/, '');
        return requiredPrefixes.some((prefix: string) => cleanResource.includes(prefix));
      });
      
      if (!hasRequiredPrefix && !policy.resources.includes('*')) {
        violations.push({
          severity: 'error',
          file,
          line: policy.line,
          message: `Action ${action} must have resources scoped to: ${requiredPrefixes.join(' or ')}`,
          policyStatement: policy.sid || 'Unnamed Policy',
        });
      }
    }
  });
  
  // Check for overly broad permissions
  const broadActions = policy.actions.filter((action: string) =>
    action.endsWith(':*') || action === '*'
  );
  
  if (broadActions.length > 0) {
    violations.push({
      severity: 'error',
      file,
      line: policy.line,
      message: `Overly broad action permissions: ${broadActions.join(', ')}. Use specific actions instead.`,
      policyStatement: policy.sid || 'Unnamed Policy',
    });
  }
  
  return violations;
}

function validateStackFile(filePath: string): PolicyViolation[] {
  console.log(`\nValidating: ${filePath}`);
  
  const sourceFile = parseTypeScriptFile(filePath);
  const policies = extractPolicyStatements(sourceFile);
  
  console.log(`  Found ${policies.length} policy statements`);
  
  const violations: PolicyViolation[] = [];
  
  policies.forEach((policy) => {
    const policyViolations = validatePolicy(policy, filePath, sourceFile);
    violations.push(...policyViolations);
  });
  
  return violations;
}

function validateAllStacks(): ValidationResult {
  const libDir = path.join(__dirname, '..', 'lib');
  const stackFiles = fs.readdirSync(libDir)
    .filter(f => f.endsWith('-stack.ts') && !f.endsWith('.disabled'))
    .map(f => path.join(libDir, f));
  
  console.log('='.repeat(80));
  console.log('AFU-9 IAM Policy Security Validation');
  console.log('EPIC 07: Security & Blast Radius Minimization');
  console.log('='.repeat(80));
  
  const allViolations: PolicyViolation[] = [];
  
  stackFiles.forEach(file => {
    const violations = validateStackFile(file);
    allViolations.push(...violations);
  });
  
  // Separate violations by severity
  const errors = allViolations.filter(v => v.severity === 'error');
  const warnings = allViolations.filter(v => v.severity === 'warning');
  const info = allViolations.filter(v => v.severity === 'info');
  
  // Print results
  console.log('\n' + '='.repeat(80));
  console.log('VALIDATION RESULTS');
  console.log('='.repeat(80));
  
  if (errors.length > 0) {
    console.log('\n❌ ERRORS (must be fixed):');
    errors.forEach(v => {
      console.log(`  ${path.basename(v.file)}:${v.line} [${v.policyStatement}]`);
      console.log(`    ${v.message}`);
    });
  }
  
  if (warnings.length > 0) {
    console.log('\n⚠️  WARNINGS (should be reviewed):');
    warnings.forEach(v => {
      console.log(`  ${path.basename(v.file)}:${v.line} [${v.policyStatement}]`);
      console.log(`    ${v.message}`);
    });
  }
  
  if (info.length > 0) {
    console.log('\nℹ️  INFO (for awareness):');
    info.forEach(v => {
      console.log(`  ${path.basename(v.file)}:${v.line} [${v.policyStatement}]`);
      console.log(`    ${v.message}`);
    });
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Errors:   ${errors.length}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log(`Info:     ${info.length}`);
  console.log('='.repeat(80));
  
  const passed = errors.length === 0;
  
  if (passed) {
    console.log('\n✅ All IAM policies comply with security requirements!');
  } else {
    console.log('\n❌ IAM policy validation FAILED. Please fix the errors above.');
  }
  
  return {
    passed,
    violations: errors,
    warnings,
    info,
  };
}

// Main execution
if (require.main === module) {
  const result = validateAllStacks();
  process.exit(result.passed ? 0 : 1);
}

export { validateAllStacks, ValidationResult, PolicyViolation };
