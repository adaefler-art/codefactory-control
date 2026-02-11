#!/usr/bin/env ts-node
/**
 * Clinical Intake Validation Script
 * Issue #10: Clinical Intake Synthesis (CRE-konform)
 * 
 * Validates clinical intake records against all rules (R-XXX)
 * 
 * Usage:
 *   ts-node scripts/validate-clinical-intake.ts [intake-file.json]
 *   
 * Output format includes "violates R-XXX" for quick diagnosis
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  validateClinicalIntakeWithRules,
  RULE_CODES,
  getRuleDescription,
  type ValidationResult 
} from '../control-center/src/lib/validators/clinicalIntakeValidator';

/**
 * Colors for console output
 */
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

/**
 * Print validation result with color-coded output
 */
function printValidationResult(result: ValidationResult, filePath?: string): void {
  console.log('\n' + '='.repeat(80));
  if (filePath) {
    console.log(`${colors.blue}File: ${filePath}${colors.reset}`);
  }
  console.log(`${colors.blue}Validated at: ${result.meta.validatedAt}${colors.reset}`);
  console.log(`${colors.blue}Schema version: ${result.meta.schemaVersion}${colors.reset}`);
  console.log(`${colors.blue}Validator version: ${result.meta.validatorVersion}${colors.reset}`);
  
  if (result.meta.hash) {
    console.log(`${colors.gray}Hash: ${result.meta.hash}${colors.reset}`);
  }
  
  console.log('='.repeat(80));
  
  // Print errors
  if (result.errors.length > 0) {
    console.log(`\n${colors.red}❌ ERRORS (${result.errors.length}):${colors.reset}\n`);
    for (const error of result.errors) {
      console.log(`${colors.red}  ✗ violates ${error.code}${colors.reset}`);
      console.log(`    ${error.message}`);
      console.log(`    ${colors.gray}Path: ${error.path}${colors.reset}`);
      if (error.details) {
        console.log(`    ${colors.gray}Details: ${JSON.stringify(error.details)}${colors.reset}`);
      }
      console.log('');
    }
  }
  
  // Print warnings
  if (result.warnings.length > 0) {
    console.log(`${colors.yellow}⚠ WARNINGS (${result.warnings.length}):${colors.reset}\n`);
    for (const warning of result.warnings) {
      console.log(`${colors.yellow}  ⚠ violates ${warning.code}${colors.reset}`);
      console.log(`    ${warning.message}`);
      console.log(`    ${colors.gray}Path: ${warning.path}${colors.reset}`);
      if (warning.details) {
        console.log(`    ${colors.gray}Details: ${JSON.stringify(warning.details)}${colors.reset}`);
      }
      console.log('');
    }
  }
  
  // Print summary
  console.log('='.repeat(80));
  if (result.isValid) {
    console.log(`${colors.green}✓ VALIDATION PASSED${colors.reset}`);
    if (result.warnings.length > 0) {
      console.log(`${colors.yellow}  (with ${result.warnings.length} warning(s))${colors.reset}`);
    }
  } else {
    console.log(`${colors.red}✗ VALIDATION FAILED${colors.reset}`);
    console.log(`${colors.red}  ${result.errors.length} error(s), ${result.warnings.length} warning(s)${colors.reset}`);
  }
  console.log('='.repeat(80) + '\n');
}

/**
 * Print all available rule codes
 */
function printRuleCodes(): void {
  console.log('\n' + '='.repeat(80));
  console.log(`${colors.blue}Available Rule Codes:${colors.reset}\n`);
  
  const categories = {
    'Schema Validation (R-001 to R-099)': Object.entries(RULE_CODES).filter(
      ([_, code]) => code.startsWith('R-0')
    ),
    'Content Quality (R-100 to R-199)': Object.entries(RULE_CODES).filter(
      ([_, code]) => code.startsWith('R-1')
    ),
    'Structural Integrity (R-200 to R-299)': Object.entries(RULE_CODES).filter(
      ([_, code]) => code.startsWith('R-2')
    ),
    'Security/Safety (R-300 to R-399)': Object.entries(RULE_CODES).filter(
      ([_, code]) => code.startsWith('R-3')
    ),
  };
  
  for (const [category, rules] of Object.entries(categories)) {
    if (rules.length > 0) {
      console.log(`${colors.blue}${category}${colors.reset}`);
      for (const [name, code] of rules) {
        const description = getRuleDescription(code);
        console.log(`  ${colors.green}${code}${colors.reset} (${name}): ${description}`);
      }
      console.log('');
    }
  }
  
  console.log('='.repeat(80) + '\n');
}

/**
 * Main validation function
 */
function main(): void {
  const args = process.argv.slice(2);
  
  // Check for --help or --rules flag
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Clinical Intake Validation Script

Usage:
  ts-node scripts/validate-clinical-intake.ts [options] [file.json]
  
Options:
  --help, -h         Show this help message
  --rules, -r        List all available rule codes
  --stdin            Read intake JSON from stdin
  
Examples:
  # Validate a file
  ts-node scripts/validate-clinical-intake.ts intake.json
  
  # List all rule codes
  ts-node scripts/validate-clinical-intake.ts --rules
  
  # Validate from stdin
  echo '{"session_id":"...","structured_intake":{...}}' | ts-node scripts/validate-clinical-intake.ts --stdin
`);
    process.exit(0);
  }
  
  if (args.includes('--rules') || args.includes('-r')) {
    printRuleCodes();
    process.exit(0);
  }
  
  // Read intake data
  let intakeData: any;
  
  if (args.includes('--stdin')) {
    // Read from stdin
    const stdinBuffer = fs.readFileSync(0, 'utf-8');
    try {
      intakeData = JSON.parse(stdinBuffer);
    } catch (error) {
      console.error(`${colors.red}Error parsing JSON from stdin:${colors.reset}`, error);
      process.exit(1);
    }
  } else {
    // Read from file
    const filePath = args[0];
    
    if (!filePath) {
      console.error(`${colors.red}Error: No file specified${colors.reset}`);
      console.log('Usage: ts-node scripts/validate-clinical-intake.ts <file.json>');
      console.log('       ts-node scripts/validate-clinical-intake.ts --help');
      process.exit(1);
    }
    
    const absolutePath = path.resolve(filePath);
    
    if (!fs.existsSync(absolutePath)) {
      console.error(`${colors.red}Error: File not found: ${absolutePath}${colors.reset}`);
      process.exit(1);
    }
    
    try {
      const fileContent = fs.readFileSync(absolutePath, 'utf-8');
      intakeData = JSON.parse(fileContent);
    } catch (error) {
      console.error(`${colors.red}Error reading or parsing file:${colors.reset}`, error);
      process.exit(1);
    }
  }
  
  // Validate
  const result = validateClinicalIntakeWithRules(intakeData);
  
  // Print result
  printValidationResult(result, args[0]);
  
  // Exit with appropriate code
  process.exit(result.isValid ? 0 : 1);
}

// Run main if executed directly
if (require.main === module) {
  main();
}

export { main as validateClinicalIntakeScript };
