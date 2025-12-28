#!/usr/bin/env tsx
/**
 * Test the backlog parser with the actual file
 */

import { parseBacklogFile, validateParseResult } from '../control-center/src/lib/parsers/backlog-parser';
import * as fs from 'fs';
import * as path from 'path';

const backlogPath = path.join(__dirname, '../docs/roadmaps/afu9_v0_6_backlog.md');
const content = fs.readFileSync(backlogPath, 'utf-8');

console.log('Testing backlog parser...\n');
console.log('File:', backlogPath);
console.log('Content length:', content.length, 'bytes\n');

const result = parseBacklogFile(content);

console.log('Parse Results:');
console.log('  Epics found:', result.epics.length);
console.log('  Issues found:', result.issues.length);
console.log('  Parse errors:', result.errors.length);

if (result.epics.length > 0) {
  console.log('\nEpics:');
  result.epics.forEach(epic => {
    console.log(`  - ${epic.externalId}: ${epic.title}`);
  });
}

if (result.issues.length > 0) {
  console.log('\nIssues:');
  result.issues.forEach(issue => {
    console.log(`  - ${issue.externalId} (Epic: ${issue.epicExternalId}): ${issue.title}`);
  });
}

if (result.errors.length > 0) {
  console.log('\nParse Errors:');
  result.errors.forEach(err => {
    console.log(`  Line ${err.line}: ${err.message}`);
  });
}

const validationErrors = validateParseResult(result);
if (validationErrors.length > 0) {
  console.log('\nValidation Errors:');
  validationErrors.forEach(err => {
    console.log(`  - ${err}`);
  });
} else {
  console.log('\n✅ Validation passed!');
}

console.log('\nExpected: 1 Epic, 5 Issues');
console.log(`Actual: ${result.epics.length} Epic(s), ${result.issues.length} Issue(s)`);

if (result.epics.length === 1 && result.issues.length === 5) {
  console.log('✅ TEST PASSED');
  process.exit(0);
} else {
  console.log('❌ TEST FAILED');
  process.exit(1);
}
