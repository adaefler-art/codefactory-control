/**
 * GitHub Checks Classifier
 * 
 * Classifies GitHub check runs into failure types based on check name patterns.
 * Uses deterministic pattern matching for consistent classification.
 * 
 * Reference: E84.1 - Checks Triage Analyzer
 */

import { FailureType } from '@/lib/types/checks-triage';

/**
 * Classification patterns for different failure types
 * Order matters: first match wins
 */
const CLASSIFICATION_PATTERNS: Array<{
  type: FailureType;
  patterns: RegExp[];
}> = [
  // Linting checks
  {
    type: 'lint',
    patterns: [
      /\blint\b/i,
      /\beslint\b/i,
      /\btslint\b/i,
      /\bpylint\b/i,
      /\brubocop\b/i,
      /\bstyle\b.*\bcheck\b/i,
      /\bcode.*\bstyle\b/i,
      /\bformat\b.*\bcheck\b/i,
      /\bprettier\b/i,
      /\bblack\b.*\bcheck\b/i,
      /\bflake8\b/i,
    ],
  },
  // Test checks
  {
    type: 'test',
    patterns: [
      /\btest\b/i,
      /\bspec\b/i,
      /\bjest\b/i,
      /\bmocha\b/i,
      /\bkarma\b/i,
      /\bpytest\b/i,
      /\bunit\b/i,
      /\bintegration\b.*\btest\b/i,
      /\brspec\b/i,
      /\bminitest\b/i,
      /\bvitest\b/i,
    ],
  },
  // E2E/UI tests
  {
    type: 'e2e',
    patterns: [
      /\be2e\b/i,
      /\bend.*to.*end\b/i,
      /\bcypress\b/i,
      /\bplaywright\b/i,
      /\bselenium\b/i,
      /\bpuppeteer\b/i,
      /\bui.*\btest\b/i,
      /\bacceptance\b/i,
      /\bfunctional\b.*\btest\b/i,
    ],
  },
  // Build checks
  {
    type: 'build',
    patterns: [
      /\bbuild\b/i,
      /\bcompile\b/i,
      /\btsc\b/i,
      /\btypescript\b.*\bcheck\b/i,
      /\bwebpack\b/i,
      /\bvite\b.*\bbuild\b/i,
      /\bnpm\b.*\bbuild\b/i,
      /\byarn\b.*\bbuild\b/i,
      /\bpnpm\b.*\bbuild\b/i,
      /\bmaven\b/i,
      /\bgradle\b/i,
      /\bcargo\b.*\bbuild\b/i,
      /\bgo\b.*\bbuild\b/i,
    ],
  },
  // Deploy checks
  {
    type: 'deploy',
    patterns: [
      /\bdeploy\b/i,
      /\brelease\b/i,
      /\bpublish\b/i,
      /\bvercel\b/i,
      /\bnetlify\b/i,
      /\bheroku\b/i,
      /\baws\b.*\bdeploy\b/i,
      /\bgcp\b.*\bdeploy\b/i,
      /\bazure\b.*\bdeploy\b/i,
    ],
  },
  // Infrastructure checks
  {
    type: 'infra',
    patterns: [
      /\binfra\b/i,
      /\binfrastructure\b/i,
      /\bterraform\b/i,
      /\bcdk\b/i,
      /\bcloudformation\b/i,
      /\bpulumi\b/i,
      /\bansible\b/i,
      /\bdocker\b/i,
      /\bkubernetes\b/i,
      /\bk8s\b/i,
      /\bhelm\b/i,
    ],
  },
];

/**
 * Classify a check name into a failure type
 * 
 * Uses pattern matching to determine the most likely failure type.
 * Returns 'unknown' if no patterns match.
 * 
 * @param checkName - The name of the GitHub check run
 * @returns The classified failure type
 */
export function classifyCheck(checkName: string): FailureType {
  const normalized = checkName.toLowerCase().trim();
  
  for (const { type, patterns } of CLASSIFICATION_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        return type;
      }
    }
  }
  
  return 'unknown';
}

/**
 * Classify multiple check names and return a summary
 * 
 * @param checkNames - Array of check names
 * @returns Map of failure types to count
 */
export function classifyChecks(
  checkNames: string[]
): Map<FailureType, number> {
  const counts = new Map<FailureType, number>();
  
  for (const checkName of checkNames) {
    const type = classifyCheck(checkName);
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  
  return counts;
}
