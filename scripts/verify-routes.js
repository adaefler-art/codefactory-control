#!/usr/bin/env node
/**
 * API Route Canonicalization Verification Script
 * 
 * Enforces API route guardrails:
 * 1. No hardcoded /api/ strings (must use API_ROUTES constants)
 * 2. No deprecated route usage in client code
 * 3. Documentation consistency with implementation
 * 
 * Part of ISSUE 3 — API Route Canonicalization
 * 
 * Usage:
 *   npm run routes:verify
 *   node scripts/verify-routes.js (after compilation)
 *   pwsh -Command "npm run routes:verify"  # Windows/PowerShell
 *   ROUTES_STRICT_MODE=true npm run routes:verify  # Fail on hardcoded routes
 * 
 * Environment Variables:
 *   ROUTES_STRICT_MODE - If set to 'true', fail on hardcoded /api/ strings
 *                        Default: false (warnings only for existing code)
 * 
 * Exit Codes:
 *   0 - All checks passed
 *   1 - One or more checks failed
 */

const fs = require('fs');
const path = require('path');

// Check if strict mode is enabled
const STRICT_MODE = process.env.ROUTES_STRICT_MODE === 'true';

// ============================================================================
// Configuration
// ============================================================================

const REPO_ROOT = path.resolve(__dirname, '..');
const CONTROL_CENTER_DIR = path.join(REPO_ROOT, 'control-center');
const API_DIR = path.join(CONTROL_CENTER_DIR, 'app', 'api');
const SRC_DIR = path.join(CONTROL_CENTER_DIR, 'src');
const APP_DIR = path.join(CONTROL_CENTER_DIR, 'app');

// Files that are allowed to have hardcoded /api/ strings
const ALLOWED_HARDCODED_FILES = [
  // Route definition files
  'route.ts',
  // Route constants definition
  'src/lib/api-routes.ts',
  // Test files may test specific routes
  '.test.ts',
  '.test.tsx',
  // Middleware configuration
  'middleware-public-routes.ts',
  'middleware.ts',
  // Test/demo pages
  'test-errors/page.tsx',
];

// Deprecated routes to check for
const DEPRECATED_ROUTES = [
  '/api/github/webhook', // Use /api/webhooks/github instead
];

// Critical routes that must exist
const CRITICAL_ROUTES = [
  'api/auth/login',
  'api/webhooks/github',
  'api/workflows',
  'api/workflow/execute',
  'api/issues',
  'api/v1/kpi/aggregate',
  'api/v1/costs/factory',
  'api/health',
  'api/ready',
];

// ============================================================================
// Helper Functions
// ============================================================================

function isAllowedFile(filePath) {
  return ALLOWED_HARDCODED_FILES.some(pattern => filePath.includes(pattern));
}

