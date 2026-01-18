#!/usr/bin/env ts-node
/**
 * INTENT Incident Diagnostic Tool
 * 
 * Deterministic debug loop MVP for INTENT authoring incidents.
 * 
 * Usage:
 *   node scripts/diagnose-intent-incident.ts --file <path-to-evidence-pack.json>
 *   ts-node scripts/diagnose-intent-incident.ts --file docs/diagnostics/examples/incident_c1_missing_read_path.json
 * 
 * Output:
 *   JSON diagnostic result to stdout
 * 
 * Exit Codes:
 *   0 - Success
 *   1 - Error (invalid arguments, file not found, validation failed)
 */

import * as fs from 'fs';
import * as path from 'path';
import { diagnoseIncident, formatDiagnosticOutput } from '../control-center/src/lib/diagnostics/diagnose';
import { safeValidateEvidencePack } from '../control-center/src/lib/diagnostics/incidentSchema';

/**
 * CLI Arguments
 */
interface CliArgs {
  file?: string;
  help?: boolean;
}

/**
 * Parse CLI arguments
 */
function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    
    if (arg === '--file' && i + 1 < argv.length) {
      args.file = argv[i + 1];
      i++;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }
  
  return args;
}

/**
 * Show usage help
 */
function showHelp() {
  console.log(`
INTENT Incident Diagnostic Tool
================================

Deterministic debug loop for INTENT authoring incidents.

Usage:
  node scripts/diagnose-intent-incident.ts --file <path>
  ts-node scripts/diagnose-intent-incident.ts --file <path>

Options:
  --file <path>   Path to evidence pack JSON file (required)
  --help, -h      Show this help message

Example:
  node scripts/diagnose-intent-incident.ts --file docs/diagnostics/examples/incident_c1_missing_read_path.json

Output:
  JSON diagnostic result with classification, proofs, and playbook

Exit Codes:
  0 - Success
  1 - Error (invalid arguments, file not found, validation failed)
  `);
}

/**
 * Main execution
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  // Show help
  if (args.help) {
    showHelp();
    process.exit(0);
  }
  
  // Validate arguments
  if (!args.file) {
    console.error('Error: --file argument is required');
    console.error('Run with --help for usage information');
    process.exit(1);
  }
  
  // Resolve file path (relative to repo root or absolute)
  const repoRoot = path.resolve(__dirname, '..');
  const filePath = path.isAbsolute(args.file) 
    ? args.file 
    : path.resolve(repoRoot, args.file);
  
  // Check file exists
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }
  
  // Read file
  let fileContent: string;
  try {
    fileContent = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    console.error(`Error: Failed to read file: ${error}`);
    process.exit(1);
  }
  
  // Parse JSON
  let evidencePack: unknown;
  try {
    evidencePack = JSON.parse(fileContent);
  } catch (error) {
    console.error(`Error: Invalid JSON in file: ${error}`);
    process.exit(1);
  }
  
  // Validate evidence pack
  const validation = safeValidateEvidencePack(evidencePack);
  if (!validation.success) {
    console.error('Error: Evidence pack validation failed');
    console.error(validation.error);
    process.exit(1);
  }
  
  // Run diagnosis
  try {
    const result = diagnoseIncident(evidencePack, {
      skipValidation: false, // Already validated above
      skipRedaction: false,  // Always redact for security
    });
    
    // Output JSON
    const output = formatDiagnosticOutput(result);
    console.log(output);
    
    // Success
    process.exit(0);
  } catch (error) {
    console.error('Error: Diagnostic failed');
    console.error(error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
