/**
 * Copilot Prompt Generator
 * 
 * Generates deterministic, evidence-based prompts for GitHub Copilot
 * to fix check failures. Implements E84.2 requirements.
 * 
 * Epic E84.2: Copilot Prompt Generator
 */

import { createHash } from 'crypto';
import {
  ChecksTriageReportV1,
  CopilotPromptV1,
  CopilotPromptInput,
  FailureType,
  FailureV1,
} from '@/lib/types/checks-triage';
import { logger } from '@/lib/logger';

// ========================================
// Secret Redaction
// ========================================

/**
 * Patterns for common secrets that must be redacted
 */
const SECRET_PATTERNS = [
  // GitHub tokens
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, replacement: 'ghp_REDACTED' },
  { pattern: /gho_[a-zA-Z0-9]{36}/g, replacement: 'gho_REDACTED' },
  { pattern: /ghu_[a-zA-Z0-9]{36}/g, replacement: 'ghu_REDACTED' },
  { pattern: /ghs_[a-zA-Z0-9]{36}/g, replacement: 'ghs_REDACTED' },
  { pattern: /ghr_[a-zA-Z0-9]{36}/g, replacement: 'ghr_REDACTED' },
  
  // AWS credentials
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: 'AKIA_REDACTED' },
  { pattern: /AWS_SECRET_ACCESS_KEY[=:]\s*[A-Za-z0-9/+=]{40}/gi, replacement: 'AWS_SECRET_ACCESS_KEY=REDACTED' },
  
  // Generic secrets in URLs
  { pattern: /([?&])(token|access_token|api_key|apikey|secret)=([^&\s]+)/gi, replacement: '$1$2=REDACTED' },
  
  // Bearer tokens
  { pattern: /Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/gi, replacement: 'Bearer REDACTED' },
  
  // NPM tokens
  { pattern: /npm_[a-zA-Z0-9]{36}/g, replacement: 'npm_REDACTED' },
];

/**
 * Redact secrets from text
 */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

// ========================================
// Template System
// ========================================

/**
 * Template for a failure class prompt
 */
interface PromptTemplate {
  failureClass: FailureType;
  contextSection: string;
  instructionSection: string;
  verifySteps: string[];
  doneDefinition: string[];
}

/**
 * Get prompt template for a failure class
 */
