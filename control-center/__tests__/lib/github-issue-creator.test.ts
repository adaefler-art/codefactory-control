/**
 * Tests for GitHub Issue Creator (I752 / E75.2)
 * 
 * Tests idempotent create/update flow with mocked GitHub API
 * 
 * @jest-environment node
 */

import {
  createOrUpdateFromCR,
  IssueCreatorError,
  ERROR_CODES,
} from '../../src/lib/github/issue-creator';
import type { ChangeRequest } from '../../src/lib/schemas/changeRequest';

// Mock dependencies - partial mock for canonical-id-resolver
jest.mock('../../src/lib/validators/changeRequestValidator');
jest.mock('../../src/lib/github/auth-wrapper');

// Partial mock - keep helper functions but mock resolveCanonicalId
jest.mock('../../src/lib/github/canonical-id-resolver', () => {
  const actual = jest.requireActual('../../src/lib/github/canonical-id-resolver');
  return {
    ...actual,
    resolveCanonicalId: jest.fn(),
  };
});

const mockValidateChangeRequest = jest.requireMock('../../src/lib/validators/changeRequestValidator').validateChangeRequest;
const mockResolveCanonicalId = jest.requireMock('../../src/lib/github/canonical-id-resolver').resolveCanonicalId;
const mockCreateAuthenticatedClient = jest.requireMock('../../src/lib/github/auth-wrapper').createAuthenticatedClient;

// Mock Octokit
const mockCreateIssue = jest.fn();
const mockUpdateIssue = jest.fn();
const mockGetIssue = jest.fn();

const mockOctokit = {
  rest: {
    issues: {
      create: mockCreateIssue,
      update: mockUpdateIssue,
      get: mockGetIssue,
    },
  },
};

