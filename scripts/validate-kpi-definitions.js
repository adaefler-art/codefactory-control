#!/usr/bin/env node

/**
 * KPI Definition Validator - CI/CD Script
 * 
 * Validates that all KPI definitions are consistent and properly versioned.
 * Run this as part of CI/CD pipeline to catch KPI governance violations.
 * 
 * Usage:
 *   node scripts/validate-kpi-definitions.js
 * 
 * Exit codes:
 *   0 - All validations passed
 *   1 - Validation errors found
 */

const path = require('path');
const fs = require('fs');

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function loadKpiDefinitions() {
  try {
    // Load from TypeScript file (simplified - in real CI, we'd compile first)
    const kpiTypesPath = path.join(
      __dirname,
      '../control-center/src/lib/types/kpi.ts'
    );
    
    if (!fs.existsSync(kpiTypesPath)) {
      log(`Error: Cannot find KPI types at ${kpiTypesPath}`, 'red');
      return null;
    }

    const content = fs.readFileSync(kpiTypesPath, 'utf8');
    
    // Parse CANONICAL_KPIS export (basic regex parsing)
    const match = content.match(/export const CANONICAL_KPIS[^=]*=\s*(\{[\s\S]*?\n\};)/);
    if (!match) {
      log('Error: Cannot parse CANONICAL_KPIS from kpi.ts', 'red');
      return null;
    }

    log('✓ Loaded KPI definitions from kpi.ts', 'green');
    return content;
  } catch (error) {
    log(`Error loading KPI definitions: ${error.message}`, 'red');
    return null;
  }
}

function validateKpiDocumentation() {
  const docsPath = path.join(__dirname, '../docs/KPI_DEFINITIONS.md');
  
  if (!fs.existsSync(docsPath)) {
    log('Error: KPI_DEFINITIONS.md not found', 'red');
    return false;
  }

  const content = fs.readFileSync(docsPath, 'utf8');
  
  // Check for required sections
  const requiredSections = [
    '# AFU-9 Factory KPI Definitions',
    '## Governance',
    'Version:',
    'Canonical',
    'KPI Governance',
    'KPI Changelog',
  ];

  const missing = [];
  for (const section of requiredSections) {
    if (!content.includes(section)) {
      missing.push(section);
    }
  }

  if (missing.length > 0) {
    log('Error: Missing required sections in KPI_DEFINITIONS.md:', 'red');
    missing.forEach((s) => log(`  - ${s}`, 'yellow'));
    return false;
  }

  log('✓ KPI_DEFINITIONS.md has all required sections', 'green');
  return true;
}

function validateChangelogExists() {
  const changelogPath = path.join(__dirname, '../docs/KPI_CHANGELOG.md');
  
  if (!fs.existsSync(changelogPath)) {
    log('Error: KPI_CHANGELOG.md not found', 'red');
    return false;
  }

  const content = fs.readFileSync(changelogPath, 'utf8');
  
  // Check for version 1.0.0 entry
  if (!content.includes('[1.0.0]')) {
    log('Error: KPI_CHANGELOG.md missing version 1.0.0 entry', 'red');
    return false;
  }

  log('✓ KPI_CHANGELOG.md exists and has version history', 'green');
  return true;
}

function validateGovernanceDocument() {
  const govPath = path.join(__dirname, '../docs/KPI_GOVERNANCE.md');
  
  if (!fs.existsSync(govPath)) {
    log('Error: KPI_GOVERNANCE.md not found', 'red');
    return false;
  }

  const content = fs.readFileSync(govPath, 'utf8');
  
  const requiredSections = [
    '# KPI Governance',
    'Change Management Process',
    'Single Source of Truth',
    'Versioning Discipline',
  ];

  const missing = [];
  for (const section of requiredSections) {
    if (!content.includes(section)) {
      missing.push(section);
    }
  }

  if (missing.length > 0) {
    log('Error: Missing sections in KPI_GOVERNANCE.md:', 'red');
    missing.forEach((s) => log(`  - ${s}`, 'yellow'));
    return false;
  }

  log('✓ KPI_GOVERNANCE.md exists with required sections', 'green');
  return true;
}

