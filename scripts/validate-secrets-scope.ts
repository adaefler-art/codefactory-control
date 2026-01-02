#!/usr/bin/env ts-node

/**
 * Secrets Scope Linter - E7.0.5
 * 
 * Validates that IAM policies do not grant cross-environment secret access.
 * This prevents security/governance smells like stage-secrets in prod-ExecutionRole.
 * 
 * Rules:
 * - Production resources (roles/tasks) can only access afu9/prod/* secrets
 * - Staging resources can only access afu9/stage/* secrets
 * - Cross-environment access is strictly forbidden
 * - Legacy afu9/* (no env prefix) is allowed for backward compatibility
 * 
 * Part of EPIC 07: Security & Blast Radius minimization
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

interface SecretScopeViolation {
  severity: 'error' | 'warning';
  file: string;
  line: number;
  environment: string;
  secretArn: string;
  message: string;
  policyStatement: string;
}

interface ValidationResult {
  passed: boolean;
  violations: SecretScopeViolation[];
}

/**
 * Environment-specific secret prefix rules
 * Each environment can only access secrets with these prefixes
 */
const ALLOWED_SECRET_PREFIXES: Record<string, string[]> = {
  prod: [
    'afu9/prod/',      // Production-specific secrets
    'afu9/database',   // Legacy database secret (no env prefix for backward compatibility)
    'afu9/github',     // Legacy GitHub secret (shared across envs)
    'afu9/llm',        // Legacy LLM secret (shared across envs)
  ],
  stage: [
    'afu9/stage/',     // Stage-specific secrets
    'afu9/database',   // Legacy database secret
    'afu9/github',     // Legacy GitHub secret (shared across envs)
    'afu9/llm',        // Legacy LLM secret (shared across envs)
  ],
  legacy: [
    'afu9/',           // Legacy deployments can access all afu9/* secrets
  ],
};

/**
 * Forbidden cross-environment patterns
 * These explicitly violate environment isolation
 */
const FORBIDDEN_CROSS_ENV_PATTERNS: Record<string, string[]> = {
  prod: [
    'afu9/stage/',     // Prod resources must not access stage secrets
  ],
  stage: [
    'afu9/prod/',      // Stage resources must not access prod secrets
  ],
};

/**
 * Extract environment from role name, task definition name, or file name
 */
function detectEnvironment(context: {
  fileName: string;
  roleName?: string;
  taskDefName?: string;
}): string | null {
  const { fileName, roleName, taskDefName } = context;

  // Check role name for environment indicators
  if (roleName) {
    if (roleName.includes('-prod') || roleName.includes('prod-')) return 'prod';
    if (roleName.includes('-stage') || roleName.includes('stage-') || 
        roleName.includes('-staging') || roleName.includes('staging-')) return 'stage';
  }

  // Check task definition name
  if (taskDefName) {
    if (taskDefName.includes('-prod') || taskDefName.includes('prod-')) return 'prod';
    if (taskDefName.includes('-stage') || taskDefName.includes('stage-') || 
        taskDefName.includes('-staging') || taskDefName.includes('staging-')) return 'stage';
  }

  // Check file name
  if (fileName.includes('-prod') || fileName.includes('prod-')) return 'prod';
  if (fileName.includes('-stage') || fileName.includes('stage-') || 
      fileName.includes('-staging') || fileName.includes('staging-')) return 'stage';

  // Default to legacy if no environment detected (backward compatibility)
  return 'legacy';
}

/**
 * Extract secret ARNs from resources array
 * Matches both full ARNs and partial ARN patterns from template literals
 * - Full ARN: arn:aws:secretsmanager:region:account:secret:afu9/...
 * - Partial: secret:afu9/... (from template literals like `${region}:${account}:secret:afu9/...`)
 */
function extractSecretArns(resources: string[]): string[] {
  return resources.filter(r => 
    r.includes('secretsmanager') || r.includes('secret:afu9/')
  );
}

/**
 * Validate that a secret ARN matches allowed prefixes for the environment
 */
