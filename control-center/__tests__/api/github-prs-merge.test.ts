/**
 * Tests for /api/github/prs/[prNumber]/merge (E83.5)
 * 
 * Validates:
 * - Precondition validation (checks, reviews, mergeable, draft)
 * - Merge method selection from registry
 * - Branch deletion after successful merge
 * - Production blocking
 * - Audit logging
 * - Fail-closed behavior
 */

import { POST } from '../../app/api/github/prs/[prNumber]/merge/route';
import { NextRequest } from 'next/server';
import { getPool } from '../../src/lib/db';
import { getRepoActionsRegistryService } from '../../src/lib/repo-actions-registry-service';

// Mock dependencies
jest.mock('../../src/lib/db');
jest.mock('../../src/lib/repo-actions-registry-service');
jest.mock('../../src/lib/github/auth-wrapper');
jest.mock('../../src/lib/utils/prod-control');

const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
};

const mockOctokit = {
  rest: {
    pulls: {
      get: jest.fn(),
      merge: jest.fn(),
      listReviews: jest.fn(),
    },
    checks: {
      listForRef: jest.fn(),
    },
    git: {
      deleteRef: jest.fn(),
    },
  },
};

describe('POST /api/github/prs/[prNumber]/merge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getPool as jest.Mock).mockReturnValue(mockPool);

    // Setup default mocks
    const { createAuthenticatedClient } = require('../../src/lib/github/auth-wrapper');
    createAuthenticatedClient.mockResolvedValue(mockOctokit);

    const { isProdEnabled } = require('../../src/lib/utils/prod-control');
    isProdEnabled.mockReturnValue(false);

    // Mock registry service
    const mockRegistryService = {
      getActiveRegistry: jest.fn(),
      validateAction: jest.fn(),
      logActionValidation: jest.fn(),
    };
    (getRepoActionsRegistryService as jest.Mock).mockReturnValue(mockRegistryService);

    // Mock pool.query for audit logging
    mockPool.query.mockResolvedValue({
      rows: [{ id: 123 }],
    });
  });

  describe('Success Cases', () => {
    it('should merge PR successfully when all preconditions are met', async () => {
      // Setup mocks
      const mockRegistryService = getRepoActionsRegistryService();
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        id: 'test-registry-id',
        registryId: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {
          allowedActions: [
            {
              actionType: 'merge_pr',
              enabled: true,
              preconditions: [],
            },
          ],
          mergePolicy: {
            defaultMethod: 'squash',
            allowedMethods: ['squash', 'merge'],
            deleteBranchOnMerge: true,
          },
        },
        active: true,
        createdAt: new Date(),
        createdBy: 'system',
      });

      mockRegistryService.validateAction.mockResolvedValue({
        allowed: true,
        actionType: 'merge_pr',
        preconditionsMet: true,
        missingPreconditions: [],
        approvalRequired: true,
        approvalMet: true,
        errors: [],
        warnings: [],
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          mergeable: true,
          draft: false,
          head: {
            ref: 'feature-branch',
            sha: 'abc123',
          },
          labels: [],
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              name: 'CI',
              status: 'completed',
              conclusion: 'success',
            },
            {
              name: 'Build',
              status: 'completed',
              conclusion: 'success',
            },
          ],
        },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: 'reviewer1' },
            state: 'APPROVED',
          },
        ],
      });

      mockOctokit.rest.pulls.merge.mockResolvedValue({
        data: {
          sha: 'merge-sha-123',
          merged: true,
        },
      });

      mockOctokit.rest.git.deleteRef.mockResolvedValue({});

      // Make request
      const request = new NextRequest('http://localhost/api/github/prs/123/merge', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
          approvalToken: 'test-token',
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ prNumber: '123' }),
      });

      // Verify response
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.decision).toBe('MERGED');
      expect(data.merged).toBe(true);
      expect(data.branchDeleted).toBe(true);
      expect(data.mergeMethod).toBe('squash');
      expect(data.commitSha).toBe('merge-sha-123');

      // Verify merge was called with correct method
      expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        pull_number: 123,
        merge_method: 'squash',
      });

      // Verify branch deletion was called
      expect(mockOctokit.rest.git.deleteRef).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        ref: 'heads/feature-branch',
      });

      // Verify audit logging
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO registry_action_audit'),
        expect.arrayContaining([
          expect.any(String), // registry_id
          expect.any(String), // registry_version
          'merge_pr',
          'allowed',
          'owner/repo',
          'pull_request',
          123,
          expect.any(String), // validation_result JSON
        ])
      );
    });

    it('should not delete branch when deleteBranchOnMerge is false', async () => {
      // Setup mocks
      const mockRegistryService = getRepoActionsRegistryService();
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        id: 'test-registry-id',
        registryId: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {
          allowedActions: [
            {
              actionType: 'merge_pr',
              enabled: true,
              preconditions: [],
            },
          ],
          mergePolicy: {
            defaultMethod: 'merge',
            allowedMethods: ['merge'],
            deleteBranchOnMerge: false, // Branch deletion disabled
          },
        },
        active: true,
        createdAt: new Date(),
        createdBy: 'system',
      });

      mockRegistryService.validateAction.mockResolvedValue({
        allowed: true,
        actionType: 'merge_pr',
        preconditionsMet: true,
        missingPreconditions: [],
        approvalRequired: false,
        approvalMet: true,
        errors: [],
        warnings: [],
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          mergeable: true,
          draft: false,
          head: {
            ref: 'feature-branch',
            sha: 'abc123',
          },
          labels: [],
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [],
      });

      mockOctokit.rest.pulls.merge.mockResolvedValue({
        data: {
          sha: 'merge-sha-123',
          merged: true,
        },
      });

      // Make request
      const request = new NextRequest('http://localhost/api/github/prs/123/merge', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ prNumber: '123' }),
      });

      // Verify response
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.merged).toBe(true);
      expect(data.branchDeleted).toBe(false);

      // Verify branch deletion was NOT called
      expect(mockOctokit.rest.git.deleteRef).not.toHaveBeenCalled();
    });
  });

  describe('Precondition Failures', () => {
    it('should block merge when no registry exists', async () => {
      // Setup mocks
      const mockRegistryService = getRepoActionsRegistryService();
      mockRegistryService.getActiveRegistry.mockResolvedValue(null); // No registry

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          mergeable: true,
          draft: false,
          head: {
            ref: 'feature-branch',
            sha: 'abc123',
          },
          labels: [],
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [],
      });

      // Make request
      const request = new NextRequest('http://localhost/api/github/prs/123/merge', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ prNumber: '123' }),
      });

      // Verify response
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.decision).toBe('BLOCKED_NO_REGISTRY');
      expect(data.merged).toBe(false);
      expect(data.reasonCodes).toContain('No active registry found for repository');
    });

    it('should block merge when merge_pr action is disabled', async () => {
      // Setup mocks
      const mockRegistryService = getRepoActionsRegistryService();
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        id: 'test-registry-id',
        registryId: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {
          allowedActions: [
            {
              actionType: 'merge_pr',
              enabled: false, // Disabled
            },
          ],
        },
        active: true,
        createdAt: new Date(),
        createdBy: 'system',
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          mergeable: true,
          draft: false,
          head: {
            ref: 'feature-branch',
            sha: 'abc123',
          },
          labels: [],
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [],
      });

      // Make request
      const request = new NextRequest('http://localhost/api/github/prs/123/merge', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ prNumber: '123' }),
      });

      // Verify response
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.code).toBe('REGISTRY_AUTHORIZATION_FAILED');
    });

    it('should block merge when preconditions are not met', async () => {
      // Setup mocks
      const mockRegistryService = getRepoActionsRegistryService();
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        id: 'test-registry-id',
        registryId: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {
          allowedActions: [
            {
              actionType: 'merge_pr',
              enabled: true,
              preconditions: [
                { type: 'checks_passed' },
                { type: 'pr_mergeable' },
              ],
            },
          ],
          mergePolicy: {
            defaultMethod: 'squash',
            deleteBranchOnMerge: true,
          },
        },
        active: true,
        createdAt: new Date(),
        createdBy: 'system',
      });

      mockRegistryService.validateAction.mockResolvedValue({
        allowed: false,
        actionType: 'merge_pr',
        preconditionsMet: false,
        missingPreconditions: [
          { type: 'checks_passed', description: 'All checks must pass' },
        ],
        approvalRequired: true,
        approvalMet: true,
        errors: ['Preconditions not met: checks_passed'],
        warnings: [],
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          mergeable: true,
          draft: false,
          head: {
            ref: 'feature-branch',
            sha: 'abc123',
          },
          labels: [],
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              name: 'CI',
              status: 'completed',
              conclusion: 'failure', // Failed check
            },
          ],
        },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: 'reviewer1' },
            state: 'APPROVED',
          },
        ],
      });

      // Make request
      const request = new NextRequest('http://localhost/api/github/prs/123/merge', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ prNumber: '123' }),
      });

      // Verify response
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.decision).toBe('BLOCKED_MISSING_PRECONDITIONS');
      expect(data.merged).toBe(false);
      expect(data.reasonCodes).toContain('checks_passed');
    });

    it('should block merge when approval is not met', async () => {
      // Setup mocks
      const mockRegistryService = getRepoActionsRegistryService();
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        id: 'test-registry-id',
        registryId: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {
          allowedActions: [
            {
              actionType: 'merge_pr',
              enabled: true,
              preconditions: [],
              approvalRule: {
                required: true,
                minApprovers: 2,
              },
            },
          ],
          mergePolicy: {
            defaultMethod: 'squash',
            deleteBranchOnMerge: true,
          },
        },
        active: true,
        createdAt: new Date(),
        createdBy: 'system',
      });

      mockRegistryService.validateAction.mockResolvedValue({
        allowed: false,
        actionType: 'merge_pr',
        preconditionsMet: true,
        missingPreconditions: [],
        approvalRequired: true,
        approvalMet: false, // Not enough approvals
        errors: ['Approval requirements not met'],
        warnings: [],
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          mergeable: true,
          draft: false,
          head: {
            ref: 'feature-branch',
            sha: 'abc123',
          },
          labels: [],
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              name: 'CI',
              status: 'completed',
              conclusion: 'success',
            },
          ],
        },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [
          {
            id: 1,
            user: { login: 'reviewer1' },
            state: 'APPROVED',
          },
          // Only 1 approval, but needs 2
        ],
      });

      // Make request
      const request = new NextRequest('http://localhost/api/github/prs/123/merge', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ prNumber: '123' }),
      });

      // Verify response
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.decision).toBe('BLOCKED_NO_APPROVAL');
      expect(data.merged).toBe(false);
      expect(data.reasonCodes).toContain('Minimum approvals not met');
    });

    it('should block merge in production without approval token', async () => {
      // Enable prod mode
      const { isProdEnabled } = require('../../src/lib/utils/prod-control');
      isProdEnabled.mockReturnValue(true);

      // Setup mocks
      const mockRegistryService = getRepoActionsRegistryService();
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        id: 'test-registry-id',
        registryId: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {
          allowedActions: [
            {
              actionType: 'merge_pr',
              enabled: true,
              preconditions: [],
            },
          ],
          mergePolicy: {
            defaultMethod: 'squash',
            deleteBranchOnMerge: true,
          },
        },
        active: true,
        createdAt: new Date(),
        createdBy: 'system',
      });

      mockRegistryService.validateAction.mockResolvedValue({
        allowed: true,
        actionType: 'merge_pr',
        preconditionsMet: true,
        missingPreconditions: [],
        approvalRequired: false,
        approvalMet: true,
        errors: [],
        warnings: [],
      });

      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          mergeable: true,
          draft: false,
          head: {
            ref: 'feature-branch',
            sha: 'abc123',
          },
          labels: [],
        },
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [],
      });

      // Make request WITHOUT approval token
      const request = new NextRequest('http://localhost/api/github/prs/123/merge', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
          // No approvalToken
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ prNumber: '123' }),
      });

      // Verify response
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.code).toBe('PRODUCTION_MERGE_BLOCKED');
    });
  });

  describe('Error Cases', () => {
    it('should return 404 when PR not found', async () => {
      // Setup mocks
      const mockRegistryService = getRepoActionsRegistryService();
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        id: 'test-registry-id',
        registryId: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {
          allowedActions: [
            {
              actionType: 'merge_pr',
              enabled: true,
            },
          ],
        },
        active: true,
        createdAt: new Date(),
        createdBy: 'system',
      });

      // PR not found
      mockOctokit.rest.pulls.get.mockRejectedValue({
        status: 404,
        message: 'Not Found',
      });

      // Make request
      const request = new NextRequest('http://localhost/api/github/prs/999/merge', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ prNumber: '999' }),
      });

      // Verify response
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.code).toBe('PR_NOT_FOUND');
    });

    it('should return 400 for invalid PR number', async () => {
      // Make request with invalid PR number
      const request = new NextRequest('http://localhost/api/github/prs/abc/merge', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ prNumber: 'abc' }),
      });

      // Verify response
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.code).toBe('INVALID_PR_NUMBER');
    });
  });
});
