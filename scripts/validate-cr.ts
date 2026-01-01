#!/usr/bin/env ts-node

/**
 * CLI Validator for Change Request JSON
 * Issue E74.2: CR Validator Library + Standard Error Format
 * 
 * Usage:
 *   ts-node scripts/validate-cr.ts <path-to-cr.json>
 *   # or
 *   node -r ts-node/register scripts/validate-cr.ts <path-to-cr.json>
 * 
 * Exit codes:
 *   0 - Validation passed (ok: true)
 *   1 - Validation failed (ok: false)
 *   2 - CLI error (invalid usage, file not found, etc.)
 */

import * as fs from 'fs';
import * as path from 'path';
import { validateChangeRequest } from '../control-center/src/lib/validators/changeRequestValidator';

function printUsage() {
  console.error('Usage: ts-node scripts/validate-cr.ts <path-to-cr.json>');
  console.error('');
  console.error('Options:');
  console.error('  <path-to-cr.json>  Path to the Change Request JSON file to validate');
  console.error('');
  console.error('Exit codes:');
  console.error('  0 - Validation passed (ok: true)');
  console.error('  1 - Validation failed (ok: false)');
  console.error('  2 - CLI error (invalid usage, file not found, etc.)');
}

function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Error: Missing CR JSON file path\n');
    printUsage();
    process.exit(2);
  }

  if (args.includes('-h') || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const crFilePath = args[0];

  // Resolve to absolute path
  const absolutePath = path.resolve(process.cwd(), crFilePath);

  // Check if file exists
  if (!fs.existsSync(absolutePath)) {
    console.error(`Error: File not found: ${absolutePath}`);
    process.exit(2);
  }

  // Read and parse JSON
  let crJson: unknown;
  try {
    const fileContent = fs.readFileSync(absolutePath, 'utf8');
    crJson = JSON.parse(fileContent);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error: Failed to read or parse JSON file: ${errorMessage}`);
    process.exit(2);
  }

  // Validate CR
  let result;
  try {
    result = validateChangeRequest(crJson);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error(`Error: Validation failed with unexpected error: ${errorMessage}`);
    console.error(errorStack);
    process.exit(2);
  }

  // Print result as JSON
  console.log(JSON.stringify(result, null, 2));

  // Exit with appropriate code
  process.exit(result.ok ? 0 : 1);
}

// Run main function
main();
