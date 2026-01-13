/**
 * Tests for Copilot Prompt Generator
 * 
 * @jest-environment node
 */

import {
  generateCopilotPrompt,
  redactSecrets,
  hashPrompt,
} from '../../src/lib/github/copilot-prompt-generator';
import {
  ChecksTriageReportV1,
  CopilotPromptV1,
  FailureType,
} from '../../src/lib/types/checks-triage';

// Helper to create a minimal triage report
function createTriageReport(
  failureType: FailureType,
  checkName: string,
  excerpt: string,
  url = 'https://github.com/test/repo/runs/123'
): ChecksTriageReportV1 {
  return {
    schemaVersion: '1.0',
    requestId: 'test-request-123',
    deploymentEnv: 'staging',
    lawbookHash: 'v1.0.0-test',
    repo: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
    pr: {
      number: 42,
      headSha: 'abc123def456',
    },
    summary: {
      overall: 'RED',
      failingChecks: 1,
      failingRuns: 1,
    },
    failures: [
      {
        checkName,
        type: failureType,
        conclusion: 'failure',
        runId: 100,
        jobId: 200,
        stepName: checkName,
        evidence: {
          url,
          excerpt,
          excerptHash: 'hash123',
        },
        primarySignal: 'Error detected',
        recommendation: {
          nextAction: 'PROMPT',
          rationale: 'Needs code fix',
        },
      },
    ],
  };
}