describe('GitHub Issue Creator', () => {
  // Sample CR for testing
  const sampleCR: ChangeRequest = {
    crVersion: '0.7.0',
    canonicalId: 'CR-2026-01-02-TEST',
    title: 'Test Issue Creation',
    motivation: 'Test motivation',
    scope: {
      summary: 'Test scope',
      inScope: ['Item 1'],
      outOfScope: ['Item 2'],
    },
    targets: {
      repo: {
        owner: 'adaefler-art',
        repo: 'codefactory-control',
      },
      branch: 'main',
    },
    changes: {
      files: [
        {
          path: 'test.ts',
          changeType: 'create',
        },
      ],
    },
    acceptanceCriteria: ['AC1'],
    tests: {
      required: ['Test 1'],
    },
    risks: {
      items: [],
    },
    rollout: {
      steps: ['Step 1'],
      rollbackPlan: 'Rollback',
    },
    evidence: [
      {
        kind: 'file_snippet',
        repo: { owner: 'test', repo: 'test' },
        branch: 'main',
        path: 'test.ts',
        startLine: 1,
        endLine: 5,
      },
    ],
    constraints: {
      lawbookVersion: '0.7.0',
    },
    metadata: {
      createdAt: '2026-01-02T00:00:00Z',
      createdBy: 'intent',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock: CR is valid
    mockValidateChangeRequest.mockReturnValue({
      ok: true,
      errors: [],
      warnings: [],
      meta: {
        validatedAt: new Date().toISOString(),
        validatorVersion: '0.7.0',
      },
    });
    
    // Default mock: authenticated client
    mockCreateAuthenticatedClient.mockResolvedValue(mockOctokit);
  });

  describe('createOrUpdateFromCR - Create Flow', () => {
    test('creates new issue when canonical ID not found', async () => {
      // Mock resolver: not found
      mockResolveCanonicalId.mockResolvedValue({
        mode: 'not_found',
      });
      
      // Mock GitHub API: create issue
      mockCreateIssue.mockResolvedValue({
        data: {
          number: 100,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/100',
        },
      });
      
      const result = await createOrUpdateFromCR(sampleCR);
      
      expect(result.mode).toBe('created');
      expect(result.issueNumber).toBe(100);
      expect(result.url).toBe('https://github.com/adaefler-art/codefactory-control/issues/100');
      expect(result.canonicalId).toBe('CR-2026-01-02-TEST');
      expect(result.renderedHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.labelsApplied).toContain('afu9');
      expect(result.labelsApplied).toContain('v0.7');
      expect(result.labelsApplied).toContain('state:CREATED');
    });

    test('calls GitHub API with correct parameters on create', async () => {
      mockResolveCanonicalId.mockResolvedValue({ mode: 'not_found' });
      
      mockCreateIssue.mockResolvedValue({
        data: {
          number: 100,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/100',
        },
      });
      
      await createOrUpdateFromCR(sampleCR);
      
      expect(mockCreateIssue).toHaveBeenCalledWith({
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        title: '[CID:CR-2026-01-02-TEST] Test Issue Creation',
        body: expect.stringContaining('Canonical-ID: CR-2026-01-02-TEST'),
        labels: expect.arrayContaining(['afu9', 'v0.7', 'state:CREATED']),
      });
    });

    test('throws IssueCreatorError if create fails', async () => {
      mockResolveCanonicalId.mockResolvedValue({ mode: 'not_found' });
      
      mockCreateIssue.mockRejectedValue(new Error('API error'));
      
      await expect(createOrUpdateFromCR(sampleCR)).rejects.toThrow(IssueCreatorError);
      await expect(createOrUpdateFromCR(sampleCR)).rejects.toThrow('Failed to create issue');
    });
  });

  describe('createOrUpdateFromCR - Update Flow', () => {
    test('updates existing issue when canonical ID found', async () => {
      // Mock resolver: found
      mockResolveCanonicalId.mockResolvedValue({
        mode: 'found',
        issueNumber: 200,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/200',
        matchedBy: 'body',
      });
      
      // Mock GitHub API: get issue (for labels)
      mockGetIssue.mockResolvedValue({
        data: {
          number: 200,
          labels: [
            { name: 'afu9' },
            { name: 'v0.7' },
            { name: 'state:IN_PROGRESS' },
            { name: 'custom-label' },
          ],
        },
      });
      
      // Mock GitHub API: update issue
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: 200,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/200',
        },
      });
      
      const result = await createOrUpdateFromCR(sampleCR);
      
      expect(result.mode).toBe('updated');
      expect(result.issueNumber).toBe(200);
      expect(result.url).toBe('https://github.com/adaefler-art/codefactory-control/issues/200');
      expect(result.canonicalId).toBe('CR-2026-01-02-TEST');
    });

    test('preserves existing labels on update', async () => {
      mockResolveCanonicalId.mockResolvedValue({
        mode: 'found',
        issueNumber: 200,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/200',
        matchedBy: 'body',
      });
      
      mockGetIssue.mockResolvedValue({
        data: {
          number: 200,
          labels: [
            { name: 'afu9' },
            { name: 'v0.7' },
            { name: 'state:IN_PROGRESS' },
            { name: 'custom-label' },
          ],
        },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: 200,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/200',
        },
      });
      
      const result = await createOrUpdateFromCR(sampleCR);
      
      // Should preserve existing labels
      expect(result.labelsApplied).toContain('custom-label');
      expect(result.labelsApplied).toContain('state:IN_PROGRESS');
      
      // Should ensure required labels
      expect(result.labelsApplied).toContain('afu9');
      expect(result.labelsApplied).toContain('v0.7');
      
      // Should NOT add state:CREATED (preserve existing state)
      expect(result.labelsApplied).not.toContain('state:CREATED');
    });

    test('calls GitHub API with correct parameters on update', async () => {
      mockResolveCanonicalId.mockResolvedValue({
        mode: 'found',
        issueNumber: 200,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/200',
        matchedBy: 'body',
      });
      
      mockGetIssue.mockResolvedValue({
        data: {
          number: 200,
          labels: [{ name: 'afu9' }, { name: 'v0.7' }],
        },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: 200,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/200',
        },
      });
      
      await createOrUpdateFromCR(sampleCR);
      
      expect(mockUpdateIssue).toHaveBeenCalledWith({
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        issue_number: 200,
        title: '[CID:CR-2026-01-02-TEST] Test Issue Creation',
        body: expect.stringContaining('Canonical-ID: CR-2026-01-02-TEST'),
        labels: expect.any(Array),
      });
    });

    test('throws IssueCreatorError if update fails', async () => {
      mockResolveCanonicalId.mockResolvedValue({
        mode: 'found',
        issueNumber: 200,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/200',
        matchedBy: 'body',
      });
      
      mockGetIssue.mockResolvedValue({
        data: { number: 200, labels: [] },
      });
      
      mockUpdateIssue.mockRejectedValue(new Error('API error'));
      
      await expect(createOrUpdateFromCR(sampleCR)).rejects.toThrow(IssueCreatorError);
      await expect(createOrUpdateFromCR(sampleCR)).rejects.toThrow('Failed to update issue');
    });
  });

  describe('Validation', () => {
    test('throws IssueCreatorError if CR validation fails', async () => {
      mockValidateChangeRequest.mockReturnValue({
        ok: false,
        errors: [
          {
            code: 'CR_SCHEMA_INVALID',
            message: 'Invalid field',
            path: '/title',
            severity: 'error',
          },
        ],
        warnings: [],
        meta: {
          validatedAt: new Date().toISOString(),
          validatorVersion: '0.7.0',
        },
      });
      
      await expect(createOrUpdateFromCR(sampleCR)).rejects.toThrow(IssueCreatorError);
      
      try {
        await createOrUpdateFromCR(sampleCR);
      } catch (error) {
        expect(error).toBeInstanceOf(IssueCreatorError);
        expect((error as IssueCreatorError).code).toBe(ERROR_CODES.CR_INVALID);
        expect((error as IssueCreatorError).details).toHaveProperty('errors');
      }
    });

    test('does not call GitHub API if validation fails', async () => {
      mockValidateChangeRequest.mockReturnValue({
        ok: false,
        errors: [{ code: 'CR_SCHEMA_INVALID', message: 'Invalid', path: '/', severity: 'error' }],
        warnings: [],
        meta: { validatedAt: new Date().toISOString(), validatorVersion: '0.7.0' },
      });
      
      await expect(createOrUpdateFromCR(sampleCR)).rejects.toThrow();
      
      expect(mockResolveCanonicalId).not.toHaveBeenCalled();
      expect(mockCreateIssue).not.toHaveBeenCalled();
      expect(mockUpdateIssue).not.toHaveBeenCalled();
    });
  });

  describe('Policy Enforcement', () => {
    test('throws IssueCreatorError with REPO_ACCESS_DENIED if repo not allowed', async () => {
      mockResolveCanonicalId.mockRejectedValue(
        Object.assign(new Error('Access denied to repository test/unauthorized'), {
          name: 'RepoAccessDeniedError',
        })
      );
      
      await expect(createOrUpdateFromCR(sampleCR)).rejects.toThrow(IssueCreatorError);
      
      try {
        await createOrUpdateFromCR(sampleCR);
      } catch (error) {
        expect(error).toBeInstanceOf(IssueCreatorError);
        expect((error as IssueCreatorError).code).toBe(ERROR_CODES.REPO_ACCESS_DENIED);
      }
    });

    test('does not create issue if policy check fails', async () => {
      mockResolveCanonicalId.mockRejectedValue(
        Object.assign(new Error('Access denied'), {
          name: 'RepoAccessDeniedError',
        })
      );
      
      await expect(createOrUpdateFromCR(sampleCR)).rejects.toThrow();
      
      expect(mockCreateIssue).not.toHaveBeenCalled();
      expect(mockUpdateIssue).not.toHaveBeenCalled();
    });
  });

  describe('Idempotency', () => {
    test('repeated calls with same CR update same issue', async () => {
      // First call: not found → create
      mockResolveCanonicalId.mockResolvedValueOnce({ mode: 'not_found' });
      
      mockCreateIssue.mockResolvedValue({
        data: {
          number: 300,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/300',
        },
      });
      
      const result1 = await createOrUpdateFromCR(sampleCR);
      expect(result1.mode).toBe('created');
      expect(result1.issueNumber).toBe(300);
      
      // Second call: found → update (simulating idempotency)
      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'found',
        issueNumber: 300,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/300',
        matchedBy: 'body',
      });
      
      mockGetIssue.mockResolvedValue({
        data: {
          number: 300,
          labels: [{ name: 'afu9' }, { name: 'v0.7' }, { name: 'state:CREATED' }],
        },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: 300,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/300',
        },
      });
      
      const result2 = await createOrUpdateFromCR(sampleCR);
      expect(result2.mode).toBe('updated');
      expect(result2.issueNumber).toBe(300);
      
      // Both calls reference same issue number
      expect(result1.issueNumber).toBe(result2.issueNumber);
    });
  });

  describe('Error Handling', () => {
    test('throws IssueCreatorError with GITHUB_API_ERROR on resolver failure', async () => {
      mockResolveCanonicalId.mockRejectedValue(new Error('GitHub API error'));
      
      await expect(createOrUpdateFromCR(sampleCR)).rejects.toThrow(IssueCreatorError);
      
      try {
        await createOrUpdateFromCR(sampleCR);
      } catch (error) {
        expect(error).toBeInstanceOf(IssueCreatorError);
        expect((error as IssueCreatorError).code).toBe(ERROR_CODES.GITHUB_API_ERROR);
      }
    });

    test('includes error details in IssueCreatorError', async () => {
      mockValidateChangeRequest.mockReturnValue({
        ok: false,
        errors: [{ code: 'TEST_ERROR', message: 'Test', path: '/', severity: 'error' }],
        warnings: [],
        meta: { validatedAt: new Date().toISOString(), validatorVersion: '0.7.0' },
      });
      
      try {
        await createOrUpdateFromCR(sampleCR);
      } catch (error) {
        expect(error).toBeInstanceOf(IssueCreatorError);
        const creatorError = error as IssueCreatorError;
        expect(creatorError.details).toBeDefined();
        expect(creatorError.code).toBe(ERROR_CODES.CR_INVALID);
      }
    });
  });

  describe('Race Condition Handling', () => {
    test('handles race condition when create fails due to duplicate issue', async () => {
      // First resolve: not found
      mockResolveCanonicalId.mockResolvedValueOnce({ mode: 'not_found' });
      
      // Create attempt fails with duplicate error
      mockCreateIssue.mockRejectedValueOnce(
        new Error('Validation Failed: {"errors":[{"message":"already exists"}]}')
      );
      
      // Second resolve after race detected: found
      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'found',
        issueNumber: 400,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/400',
        matchedBy: 'body',
      });
      
      // Update succeeds
      mockGetIssue.mockResolvedValue({
        data: {
          number: 400,
          labels: [{ name: 'afu9' }, { name: 'v0.7' }],
        },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: 400,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/400',
        },
      });
      
      const result = await createOrUpdateFromCR(sampleCR);
      
      // Should fall back to update
      expect(result.mode).toBe('updated');
      expect(result.issueNumber).toBe(400);
      
      // Verify retry resolve was called
      expect(mockResolveCanonicalId).toHaveBeenCalledTimes(2);
    });

    test('re-throws error if create fails without race condition indicator', async () => {
      mockResolveCanonicalId.mockResolvedValue({ mode: 'not_found' });
      
      // Create fails with non-race error
      mockCreateIssue.mockRejectedValue(new Error('Network timeout'));
      
      await expect(createOrUpdateFromCR(sampleCR)).rejects.toThrow(IssueCreatorError);
      
      // Should not retry resolve
      expect(mockResolveCanonicalId).toHaveBeenCalledTimes(1);
    });

    test('handles race condition with "duplicate" error message', async () => {
      mockResolveCanonicalId.mockResolvedValueOnce({ mode: 'not_found' });
      
      mockCreateIssue.mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint')
      );
      
      mockResolveCanonicalId.mockResolvedValueOnce({
        mode: 'found',
        issueNumber: 500,
        issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/500',
        matchedBy: 'body',
      });
      
      mockGetIssue.mockResolvedValue({
        data: { number: 500, labels: [] },
      });
      
      mockUpdateIssue.mockResolvedValue({
        data: {
          number: 500,
          html_url: 'https://github.com/adaefler-art/codefactory-control/issues/500',
        },
      });
      
      const result = await createOrUpdateFromCR(sampleCR);
      
      expect(result.mode).toBe('updated');
      expect(result.issueNumber).toBe(500);
    });
  });
});