function getTemplateForFailureClass(failureClass: FailureType): PromptTemplate {
  const baseVerifySteps = [
    'npm run repo:verify',
    'npm --prefix control-center test',
    'npm --prefix control-center run build',
  ];

  const baseDoneDefinition = [
    'All failing checks now pass',
    'No new test failures introduced',
    'Changes are minimal and focused',
    'No secrets or sensitive data in code',
  ];

  switch (failureClass) {
    case 'lint':
      return {
        failureClass,
        contextSection: `
You are fixing **linting failures** in a TypeScript/JavaScript codebase.
These failures indicate code style or formatting issues that need to be corrected.`,
        instructionSection: `
**Instructions:**
1. Fix ONLY the linting errors listed below
2. Make MINIMAL changes - only what's necessary to pass the linter
3. Follow existing code style and formatting conventions
4. Do NOT refactor or make unnecessary changes
5. Preserve existing functionality exactly`,
        verifySteps: [
          'npm --prefix control-center run lint',
          ...baseVerifySteps,
        ],
        doneDefinition: [
          'All linting errors are resolved',
          ...baseDoneDefinition,
        ],
      };

    case 'test':
      return {
        failureClass,
        contextSection: `
You are fixing **test failures** in a TypeScript/JavaScript codebase.
These failures indicate that unit tests or integration tests are failing.`,
        instructionSection: `
**Instructions:**
1. Analyze the test failures and identify the root cause
2. Fix the MINIMAL code necessary to make tests pass
3. Do NOT modify test files unless the test itself is incorrect
4. Do NOT remove or skip failing tests
5. Ensure all existing tests continue to pass
6. Add new tests only if fixing a bug that lacks coverage`,
        verifySteps: baseVerifySteps,
        doneDefinition: [
          'All test suites pass',
          'No tests were removed or skipped',
          ...baseDoneDefinition,
        ],
      };

    case 'build':
      return {
        failureClass,
        contextSection: `
You are fixing **build failures** in a TypeScript/JavaScript codebase.
These failures indicate compilation or build process errors.`,
        instructionSection: `
**Instructions:**
1. Fix compilation/TypeScript errors
2. Make MINIMAL changes to resolve build issues
3. Do NOT change tsconfig.json or build configuration unless absolutely necessary
4. Fix type errors at the source, not by adding 'any' or disabling checks
5. Ensure the build produces the expected output`,
        verifySteps: [
          'npm --prefix control-center run build',
          ...baseVerifySteps,
        ],
        doneDefinition: [
          'Build completes successfully',
          'No TypeScript errors',
          'All type checks pass',
          ...baseDoneDefinition,
        ],
      };

    case 'e2e':
      return {
        failureClass,
        contextSection: `
You are fixing **end-to-end test failures** in a web application.
These failures indicate issues with user-facing functionality.`,
        instructionSection: `
**Instructions:**
1. Analyze E2E test failures and identify the root cause
2. Fix the MINIMAL code to restore expected behavior
3. Do NOT modify E2E tests unless they are testing incorrect behavior
4. Ensure user workflows work end-to-end
5. Check for timing issues, race conditions, or selector problems`,
        verifySteps: baseVerifySteps,
        doneDefinition: [
          'All E2E tests pass',
          'User workflows function correctly',
          ...baseDoneDefinition,
        ],
      };

    case 'infra':
      return {
        failureClass,
        contextSection: `
You are addressing **infrastructure failures** in the deployment pipeline.
These failures may require manual intervention or infrastructure changes.`,
        instructionSection: `
**Instructions:**
1. Review infrastructure errors and identify the issue
2. If code changes can fix the issue (e.g., CDK/Terraform), make MINIMAL changes
3. If manual intervention is needed, document what needs to be done
4. Do NOT make breaking infrastructure changes
5. Ensure changes are backward compatible`,
        verifySteps: baseVerifySteps,
        doneDefinition: [
          'Infrastructure checks pass OR manual steps documented',
          'No breaking changes to infrastructure',
          ...baseDoneDefinition,
        ],
      };

    case 'deploy':
      return {
        failureClass,
        contextSection: `
You are addressing **deployment failures**.
These failures indicate issues during the deployment process.`,
        instructionSection: `
**Instructions:**
1. Review deployment errors and identify the issue
2. Fix MINIMAL code if the issue is in deployment scripts or configuration
3. If external service issues, document the problem
4. Do NOT change deployment configuration without understanding impact
5. Ensure deployments are idempotent and safe`,
        verifySteps: baseVerifySteps,
        doneDefinition: [
          'Deployment checks pass OR issue is documented',
          'Deployment process is safe and idempotent',
          ...baseDoneDefinition,
        ],
      };

    case 'unknown':
    default:
      return {
        failureClass: 'unknown',
        contextSection: `
You are investigating **unclassified check failures**.
The failure type is not clearly identified and requires investigation.`,
        instructionSection: `
**Instructions:**
1. Carefully analyze the failure evidence below
2. Identify the root cause of the failure
3. Make MINIMAL changes to fix the issue
4. If the issue is external or unclear, document your findings
5. Follow best practices for the type of issue you identify`,
        verifySteps: baseVerifySteps,
        doneDefinition: [
          'The identified issue is resolved',
          'Root cause is understood and documented',
          ...baseDoneDefinition,
        ],
      };
  }
}

// ========================================
// Prompt Generation
// ========================================

/**
 * Extract file hints from failure evidence
 * Looks for file paths in error messages and stack traces
 */
function extractFileHints(failures: FailureV1[]): string[] {
  const filePatterns = [
    // File paths with line numbers
    /(?:^|\s)([a-zA-Z0-9/_.-]+\.(ts|tsx|js|jsx|json|yml|yaml))(?::\d+)?/g,
    // Stack trace patterns
    /at\s+(?:.*\s+)?\(([^)]+\.(ts|tsx|js|jsx)):\d+:\d+\)/g,
  ];

  const files = new Set<string>();

  for (const failure of failures) {
    const text = failure.evidence.excerpt;
    for (const pattern of filePatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const file = match[1];
        if (file && !file.includes('node_modules') && !file.startsWith('http')) {
          files.add(file);
        }
      }
    }
  }

  return Array.from(files).sort();
}

/**
 * Format failure evidence for prompt
 */