describe('Copilot Prompt Generator', () => {
  describe('redactSecrets', () => {
    it('should redact GitHub personal access tokens', () => {
      const token = 'ghp_' + '1234567890' + 'abcdefghijklmnopqrstuvwxyz';
      const text = `Using token ${token} to authenticate`;
      const redacted = redactSecrets(text);
      expect(redacted).toBe('Using token ghp_REDACTED to authenticate');
      expect(redacted).not.toContain('ghp_1234567890');
    });

    it('should redact multiple GitHub token types', () => {
      const ghp = 'ghp_' + '1'.repeat(36);
      const gho = 'gho_' + '2'.repeat(36);
      const ghs = 'ghs_' + '3'.repeat(36);
      const text = `Tokens: ${ghp}, ${gho}, ${ghs}`;
      const redacted = redactSecrets(text);
      expect(redacted).toContain('ghp_REDACTED');
      expect(redacted).toContain('gho_REDACTED');
      expect(redacted).toContain('ghs_REDACTED');
      expect(redacted).not.toContain(ghp);
      expect(redacted).not.toContain(gho);
      expect(redacted).not.toContain(ghs);
    });

    it('should redact AWS access keys', () => {
      const accessKey = 'AKIA' + 'A'.repeat(16);
      const text = `Access key: ${accessKey}`;
      const redacted = redactSecrets(text);
      expect(redacted).toBe('Access key: AKIA_REDACTED');
      expect(redacted).not.toContain(accessKey);
    });

    it('should redact AWS secret access keys', () => {
      const secretKey = 'A'.repeat(40);
      const text = `AWS_SECRET_ACCESS_KEY=${secretKey}`;
      const redacted = redactSecrets(text);
      expect(redacted).toBe('AWS_SECRET_ACCESS_KEY=REDACTED');
      expect(redacted).not.toContain(secretKey);
    });

    it('should redact secrets in URLs', () => {
      const text = 'https://api.example.com/data?token=secret123&user=john';
      const redacted = redactSecrets(text);
      expect(redacted).toContain('token=REDACTED');
      expect(redacted).not.toContain('secret123');
    });

    it('should redact Bearer tokens', () => {
      const jwt =
        'eyJ' +
        'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
        '.' +
        'eyJ' +
        'zdWIiOiIxMjM0NTY3ODkwIn0' +
        '.' +
        'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const text = `Authorization: Bearer ${jwt}`;
      const redacted = redactSecrets(text);
      expect(redacted).toBe('Authorization: Bearer REDACTED');
      expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    });

    it('should redact NPM tokens', () => {
      const npmToken = 'npm_' + 'x'.repeat(36);
      const text = `NPM_TOKEN=${npmToken}`;
      const redacted = redactSecrets(text);
      expect(redacted).toContain('npm_REDACTED');
      expect(redacted).not.toContain(npmToken);
    });

    it('should handle text with no secrets', () => {
      const text = 'This is just normal text without secrets';
      const redacted = redactSecrets(text);
      expect(redacted).toBe(text);
    });

    it('should redact multiple types of secrets in one text', () => {
      const ghp = 'ghp_' + 'x'.repeat(36);
      const accessKey = 'AKIA' + 'B'.repeat(16);
      const text = `
        GitHub: ${ghp}
        AWS: ${accessKey}
        URL: https://api.test.com?api_key=secret123
      `;
      const redacted = redactSecrets(text);
      expect(redacted).toContain('ghp_REDACTED');
      expect(redacted).toContain('AKIA_REDACTED');
      expect(redacted).toContain('api_key=REDACTED');
      expect(redacted).not.toContain(ghp);
      expect(redacted).not.toContain(accessKey);
      expect(redacted).not.toContain('secret123');
    });
  });

  describe('generateCopilotPrompt', () => {
    it('should generate prompt for lint failure', async () => {
      const report = createTriageReport(
        'lint',
        'ESLint',
        'Error: Expected 2 spaces but found 4\n  at src/example.ts:10:5'
      );

      const prompt = await generateCopilotPrompt({
        triageReport: report,
      });

      expect(prompt.schemaVersion).toBe('1.0');
      expect(prompt.requestId).toBe('test-request-123');
      expect(prompt.lawbookHash).toBe('v1.0.0-test');
      expect(prompt.failureClass).toBe('lint');
      expect(prompt.promptText).toContain('linting failures');
      expect(prompt.promptText).toContain('ESLint');
      expect(prompt.promptText).toContain('Expected 2 spaces');
      expect(prompt.promptText).toContain('test-owner/test-repo');
      expect(prompt.promptText).toContain('#42');
      expect(prompt.verifySteps).toContain('npm --prefix control-center run lint');
      expect(prompt.doneDefinition).toContain('All linting errors are resolved');
    });

    it('should generate prompt for test failure', async () => {
      const report = createTriageReport(
        'test',
        'Jest Tests',
        'FAIL test/example.test.ts\n  ● Example suite › should pass\n    Expected: true\n    Received: false'
      );

      const prompt = await generateCopilotPrompt({
        triageReport: report,
      });

      expect(prompt.failureClass).toBe('test');
      expect(prompt.promptText).toContain('test failures');
      expect(prompt.promptText).toContain('Jest Tests');
      expect(prompt.verifySteps).toContain('npm --prefix control-center test');
      expect(prompt.doneDefinition).toContain('All test suites pass');
    });

    it('should generate prompt for build failure', async () => {
      const report = createTriageReport(
        'build',
        'TypeScript Build',
        "error TS2304: Cannot find name 'somethingUndefined'.\n  at src/app.ts:42:10"
      );

      const prompt = await generateCopilotPrompt({
        triageReport: report,
      });

      expect(prompt.failureClass).toBe('build');
      expect(prompt.promptText).toContain('build failures');
      expect(prompt.promptText).toContain('TypeScript Build');
      expect(prompt.verifySteps).toContain('npm --prefix control-center run build');
      expect(prompt.doneDefinition).toContain('Build completes successfully');
    });

    it('should generate prompt for e2e failure', async () => {
      const report = createTriageReport(
        'e2e',
        'Playwright E2E Tests',
        'Error: Timeout waiting for selector ".login-button"'
      );

      const prompt = await generateCopilotPrompt({
        triageReport: report,
      });

      expect(prompt.failureClass).toBe('e2e');
      expect(prompt.promptText).toContain('end-to-end test failures');
      expect(prompt.doneDefinition).toContain('All E2E tests pass');
    });

    it('should generate prompt for infra failure', async () => {
      const report = createTriageReport(
        'infra',
        'CDK Deploy',
        'Error: Stack deployment failed - resource already exists'
      );

      const prompt = await generateCopilotPrompt({
        triageReport: report,
      });

      expect(prompt.failureClass).toBe('infra');
      expect(prompt.promptText).toContain('infrastructure failures');
      expect(prompt.doneDefinition).toContain('Infrastructure checks pass OR manual steps documented');
    });

    it('should generate prompt for deploy failure', async () => {
      const report = createTriageReport(
        'deploy',
        'Deploy to Production',
        'Error: Deployment failed - health check timeout'
      );

      const prompt = await generateCopilotPrompt({
        triageReport: report,
      });

      expect(prompt.failureClass).toBe('deploy');
      expect(prompt.promptText).toContain('deployment failures');
      expect(prompt.doneDefinition).toContain('Deployment checks pass OR issue is documented');
    });

    it('should generate prompt for unknown failure', async () => {
      const report = createTriageReport(
        'unknown',
        'Mystery Check',
        'Something went wrong'
      );

      const prompt = await generateCopilotPrompt({
        triageReport: report,
      });

      expect(prompt.failureClass).toBe('unknown');
      expect(prompt.promptText).toContain('unclassified check failures');
      expect(prompt.doneDefinition).toContain('Root cause is understood and documented');
    });

    it('should extract file hints from error messages', async () => {
      const report = createTriageReport(
        'test',
        'Jest',
        'FAIL src/components/Button.tsx\n  at src/utils/helper.ts:15:3\n  Error in src/lib/api.ts'
      );

      const prompt = await generateCopilotPrompt({
        triageReport: report,
      });

      expect(prompt.promptText).toContain('File Touch Hints');
      expect(prompt.promptText).toContain('src/components/Button.tsx');
      expect(prompt.promptText).toContain('src/utils/helper.ts');
      expect(prompt.promptText).toContain('src/lib/api.ts');
    });

    it('should limit file hints to maxFiles', async () => {
      const report = createTriageReport(
        'test',
        'Jest',
        'Files: a.ts b.ts c.ts d.ts e.ts f.ts g.ts h.ts'
      );

      const prompt = await generateCopilotPrompt({
        triageReport: report,
        constraints: {
          maxFiles: 3,
          preferMinimalDiff: true,
        },
      });

      // Count how many files are listed
      const fileListMatch = prompt.promptText.match(/- [a-z]\.ts/g);
      expect(fileListMatch?.length).toBeLessThanOrEqual(3);
    });

    it('should redact secrets in prompts', async () => {
      const report = createTriageReport(
        'test',
        'Security Test',
        'Failed auth with token ' + ('ghp_' + '1234567890' + 'abcdefghijklmnopqrstuvwxyz')
      );

      const prompt = await generateCopilotPrompt({
        triageReport: report,
      });

      expect(prompt.promptText).toContain('ghp_REDACTED');
      expect(prompt.promptText).not.toContain('ghp_1234567890');
    });

    it('should include all required fields', async () => {
      const report = createTriageReport('lint', 'ESLint', 'Error');

      const prompt = await generateCopilotPrompt({
        triageReport: report,
      });

      expect(prompt).toHaveProperty('schemaVersion', '1.0');
      expect(prompt).toHaveProperty('requestId');
      expect(prompt).toHaveProperty('lawbookHash');
      expect(prompt).toHaveProperty('failureClass');
      expect(prompt).toHaveProperty('promptText');
      expect(prompt).toHaveProperty('attachments');
      expect(prompt.attachments).toHaveProperty('evidenceUrls');
      expect(prompt.attachments).toHaveProperty('excerptHashes');
      expect(prompt).toHaveProperty('verifySteps');
      expect(prompt).toHaveProperty('doneDefinition');
    });

    it('should sort evidence URLs and hashes for determinism', async () => {
      const report: ChecksTriageReportV1 = {
        schemaVersion: '1.0',
        requestId: 'test-123',
        deploymentEnv: 'staging',
        lawbookHash: 'v1.0.0',
        repo: { owner: 'test', repo: 'test' },
        pr: { number: 1, headSha: 'abc' },
        summary: { overall: 'RED', failingChecks: 3, failingRuns: 1 },
        failures: [
          {
            checkName: 'C',
            type: 'test',
            conclusion: 'failure',
            evidence: { url: 'https://github.com/c', excerpt: 'C', excerptHash: 'ccc' },
            primarySignal: 'C',
            recommendation: { nextAction: 'PROMPT', rationale: 'fix' },
          },
          {
            checkName: 'A',
            type: 'test',
            conclusion: 'failure',
            evidence: { url: 'https://github.com/a', excerpt: 'A', excerptHash: 'aaa' },
            primarySignal: 'A',
            recommendation: { nextAction: 'PROMPT', rationale: 'fix' },
          },
          {
            checkName: 'B',
            type: 'test',
            conclusion: 'failure',
            evidence: { url: 'https://github.com/b', excerpt: 'B', excerptHash: 'bbb' },
            primarySignal: 'B',
            recommendation: { nextAction: 'PROMPT', rationale: 'fix' },
          },
        ],
      };

      const prompt = await generateCopilotPrompt({ triageReport: report });

      // URLs and hashes should be sorted
      expect(prompt.attachments.evidenceUrls).toEqual([
        'https://github.com/a',
        'https://github.com/b',
        'https://github.com/c',
      ]);
      expect(prompt.attachments.excerptHashes).toEqual(['aaa', 'bbb', 'ccc']);
    });
  });

  describe('hashPrompt', () => {
    it('should generate consistent hash for same prompt', () => {
      const prompt: CopilotPromptV1 = {
        schemaVersion: '1.0',
        requestId: 'test-123',
        lawbookHash: 'v1.0.0',
        failureClass: 'lint',
        promptText: 'Fix lint errors',
        attachments: {
          evidenceUrls: ['https://url1', 'https://url2'],
          excerptHashes: ['hash1', 'hash2'],
        },
        verifySteps: ['npm test'],
        doneDefinition: ['Tests pass'],
      };

      const hash1 = hashPrompt(prompt);
      const hash2 = hashPrompt(prompt);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(16);
    });

    it('should generate different hash for different prompts', () => {
      const prompt1: CopilotPromptV1 = {
        schemaVersion: '1.0',
        requestId: 'test-123',
        lawbookHash: 'v1.0.0',
        failureClass: 'lint',
        promptText: 'Fix lint errors',
        attachments: { evidenceUrls: [], excerptHashes: [] },
        verifySteps: [],
        doneDefinition: [],
      };

      const prompt2: CopilotPromptV1 = {
        ...prompt1,
        promptText: 'Fix test errors',
      };

      const hash1 = hashPrompt(prompt1);
      const hash2 = hashPrompt(prompt2);

      expect(hash1).not.toBe(hash2);
    });

    it('should ignore requestId in hash (not part of stable data)', () => {
      const prompt1: CopilotPromptV1 = {
        schemaVersion: '1.0',
        requestId: 'request-1',
        lawbookHash: 'v1.0.0',
        failureClass: 'lint',
        promptText: 'Fix errors',
        attachments: { evidenceUrls: [], excerptHashes: [] },
        verifySteps: [],
        doneDefinition: [],
      };

      const prompt2: CopilotPromptV1 = {
        ...prompt1,
        requestId: 'request-2',
      };

      const hash1 = hashPrompt(prompt1);
      const hash2 = hashPrompt(prompt2);

      // Hash should be the same because requestId is not included in stable data
      expect(hash1).toBe(hash2);
    });

    it('should handle unsorted arrays by sorting them', () => {
      const prompt1: CopilotPromptV1 = {
        schemaVersion: '1.0',
        requestId: 'test',
        lawbookHash: 'v1.0.0',
        failureClass: 'lint',
        promptText: 'Fix',
        attachments: {
          evidenceUrls: ['url2', 'url1', 'url3'],
          excerptHashes: ['c', 'a', 'b'],
        },
        verifySteps: [],
        doneDefinition: [],
      };

      const prompt2: CopilotPromptV1 = {
        schemaVersion: '1.0',
        requestId: 'test',
        lawbookHash: 'v1.0.0',
        failureClass: 'lint',
        promptText: 'Fix',
        attachments: {
          evidenceUrls: ['url1', 'url2', 'url3'],
          excerptHashes: ['a', 'b', 'c'],
        },
        verifySteps: [],
        doneDefinition: [],
      };

      const hash1 = hashPrompt(prompt1);
      const hash2 = hashPrompt(prompt2);

      // Should be the same because arrays are sorted before hashing
      expect(hash1).toBe(hash2);
    });
  });

  describe('Determinism', () => {
    it('should generate identical prompts for identical triage reports', async () => {
      const report = createTriageReport(
        'lint',
        'ESLint',
        'Error: Expected 2 spaces but found 4'
      );

      const prompt1 = await generateCopilotPrompt({ triageReport: report });
      const prompt2 = await generateCopilotPrompt({ triageReport: report });

      const hash1 = hashPrompt(prompt1);
      const hash2 = hashPrompt(prompt2);

      expect(hash1).toBe(hash2);
      expect(prompt1.promptText).toBe(prompt2.promptText);
      expect(prompt1.failureClass).toBe(prompt2.failureClass);
      expect(prompt1.attachments).toEqual(prompt2.attachments);
    });
  });
});
