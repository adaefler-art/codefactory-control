#!/usr/bin/env tsx
/**
 * Test the API logic without database
 * This tests the parsing and validation flow
 */

import { parseBacklogFile, validateParseResult } from '../control-center/src/lib/parsers/backlog-parser';

// Test data that simulates our actual backlog file
const testBacklogContent = `# AFU-9 Backlog v0.6

## EPIC E1 — Self-Propelling Mode v1

- I1 (E1.1): Issue State Machine aktivieren
- I2 (E1.2): Auto-Transition Engine
- I3 (E1.3): Verdict → Action Mapping
- I4 (E1.4): Failure & Retry Semantik
- I5 (E1.5): Observability & Evidence
`;

// Test cases
const testCases = [
  {
    name: 'Valid backlog file',
    content: testBacklogContent,
    expectedEpics: 1,
    expectedIssues: 5,
    shouldPass: true,
  },
  {
    name: 'Empty file',
    content: '',
    expectedEpics: 0,
    expectedIssues: 0,
    shouldPass: false, // Should fail validation
  },
  {
    name: 'Issue before Epic',
    content: `- I1 (E1.1): Test Issue\n\n## EPIC E1 — Test Epic`,
    expectedEpics: 1,
    expectedIssues: 0, // Issue should be rejected
    shouldPass: true,
  },
  {
    name: 'Multiple Epics',
    content: `## EPIC E1 — First Epic\n\n- I1 (E1.1): Issue 1\n\n## EPIC E2 — Second Epic\n\n- I2 (E2.1): Issue 2`,
    expectedEpics: 2,
    expectedIssues: 2,
    shouldPass: true,
  },
];

console.log('Running API logic tests...\n');

let passCount = 0;
let failCount = 0;

for (const testCase of testCases) {
  console.log(`Test: ${testCase.name}`);
  
  try {
    const result = parseBacklogFile(testCase.content);
    const validationErrors = validateParseResult(result);
    
    const epicsMatch = result.epics.length === testCase.expectedEpics;
    const issuesMatch = result.issues.length === testCase.expectedIssues;
    const validationPass = testCase.shouldPass ? validationErrors.length === 0 : validationErrors.length > 0;
    
    if (epicsMatch && issuesMatch && validationPass) {
      console.log(`  ✅ PASSED`);
      console.log(`     Epics: ${result.epics.length}, Issues: ${result.issues.length}`);
      passCount++;
    } else {
      console.log(`  ❌ FAILED`);
      console.log(`     Expected - Epics: ${testCase.expectedEpics}, Issues: ${testCase.expectedIssues}, Valid: ${testCase.shouldPass}`);
      console.log(`     Got - Epics: ${result.epics.length}, Issues: ${result.issues.length}, ValidationErrors: ${validationErrors.length}`);
      if (validationErrors.length > 0) {
        console.log(`     Validation errors:`, validationErrors);
      }
      if (result.errors.length > 0) {
        console.log(`     Parse errors:`, result.errors);
      }
      failCount++;
    }
  } catch (error) {
    console.log(`  ❌ EXCEPTION: ${error}`);
    failCount++;
  }
  
  console.log();
}

console.log(`Summary: ${passCount} passed, ${failCount} failed`);

if (failCount === 0) {
  console.log('✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log('❌ SOME TESTS FAILED');
  process.exit(1);
}