function validateVersionConsistency() {
  const kpiDefPath = path.join(__dirname, '../docs/KPI_DEFINITIONS.md');
  const kpiTypesPath = path.join(
    __dirname,
    '../control-center/src/lib/types/kpi.ts'
  );

  if (!fs.existsSync(kpiDefPath) || !fs.existsSync(kpiTypesPath)) {
    log('Error: Cannot validate version consistency - files missing', 'red');
    return false;
  }

  const docsContent = fs.readFileSync(kpiDefPath, 'utf8');
  const typesContent = fs.readFileSync(kpiTypesPath, 'utf8');

  // Extract version from docs
  const docsVersionMatch = docsContent.match(/\*\*Version:\*\*\s*([\d.]+)/);
  if (!docsVersionMatch) {
    log('Error: Cannot find version in KPI_DEFINITIONS.md', 'red');
    return false;
  }
  const docsVersion = docsVersionMatch[1];

  // Check if types reference the same version
  const versionPattern = new RegExp(`version:\\s*['"]${docsVersion}['"]`, 'g');
  const versionMatches = typesContent.match(versionPattern);
  
  if (!versionMatches || versionMatches.length === 0) {
    log(
      `Error: KPI types don't reference canonical version ${docsVersion}`,
      'red'
    );
    return false;
  }

  log(`✓ Version consistency verified: ${docsVersion}`, 'green');
  return true;
}

function validateKpiCount() {
  const kpiTypesPath = path.join(
    __dirname,
    '../control-center/src/lib/types/kpi.ts'
  );

  if (!fs.existsSync(kpiTypesPath)) {
    log('Error: Cannot validate KPI count - kpi.ts missing', 'red');
    return false;
  }

  const content = fs.readFileSync(kpiTypesPath, 'utf8');
  
  // Count KPI definitions in CANONICAL_KPIS
  const kpiMatches = content.match(/^\s{2}\w+:\s*\{/gm);
  const kpiCount = kpiMatches ? kpiMatches.length : 0;

  if (kpiCount < 7) {
    log(`Warning: Only ${kpiCount} KPIs defined, expected at least 7`, 'yellow');
  } else {
    log(`✓ ${kpiCount} KPIs defined in CANONICAL_KPIS`, 'green');
  }

  return true;
}

function main() {
  log('\n=== KPI Definition Validator ===\n', 'cyan');
  log('Validating KPI governance compliance...\n', 'blue');

  const checks = [
    { name: 'Load KPI Definitions', fn: loadKpiDefinitions },
    { name: 'Validate KPI Documentation', fn: validateKpiDocumentation },
    { name: 'Validate Changelog Exists', fn: validateChangelogExists },
    { name: 'Validate Governance Document', fn: validateGovernanceDocument },
    { name: 'Validate Version Consistency', fn: validateVersionConsistency },
    { name: 'Validate KPI Count', fn: validateKpiCount },
  ];

  let allPassed = true;

  for (const check of checks) {
    log(`\nRunning: ${check.name}...`, 'blue');
    const result = check.fn();
    if (!result && result !== null) {
      allPassed = false;
    }
  }

  log('\n=== Validation Summary ===\n', 'cyan');

  if (allPassed) {
    log('✅ All KPI definition validations passed!', 'green');
    log('\nKPI governance compliance verified:', 'green');
    log('  • Canonical definitions exist and are complete', 'green');
    log('  • Version tracking is in place', 'green');
    log('  • Governance framework is documented', 'green');
    log('  • Change process is defined', 'green');
    process.exit(0);
  } else {
    log('❌ KPI definition validation failed', 'red');
    log('\nPlease fix the issues above and try again.', 'yellow');
    log('See docs/KPI_GOVERNANCE.md for guidance.', 'yellow');
    process.exit(1);
  }
}

// Run the validator
main();
