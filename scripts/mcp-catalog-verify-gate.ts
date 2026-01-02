#!/usr/bin/env ts-node
/**
 * MCP Catalog Verification Gate
 * 
 * Validates that the MCP catalog is consistent with runtime configuration.
 * This script is run during CI/CD as a deploy gate to prevent false-green scenarios.
 * 
 * Exit codes:
 * - 0: Verification passed
 * - 1: Verification failed (catalog mismatch or unreachable endpoints)
 * - 2: Script error (catalog not found, invalid config, etc.)
 * 
 * Environment variables:
 * - MCP_VERIFY_ENDPOINT: URL of the verify endpoint (default: http://localhost:3000/api/mcp/verify)
 * - MCP_VERIFY_TIMEOUT_MS: Timeout in milliseconds (default: 30000)
 * - SKIP_MCP_VERIFY: Set to 'true' to skip verification (for local dev only)
 */

import * as fs from 'fs';
import * as path from 'path';

interface VerificationResult {
  server: string;
  ok: boolean;
  catalogEndpoint?: string;
  catalogPort?: number;
  catalogContractVersion?: string;
  runtimeEndpoint?: string;
  reachable?: boolean;
  actualContractVersion?: string;
  healthCheckPassed?: boolean;
  errors: string[];
}

interface VerifyResponse {
  ok: boolean;
  status: string;
  results: VerificationResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  errors?: string[];
  catalogVersion: string;
  timestamp: string;
}

async function verifyMCPCatalog(): Promise<number> {
  console.log('🔍 MCP Catalog Verification Gate');
  console.log('================================\n');

  // Check for skip flag (dev only)
  if (process.env.SKIP_MCP_VERIFY === 'true') {
    console.log('⚠️  SKIP_MCP_VERIFY is set - skipping verification (dev only)');
    console.log('   This should NEVER be set in production CI/CD!\n');
    return 0;
  }

  // Verify catalog file exists
  const catalogPath = process.env.MCP_CATALOG_PATH || 
    path.join(process.cwd(), 'docs', 'mcp', 'catalog.json');

  if (!fs.existsSync(catalogPath)) {
    console.error(`❌ MCP catalog not found at: ${catalogPath}`);
    console.error('   Expected location: docs/mcp/catalog.json\n');
    return 2;
  }

  console.log(`✓ Catalog file found: ${catalogPath}`);

  // Parse catalog to show version
  try {
    const catalogContent = fs.readFileSync(catalogPath, 'utf-8');
    const catalog = JSON.parse(catalogContent);
    console.log(`✓ Catalog version: ${catalog.catalogVersion || 'unknown'}`);
    console.log(`✓ Server count: ${catalog.servers?.length || 0}\n`);
  } catch (error) {
    console.error(`❌ Failed to parse catalog file:`, error);
    return 2;
  }

  // Call verify endpoint
  const verifyEndpoint = process.env.MCP_VERIFY_ENDPOINT || 
    'http://localhost:3000/api/mcp/verify';
  const timeoutMs = parseInt(process.env.MCP_VERIFY_TIMEOUT_MS || '30000', 10);

  console.log(`📡 Calling verification endpoint: ${verifyEndpoint}`);
  console.log(`   Timeout: ${timeoutMs}ms\n`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(verifyEndpoint, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok && response.status !== 422) {
      console.error(`❌ Verification endpoint returned HTTP ${response.status}`);
      const text = await response.text().catch(() => 'Unable to read response');
      console.error(`   Response: ${text}\n`);
      return 2;
    }

    const result: VerifyResponse = await response.json();

    // Display results
    console.log('Verification Results');
    console.log('===================\n');
    console.log(`Status: ${result.status.toUpperCase()}`);
    console.log(`Total servers: ${result.summary.total}`);
    console.log(`Passed: ${result.summary.passed}`);
    console.log(`Failed: ${result.summary.failed}\n`);

    if (result.results.length > 0) {
      console.log('Server Details:');
      console.log('---------------');
      for (const serverResult of result.results) {
        const status = serverResult.ok ? '✓' : '✗';
        console.log(`${status} ${serverResult.server}`);
        
        if (serverResult.catalogEndpoint) {
          console.log(`  Catalog endpoint: ${serverResult.catalogEndpoint}`);
        }
        if (serverResult.runtimeEndpoint) {
          console.log(`  Runtime endpoint: ${serverResult.runtimeEndpoint}`);
        }
        if (serverResult.reachable !== undefined) {
          console.log(`  Reachable: ${serverResult.reachable ? 'yes' : 'no'}`);
        }
        if (serverResult.catalogContractVersion) {
          console.log(`  Contract version: ${serverResult.catalogContractVersion}`);
        }
        
        if (serverResult.errors.length > 0) {
          console.log(`  Errors:`);
          for (const error of serverResult.errors) {
            console.log(`    - ${error}`);
          }
        }
        console.log('');
      }
    }

    if (result.errors && result.errors.length > 0) {
      console.log('Summary Errors:');
      for (const error of result.errors) {
        console.log(`  - ${error}`);
      }
      console.log('');
    }

    if (result.ok) {
      console.log('✅ MCP catalog verification PASSED');
      console.log('   All servers are reachable and match catalog configuration\n');
      return 0;
    } else {
      console.log('❌ MCP catalog verification FAILED');
      console.log('   One or more servers have configuration drift or are unreachable');
      console.log('   Deploy should be blocked until issues are resolved\n');
      return 1;
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`❌ Verification timed out after ${timeoutMs}ms`);
      console.error('   The MCP servers may be unreachable or slow to respond\n');
      return 2;
    }

    console.error(`❌ Verification failed with error:`, error);
    console.error(`   ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

// Run verification if executed directly
if (require.main === module) {
  verifyMCPCatalog()
    .then(exitCode => {
      process.exit(exitCode);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(2);
    });
}

export { verifyMCPCatalog };
