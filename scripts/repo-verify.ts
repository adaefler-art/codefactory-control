#!/usr/bin/env ts-node
/**
 * Repository Canon Verification Script
 * 
 * Enforces structural guardrails to prevent drift:
 * 1. Route-Map Check: API routes ↔ client calls must be coupled
 * 2. Forbidden Paths Check: .next/, .worktrees/, standalone/ must not exist
 * 3. Mixed-Scope Check: control-center/** + lib/afu9-*stack.ts cannot mix in PR
 * 
 * Part of ISSUE 1 — Repo Canon & Guardrails
 * 
 * Usage:
 *   npm run repo:verify
 *   ts-node scripts/repo-verify.ts
 *   AFU9_ALLOW_MIXED_SCOPE=true npm run repo:verify  # override mixed-scope check
 * 
 * Exit Codes:
 *   0 - All checks passed
 *   1 - One or more checks failed
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ============================================================================
// Configuration
// ============================================================================

const REPO_ROOT = path.resolve(__dirname, '..');
const CONTROL_CENTER_DIR = path.join(REPO_ROOT, 'control-center');
const API_ROUTES_DIR = path.join(CONTROL_CENTER_DIR, 'app', 'api');
const LIB_DIR = path.join(REPO_ROOT, 'lib');

const FORBIDDEN_PATHS = [
  '.next',
  '.worktrees',
  'standalone',
];

// Test files that intentionally call non-existent endpoints
const EXCLUDED_TEST_PATTERNS = [
  'test-error',
  'test-errors',
  '__test',
];

// ============================================================================
// Types
// ============================================================================

interface RouteInfo {
  filePath: string;
  apiPath: string;
}

interface FetchCall {
  filePath: string;
  lineNumber: number;
  apiPath: string;
  rawCall: string;
}

interface ValidationResult {
  passed: boolean;
  errors: string[];
}

// ============================================================================
// Route-Map Check
// ============================================================================

/**
 * Scan control-center/app/api for all route.ts files and derive API paths
 */
function discoverApiRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];

  function scanDirectory(dir: string): void {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (entry.isFile() && entry.name === 'route.ts') {
        // Derive API path from file system path
        const relativePath = path.relative(API_ROUTES_DIR, path.dirname(fullPath));
        // Handle root api directory case
        const apiPath = relativePath 
          ? '/api/' + relativePath.replace(/\\/g, '/')
          : '/api';
        
        routes.push({
          filePath: fullPath,
          apiPath,
        });
      }
    }
  }

  scanDirectory(API_ROUTES_DIR);
  return routes;
}

/**
 * Scan control-center for client-side fetch calls to /api/**
 */
