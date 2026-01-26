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

// I671 (E67) — Artifact paths that should NEVER be committed
// These are build/runtime outputs that must be in .gitignore
const ARTIFACT_DENYLIST = [
  '.next',
  'cdk.out',
  'dist',
  'node_modules',
  '.local',
  'artifacts',
  'build',
  'out',
  '.turbo',
  'coverage',
  '.cache',
  'tmp',
  'temp',
  '.temp',
];

// I671 (E67) — Known project directory structure
// These paths are checked for artifact subdirectories
// Update this list if project structure changes
const PROJECT_DIRECTORIES = [
  'control-center',  // Next.js control center app
  'apps',            // Additional apps (landing, etc.)
  'packages',        // Monorepo packages
];

// I671 (E67) — Maximum file size allowed in repository (bytes)
// Files larger than this should be flagged unless explicitly allowed
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// I671 (E67) — Files allowed to exceed size limit
// Use relative paths from repo root
const LARGE_FILE_ALLOWLIST = [
  'package-lock.json',
  'control-center/package-lock.json',
  'apps/landing/package-lock.json',
  // Add other legitimate large files here if needed
];

// Secret file patterns that should never be committed
const SECRET_FILE_PATTERNS = [
  '.env.local',
  '.env*.local',
  '*.pem',
  '*.pkcs8.pem',
  '*private-key*',
  'secret-*.json',
  'github-app-secret.json',
  'github-app-private-key*',
];

// Regex patterns to detect secret-like content in files
const SECRET_CONTENT_PATTERNS = [
  {
    name: 'GitHub Personal Access Token',
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    severity: 'critical',
  },
  {
    name: 'GitHub OAuth Token',
    pattern: /gho_[a-zA-Z0-9]{36}/g,
    severity: 'critical',
  },
  {
    name: 'GitHub App Token',
    pattern: /ghs_[a-zA-Z0-9]{36}/g,
    severity: 'critical',
  },
  {
    name: 'OpenAI API Key',
    pattern: /sk-proj-[a-zA-Z0-9]{20,}/g,
    severity: 'critical',
  },
  {
    name: 'AWS Access Key ID',
    pattern: /AKIA[0-9A-Z]{16}/g,
    severity: 'critical',
  },
  {
    name: 'AWS Session Token',
    pattern: /ASIA[0-9A-Z]{16}/g,
    severity: 'high',
  },
  {
    name: 'Private Key Block',
    pattern: new RegExp('-----BEGIN (RSA |EC )?PRIVATE' + ' KEY-----', 'g'),
    severity: 'critical',
  },
];

// Maximum depth to scan directories (prevents excessive recursion)
const MAX_SCAN_DEPTH = 10;

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
// ECS Resource Sanity Check (warn only)
// ============================================================================