function extractApiPath(line) {
  // Match patterns like: fetch("/api/..."), fetch('/api/...'), fetch(`/api/...`)
  const patterns = [
    /fetch\s*\(\s*["'`](\/api\/[^"'`]+)["'`]/,
    /axios\s*\.\s*\w+\s*\(\s*["'`](\/api\/[^"'`]+)["'`]/,
    /href\s*=\s*["'`](\/api\/[^"'`]+)["'`]/,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

// ============================================================================
// Check 1: No Hardcoded /api/ Strings
// ============================================================================

function checkNoHardcodedApiStrings() {
  console.log('🔍 Checking for hardcoded /api/ strings...');
  if (!STRICT_MODE) {
    console.log('   (Warning mode - existing code grandfathered)\n');
  } else {
    console.log('   (Strict mode - all violations will fail)\n');
  }

  const errors = [];
  const warnings = [];
  const violations = [];

  function scanDirectory(dir) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip node_modules, .next, dist, etc.
      if (entry.name === 'node_modules' || entry.name === '.next' || 
          entry.name === 'dist' || entry.name === '.git') {
        continue;
      }

      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        // Check if file is allowed to have hardcoded strings
        if (isAllowedFile(fullPath)) {
          continue;
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          // Skip comments
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
            return;
          }

          const apiPath = extractApiPath(line);
          if (apiPath) {
            violations.push({
              filePath: path.relative(REPO_ROOT, fullPath),
              lineNumber: index + 1,
              line: line.trim(),
              apiPath,
            });
          }
        });
      }
    }
  }

  // Scan app directory (pages, components, etc.)
  scanDirectory(APP_DIR);

  // Scan src directory (lib, utilities, etc.)
  if (fs.existsSync(SRC_DIR)) {
    scanDirectory(SRC_DIR);
  }

  if (violations.length > 0) {
    if (STRICT_MODE) {
      errors.push(`Found ${violations.length} hardcoded /api/ string(s):`);
      violations.forEach(v => {
        errors.push(`  ❌ ${v.filePath}:${v.lineNumber}`);
        errors.push(`     ${v.line}`);
        errors.push(`     Use: API_ROUTES constant instead of "${v.apiPath}"`);
        errors.push('');
      });
      errors.push('Migration: Import API_ROUTES from @/lib/api-routes');
      errors.push('Example: fetch(API_ROUTES.issues.list) instead of fetch("/api/issues")');
    } else {
      warnings.push(`⚠️  Found ${violations.length} hardcoded /api/ string(s) (grandfathered)`);
      warnings.push('   New code should use API_ROUTES constants');
      warnings.push('   Set ROUTES_STRICT_MODE=true to enforce this check');
      console.log(`  ⚠️  Found ${violations.length} hardcoded routes (allowed for now)\n`);
    }
  } else {
    console.log('  ✅ PASS: No hardcoded /api/ strings found\n');
  }

  return { passed: STRICT_MODE ? violations.length === 0 : true, errors, warnings };
}

// ============================================================================
// Check 2: No Deprecated Route Usage
// ============================================================================

function checkNoDeprecatedRoutes() {
  console.log('🔍 Checking for deprecated route usage...\n');

  const errors = [];
  const warnings = [];

  for (const deprecatedRoute of DEPRECATED_ROUTES) {
    const violations = [];

    function scanDirectory(dir) {
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip exclusions
        if (entry.name === 'node_modules' || entry.name === '.next' || 
            entry.name === 'dist' || entry.name === '.git') {
          continue;
        }

        // Skip allowed files
        if (isAllowedFile(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          scanDirectory(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          
          if (content.includes(deprecatedRoute)) {
            const relativePath = path.relative(REPO_ROOT, fullPath);
            violations.push(relativePath);
          }
        }
      }
    }

    scanDirectory(CONTROL_CENTER_DIR);

    if (violations.length > 0) {
      errors.push(`Found usage of deprecated route "${deprecatedRoute}":`);
      violations.forEach(file => {
        errors.push(`  ❌ ${file}`);
      });
      
      // Suggest canonical alternative
      if (deprecatedRoute === '/api/github/webhook') {
        errors.push('  Migration: Use /api/webhooks/github instead');
      }
      errors.push('');
    } else {
      console.log(`  ✅ PASS: No usage of deprecated route "${deprecatedRoute}"\n`);
    }
  }

  return { passed: errors.length === 0, errors, warnings };
}

// ============================================================================
// Check 3: Documentation Consistency
// ============================================================================

function checkDocumentationConsistency() {
  console.log('🔍 Checking documentation consistency...\n');

  const errors = [];
  const warnings = [];
  let passCount = 0;

  for (const route of CRITICAL_ROUTES) {
    const routeFile = path.join(CONTROL_CENTER_DIR, 'app', route, 'route.ts');
    
    if (fs.existsSync(routeFile)) {
      console.log(`  ✅ ${route}`);
      passCount++;
    } else {
      errors.push(`  ❌ ${route} (file not found: ${routeFile})`);
    }
  }

  console.log('');

  // Check for @deprecated annotation
  const deprecatedRouteFile = path.join(API_DIR, 'github', 'webhook', 'route.ts');
  if (fs.existsSync(deprecatedRouteFile)) {
    const content = fs.readFileSync(deprecatedRouteFile, 'utf-8');
    if (content.includes('@deprecated')) {
      console.log('  ✅ Deprecated route properly annotated\n');
    } else {
      errors.push('  ❌ /api/github/webhook missing @deprecated annotation');
    }
  }

  // Check for @canonical annotation
  const canonicalRouteFile = path.join(API_DIR, 'webhooks', 'github', 'route.ts');
  if (fs.existsSync(canonicalRouteFile)) {
    const content = fs.readFileSync(canonicalRouteFile, 'utf-8');
    if (content.includes('@canonical')) {
      console.log('  ✅ Canonical route properly annotated\n');
    } else {
      warnings.push('  ⚠️  /api/webhooks/github missing @canonical annotation');
    }
  }

  // Check if API_ROUTES.md exists
  const apiRoutesDoc = path.join(REPO_ROOT, 'docs', 'API_ROUTES.md');
  if (fs.existsSync(apiRoutesDoc)) {
    console.log('  ✅ API_ROUTES.md exists\n');
  } else {
    errors.push('  ❌ docs/API_ROUTES.md missing');
  }

  // Check if api-routes.ts exists
  const apiRoutesConstants = path.join(SRC_DIR, 'lib', 'api-routes.ts');
  if (fs.existsSync(apiRoutesConstants)) {
    console.log('  ✅ api-routes.ts constants file exists\n');
  } else {
    errors.push('  ❌ src/lib/api-routes.ts missing');
  }

  return { passed: errors.length === 0, errors, warnings };
}

// ============================================================================
// Main Execution
// ============================================================================

function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  AFU-9 API Route Canonicalization Verification');
  console.log('═══════════════════════════════════════════════════════════\n');

  const results = [];

  // Run all checks
  results.push(checkNoHardcodedApiStrings());
  results.push(checkNoDeprecatedRoutes());
  results.push(checkDocumentationConsistency());

  // Aggregate results
  const allPassed = results.every(r => r.passed);
  const allErrors = results.flatMap(r => r.errors);
  const allWarnings = results.flatMap(r => r.warnings);

  // Print summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  VERIFICATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  if (allErrors.length > 0) {
    console.log('❌ FAILED:\n');
    allErrors.forEach(error => console.log(error));
    console.log('');
  }

  if (allWarnings.length > 0) {
    console.log('⚠️  WARNINGS:\n');
    allWarnings.forEach(warning => console.log(warning));
    console.log('');
  }

  if (allPassed && allWarnings.length === 0) {
    console.log('✅ ALL CHECKS PASSED\n');
    console.log('All API routes are properly canonicalized:');
    console.log('  • No hardcoded /api/ strings');
    console.log('  • No deprecated route usage');
    console.log('  • Documentation is consistent\n');
  } else if (allPassed) {
    console.log('✅ ALL CHECKS PASSED (with warnings)\n');
  } else {
    console.log('❌ VERIFICATION FAILED\n');
    console.log(`Found ${allErrors.length} error(s) that must be fixed.\n`);
  }

  // Exit with appropriate code
  process.exit(allPassed ? 0 : 1);
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { checkNoHardcodedApiStrings, checkNoDeprecatedRoutes, checkDocumentationConsistency };
