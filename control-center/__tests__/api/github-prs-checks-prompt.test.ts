/**
 * Tests for Copilot Prompt API
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/github/prs/[prNumber]/checks/prompt/route';

// Mock dependencies
jest.mock('../../src/lib/github/checks-triage-service', () => ({
  generateChecksTriageReport: jest.fn(),
}));

jest.mock('../../src/lib/github/copilot-prompt-generator', () => ({
  generateCopilotPrompt: jest.fn(),
}));

describe('Copilot Prompt API', () => {
  let mockGenerateChecksTriageReport: jest.Mock;
  let mockGenerateCopilotPrompt: jest.Mock;

  beforeEach(() => {
    const triageService = require('../../src/lib/github/checks-triage-service');
    const promptGenerator = require('../../src/lib/github/copilot-prompt-generator');
    
    mockGenerateChecksTriageReport = triageService.generateChecksTriageReport;
    mockGenerateCopilotPrompt = promptGenerator.generateCopilotPrompt;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/github/prs/[prNumber]/checks/prompt', () => {
    it('should return 400 for invalid PR number', async () => {
      const request = new NextRequest('http://localhost/api/github/prs/invalid/checks/prompt?owner=test&repo=test');
      const context = { params: Promise.resolve({ prNumber: 'invalid' }) };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('INVALID_PR_NUMBER');
    });

    it('should return 400 for missing owner parameter', async () => {
      const request = new NextRequest('http://localhost/api/github/prs/123/checks/prompt?repo=test');
      const context = { params: Promise.resolve({ prNumber: '123' }) };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('MISSING_PARAMS');
    });

    it('should return 400 for missing repo parameter', async () => {
      const request = new NextRequest('http://localhost/api/github/prs/123/checks/prompt?owner=test');
      const context = { params: Promise.resolve({ prNumber: '123' }) };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('MISSING_PARAMS');
    });

    it('should return 409 when no failures are found', async () => {
      mockGenerateChecksTriageReport.mockResolvedValue({
        schemaVersion: '1.0',
        requestId: 'test-123',
        deploymentEnv: 'staging',
        lawbookHash: 'v1.0.0',
        repo: { owner: 'test-owner', repo: 'test-repo' },
        pr: { number: 123, headSha: 'abc123' },
        summary: { overall: 'GREEN', failingChecks: 0, failingRuns: 0 },
        failures: [],
      });

      const request = new NextRequest('http://localhost/api/github/prs/123/checks/prompt?owner=test&repo=test');
      const context = { params: Promise.resolve({ prNumber: '123' }) };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.code).toBe('NO_FAILURES');
      expect(data.details.overall).toBe('GREEN');
    });

    it('should generate and return prompt for failures', async () => {
      const triageReport = {
        schemaVersion: '1.0' as const,
        requestId: 'test-123',
        deploymentEnv: 'staging' as const,
        lawbookHash: 'v1.0.0',
        repo: { owner: 'test-owner', repo: 'test-repo' },
        pr: { number: 123, headSha: 'abc123' },
        summary: { overall: 'RED' as const, failingChecks: 1, failingRuns: 1 },
        failures: [
          {
            checkName: 'ESLint',
            type: 'lint' as const,
            conclusion: 'failure',
            runId: 100,
            jobId: 200,
            stepName: 'ESLint',
            evidence: {
              url: 'https://github.com/test/url',
              excerpt: 'Error: Expected 2 spaces',
              excerptHash: 'hash123',
            },
            primarySignal: 'Lint error',
            recommendation: {
              nextAction: 'PROMPT' as const,
              rationale: 'Needs fix',
            },
          },
        ],
      };

      const expectedPrompt = {
        schemaVersion: '1.0' as const,
        requestId: 'test-123',
        lawbookHash: 'v1.0.0',
        failureClass: 'lint' as const,
        promptText: 'Fix the linting errors...',
        attachments: {
          evidenceUrls: ['https://github.com/test/url'],
          excerptHashes: ['hash123'],
        },
        verifySteps: ['npm run lint'],
        doneDefinition: ['All linting errors resolved'],
      };

      mockGenerateChecksTriageReport.mockResolvedValue(triageReport);
      mockGenerateCopilotPrompt.mockResolvedValue(expectedPrompt);

      const request = new NextRequest('http://localhost/api/github/prs/123/checks/prompt?owner=test&repo=test');
      const context = { params: Promise.resolve({ prNumber: '123' }) };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.schemaVersion).toBe('1.0');
      expect(data.failureClass).toBe('lint');
      expect(data.promptText).toBe('Fix the linting errors...');
      expect(mockGenerateCopilotPrompt).toHaveBeenCalledWith({
        triageReport,
        constraints: {
          maxFiles: 5,
          preferMinimalDiff: true,
        },
      });
    });

    it('should respect custom maxFiles parameter', async () => {
      const triageReport = {
        schemaVersion: '1.0' as const,
        requestId: 'test-123',
        deploymentEnv: 'staging' as const,
        lawbookHash: 'v1.0.0',
        repo: { owner: 'test', repo: 'test' },
        pr: { number: 123, headSha: 'abc' },
        summary: { overall: 'RED' as const, failingChecks: 1, failingRuns: 1 },
        failures: [
          {
            checkName: 'Test',
            type: 'test' as const,
            conclusion: 'failure',
            evidence: { url: 'url', excerpt: 'excerpt', excerptHash: 'hash' },
            primarySignal: 'signal',
            recommendation: { nextAction: 'PROMPT' as const, rationale: 'fix' },
          },
        ],
      };

      mockGenerateChecksTriageReport.mockResolvedValue(triageReport);
      mockGenerateCopilotPrompt.mockResolvedValue({
        schemaVersion: '1.0',
        requestId: 'test-123',
        lawbookHash: 'v1.0.0',
        failureClass: 'test',
        promptText: 'Prompt',
        attachments: { evidenceUrls: [], excerptHashes: [] },
        verifySteps: [],
        doneDefinition: [],
      });

      const request = new NextRequest('http://localhost/api/github/prs/123/checks/prompt?owner=test&repo=test&maxFiles=10');
      const context = { params: Promise.resolve({ prNumber: '123' }) };

      await GET(request, context);

      expect(mockGenerateCopilotPrompt).toHaveBeenCalledWith({
        triageReport,
        constraints: {
          maxFiles: 10,
          preferMinimalDiff: true,
        },
      });
    });

    it('should include x-request-id in response headers', async () => {
      mockGenerateChecksTriageReport.mockResolvedValue({
        schemaVersion: '1.0',
        requestId: 'test-123',
        deploymentEnv: 'staging',
        lawbookHash: 'v1.0.0',
        repo: { owner: 'test', repo: 'test' },
        pr: { number: 123, headSha: 'abc' },
        summary: { overall: 'GREEN', failingChecks: 0, failingRuns: 0 },
        failures: [],
      });

      const request = new NextRequest('http://localhost/api/github/prs/123/checks/prompt?owner=test&repo=test');
      request.headers.set('x-request-id', 'custom-id-456');
      const context = { params: Promise.resolve({ prNumber: '123' }) };

      const response = await GET(request, context);

      expect(response.headers.get('x-request-id')).toBe('custom-id-456');
    });

    it('should handle errors gracefully', async () => {
      mockGenerateChecksTriageReport.mockRejectedValue(new Error('GitHub API error'));

      const request = new NextRequest('http://localhost/api/github/prs/123/checks/prompt?owner=test&repo=test');
      const context = { params: Promise.resolve({ prNumber: '123' }) };

      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.code).toBe('INTERNAL_ERROR');
      expect(data.message).toContain('GitHub API error');
    });
  });
});
