/**
 * Tests for GitHub Checks Triage Service
 * 
 * @jest-environment node
 */

import { generateChecksTriageReport } from '../../src/lib/github/checks-triage-service';
import { ChecksTriageInput } from '../../src/lib/types/checks-triage';

// Mock dependencies
jest.mock('../../src/lib/github/auth-wrapper', () => ({
  createAuthenticatedClient: jest.fn(),
  RepoAccessDeniedError: class RepoAccessDeniedError extends Error {
    repository: string;
    constructor(repository: string) {
      super(`Repository access denied: ${repository}`);
      this.repository = repository;
    }
  },
}));

jest.mock('../../src/lib/github/retry-policy', () => ({
  withRetry: jest.fn((fn) => fn()),
  DEFAULT_RETRY_CONFIG: {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 32000,
    backoffMultiplier: 2,
    jitterFactor: 0.25,
  },
}));

describe('GitHub Checks Triage Service', () => {
  let mockOctokit: any;

  beforeEach(() => {
    const { createAuthenticatedClient } = require('../../src/lib/github/auth-wrapper');
    
    mockOctokit = {
      rest: {
        pulls: {
          get: jest.fn(),
        },
        checks: {
          listForRef: jest.fn(),
        },
      },
      request: jest.fn(),
    };

    createAuthenticatedClient.mockResolvedValue(mockOctokit);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateChecksTriageReport', () => {
    it('should generate GREEN report when all checks pass', async () => {
      const input: ChecksTriageInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        maxLogBytes: 65536,
        maxSteps: 50,
      };

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: {
            sha: 'abc123',
          },
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 1,
              name: 'ESLint',
              status: 'completed',
              conclusion: 'success',
              html_url: 'https://github.com/test/url/1',
            },
            {
              id: 2,
              name: 'Jest Tests',
              status: 'completed',
              conclusion: 'success',
              html_url: 'https://github.com/test/url/2',
            },
          ],
        },
      });

      const report = await generateChecksTriageReport(input);

      expect(report.schemaVersion).toBe('1.0');
      expect(report.repo.owner).toBe('test-owner');
      expect(report.repo.repo).toBe('test-repo');
      expect(report.pr.number).toBe(123);
      expect(report.pr.headSha).toBe('abc123');
      expect(report.summary.overall).toBe('GREEN');
      expect(report.summary.failingChecks).toBe(0);
      expect(report.failures).toHaveLength(0);
    });

    it('should generate RED report with failures requiring PROMPT', async () => {
      const input: ChecksTriageInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        maxLogBytes: 65536,
        maxSteps: 50,
      };

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: {
            sha: 'abc123',
          },
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 1,
              name: 'ESLint',
              status: 'completed',
              conclusion: 'failure',
              html_url: 'https://github.com/test/url/1',
              output: {
                title: 'ESLint failed',
                summary: 'Error: Expected 2 spaces but found 4',
              },
            },
            {
              id: 2,
              name: 'Jest Tests',
              status: 'completed',
              conclusion: 'failure',
              html_url: 'https://github.com/test/url/2',
              output: {
                title: 'Tests failed',
                summary: 'FAIL test/example.test.js\n  ● Example test suite › should pass\n    Expected: true\n    Received: false',
              },
            },
          ],
        },
      });

      const report = await generateChecksTriageReport(input);

      expect(report.summary.overall).toBe('RED');
      expect(report.summary.failingChecks).toBe(2);
      expect(report.failures).toHaveLength(2);

      // Check first failure (ESLint - sorted alphabetically)
      const eslintFailure = report.failures[0];
      expect(eslintFailure.checkName).toBe('ESLint');
      expect(eslintFailure.type).toBe('lint');
      expect(eslintFailure.conclusion).toBe('failure');
      expect(eslintFailure.recommendation.nextAction).toBe('PROMPT');
      expect(eslintFailure.evidence.url).toBe('https://github.com/test/url/1');
      expect(eslintFailure.evidence.excerpt).toContain('Expected 2 spaces');
      expect(eslintFailure.evidence.excerptHash).toBeDefined();

      // Check second failure (Jest)
      const jestFailure = report.failures[1];
      expect(jestFailure.checkName).toBe('Jest Tests');
      expect(jestFailure.type).toBe('test');
      expect(jestFailure.conclusion).toBe('failure');
      expect(jestFailure.recommendation.nextAction).toBe('PROMPT');
    });

    it('should generate YELLOW report for transient failures', async () => {
      const input: ChecksTriageInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        maxLogBytes: 65536,
        maxSteps: 50,
      };

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: {
            sha: 'abc123',
          },
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 1,
              name: 'Build',
              status: 'completed',
              conclusion: 'timed_out',
              html_url: 'https://github.com/test/url/1',
              output: {
                title: 'Build timed out',
                summary: 'The build exceeded the maximum time limit',
              },
            },
          ],
        },
      });

      const report = await generateChecksTriageReport(input);

      expect(report.summary.overall).toBe('YELLOW');
      expect(report.failures).toHaveLength(1);
      expect(report.failures[0].recommendation.nextAction).toBe('RERUN');
    });

    it('should sort failures deterministically', async () => {
      const input: ChecksTriageInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        maxLogBytes: 65536,
        maxSteps: 50,
      };

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: {
            sha: 'abc123',
          },
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 3,
              run_id: 200,
              name: 'Zebra Check',
              status: 'completed',
              conclusion: 'failure',
              html_url: 'https://github.com/test/url/3',
              output: { summary: 'Failed' },
            },
            {
              id: 1,
              run_id: 100,
              name: 'Alpha Check',
              status: 'completed',
              conclusion: 'failure',
              html_url: 'https://github.com/test/url/1',
              output: { summary: 'Failed' },
            },
            {
              id: 2,
              run_id: 100,
              name: 'Beta Check',
              status: 'completed',
              conclusion: 'failure',
              html_url: 'https://github.com/test/url/2',
              output: { summary: 'Failed' },
            },
          ],
        },
      });

      const report = await generateChecksTriageReport(input);

      expect(report.failures).toHaveLength(3);
      // Should be sorted by checkName first
      expect(report.failures[0].checkName).toBe('Alpha Check');
      expect(report.failures[1].checkName).toBe('Beta Check');
      expect(report.failures[2].checkName).toBe('Zebra Check');
    });

    it('should bound log excerpts to maxLogBytes', async () => {
      const input: ChecksTriageInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        maxLogBytes: 100, // Very small limit
        maxSteps: 50,
      };

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: {
            sha: 'abc123',
          },
        },
      });

      const longSummary = 'x'.repeat(500); // 500 character summary

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 1,
              name: 'Test',
              status: 'completed',
              conclusion: 'failure',
              html_url: 'https://github.com/test/url/1',
              output: {
                summary: longSummary,
              },
            },
          ],
        },
      });

      const report = await generateChecksTriageReport(input);

      expect(report.failures).toHaveLength(1);
      expect(report.failures[0].evidence.excerpt.length).toBeLessThanOrEqual(100);
    });

    it('should handle checks with no logs gracefully', async () => {
      const input: ChecksTriageInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        maxLogBytes: 65536,
        maxSteps: 50,
      };

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: {
            sha: 'abc123',
          },
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 1,
              name: 'Unknown Check',
              status: 'completed',
              conclusion: 'failure',
              html_url: 'https://github.com/test/url/1',
              // No output
            },
          ],
        },
      });

      const report = await generateChecksTriageReport(input);

      expect(report.failures).toHaveLength(1);
      expect(report.failures[0].evidence.excerpt).toContain('Unknown Check');
      expect(report.failures[0].type).toBe('unknown');
    });

    it('should skip completed checks with success/skipped/neutral conclusions', async () => {
      const input: ChecksTriageInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        maxLogBytes: 65536,
        maxSteps: 50,
      };

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: {
            sha: 'abc123',
          },
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 1,
              name: 'Success Check',
              status: 'completed',
              conclusion: 'success',
              html_url: 'https://github.com/test/url/1',
            },
            {
              id: 2,
              name: 'Skipped Check',
              status: 'completed',
              conclusion: 'skipped',
              html_url: 'https://github.com/test/url/2',
            },
            {
              id: 3,
              name: 'Neutral Check',
              status: 'completed',
              conclusion: 'neutral',
              html_url: 'https://github.com/test/url/3',
            },
            {
              id: 4,
              name: 'Failed Check',
              status: 'completed',
              conclusion: 'failure',
              html_url: 'https://github.com/test/url/4',
              output: { summary: 'Failed' },
            },
          ],
        },
      });

      const report = await generateChecksTriageReport(input);

      expect(report.failures).toHaveLength(1);
      expect(report.failures[0].checkName).toBe('Failed Check');
    });

    it('should include requestId in report', async () => {
      const input: ChecksTriageInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        maxLogBytes: 65536,
        maxSteps: 50,
        requestId: 'custom-request-id-123',
      };

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: {
            sha: 'abc123',
          },
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [],
        },
      });

      const report = await generateChecksTriageReport(input);

      expect(report.requestId).toBe('custom-request-id-123');
    });
  });
});
