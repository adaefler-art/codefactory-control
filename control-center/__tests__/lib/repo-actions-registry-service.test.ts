/**
 * Tests for Repository Actions Registry Service (E83.1)
 */

import { RepoActionsRegistryService } from '../../src/lib/repo-actions-registry-service';
import { RepoActionsRegistry, ActionType } from '../../src/lib/types/repo-actions-registry';
import { Pool } from 'pg';

// Mock pool for testing
const createMockPool = () => {
  const mockClient = {
    query: jest.fn(),
    release: jest.fn(),
  };

  return {
    query: jest.fn(),
    connect: jest.fn().mockResolvedValue(mockClient),
  } as unknown as Pool;
};

describe('RepoActionsRegistryService', () => {
  let service: RepoActionsRegistryService;
  let mockPool: Pool;

  beforeEach(() => {
    mockPool = createMockPool();
    service = new RepoActionsRegistryService(mockPool);
  });

  describe('getActiveRegistry', () => {
    it('should return active registry for repository', async () => {
      const mockRegistry = {
        id: '123',
        registry_id: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {
          version: '1.0.0',
          registryId: 'test-registry',
          repository: 'owner/repo',
          allowedActions: [],
          requiredChecks: [],
          labelMappings: [],
          reviewerMappings: [],
          environments: [],
          createdAt: new Date().toISOString(),
          createdBy: 'test-user',
          failClosed: true,
        },
        active: true,
        created_at: new Date(),
        created_by: 'test-user',
      };

      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [mockRegistry],
      });

      const result = await service.getActiveRegistry('owner/repo');

      expect(result).not.toBeNull();
      expect(result?.repository).toBe('owner/repo');
      expect(result?.active).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE repository = $1 AND active = true'),
        ['owner/repo']
      );
    });

    it('should return null if no active registry exists', async () => {
      (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] });

      const result = await service.getActiveRegistry('owner/repo');

      expect(result).toBeNull();
    });
  });

  describe('validateAction - fail-closed behavior', () => {
    it('should block unknown actions when fail-closed is true', async () => {
      const mockRegistry = {
        id: '123',
        registry_id: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {
          version: '1.0.0',
          registryId: 'test-registry',
          repository: 'owner/repo',
          allowedActions: [
            {
              actionType: 'assign_issue' as ActionType,
              enabled: true,
              preconditions: [],
              requireEvidence: true,
            },
          ],
          requiredChecks: [],
          labelMappings: [],
          reviewerMappings: [],
          environments: [],
          createdAt: new Date().toISOString(),
          createdBy: 'test-user',
          failClosed: true,
        },
        active: true,
        created_at: new Date(),
        created_by: 'test-user',
      };

      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [mockRegistry],
      });

      const result = await service.validateAction(
        'owner/repo',
        'merge_pr' as ActionType,
        {
          resourceType: 'pull_request',
          resourceNumber: 1,
        }
      );

      expect(result.allowed).toBe(false);
      expect(result.errors).toContain(
        'Action "merge_pr" not found in registry (fail-closed mode)'
      );
    });

    it('should allow unknown actions when fail-closed is false', async () => {
      const mockRegistry = {
        id: '123',
        registry_id: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {
          version: '1.0.0',
          registryId: 'test-registry',
          repository: 'owner/repo',
          allowedActions: [],
          requiredChecks: [],
          labelMappings: [],
          reviewerMappings: [],
          environments: [],
          createdAt: new Date().toISOString(),
          createdBy: 'test-user',
          failClosed: false,
        },
        active: true,
        created_at: new Date(),
        created_by: 'test-user',
      };

      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [mockRegistry],
      });

      const result = await service.validateAction(
        'owner/repo',
        'merge_pr' as ActionType,
        {
          resourceType: 'pull_request',
          resourceNumber: 1,
        }
      );

      expect(result.allowed).toBe(true);
      expect(result.warnings).toContain(
        'Action "merge_pr" not found in registry (fail-open mode)'
      );
    });

    it('should block when no registry exists', async () => {
      (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] });

      const result = await service.validateAction(
        'owner/repo',
        'merge_pr' as ActionType,
        {
          resourceType: 'pull_request',
          resourceNumber: 1,
        }
      );

      expect(result.allowed).toBe(false);
      expect(result.errors).toContain('No active registry found for repository');
    });
  });

  describe('validateAction - preconditions', () => {
    it('should validate checks_passed precondition', async () => {
      const mockRegistry = {
        id: '123',
        registry_id: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {
          version: '1.0.0',
          registryId: 'test-registry',
          repository: 'owner/repo',
          allowedActions: [
            {
              actionType: 'merge_pr' as ActionType,
              enabled: true,
              preconditions: [
                {
                  type: 'checks_passed',
                  description: 'All checks must pass',
                },
              ],
              requireEvidence: true,
            },
          ],
          requiredChecks: [],
          labelMappings: [],
          reviewerMappings: [],
          environments: [],
          createdAt: new Date().toISOString(),
          createdBy: 'test-user',
          failClosed: true,
        },
        active: true,
        created_at: new Date(),
        created_by: 'test-user',
      };

      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [mockRegistry],
      });

      // Test with failing checks
      let result = await service.validateAction(
        'owner/repo',
        'merge_pr' as ActionType,
        {
          resourceType: 'pull_request',
          resourceNumber: 1,
          checks: [
            { name: 'CI', status: 'success' },
            { name: 'Build', status: 'failure' },
          ],
        }
      );

      expect(result.allowed).toBe(false);
      expect(result.preconditionsMet).toBe(false);
      expect(result.missingPreconditions.length).toBe(1);

      // Test with passing checks
      result = await service.validateAction(
        'owner/repo',
        'merge_pr' as ActionType,
        {
          resourceType: 'pull_request',
          resourceNumber: 1,
          checks: [
            { name: 'CI', status: 'success' },
            { name: 'Build', status: 'success' },
          ],
        }
      );

      expect(result.allowed).toBe(true);
      expect(result.preconditionsMet).toBe(true);
      expect(result.missingPreconditions.length).toBe(0);
    });

    it('should validate review_approved precondition', async () => {
      const mockRegistry = {
        id: '123',
        registry_id: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {
          version: '1.0.0',
          registryId: 'test-registry',
          repository: 'owner/repo',
          allowedActions: [
            {
              actionType: 'merge_pr' as ActionType,
              enabled: true,
              preconditions: [
                {
                  type: 'review_approved',
                  description: 'PR must be approved',
                },
              ],
              requireEvidence: true,
            },
          ],
          requiredChecks: [],
          labelMappings: [],
          reviewerMappings: [],
          environments: [],
          createdAt: new Date().toISOString(),
          createdBy: 'test-user',
          failClosed: true,
        },
        active: true,
        created_at: new Date(),
        created_by: 'test-user',
      };

      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [mockRegistry],
      });

      // Test without approval
      let result = await service.validateAction(
        'owner/repo',
        'merge_pr' as ActionType,
        {
          resourceType: 'pull_request',
          resourceNumber: 1,
          reviews: [{ state: 'CHANGES_REQUESTED', user: 'reviewer1' }],
        }
      );

      expect(result.allowed).toBe(false);
      expect(result.preconditionsMet).toBe(false);

      // Test with approval
      result = await service.validateAction(
        'owner/repo',
        'merge_pr' as ActionType,
        {
          resourceType: 'pull_request',
          resourceNumber: 1,
          reviews: [{ state: 'APPROVED', user: 'reviewer1' }],
        }
      );

      expect(result.allowed).toBe(true);
      expect(result.preconditionsMet).toBe(true);
    });

    it('should validate pr_mergeable precondition', async () => {
      const mockRegistry = {
        id: '123',
        registry_id: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {
          version: '1.0.0',
          registryId: 'test-registry',
          repository: 'owner/repo',
          allowedActions: [
            {
              actionType: 'merge_pr' as ActionType,
              enabled: true,
              preconditions: [
                {
                  type: 'pr_mergeable',
                  value: true,
                  description: 'PR must be mergeable',
                },
              ],
              requireEvidence: true,
            },
          ],
          requiredChecks: [],
          labelMappings: [],
          reviewerMappings: [],
          environments: [],
          createdAt: new Date().toISOString(),
          createdBy: 'test-user',
          failClosed: true,
        },
        active: true,
        created_at: new Date(),
        created_by: 'test-user',
      };

      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [mockRegistry],
      });

      // Test with non-mergeable PR
      let result = await service.validateAction(
        'owner/repo',
        'merge_pr' as ActionType,
        {
          resourceType: 'pull_request',
          resourceNumber: 1,
          mergeable: false,
        }
      );

      expect(result.allowed).toBe(false);
      expect(result.preconditionsMet).toBe(false);

      // Test with mergeable PR
      result = await service.validateAction(
        'owner/repo',
        'merge_pr' as ActionType,
        {
          resourceType: 'pull_request',
          resourceNumber: 1,
          mergeable: true,
        }
      );

      expect(result.allowed).toBe(true);
      expect(result.preconditionsMet).toBe(true);
    });
  });

  describe('validateAction - approval rules', () => {
    it('should enforce approval requirements', async () => {
      const mockRegistry = {
        id: '123',
        registry_id: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {
          version: '1.0.0',
          registryId: 'test-registry',
          repository: 'owner/repo',
          allowedActions: [
            {
              actionType: 'merge_pr' as ActionType,
              enabled: true,
              preconditions: [],
              approvalRule: {
                required: true,
                minApprovers: 2,
              },
              requireEvidence: true,
            },
          ],
          requiredChecks: [],
          labelMappings: [],
          reviewerMappings: [],
          environments: [],
          createdAt: new Date().toISOString(),
          createdBy: 'test-user',
          failClosed: true,
        },
        active: true,
        created_at: new Date(),
        created_by: 'test-user',
      };

      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [mockRegistry],
      });

      // Test with insufficient approvals
      let result = await service.validateAction(
        'owner/repo',
        'merge_pr' as ActionType,
        {
          resourceType: 'pull_request',
          resourceNumber: 1,
          reviews: [{ state: 'APPROVED', user: 'reviewer1' }],
        }
      );

      expect(result.allowed).toBe(false);
      expect(result.approvalRequired).toBe(true);
      expect(result.approvalMet).toBe(false);

      // Test with sufficient approvals
      result = await service.validateAction(
        'owner/repo',
        'merge_pr' as ActionType,
        {
          resourceType: 'pull_request',
          resourceNumber: 1,
          reviews: [
            { state: 'APPROVED', user: 'reviewer1' },
            { state: 'APPROVED', user: 'reviewer2' },
          ],
        }
      );

      expect(result.allowed).toBe(true);
      expect(result.approvalRequired).toBe(true);
      expect(result.approvalMet).toBe(true);
    });
  });

  describe('validateAction - disabled actions', () => {
    it('should block disabled actions', async () => {
      const mockRegistry = {
        id: '123',
        registry_id: 'test-registry',
        repository: 'owner/repo',
        version: '1.0.0',
        content: {
          version: '1.0.0',
          registryId: 'test-registry',
          repository: 'owner/repo',
          allowedActions: [
            {
              actionType: 'merge_pr' as ActionType,
              enabled: false,
              preconditions: [],
              requireEvidence: true,
            },
          ],
          requiredChecks: [],
          labelMappings: [],
          reviewerMappings: [],
          environments: [],
          createdAt: new Date().toISOString(),
          createdBy: 'test-user',
          failClosed: true,
        },
        active: true,
        created_at: new Date(),
        created_by: 'test-user',
      };

      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [mockRegistry],
      });

      const result = await service.validateAction(
        'owner/repo',
        'merge_pr' as ActionType,
        {
          resourceType: 'pull_request',
          resourceNumber: 1,
        }
      );

      expect(result.allowed).toBe(false);
      expect(result.errors).toContain('Action "merge_pr" is disabled in registry');
    });
  });
});