function discoverFetchCalls(): FetchCall[] {
  const calls: FetchCall[] = [];

  // Patterns to match fetch calls with /api/ paths
  // Handles: fetch(`/api/...`), fetch('/api/...'), fetch("/api/...")
  // Also handles fetch calls with additional parameters
  const fetchPatterns = [
    /fetch\s*\(\s*`(\/api\/[^`]*)`/g,           // Template literals
    /fetch\s*\(\s*'(\/api\/[^']*)'[,\s)]/g,     // Single quotes with params
    /fetch\s*\(\s*"(\/api\/[^"]*)"[,\s)]/g,     // Double quotes with params
  ];

  function scanFile(filePath: string): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of fetchPatterns) {
        pattern.lastIndex = 0; // Reset regex state
        let match;

        while ((match = pattern.exec(line)) !== null) {
          let apiPath = match[1];

          // Remove query parameters first
          apiPath = apiPath.split('?')[0];
          
          // For template expressions, replace ${...} with a placeholder for dynamic segments
          // This allows /api/issues/${id} to match /api/issues/[id]
          apiPath = apiPath.replace(/\$\{[^}]*\}/g, '[dynamic]');
          
          apiPath = apiPath.trim();
          
          // Remove trailing slash if present (but not for /api/ root)
          if (apiPath.endsWith('/') && apiPath !== '/api/') {
            apiPath = apiPath.slice(0, -1);
          }

          // Skip if path is empty after cleanup
          if (!apiPath || apiPath === '/api/') continue;

          calls.push({
            filePath,
            lineNumber: i + 1,
            apiPath,
            rawCall: line.trim(),
          });
        }
      }
    }
  }

  function scanDirectory(dir: string): void {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip API routes directory (routes calling themselves)
      if (fullPath.startsWith(API_ROUTES_DIR)) continue;

      // Skip node_modules and other build artifacts
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      
      // Skip test files that intentionally call non-existent endpoints
      if (EXCLUDED_TEST_PATTERNS.some(pattern => entry.name.includes(pattern))) continue;

      if (entry.isDirectory()) {
        scanDirectory(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        scanFile(fullPath);
      }
    }
  }

  scanDirectory(CONTROL_CENTER_DIR);
  return calls;
}

/**
 * Check if a client call matches a route definition
 * Supports dynamic segments: /api/issues/[id] matches /api/issues/[dynamic]
 */
function matchesRoute(callPath: string, routePath: string): boolean {
  // Exact match
  if (callPath === routePath) return true;

  // Dynamic segment matching
  const callSegments = callPath.split('/').filter(Boolean);
  const routeSegments = routePath.split('/').filter(Boolean);

  if (callSegments.length !== routeSegments.length) return false;

  for (let i = 0; i < callSegments.length; i++) {
    const routeSegment = routeSegments[i];
    const callSegment = callSegments[i];

    // Dynamic segment in route [id], [slug], etc., or in call [dynamic]
    if (
      (routeSegment.startsWith('[') && routeSegment.endsWith(']')) ||
      (callSegment.startsWith('[') && callSegment.endsWith(']'))
    ) {
      continue; // Match any value
    }

    // Exact segment match required
    if (callSegment !== routeSegment) {
      return false;
    }
  }

  return true;
}

/**
 * Verify all client fetch calls have corresponding API routes
 */
function checkRouteMap(): ValidationResult {
  console.log('🔍 Running Route-Map Check...');

  const routes = discoverApiRoutes();
  const calls = discoverFetchCalls();

  console.log(`   Found ${routes.length} API routes`);
  console.log(`   Found ${calls.length} client fetch calls`);

  const errors: string[] = [];

  for (const call of calls) {
    const matchingRoute = routes.find((route) => matchesRoute(call.apiPath, route.apiPath));

    if (!matchingRoute) {
      const relativeFilePath = path.relative(REPO_ROOT, call.filePath);
      
      errors.push(
        `\nClient call to non-existent API route:\n` +
        `  File: ${relativeFilePath}\n` +
        `  Line: ${call.lineNumber}\n` +
        `  Call: ${call.apiPath}\n` +
        `\n` +
        `Error: No route defined for ${call.apiPath}\n` +
        `\n` +
        `Available routes:\n` +
        routes.map((r) => `  - ${r.apiPath}`).join('\n') +
        `\n\n` +
        `Remedy:\n` +
        `  - Create route at: control-center/app/api${call.apiPath}/route.ts\n` +
        `  - OR verify the API path is correct in the client code`
      );
    }
  }

  if (errors.length > 0) {
    console.log(`   ❌ Route-Map Check FAILED (${errors.length} violations)`);
    return { passed: false, errors };
  }

  console.log('   ✅ Route-Map Check PASSED');
  return { passed: true, errors: [] };
}

// ============================================================================
// Forbidden Paths Check
// ============================================================================

/**
 * Check for forbidden directories that should never be committed
 */
function checkForbiddenPaths(): ValidationResult {
  console.log('🔍 Running Forbidden Paths Check...');

  const errors: string[] = [];

  function checkPath(basePath: string, forbiddenName: string): void {
    const fullPath = path.join(basePath, forbiddenName);

    if (fs.existsSync(fullPath)) {
      errors.push(
        `\nFound forbidden directory:\n` +
        `  Path: ${path.relative(REPO_ROOT, fullPath)}\n` +
        `\n` +
        `Error: Build artifacts must not be committed to repository\n` +
        `\n` +
        `Remedy:\n` +
        `  - Remove directory: rm -rf ${forbiddenName}/\n` +
        `  - Verify .gitignore includes: ${forbiddenName}/`
      );
    }
  }

  // Check in repo root
  for (const forbiddenPath of FORBIDDEN_PATHS) {
    checkPath(REPO_ROOT, forbiddenPath);
  }

  // Check in control-center
  for (const forbiddenPath of FORBIDDEN_PATHS) {
    checkPath(CONTROL_CENTER_DIR, forbiddenPath);
  }

  if (errors.length > 0) {
    console.log(`   ❌ Forbidden Paths Check FAILED (${errors.length} violations)`);
    return { passed: false, errors };
  }

  console.log('   ✅ Forbidden Paths Check PASSED');
  return { passed: true, errors: [] };
}

// ============================================================================
// Mixed-Scope Check
// ============================================================================

/**
 * Check if PR mixes control-center and lib/afu9-*stack.ts changes
 */
function checkMixedScope(): ValidationResult {
  console.log('🔍 Running Mixed-Scope Check...');

  // Check for override
  const allowMixedScope = process.env.AFU9_ALLOW_MIXED_SCOPE === 'true';
  if (allowMixedScope) {
    console.log('   ⚠️  Mixed-Scope Check SKIPPED (AFU9_ALLOW_MIXED_SCOPE=true)');
    return { passed: true, errors: [] };
  }

  // Detect if we're in a git repository
  try {
    execSync('git rev-parse --git-dir', { cwd: REPO_ROOT, stdio: 'ignore' });
  } catch {
    console.log('   ⚠️  Mixed-Scope Check SKIPPED (not a git repository)');
    return { passed: true, errors: [] };
  }

  // Get list of changed files (comparing to origin/main or main)
  let changedFiles: string[] = [];
  try {
    // Try to get base branch from GitHub environment
    const baseBranch = process.env.GITHUB_BASE_REF || 'main';
    
    // First try comparing to origin
    try {
      const output = execSync(`git diff --name-only origin/${baseBranch}...HEAD`, {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
      });
      changedFiles = output.trim().split('\n').filter(Boolean);
    } catch {
      // Fallback to local branch comparison
      const output = execSync(`git diff --name-only ${baseBranch}...HEAD`, {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
      });
      changedFiles = output.trim().split('\n').filter(Boolean);
    }
  } catch (error) {
    // If we can't get changed files, skip the check
    console.log('   ⚠️  Mixed-Scope Check SKIPPED (cannot detect changed files)');
    return { passed: true, errors: [] };
  }

  if (changedFiles.length === 0) {
    console.log('   ⚠️  Mixed-Scope Check SKIPPED (no changed files detected)');
    return { passed: true, errors: [] };
  }

  // Categorize changes
  const frontendFiles = changedFiles.filter((f) => f.startsWith('control-center/'));
  const infraFiles = changedFiles.filter((f) => /^lib\/afu9-.*-stack\.ts$/.test(f));

  console.log(`   Found ${frontendFiles.length} frontend file(s), ${infraFiles.length} infrastructure file(s)`);

  // Check for mixed scope
  if (frontendFiles.length > 0 && infraFiles.length > 0) {
    const errors = [
      `\nThis PR mixes frontend and infrastructure changes:\n` +
      `\n` +
      `Frontend files (${frontendFiles.length}):\n` +
      frontendFiles.slice(0, 10).map((f) => `  - ${f}`).join('\n') +
      (frontendFiles.length > 10 ? `\n  ... and ${frontendFiles.length - 10} more` : '') +
      `\n\n` +
      `Infrastructure files (${infraFiles.length}):\n` +
      infraFiles.map((f) => `  - ${f}`).join('\n') +
      `\n\n` +
      `Error: Mixed-scope PRs require explicit justification\n` +
      `\n` +
      `Remedy:\n` +
      `  - Split into separate PRs (frontend vs infrastructure)\n` +
      `  - OR set AFU9_ALLOW_MIXED_SCOPE=true if justified\n` +
      `  - OR add [MIXED-SCOPE-OK] to PR description with justification`
    ];

    console.log(`   ❌ Mixed-Scope Check FAILED`);
    return { passed: false, errors };
  }

  console.log('   ✅ Mixed-Scope Check PASSED');
  return { passed: true, errors: [] };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('=====================================');
  console.log('Repository Canon Verification');
  console.log('=====================================\n');

  const results = [
    checkRouteMap(),
    checkForbiddenPaths(),
    checkMixedScope(),
  ];

  console.log('\n=====================================');
  console.log('Verification Summary');
  console.log('=====================================\n');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Total: ${results.length}\n`);

  if (failed === 0) {
    console.log('✅ All repository canon checks passed!');
    console.log('Repository structure is consistent.\n');
    process.exit(0);
  } else {
    console.error('❌ Repository canon verification failed!\n');
    console.error('The following checks have violations:\n');

    for (const result of results) {
      if (!result.passed) {
        for (const error of result.errors) {
          console.error(error);
          console.error('\n' + '─'.repeat(60) + '\n');
        }
      }
    }

    console.error('\nPlease fix the violations above before proceeding.\n');
    console.error('See docs/lawbook/repo-canon.md for detailed guidance.\n');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error running repo verification:', error);
  process.exit(2);
});