function formatFailureEvidence(failure: FailureV1): string {
  const redactedExcerpt = redactSecrets(failure.evidence.excerpt);
  const redactedUrl = redactSecrets(failure.evidence.url);
  
  return `
### ${failure.checkName} (${failure.type})

**Status:** ${failure.conclusion}
**Evidence URL:** ${redactedUrl}
**Primary Signal:** ${redactSecrets(failure.primarySignal)}

**Log Excerpt:**
\`\`\`
${redactedExcerpt}
\`\`\`

**Excerpt Hash:** ${failure.evidence.excerptHash}
`;
}

/**
 * Generate deterministic prompt text
 */
function generatePromptText(
  report: ChecksTriageReportV1,
  template: PromptTemplate,
  fileHints: string[],
  maxFiles: number
): string {
  const { repo, pr } = report;
  
  const sections = [
    '# Fix GitHub Check Failures',
    '',
    '## Context',
    template.contextSection,
    '',
    `**Repository:** ${repo.owner}/${repo.repo}`,
    `**PR:** #${pr.number}`,
    `**Head SHA:** ${pr.headSha}`,
    `**Lawbook Hash:** ${report.lawbookHash}`,
    '',
    '## Failures',
    '',
    `Found ${report.failures.length} failure(s) requiring attention:`,
    '',
    ...report.failures.map(f => formatFailureEvidence(f)),
    '',
    template.instructionSection,
    '',
    '## File Touch Hints',
    '',
    fileHints.length > 0
      ? `The following files may need changes (limit ${maxFiles}):\n${fileHints.slice(0, maxFiles).map(f => `- ${f}`).join('\n')}`
      : 'No specific file hints extracted from failures.',
    '',
    '## Verification',
    '',
    'After making changes, run these PowerShell commands to verify:',
    '',
    ...template.verifySteps.map(step => `\`\`\`powershell\n${step}\n\`\`\``),
    '',
    '## Done Definition',
    '',
    ...template.doneDefinition.map((item, idx) => `${idx + 1}. ${item}`),
  ];

  return sections.join('\n');
}

/**
 * Generate a copilot-ready prompt from a triage report
 */
export async function generateCopilotPrompt(
  input: CopilotPromptInput
): Promise<CopilotPromptV1> {
  const { triageReport, constraints } = input;
  const maxFiles = constraints?.maxFiles ?? 5;
  
  logger.info('Generating Copilot prompt', {
    requestId: triageReport.requestId,
    failureCount: triageReport.failures.length,
  }, 'CopilotPromptGenerator');

  // Determine primary failure class
  // Use the first failure's type as the primary class for template selection
  const failureClass = triageReport.failures.length > 0
    ? triageReport.failures[0].type
    : 'unknown';

  // Get template
  const template = getTemplateForFailureClass(failureClass);

  // Extract file hints
  const fileHints = extractFileHints(triageReport.failures);

  // Generate prompt text
  const promptText = generatePromptText(
    triageReport,
    template,
    fileHints,
    maxFiles
  );

  // Collect attachments
  const evidenceUrls = triageReport.failures.map(f => redactSecrets(f.evidence.url));
  const excerptHashes = triageReport.failures.map(f => f.evidence.excerptHash);

  // Sort for determinism
  evidenceUrls.sort();
  excerptHashes.sort();

  const prompt: CopilotPromptV1 = {
    schemaVersion: '1.0',
    requestId: triageReport.requestId,
    lawbookHash: triageReport.lawbookHash,
    failureClass,
    promptText: redactSecrets(promptText),
    attachments: {
      evidenceUrls,
      excerptHashes,
    },
    verifySteps: template.verifySteps,
    doneDefinition: template.doneDefinition,
  };

  logger.info('Copilot prompt generated', {
    requestId: triageReport.requestId,
    failureClass,
    fileHints: fileHints.length,
    promptLength: promptText.length,
  }, 'CopilotPromptGenerator');

  return prompt;
}

/**
 * Calculate hash of prompt for determinism verification
 */
export function hashPrompt(prompt: CopilotPromptV1): string {
  // Create stable representation
  const stableData = {
    schemaVersion: prompt.schemaVersion,
    lawbookHash: prompt.lawbookHash,
    failureClass: prompt.failureClass,
    promptText: prompt.promptText,
    attachments: {
      evidenceUrls: [...prompt.attachments.evidenceUrls].sort(),
      excerptHashes: [...prompt.attachments.excerptHashes].sort(),
    },
    verifySteps: prompt.verifySteps,
    doneDefinition: prompt.doneDefinition,
  };

  const json = JSON.stringify(stableData);
  return createHash('sha256').update(json).digest('hex').substring(0, 16);
}