function validateSecretScope(
  secretArn: string,
  environment: string
): { valid: boolean; reason?: string } {
  // Extract the secret name/path from the ARN
  // ARN format: arn:aws:secretsmanager:region:account:secret:SECRET_NAME-SUFFIX
  // Regex: Match everything after "secret:" until we hit a wildcard (*) or hyphen-suffix (-)
  const secretMatch = secretArn.match(/secret:([^*\-]+)/);
  if (!secretMatch) {
    // If we can't parse it, assume it's a variable reference and skip
    return { valid: true };
  }

  const secretName = secretMatch[1];

  // Check for forbidden cross-env patterns first
  const forbiddenPatterns = FORBIDDEN_CROSS_ENV_PATTERNS[environment] || [];
  for (const pattern of forbiddenPatterns) {
    if (secretName.startsWith(pattern)) {
      return {
        valid: false,
        reason: `Cross-environment access forbidden: ${environment} environment cannot access ${pattern}* secrets`,
      };
    }
  }

  // Check allowed prefixes
  const allowedPrefixes = ALLOWED_SECRET_PREFIXES[environment] || ALLOWED_SECRET_PREFIXES.legacy;
  const isAllowed = allowedPrefixes.some(prefix => secretName.startsWith(prefix));

  if (!isAllowed) {
    return {
      valid: false,
      reason: `Secret ${secretName} does not match allowed prefixes for ${environment}: ${allowedPrefixes.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Parse TypeScript file and extract IAM policy statements
 */
function parseTypeScriptFile(filePath: string): ts.SourceFile {
  const sourceCode = fs.readFileSync(filePath, 'utf-8');
  return ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  );
}

/**
 * Extract role names and policy statements from source file
 */
function extractPoliciesWithContext(sourceFile: ts.SourceFile): Array<{
  roleName?: string;
  taskDefName?: string;
  policy: any;
}> {
  const results: Array<{ roleName?: string; taskDefName?: string; policy: any }> = [];
  let currentRoleName: string | undefined;
  let currentTaskDefName: string | undefined;

  function visit(node: ts.Node) {
    // Detect role names from Role constructor
    if (ts.isNewExpression(node)) {
      const expression = node.expression;
      if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'Role') {
        // Try to find roleName in the config
        if (node.arguments && node.arguments.length > 2) {
          const configArg = node.arguments[2];
          if (ts.isObjectLiteralExpression(configArg)) {
            configArg.properties.forEach((prop) => {
              if (ts.isPropertyAssignment(prop)) {
                const name = prop.name.getText(sourceFile);
                if (name === 'roleName') {
                  const value = prop.initializer.getText(sourceFile).replace(/['"]/g, '');
                  currentRoleName = value;
                }
              }
            });
          }
        }
      }
      // Detect task definition names
      if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'TaskDefinition') {
        if (node.arguments && node.arguments.length > 1) {
          const configArg = node.arguments[1];
          if (ts.isObjectLiteralExpression(configArg)) {
            configArg.properties.forEach((prop) => {
              if (ts.isPropertyAssignment(prop)) {
                const name = prop.name.getText(sourceFile);
                if (name === 'family') {
                  const value = prop.initializer.getText(sourceFile).replace(/['"]/g, '');
                  currentTaskDefName = value;
                }
              }
            });
          }
        }
      }
    }

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
                    return resourceText.replace(/['"]/g, '');
                  });
                } else if (name === 'sid') {
                  policy.sid = value.getText(sourceFile).replace(/['"]/g, '');
                }
              }
            });
            
            results.push({
              roleName: currentRoleName,
              taskDefName: currentTaskDefName,
              policy,
            });
          }
        }
      }
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  return results;
}

/**
 * Validate a single policy statement for secret scope violations
 */
function validatePolicySecretScope(
  policy: any,
  context: {
    fileName: string;
    roleName?: string;
    taskDefName?: string;
  }
): SecretScopeViolation[] {
  const violations: SecretScopeViolation[] = [];

  // Only check policies that access Secrets Manager
  const hasSecretsManagerAccess = policy.actions.some((action: string) =>
    action.includes('secretsmanager:')
  );

  if (!hasSecretsManagerAccess) {
    return violations;
  }

  // Detect environment from context
  const environment = detectEnvironment(context);
  // Note: detectEnvironment returns 'legacy' as fallback, never null/empty
  if (environment === null) {
    return violations; // Skip if we can't determine environment (defensive check)
  }

  // Extract and validate secret ARNs
  const secretArns = extractSecretArns(policy.resources);
  
  for (const secretArn of secretArns) {
    const validation = validateSecretScope(secretArn, environment);
    
    if (!validation.valid) {
      violations.push({
        severity: 'error',
        file: context.fileName,
        line: policy.line,
        environment,
        secretArn,
        message: validation.reason || 'Secret scope violation',
        policyStatement: policy.sid || 'Unnamed Policy',
      });
    }
  }

  return violations;
}

/**
 * Validate all policies in a stack file
 */
function validateStackFile(filePath: string): SecretScopeViolation[] {
  console.log(`\nValidating: ${filePath}`);
  
  const sourceFile = parseTypeScriptFile(filePath);
  const policiesWithContext = extractPoliciesWithContext(sourceFile);
  
  console.log(`  Found ${policiesWithContext.length} policy statements`);
  
  const violations: SecretScopeViolation[] = [];
  
  policiesWithContext.forEach(({ roleName, taskDefName, policy }) => {
    const policyViolations = validatePolicySecretScope(policy, {
      fileName: path.basename(filePath),
      roleName,
      taskDefName,
    });
    violations.push(...policyViolations);
  });
  
  return violations;
}

/**
 * Validate all stack files
 */
function validateAllStacks(): ValidationResult {
  const libDir = path.join(__dirname, '..', 'lib');
  const stackFiles = fs.readdirSync(libDir)
    .filter(f => f.endsWith('-stack.ts') && !f.endsWith('.disabled'))
    .map(f => path.join(libDir, f));
  
  console.log('='.repeat(80));
  console.log('AFU-9 Secrets Scope Validation - E7.0.5');
  console.log('EPIC 07: Security & Blast Radius Minimization');
  console.log('Preventing Cross-Environment Secret Access');
  console.log('='.repeat(80));
  
  const allViolations: SecretScopeViolation[] = [];
  
  stackFiles.forEach(file => {
    const violations = validateStackFile(file);
    allViolations.push(...violations);
  });
  
  // Print results
  console.log('\n' + '='.repeat(80));
  console.log('VALIDATION RESULTS');
  console.log('='.repeat(80));
  
  if (allViolations.length > 0) {
    console.log('\n❌ CROSS-ENVIRONMENT SECRET ACCESS VIOLATIONS:');
    console.log('');
    
    // Group by environment for clarity
    const byEnv: Record<string, SecretScopeViolation[]> = {};
    allViolations.forEach(v => {
      if (!byEnv[v.environment]) byEnv[v.environment] = [];
      byEnv[v.environment].push(v);
    });
    
    Object.entries(byEnv).forEach(([env, violations]) => {
      console.log(`\n  Environment: ${env.toUpperCase()}`);
      violations.forEach(v => {
        console.log(`    ${path.basename(v.file)}:${v.line} [${v.policyStatement}]`);
        console.log(`      Secret: ${v.secretArn}`);
        console.log(`      Error: ${v.message}`);
        console.log('');
      });
    });
    
    console.log('REMEDIATION:');
    console.log('  1. Review the IAM policies above');
    console.log('  2. Ensure production resources only access afu9/prod/* secrets');
    console.log('  3. Ensure staging resources only access afu9/stage/* secrets');
    console.log('  4. Use environment-specific secret names');
    console.log('  5. For shared secrets, use legacy afu9/* prefix (without env)');
    console.log('');
  } else {
    console.log('\n✅ No cross-environment secret access violations found!');
    console.log('');
    console.log('  All secrets are properly scoped to their environments:');
    console.log('    - Production resources → afu9/prod/* secrets only');
    console.log('    - Staging resources → afu9/stage/* secrets only');
    console.log('    - Legacy shared secrets → afu9/* (no env prefix)');
    console.log('');
  }
  
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Violations: ${allViolations.length}`);
  console.log('='.repeat(80));
  
  const passed = allViolations.length === 0;
  
  if (!passed) {
    console.log('\n❌ Secrets scope validation FAILED.');
    console.log('   Cross-environment secret access is a security/governance smell.');
    console.log('   Please fix the violations above before deploying.');
  }
  
  return {
    passed,
    violations: allViolations,
  };
}

// Main execution
if (require.main === module) {
  const result = validateAllStacks();
  process.exit(result.passed ? 0 : 1);
}

export { validateAllStacks, ValidationResult, SecretScopeViolation };
