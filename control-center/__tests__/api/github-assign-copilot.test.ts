/**
 * Tests for /api/github/issues/[issueNumber]/assign-copilot (E83.2)
 * 
 * Validates:
 * - Idempotency (second call returns NOOP)
 * - Registry validation (repo must be in registry)
 * - Prod blocking (409 when prod disabled)
 * - Issue not found (404)
 * - Audit logging
 */

import { POST } from '../../app/api/github/issues/[issueNumber]/assign-copilot/route';
import { NextRequest } from 'next/server';
import { getPool } from '../../src/lib/db';
import { getRepoActionsRegistryService } from '../../src/lib/repo-actions-registry-service';

// Mock dependencies
jest.mock('../../src/lib/db');
jest.mock('../../src/lib/repo-actions-registry-service');
jest.mock('../../src/lib/github/auth-wrapper');
jest.mock('../../src/lib/db/lawbook');
jest.mock('../../src/lib/utils/prod-control');

const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
};

const mockOctokit = {
  rest: {
    issues: {
      get: jest.fn(),
      addAssignees: jest.fn(),
    },
  },
};

describe('POST /api/github/issues/[issueNumber]/assign-copilot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getPool as jest.Mock).mockReturnValue(mockPool);
    
    // Setup default mocks
    const { createAuthenticatedClient } = require('../../src/lib/github/auth-wrapper');
    createAuthenticatedClient.mockResolvedValue(mockOctokit);

    const { getActiveLawbook } = require('../../src/lib/db/lawbook');
    getActiveLawbook.mockResolvedValue({
      success: true,
      data: {
        lawbook_hash: 'test-lawbook-hash-12345',
      },
    });

    const { isProdEnabled } = require('../../src/lib/utils/prod-control');
    isProdEnabled.mockReturnValue(false);

    // Mock registry service
    const mockRegistryService = {
      getActiveRegistry: jest.fn(),
      validateAction: jest.fn(),
    };
    (getRepoActionsRegistryService as jest.Mock).mockReturnValue(mockRegistryService);
  });

  describe('Success Cases', () => {
    it('should assign copilot successfully when not already assigned', async () => {
      // Setup mocks
      const mockRegistryService = getRepoActionsRegistryService();
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        id: 'test-registry-id',
        registryId: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {},
        active: true,
        createdAt: new Date(),
        createdBy: 'system',
      });

      mockRegistryService.validateAction.mockResolvedValue({
        allowed: true,
        actionType: 'assign_issue',
        preconditionsMet: true,
        missingPreconditions: [],
        approvalRequired: false,
        approvalMet: true,
        errors: [],
        warnings: [],
      });

      mockOctokit.rest.issues.get.mockResolvedValue({
        data: {
          number: 123,
          assignees: [],
        },
      });

      mockOctokit.rest.issues.addAssignees.mockResolvedValue({
        data: {
          assignees: [{ login: 'copilot' }],
        },
      });

      mockPool.query.mockResolvedValue({ rows: [] });

      // Create request
      const request = new NextRequest('http://localhost/api/github/issues/123/assign-copilot', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
          requestId: 'test-request-id',
        }),
      });

      const params = Promise.resolve({ issueNumber: '123' });

      // Execute
      const response = await POST(request, { params });
      const body = await response.json();

      // Verify
      expect(response.status).toBe(200);
      expect(body.status).toBe('ASSIGNED');
      expect(body.assignees).toEqual(['copilot']);
      expect(body.requestId).toBe('test-request-id');
      expect(body.lawbookHash).toBe('test-lawbook-hash-12345');

      // Verify audit log was created
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO registry_action_audit'),
        expect.arrayContaining([
          'test-registry',
          '1.0.0',
          'assign_issue',
          'allowed',
          'owner/repo',
          'issue',
          123,
        ])
      );
    });

    it('should return NOOP when copilot is already assigned (idempotency)', async () => {
      // Setup mocks
      const mockRegistryService = getRepoActionsRegistryService();
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        id: 'test-registry-id',
        registryId: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {},
        active: true,
        createdAt: new Date(),
        createdBy: 'system',
      });

      mockRegistryService.validateAction.mockResolvedValue({
        allowed: true,
        actionType: 'assign_issue',
        preconditionsMet: true,
        missingPreconditions: [],
        approvalRequired: false,
        approvalMet: true,
        errors: [],
        warnings: [],
      });

      mockOctokit.rest.issues.get.mockResolvedValue({
        data: {
          number: 123,
          assignees: [{ login: 'copilot' }], // Already assigned
        },
      });

      mockPool.query.mockResolvedValue({ rows: [] });

      // Create request
      const request = new NextRequest('http://localhost/api/github/issues/123/assign-copilot', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
        }),
      });

      const params = Promise.resolve({ issueNumber: '123' });

      // Execute
      const response = await POST(request, { params });
      const body = await response.json();

      // Verify
      expect(response.status).toBe(200);
      expect(body.status).toBe('NOOP');
      expect(body.assignees).toEqual(['copilot']);
      expect(mockOctokit.rest.issues.addAssignees).not.toHaveBeenCalled();

      // Verify audit log was still created
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO registry_action_audit'),
        expect.anything()
      );
    });
  });

  describe('Error Cases', () => {
    it('should return 400 for invalid request body', async () => {
      const request = new NextRequest('http://localhost/api/github/issues/123/assign-copilot', {
        method: 'POST',
        body: 'invalid json',
      });

      const params = Promise.resolve({ issueNumber: '123' });

      const response = await POST(request, { params });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid request body');
    });

    it('should return 400 for missing required fields', async () => {
      const request = new NextRequest('http://localhost/api/github/issues/123/assign-copilot', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          // Missing repo
        }),
      });

      const params = Promise.resolve({ issueNumber: '123' });

      const response = await POST(request, { params });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Missing required fields');
    });

    it('should return 400 for invalid issue number', async () => {
      const request = new NextRequest('http://localhost/api/github/issues/abc/assign-copilot', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
        }),
      });

      const params = Promise.resolve({ issueNumber: 'abc' });

      const response = await POST(request, { params });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid issue number');
    });

    it('should return 409 when production is blocked', async () => {
      const { isProdEnabled } = require('../../src/lib/utils/prod-control');
      isProdEnabled.mockReturnValue(false);

      const request = new NextRequest('http://control.afu9.cloud/api/github/issues/123/assign-copilot', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
        }),
      });

      const params = Promise.resolve({ issueNumber: '123' });

      const response = await POST(request, { params });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toBe('Production environment blocked');
    });

    it('should return 404 when repository not in registry', async () => {
      const { getActiveLawbook } = require('../../src/lib/db/lawbook');
      getActiveLawbook.mockResolvedValue({
        success: true,
        data: {
          lawbook_hash: 'test-hash',
        },
      });

      const mockRegistryService = getRepoActionsRegistryService();
      mockRegistryService.getActiveRegistry.mockResolvedValue(null);

      const request = new NextRequest('http://localhost/api/github/issues/123/assign-copilot', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'unknown',
          repo: 'unknown',
        }),
      });

      const params = Promise.resolve({ issueNumber: '123' });

      const response = await POST(request, { params });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Repository not found in registry');
    });

    it('should return 403 when action not allowed by registry', async () => {
      const { getActiveLawbook } = require('../../src/lib/db/lawbook');
      getActiveLawbook.mockResolvedValue({
        success: true,
        data: {
          lawbook_hash: 'test-hash',
        },
      });

      const mockRegistryService = getRepoActionsRegistryService();
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        id: 'test-registry-id',
        registryId: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {},
        active: true,
        createdAt: new Date(),
        createdBy: 'system',
      });

      mockRegistryService.validateAction.mockResolvedValue({
        allowed: false,
        actionType: 'assign_issue',
        preconditionsMet: false,
        missingPreconditions: [],
        approvalRequired: false,
        approvalMet: false,
        errors: ['Action not enabled in registry'],
        warnings: [],
      });

      const request = new NextRequest('http://localhost/api/github/issues/123/assign-copilot', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
        }),
      });

      const params = Promise.resolve({ issueNumber: '123' });

      const response = await POST(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Action not allowed by registry');
    });

    it('should return 404 when issue not found on GitHub', async () => {
      const { getActiveLawbook } = require('../../src/lib/db/lawbook');
      getActiveLawbook.mockResolvedValue({
        success: true,
        data: {
          lawbook_hash: 'test-hash',
        },
      });

      const mockRegistryService = getRepoActionsRegistryService();
      mockRegistryService.getActiveRegistry.mockResolvedValue({
        id: 'test-registry-id',
        registryId: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {},
        active: true,
        createdAt: new Date(),
        createdBy: 'system',
      });

      mockRegistryService.validateAction.mockResolvedValue({
        allowed: true,
        actionType: 'assign_issue',
        preconditionsMet: true,
        missingPreconditions: [],
        approvalRequired: false,
        approvalMet: true,
        errors: [],
        warnings: [],
      });

      const notFoundError = new Error('Not Found');
      (notFoundError as any).status = 404;
      mockOctokit.rest.issues.get.mockRejectedValue(notFoundError);

      const request = new NextRequest('http://localhost/api/github/issues/999/assign-copilot', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
        }),
      });

      const params = Promise.resolve({ issueNumber: '999' });

      const response = await POST(request, { params });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Issue not found');
    });
  });
});