function checkEcsResourceSanity(): ValidationResult {
  console.log('🔍 Running ECS Resource Sanity Check...');

  const ecsStackPath = path.join(REPO_ROOT, 'lib', 'afu9-ecs-stack.ts');
  if (!fs.existsSync(ecsStackPath)) {
    console.log('   ⚠️  ECS Resource Sanity Check SKIPPED (afu9-ecs-stack.ts not found)');
    return { passed: true, errors: [] };
  }

  const content = fs.readFileSync(ecsStackPath, 'utf-8');

  const readNumber = (name: string): number | null => {
    const match = content.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`, 'm'));
    return match ? Number(match[1]) : null;
  };

  const defaultTaskMemory = readNumber('DEFAULT_TASK_MEMORY_MIB');
  const controlCenterReservation = readNumber('CONTROL_CENTER_MEMORY_RESERVATION_MIB');
  const mcpReservation = readNumber('MCP_MEMORY_RESERVATION_MIB');
  const mcpRunnerReservation = readNumber('MCP_RUNNER_MEMORY_RESERVATION_MIB');

  if (
    defaultTaskMemory === null ||
    controlCenterReservation === null ||
    mcpReservation === null ||
    mcpRunnerReservation === null
  ) {
    return {
      passed: true,
      errors: [
        `\n⚠️  ECS resource sanity check skipped: unable to parse memory constants in lib/afu9-ecs-stack.ts.\n` +
          `   Ensure DEFAULT_TASK_MEMORY_MIB and container reservation constants are defined.\n`,
      ],
    };
  }

  const totalReservation = controlCenterReservation + mcpReservation * 3 + mcpRunnerReservation;

  if (defaultTaskMemory < totalReservation) {
    return {
      passed: true,
      errors: [
        `\n⚠️  ECS resource sanity warning:\n` +
          `   DEFAULT_TASK_MEMORY_MIB (${defaultTaskMemory} MiB) is below total container reservations (${totalReservation} MiB).\n` +
          `   Remedy: increase DEFAULT_TASK_MEMORY_MIB or lower reservation values.\n`,
      ],
    };
  }

  console.log('   ✅ ECS Resource Sanity Check PASSED');
  return { passed: true, errors: [] };
}

// ============================================================================
// Deploy Workflow Invariants (SMOKE + RUNNER)
// ============================================================================

function checkDeployEcsWorkflowInvariants(): ValidationResult {
  console.log('🔍 Running Deploy Workflow Invariants Check...');

  const errors: string[] = [];
  const workflowPath = path.join(REPO_ROOT, '.github', 'workflows', 'deploy-ecs.yml');

  if (!fs.existsSync(workflowPath)) {
    console.log('   ⚠️  Deploy Workflow Invariants Check SKIPPED (deploy-ecs.yml not found)');
    return { passed: true, errors: [] };
  }

  const content = fs.readFileSync(workflowPath, 'utf-8');

  const ecsStackPath = path.join(REPO_ROOT, 'lib', 'afu9-ecs-stack.ts');
  const ecsStackContent = fs.existsSync(ecsStackPath) ? fs.readFileSync(ecsStackPath, 'utf-8') : '';

  // A) Staging smoke key must be resolved by secret name (rotation-safe)
  // Disallow any suffix-pinned stage smoke-key references in the workflow.
  // Only the canonical name "afu9/stage/smoke-key" is allowed (the workflow should resolve the ARN at runtime).
  if (content.includes('afu9/stage/smoke-key-')) {
    errors.push(
      `\n❌ deploy-ecs.yml contains a suffix-pinned staging smoke-key reference (afu9/stage/smoke-key-*).\n` +
      `The staging smoke key MUST be resolved by canonical secret name (afu9/stage/smoke-key) at deploy time, then injected as the resolved secret ARN.\n` +
      `Remedy: use secretsmanager:DescribeSecret on "afu9/stage/smoke-key" to resolve ARN, then set AFU9_SMOKE_KEY.valueFrom to that ARN.\n`
    );
  }

  // Ensure the canonical secret name is used somewhere in the workflow (e.g., valueFrom).
  const mustReferenceCanonicalName = /"afu9\/stage\/smoke-key"/m;
  if (!mustReferenceCanonicalName.test(content)) {
    errors.push(
      `\n❌ deploy-ecs.yml does not reference the canonical staging smoke key secret name.\n` +
      `Expected to find \"afu9/stage/smoke-key\" used for staging smoke key injection (valueFrom).\n`
    );
  }

  // B) If runner is wired (CDK) or referenced (workflow), the workflow must build/push the image.
  const runnerWiredInCdk = /addContainer\(\s*['"]mcp-runner['"]/.test(ecsStackContent) || /\bcontainerName:\s*['"]mcp-runner['"]/.test(ecsStackContent);
  const runnerReferenced = /mcp-runner|afu9\/mcp-runner|afu9-runner\/Dockerfile/.test(content);
  const runnerEcrLookupPresent = /repository-names\s+afu9\/mcp-runner/.test(content);
  const runnerBuildPresent =
    /Build and push MCP Runner Server/.test(content) &&
    (/mcp-servers\/afu9-runner\/Dockerfile/.test(content) || /\.github\/docker\/mcp-runner\.Dockerfile/.test(content));

  if ((runnerReferenced || runnerWiredInCdk) && (!runnerEcrLookupPresent || !runnerBuildPresent)) {
    errors.push(
      `\n❌ deploy-ecs.yml references mcp-runner but does not build/push it consistently.\n` +
      `Expected: ECR URI lookup for afu9/mcp-runner and a docker/build-push-action step for the runner image (mcp-servers/afu9-runner/Dockerfile OR .github/docker/mcp-runner.Dockerfile).\n`
    );
  }

  // C) Bash set -u safety (regression guard)
  // We run many bash steps with `set -euo pipefail`. Under `-u`, any unbound variable will crash the step.
  // Pragmatic, deterministic guard: if a variable is used in the workflow, require either:
  // - it is defined via a YAML env assignment (`VAR:`), or
  // - it is guarded in bash with `${VAR:-...}`.
  function hasEnvAssignment(varName: string): boolean {
    const envLine = new RegExp(`(^|\n)\s*${varName}:\s*`, 'm');
    return envLine.test(content);
  }
  function isDefaultGuarded(varName: string): boolean {
    const guarded = new RegExp(`\$\{\s*${varName}\s*:-[^}]*\}`, 'm');
    return guarded.test(content);
  }
  function isUsedInBash(varName: string): boolean {
    const used = new RegExp(`\$\{\s*${varName}\s*\}|\$${varName}\b`, 'm');
    return used.test(content);
  }

  for (const varName of ['READY_HOST', 'APP_VERSION']) {
    if (isUsedInBash(varName) && !hasEnvAssignment(varName) && !isDefaultGuarded(varName)) {
      errors.push(
        `\n❌ deploy-ecs.yml uses ${varName} in bash but does not appear to define it (env) or guard it (\${${varName}:-...}).\n` +
        `This can fail under bash strict mode (set -u) with: ${varName}: unbound variable.\n` +
        `Remedy: define ${varName} via workflow/step env: or guard reads with \${${varName}:-default}.\n`
      );
    }
  }

  if (errors.length > 0) {
    console.log(`   ❌ Deploy Workflow Invariants Check FAILED (${errors.length} violations)`);
    return { passed: false, errors };
  }

  console.log('   ✅ Deploy Workflow Invariants Check PASSED');
  return { passed: true, errors: [] };
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
        `  - Bash:       rm -rf ${forbiddenName}/\n` +
        `  - PowerShell: Remove-Item -Recurse -Force ${forbiddenName}\n` +
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
// Empty Folders Check
// ============================================================================

/**
 * Check for empty directories that shouldn't exist in the repository
 * Empty folders can indicate incomplete cleanup or structural issues
 */
function checkEmptyFolders(): ValidationResult {
  console.log('🔍 Running Empty Folders Check...');

  const errors: string[] = [];
  const emptyFolders: string[] = [];

  // Directories to exclude from empty folder check
  const EXCLUDED_DIRS = [
    'node_modules',
    '.git',
    '.next',
    '.swc',
    'dist',
    'build',
    'coverage',
    '.husky',
    '.worktrees',
    '.turbo',      // Turborepo cache
    'cdk.out',     // CDK synthesis output
  ];

  function isDirectoryEmpty(dirPath: string): boolean {
    try {
      const entries = fs.readdirSync(dirPath);
      // A directory with only .gitkeep is considered intentionally empty (not a violation)
      if (entries.length === 1 && entries[0] === '.gitkeep') {
        return false; // Has .gitkeep, so it's intentionally preserved
      }
      // Filter out all hidden files (starting with .)
      const visibleEntries = entries.filter(entry => !entry.startsWith('.'));
      // Directory is empty if it has no visible files (even if it has hidden files)
      // This means a directory with only .DS_Store or other hidden files is considered empty
      return visibleEntries.length === 0;
    } catch {
      return false;
    }
  }

  function scanForEmptyDirectories(dir: string, depth: number = 0): void {
    // Limit recursion depth to avoid performance issues
    if (depth > MAX_SCAN_DEPTH) return;
    if (!fs.existsSync(dir)) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        // Skip excluded directories
        if (EXCLUDED_DIRS.includes(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (isDirectoryEmpty(fullPath)) {
            const relativePath = path.relative(REPO_ROOT, fullPath);
            emptyFolders.push(relativePath);
          } else {
            // Recurse into non-empty directories
            scanForEmptyDirectories(fullPath, depth + 1);
          }
        }
      }
    } catch (error) {
      // Log unexpected errors for debugging but don't fail the check
      if (error instanceof Error && error.message?.includes('EACCES')) {
        // Permission errors are expected in some environments, skip silently
      } else if (error instanceof Error) {
        console.warn(`  ⚠️  Could not scan directory: ${dir}`, error.message);
      } else {
        console.warn(`  ⚠️  Could not scan directory: ${dir}`);
      }
    }
  }

  // Scan key directories
  const dirsToScan = [
    CONTROL_CENTER_DIR,
    LIB_DIR,
    path.join(REPO_ROOT, 'scripts'),
    path.join(REPO_ROOT, 'docs'),
  ];

  for (const dir of dirsToScan) {
    if (fs.existsSync(dir)) {
      scanForEmptyDirectories(dir);
    }
  }

  if (emptyFolders.length > 0) {
    errors.push(
      `\nFound ${emptyFolders.length} empty folder(s):\n` +
      emptyFolders.map((f) => `  - ${f}`).join('\n') +
      `\n\n` +
      `Error: Empty folders should be removed to keep repository clean\n` +
      `\n` +
      `Remedy:\n` +
      `  - Bash:       rm -rf <folder>\n` +
      `  - PowerShell: Remove-Item -Recurse -Force <folder>\n` +
      `  - Or: Add .gitkeep file if folder structure is needed`
    );

    console.log(`   ❌ Empty Folders Check FAILED (${emptyFolders.length} empty folders)`);
    return { passed: false, errors };
  }

  console.log('   ✅ Empty Folders Check PASSED');
  return { passed: true, errors: [] };
}

// ============================================================================
// Unreferenced API Routes Check
// ============================================================================

/**
 * Check for API routes that are defined but never called
 * Helps identify dead code and maintain a clean API surface
 */
function checkUnreferencedRoutes(): ValidationResult {
  console.log('🔍 Running Unreferenced API Routes Check...');

  const routes = discoverApiRoutes();
  const calls = discoverFetchCalls();
  const errors: string[] = [];
  const unreferencedRoutes: RouteInfo[] = [];

  // Routes that are called externally (webhooks, callbacks, health checks, etc.) 
  // and may not have internal client references
  const EXTERNALLY_CALLED_ROUTES = [
    '/api/webhooks/github',           // GitHub webhook receiver
    '/api/webhooks/slack',            // Slack webhook receiver
    '/api/auth/callback',             // OAuth callback endpoint
    '/api/auth/github/callback',      // GitHub OAuth callback
    '/api/health',                    // Health check endpoint (monitoring)
    '/api/ready',                     // Readiness probe (K8s/ECS)
    '/api/build-info',                // Build metadata endpoint
    '/api/metrics',                   // Prometheus/monitoring metrics
    '/api/webhooks/events/[id]',      // Webhook event retrieval (external polling)
  ];

  for (const route of routes) {
    // Skip externally called routes
    if (EXTERNALLY_CALLED_ROUTES.includes(route.apiPath)) {
      continue;
    }

    // Check if route is referenced by any client call
    const isReferenced = calls.some((call) => matchesRoute(call.apiPath, route.apiPath));

    if (!isReferenced) {
      unreferencedRoutes.push(route);
    }
  }

  console.log(`   Found ${routes.length} API routes`);
  console.log(`   Found ${calls.length} client fetch calls`);
  console.log(`   Found ${unreferencedRoutes.length} unreferenced routes`);

  if (unreferencedRoutes.length > 0) {
    errors.push(
      `\nFound ${unreferencedRoutes.length} unreferenced API route(s):\n` +
      unreferencedRoutes.map((r) => {
        const relativePath = path.relative(REPO_ROOT, r.filePath);
        return `  - ${r.apiPath}\n    File: ${relativePath}`;
      }).join('\n') +
      `\n\n` +
      `Warning: These routes are defined but not called by any client code\n` +
      `\n` +
      `Remedy:\n` +
      `  - Remove unused routes to reduce code surface\n` +
      `  - OR verify routes are called externally (webhooks, etc.)\n` +
      `  - OR add to EXTERNALLY_CALLED_ROUTES if intentionally external`
    );

    console.log(`   ⚠️  Unreferenced Routes Check WARNING (${unreferencedRoutes.length} routes)`);
    // Return as warning (passed: true) but with errors for logging
    return { passed: true, errors };
  }

  console.log('   ✅ Unreferenced Routes Check PASSED');
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
// Secret Files Check (EPIC E66 / I661)
// ============================================================================

/**
 * Check for secret files that should never be committed
 * Part of I661 — Repo Security Hardening
 */
function checkSecretFiles(): ValidationResult {
  console.log('🔍 Running Secret Files Check...');

  const errors: string[] = [];
  const foundSecretFiles: string[] = [];

  // Directories to exclude from secret scanning
  const EXCLUDED_DIRS = [
    'node_modules',
    '.git',
    '.next',
    'dist',
    'build',
    'coverage',
    'cdk.out',
    '.worktrees',
  ];

  function matchesSecretPattern(filename: string): boolean {
    return SECRET_FILE_PATTERNS.some((pattern) => {
      // Simple glob matching for common patterns
      // Handles: *.ext, prefix*, *suffix, exact-match
      if (pattern.includes('*')) {
        // Escape special regex characters to prevent injection
        const escapedPattern = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape all regex special chars
          .replace(/\*/g, '.*');  // Then convert glob * to regex .*
        const regex = new RegExp(`^${escapedPattern}$`);
        return regex.test(filename);
      } else {
        // Exact match
        return filename === pattern;
      }
    });
  }

  function scanForSecretFiles(dir: string, depth: number = 0): void {
    if (depth > MAX_SCAN_DEPTH) return;
    if (!fs.existsSync(dir)) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        // Skip excluded directories
        if (EXCLUDED_DIRS.includes(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          scanForSecretFiles(fullPath, depth + 1);
        } else if (entry.isFile()) {
          if (matchesSecretPattern(entry.name)) {
            const relativePath = path.relative(REPO_ROOT, fullPath);
            foundSecretFiles.push(relativePath);
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read (permission errors are common)
      if (error instanceof Error && error.message?.includes('EACCES')) {
        // Permission denied - skip silently
        return;
      }
      // Log other unexpected errors but continue
      if (error instanceof Error) {
        console.warn(`  ⚠️  Could not scan directory: ${dir} - ${error.message}`);
      }
    }
  }

  // Scan the entire repository
  scanForSecretFiles(REPO_ROOT);

  if (foundSecretFiles.length > 0) {
    const fileList = foundSecretFiles.slice(0, 10).map((f) => `  - ${f}`).join('\n') +
      (foundSecretFiles.length > 10 ? `\n  ... and ${foundSecretFiles.length - 10} more` : '');
    
    errors.push(
      `\n❌ CRITICAL SECURITY VIOLATION: Found ${foundSecretFiles.length} secret file(s):\n` +
      fileList +
      `\n\n` +
      `Error: Secret files must NEVER be committed to the repository\n` +
      `\n` +
      `These files may contain:\n` +
      `  - API keys, tokens, passwords\n` +
      `  - Private keys (GitHub App, SSH, etc.)\n` +
      `  - Environment-specific credentials\n` +
      `\n` +
      `IMMEDIATE ACTIONS REQUIRED:\n` +
      `\n` +
      `1. DO NOT COMMIT OR PUSH\n` +
      `\n` +
      `2. Remove files from working tree:\n` +
      foundSecretFiles.map((f) => `   git rm --cached ${f}`).join('\n') +
      `\n\n` +
      `3. Verify secrets are in AWS Secrets Manager:\n` +
      `   aws secretsmanager list-secrets --filters Key=name,Values=afu9/\n` +
      `\n` +
      `4. Check if already in git history:\n` +
      `   git log --all --name-only -- <file>\n` +
      `   If found in history, see docs/v065/HISTORY_REWRITE.md\n` +
      `\n` +
      `5. If secret was exposed, ROTATE IMMEDIATELY:\n` +
      `   See docs/v065/SECURITY_ROTATION.md\n` +
      `\n` +
      `6. Verify .gitignore includes these patterns:\n` +
      SECRET_FILE_PATTERNS.map((p) => `   ${p}`).join('\n') +
      `\n\n` +
      `Related Documentation:\n` +
      `  - docs/v065/SECURITY_ROTATION.md - Secret rotation procedures\n` +
      `  - docs/v065/HISTORY_REWRITE.md - History sanitization\n` +
      `  - docs/v065/SECRET_SCANNING_SETUP.md - Prevention setup\n` +
      `\n` +
      `This check is part of I661 (E66) — Repo Security Hardening`
    );

    console.log(`   ❌ Secret Files Check FAILED (${foundSecretFiles.length} violations)`);
    return { passed: false, errors };
  }

  console.log('   ✅ Secret Files Check PASSED');
  return { passed: true, errors: [] };
}

// ============================================================================
// Tracked Artifacts Check (I671 / E67)
// ============================================================================

/**
 * Check for tracked artifact files/directories that should be in .gitignore
 * Part of I671 — Repo Hygiene & Determinism
 */
function checkTrackedArtifacts(): ValidationResult {
  console.log('🔍 Running Tracked Artifacts Check...');

  const errors: string[] = [];
  const trackedArtifacts: string[] = [];

  // Get list of all tracked files from git
  try {
    const output = execSync('git ls-files', {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    const trackedFiles = output.trim().split('\n').filter(Boolean);

    // Check each tracked file against artifact denylist
    for (const file of trackedFiles) {
      for (const artifactPath of ARTIFACT_DENYLIST) {
        const segments = file.split('/');
        
        // Only flag if artifact directory is at root or in a known project directory
        // This avoids false positives like "src/lib/build/" which is source code
        const isRootArtifact = segments[0] === artifactPath;
        
        // Check if in any known project directory structure
        const isProjectArtifact = PROJECT_DIRECTORIES.some((projectDir) => {
          if (segments[0] === projectDir) {
            // For simple project dirs (control-center), check second segment
            if (segments.length > 1 && segments[1] === artifactPath) return true;
            // For nested dirs (apps/*, packages/*), check third segment
            if (segments.length > 2 && segments[2] === artifactPath) return true;
          }
          return false;
        });
        
        if (isRootArtifact || isProjectArtifact) {
          trackedArtifacts.push(file);
          break;
        }
      }
    }
  } catch (error) {
    console.log('   ⚠️  Tracked Artifacts Check SKIPPED (not a git repository or git unavailable)');
    return { passed: true, errors: [] };
  }

  if (trackedArtifacts.length > 0) {
    // Group by artifact type for better reporting
    const groupedArtifacts: { [key: string]: string[] } = {};
    for (const file of trackedArtifacts) {
      const segments = file.split('/');
      let artifactType = 'other';
      
      // Determine artifact type from path
      for (const artifact of ARTIFACT_DENYLIST) {
        if (segments.includes(artifact)) {
          artifactType = artifact;
          break;
        }
      }
      
      if (!groupedArtifacts[artifactType]) {
        groupedArtifacts[artifactType] = [];
      }
      groupedArtifacts[artifactType].push(file);
    }

    const groupedList = Object.entries(groupedArtifacts)
      .map(([type, files]) => {
        const fileList = files.slice(0, 5).map((f) => `    - ${f}`).join('\n') +
          (files.length > 5 ? `\n    ... and ${files.length - 5} more` : '');
        return `  [${type}]:\n${fileList}`;
      })
      .join('\n\n');

    errors.push(
      `\n❌ CRITICAL: Found ${trackedArtifacts.length} tracked artifact file(s):\n` +
      groupedList +
      `\n\n` +
      `Error: Build/runtime artifacts must NEVER be committed to repository\n` +
      `\n` +
      `These artifacts break build determinism and bloat repository size.\n` +
      `\n` +
      `IMMEDIATE ACTIONS REQUIRED:\n` +
      `\n` +
      `1. DO NOT COMMIT OR PUSH\n` +
      `\n` +
      `2. Remove artifacts from git tracking:\n` +
      trackedArtifacts.slice(0, 10).map((f) => `   git rm -r --cached ${f}`).join('\n') +
      (trackedArtifacts.length > 10 ? '\n   # ... and more (run for each file)' : '') +
      `\n\n` +
      `3. Verify .gitignore includes these patterns:\n` +
      ARTIFACT_DENYLIST.map((a) => `   ${a}/`).join('\n') +
      `\n\n` +
      `4. Clean local artifacts:\n` +
      `   npm run clean  # or manually remove artifact directories\n` +
      `\n` +
      `5. Verify working tree is clean:\n` +
      `   git status --porcelain  # should be empty after cleanup\n` +
      `\n` +
      `Related Documentation:\n` +
      `  - docs/v065/DETERMINISM.md - Build determinism policy\n` +
      `  - .gitignore - Artifact exclusion patterns\n` +
      `\n` +
      `This check is part of I671 (E67) — Repo Hygiene & Determinism`
    );

    console.log(`   ❌ Tracked Artifacts Check FAILED (${trackedArtifacts.length} violations)`);
    return { passed: false, errors };
  }

  console.log('   ✅ Tracked Artifacts Check PASSED');
  return { passed: true, errors: [] };
}

// ============================================================================
// Large File Check (I671 / E67)
// ============================================================================

/**
 * Check for large files that exceed size limit
 * Part of I671 — Repo Hygiene & Determinism
 */
function checkLargeFiles(): ValidationResult {
  console.log('🔍 Running Large File Check...');

  const errors: string[] = [];
  const largeFiles: Array<{ path: string; size: number }> = [];

  // Get list of all tracked files from git
  try {
    const output = execSync('git ls-files', {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    const trackedFiles = output.trim().split('\n').filter(Boolean);
    
    // Convert allowlist to Set for O(1) lookup performance
    const allowlistSet = new Set(LARGE_FILE_ALLOWLIST);

    // Check size of each tracked file
    for (const file of trackedFiles) {
      const fullPath = path.join(REPO_ROOT, file);
      
      // Skip if file doesn't exist (e.g., submodule)
      if (!fs.existsSync(fullPath)) continue;

      try {
        const stats = fs.statSync(fullPath);
        
        // Skip if not a regular file
        if (!stats.isFile()) continue;

        // Check if file exceeds size limit and is not in allowlist
        if (stats.size > MAX_FILE_SIZE_BYTES && !allowlistSet.has(file)) {
          largeFiles.push({ path: file, size: stats.size });
        }
      } catch (error) {
        // Skip files we can't stat
        continue;
      }
    }
  } catch (error) {
    console.log('   ⚠️  Large File Check SKIPPED (not a git repository or git unavailable)');
    return { passed: true, errors: [] };
  }

  if (largeFiles.length > 0) {
    // Sort by size descending
    largeFiles.sort((a, b) => b.size - a.size);

    const formatSize = (bytes: number): string => {
      const mb = bytes / (1024 * 1024);
      return `${mb.toFixed(2)} MB`;
    };

    const fileList = largeFiles
      .slice(0, 10)
      .map((f) => `  - ${f.path} (${formatSize(f.size)})`)
      .join('\n') +
      (largeFiles.length > 10 ? `\n  ... and ${largeFiles.length - 10} more` : '');

    errors.push(
      `\n⚠️  Found ${largeFiles.length} large file(s) exceeding ${formatSize(MAX_FILE_SIZE_BYTES)}:\n` +
      fileList +
      `\n\n` +
      `Warning: Large files bloat repository and slow down clone/fetch operations\n` +
      `\n` +
      `Recommended Actions:\n` +
      `\n` +
      `1. Review if these files are necessary in version control:\n` +
      `   - Generated files? → Add to .gitignore\n` +
      `   - Test fixtures? → Consider smaller samples or external storage\n` +
      `   - Binary assets? → Use Git LFS or external CDN\n` +
      `\n` +
      `2. If files are legitimate and must be tracked:\n` +
      `   - Add to LARGE_FILE_ALLOWLIST in scripts/repo-verify.ts\n` +
      `   - Document why file is necessary in comments\n` +
      `\n` +
      `3. For binary assets consider:\n` +
      `   - Git LFS (Large File Storage)\n` +
      `   - External storage (S3, CDN)\n` +
      `   - Asset optimization/compression\n` +
      `\n` +
      `Related Documentation:\n` +
      `  - docs/v065/DETERMINISM.md - Repository hygiene policy\n` +
      `\n` +
      `This check is part of I671 (E67) — Repo Hygiene & Determinism`
    );

    console.log(`   ⚠️  Large File Check WARNING (${largeFiles.length} files)`);
    // Return as warning (passed: true) but with errors for logging
    return { passed: true, errors };
  }

  console.log('   ✅ Large File Check PASSED');
  return { passed: true, errors: [] };
}

// ============================================================================
// Issue Sync MVP Check (AFU-9)
// ============================================================================

/**
 * Check that Issue Sync MVP components are present
 * - Migration 039 (issue_snapshots, issue_sync_runs)
 * - POST /api/ops/issues/sync route
 * - GET /api/issues/status route (optional, may exist from other features)
 */
function checkIssueSyncMvp(): ValidationResult {
  console.log('🔍 Running Issue Sync MVP Check...');

  const errors: string[] = [];

  // Check for migration 039
  const migrationPath = path.join(REPO_ROOT, 'database', 'migrations', '039_issue_sync_snapshots.sql');
  if (!fs.existsSync(migrationPath)) {
    errors.push(
      `\n❌ Issue Sync MVP migration missing:\n` +
      `   Expected: database/migrations/039_issue_sync_snapshots.sql\n` +
      `\n` +
      `   This migration should create:\n` +
      `   - issue_snapshots table (GitHub issue snapshots)\n` +
      `   - issue_sync_runs table (sync operation ledger)\n` +
      `\n` +
      `   Remedy: Create migration 039 with required schema\n`
    );
  }

  // Check for POST /api/ops/issues/sync route
  const syncRoutePath = path.join(CONTROL_CENTER_DIR, 'app', 'api', 'ops', 'issues', 'sync', 'route.ts');
  if (!fs.existsSync(syncRoutePath)) {
    errors.push(
      `\n❌ Issue Sync route missing:\n` +
      `   Expected: control-center/app/api/ops/issues/sync/route.ts\n` +
      `\n` +
      `   This route should implement:\n` +
      `   - POST handler for syncing GitHub issues\n` +
      `   - Auth-first validation\n` +
      `   - Deterministic pagination\n` +
      `   - GitHub App-only authentication (no PAT)\n` +
      `\n` +
      `   Remedy: Create POST /api/ops/issues/sync route\n`
    );
  }

  // Optional: Check for GET /api/issues/status route (may exist from other features)
  const statusRoutePath = path.join(CONTROL_CENTER_DIR, 'app', 'api', 'issues', 'status', 'route.ts');
  if (!fs.existsSync(statusRoutePath)) {
    console.log('   ⚠️  Note: GET /api/issues/status route not found (optional)');
  }

  if (errors.length > 0) {
    console.log(`   ❌ Issue Sync MVP Check FAILED (${errors.length} violations)`);
    return { passed: false, errors };
  }

  console.log('   ✅ Issue Sync MVP Check PASSED');
  return { passed: true, errors: [] };
}

// ============================================================================
// State Model v1 Guardrails (I5)
// ============================================================================

// I5 Guardrails: Maximum allowed direct issue.status references without effectiveStatus
const MAX_LEGACY_STATUS_REFERENCES = 10;

/**
 * Check that State Model v1 is used end-to-end
 * - Migration 043 (github_mirror_status column)
 * - Sync route updates github_mirror_status
 * - API returns effectiveStatus
 * - UI uses effectiveStatus
 */
function checkStateModelV1(): ValidationResult {
  console.log('🔍 Running State Model v1 Guardrails Check...');

  const errors: string[] = [];

  // 1. Check for migration 043 (github_mirror_status column)
  const migration43Path = path.join(REPO_ROOT, 'database', 'migrations', '043_state_model_v1_fields.sql');
  if (!fs.existsSync(migration43Path)) {
    errors.push(
      `\n❌ State Model v1 migration missing:\n` +
      `   Expected: database/migrations/043_state_model_v1_fields.sql\n` +
      `\n` +
      `   This migration should add:\n` +
      `   - github_mirror_status column (enum: TODO, IN_PROGRESS, IN_REVIEW, DONE, BLOCKED, UNKNOWN)\n` +
      `\n` +
      `   Remedy: Create migration 043 with github_mirror_status column\n`
    );
  }

  // 2. Check sync route updates github_mirror_status
  const syncRoutePath = path.join(CONTROL_CENTER_DIR, 'app', 'api', 'ops', 'issues', 'sync', 'route.ts');
  if (fs.existsSync(syncRoutePath)) {
    const syncContent = fs.readFileSync(syncRoutePath, 'utf-8');
    
    // Check for github_mirror_status update logic
    if (!syncContent.includes('github_mirror_status') && !syncContent.includes('githubMirrorStatus')) {
      errors.push(
        `\n❌ Sync route does not update github_mirror_status:\n` +
        `   File: control-center/app/api/ops/issues/sync/route.ts\n` +
        `\n` +
        `   The sync route MUST:\n` +
        `   - Extract GitHub status from Projects/Labels/State\n` +
        `   - Map to GithubMirrorStatus enum using extractGithubMirrorStatus()\n` +
        `   - Persist to github_mirror_status column\n` +
        `\n` +
        `   Expected pattern:\n` +
        `   - extractGithubMirrorStatus(projectStatus, labels, issueState)\n` +
        `   - updateAfu9Issue(pool, id, { github_mirror_status: ... })\n` +
        `\n` +
        `   Remedy: Add github_mirror_status update logic to sync route\n`
      );
    }

    // Check for extractGithubMirrorStatus usage
    if (!syncContent.includes('extractGithubMirrorStatus')) {
      errors.push(
        `\n❌ Sync route does not use extractGithubMirrorStatus helper:\n` +
        `   File: control-center/app/api/ops/issues/sync/route.ts\n` +
        `\n` +
        `   The sync route MUST use the canonical helper:\n` +
        `   - import { extractGithubMirrorStatus } from '@/lib/issues/stateModel'\n` +
        `   - Call extractGithubMirrorStatus(projectStatus, labels, issueState)\n` +
        `\n` +
        `   This ensures consistent GitHub status mapping across the system.\n` +
        `\n` +
        `   Remedy: Use extractGithubMirrorStatus() from stateModel.ts\n`
      );
    }
  }

  // 3. Check API _shared.ts computes effectiveStatus
  const sharedApiPath = path.join(CONTROL_CENTER_DIR, 'app', 'api', 'issues', '_shared.ts');
  if (fs.existsSync(sharedApiPath)) {
    const sharedContent = fs.readFileSync(sharedApiPath, 'utf-8');
    
    if (!sharedContent.includes('effectiveStatus') || !sharedContent.includes('computeEffectiveStatus')) {
      errors.push(
        `\n❌ API does not compute effectiveStatus:\n` +
        `   File: control-center/app/api/issues/_shared.ts\n` +
        `\n` +
        `   The API MUST:\n` +
        `   - Import computeEffectiveStatus from stateModel\n` +
        `   - Compute effectiveStatus server-side\n` +
        `   - Include effectiveStatus in API response\n` +
        `\n` +
        `   Expected pattern:\n` +
        `   - const effectiveStatus = computeEffectiveStatus({ localStatus, githubMirrorStatus, executionState, handoffState })\n` +
        `   - return { ...issue, effectiveStatus }\n` +
        `\n` +
        `   Remedy: Add effectiveStatus computation in normalizeIssueForApi()\n`
      );
    }
  } else {
    errors.push(
      `\n❌ API shared helpers missing:\n` +
      `   Expected: control-center/app/api/issues/_shared.ts\n` +
      `\n` +
      `   This file should contain:\n` +
      `   - normalizeIssueForApi() with effectiveStatus computation\n` +
      `\n` +
      `   Remedy: Create _shared.ts with State Model v1 support\n`
    );
  }

  // 4. Check UI uses effectiveStatus
  const issuesPagePath = path.join(CONTROL_CENTER_DIR, 'app', 'issues', 'page.tsx');
  if (fs.existsSync(issuesPagePath)) {
    const pageContent = fs.readFileSync(issuesPagePath, 'utf-8');
    
    if (!pageContent.includes('effectiveStatus')) {
      errors.push(
        `\n❌ UI does not use effectiveStatus:\n` +
        `   File: control-center/app/issues/page.tsx\n` +
        `\n` +
        `   The UI MUST:\n` +
        `   - Read effectiveStatus from API response\n` +
        `   - Use effectiveStatus for display (primary status badge)\n` +
        `   - Use effectiveStatus for filtering and sorting\n` +
        `\n` +
        `   Expected pattern:\n` +
        `   - const effectiveStatus = issue.effectiveStatus ?? mapToCanonicalStatus(issue.status)\n` +
        `   - Display effectiveStatus in status column\n` +
        `\n` +
        `   Remedy: Update UI to use effectiveStatus from API\n`
      );
    }

    // Check for legacy status usage (regression guard)
    // Look for patterns like: issue.status (without effectiveStatus on the same line)
    const statusUsagePattern = /issue\.status(?!\w)/g;
    const lines = pageContent.split('\n');
    let directStatusCount = 0;
    
    for (const line of lines) {
      // Skip lines that already use effectiveStatus (proper usage)
      if (line.includes('effectiveStatus')) continue;
      
      // Count lines with issue.status that don't have effectiveStatus
      if (statusUsagePattern.test(line)) {
        directStatusCount++;
        statusUsagePattern.lastIndex = 0; // Reset regex
      }
    }
    
    // Allow moderate legacy usage (up to MAX_LEGACY_STATUS_REFERENCES) for backward compatibility
    // and legitimate use cases (e.g., showing legacy status indicator, tooltips)
    if (directStatusCount > MAX_LEGACY_STATUS_REFERENCES) {
      errors.push(
        `\n⚠️  UI has ${directStatusCount} direct issue.status references without effectiveStatus:\n` +
        `   File: control-center/app/issues/page.tsx\n` +
        `\n` +
        `   While some legacy usage is acceptable, excessive direct status\n` +
        `   access indicates potential regressions where effectiveStatus is ignored.\n` +
        `\n` +
        `   Pattern found: issue.status (without effectiveStatus on same line)\n` +
        `\n` +
        `   Remedy: Replace with: issue.effectiveStatus ?? mapToCanonicalStatus(issue.status)\n`
      );
    }
  }

  // 5. Check stateModel.ts helpers exist
  const stateModelPath = path.join(CONTROL_CENTER_DIR, 'src', 'lib', 'issues', 'stateModel.ts');
  if (fs.existsSync(stateModelPath)) {
    const stateModelContent = fs.readFileSync(stateModelPath, 'utf-8');
    
    const requiredFunctions = [
      'computeEffectiveStatus',
      'extractGithubMirrorStatus',
      'mapGithubMirrorStatusToEffective',
    ];
    
    const missingFunctions = requiredFunctions.filter(fn => !stateModelContent.includes(fn));
    
    if (missingFunctions.length > 0) {
      errors.push(
        `\n❌ State Model helpers missing required functions:\n` +
        `   File: control-center/src/lib/issues/stateModel.ts\n` +
        `\n` +
        `   Missing functions:\n` +
        missingFunctions.map(fn => `   - ${fn}()`).join('\n') +
        `\n\n` +
        `   Remedy: Implement missing State Model v1 helper functions\n`
      );
    }
  } else {
    errors.push(
      `\n❌ State Model helpers missing:\n` +
      `   Expected: control-center/src/lib/issues/stateModel.ts\n` +
      `\n` +
      `   This file should contain:\n` +
      `   - computeEffectiveStatus()\n` +
      `   - extractGithubMirrorStatus()\n` +
      `   - mapGithubMirrorStatusToEffective()\n` +
      `\n` +
      `   Remedy: Create stateModel.ts with State Model v1 helpers\n`
    );
  }

  if (errors.length > 0) {
    console.log(`   ❌ State Model v1 Guardrails Check FAILED (${errors.length} violations)`);
    return { passed: false, errors };
  }

  console.log('   ✅ State Model v1 Guardrails Check PASSED');
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
    checkTrackedArtifacts(),  // NEW: I671 artifact tracking check
    checkLargeFiles(),         // NEW: I671 file size check
    checkSecretFiles(),        // I661 security check
    checkEmptyFolders(),
    checkUnreferencedRoutes(),
    checkDeployEcsWorkflowInvariants(),
    checkEcsResourceSanity(),
    checkMixedScope(),
    checkIssueSyncMvp(),       // AFU-9 Issue Sync MVP
    checkStateModelV1(),       // I5: State Model v1 Guardrails
  ];

  console.log('\n=====================================');
  console.log('Verification Summary');
  console.log('=====================================\n');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  // Warnings are checks that passed but have informational messages (non-blocking)
  const warnings = results.filter((r) => r.passed && r.errors.length > 0);

  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  if (warnings.length > 0) {
    console.log(`⚠  Warnings: ${warnings.length}`);
  }
  console.log(`Total: ${results.length}\n`);

  // Show warnings first (if any)
  if (warnings.length > 0) {
    console.log('⚠️  Warnings (non-blocking):\n');
    for (const result of warnings) {
      for (const error of result.errors) {
        console.log(error);
        console.log('\n' + '─'.repeat(60) + '\n');
      }
    }
  }

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
