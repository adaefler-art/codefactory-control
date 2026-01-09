/**
 * Tests for IssueDraft Batch Publisher (E82.1)
 * 
 * These tests verify the batch publisher interface and error handling.
 * The core GitHub API integration is tested via mocks of the dependencies.
 */

import {
  publishIssueDraftBatch,
  ERROR_CODES,
} from '../../../src/lib/github/issue-draft-publisher';
import { EXAMPLE_MINIMAL_ISSUE_DRAFT } from '../../../src/lib/schemas/issueDraft';
import type { IssueDraft } from '../../../src/lib/schemas/issueDraft';

describe('IssueDraft Batch Publisher', () => {
  describe('publishIssueDraftBatch - input validation', () => {
    it('should fail all drafts if owner is missing', async () => {
      const drafts = [EXAMPLE_MINIMAL_ISSUE_DRAFT];

      const result = await publishIssueDraftBatch(drafts, '', 'test-repo');

      expect(result.total).toBe(1);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].errorCode).toBe(ERROR_CODES.MISSING_REPO_INFO);
    });

    it('should fail all drafts if repo is missing', async () => {
      const drafts = [EXAMPLE_MINIMAL_ISSUE_DRAFT];

      const result = await publishIssueDraftBatch(drafts, 'test-owner', '');

      expect(result.total).toBe(1);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].errorCode).toBe(ERROR_CODES.MISSING_REPO_INFO);
    });

    it('should handle empty draft array', async () => {
      const result = await publishIssueDraftBatch([], 'test-owner', 'test-repo');

      expect(result.total).toBe(0);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it('should include canonical ID in all results', async () => {
      const drafts = [EXAMPLE_MINIMAL_ISSUE_DRAFT];

      const result = await publishIssueDraftBatch(drafts, '', 'test-repo');

      expect(result.results[0].canonicalId).toBe(EXAMPLE_MINIMAL_ISSUE_DRAFT.canonicalId);
    });

    it('should return batch result with correct structure', async () => {
      const drafts = [EXAMPLE_MINIMAL_ISSUE_DRAFT];

      const result = await publishIssueDraftBatch(drafts, 'test-owner', 'test-repo');

      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('successful');
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('results');
      expect(Array.isArray(result.results)).toBe(true);
    });

    it('should return individual result with correct structure', async () => {
      const drafts = [EXAMPLE_MINIMAL_ISSUE_DRAFT];

      const result = await publishIssueDraftBatch(drafts, '', 'test-repo');

      expect(result.results[0]).toHaveProperty('canonicalId');
      expect(result.results[0]).toHaveProperty('success');
    });

    it('should handle multiple drafts and return result for each', async () => {
      const drafts = [EXAMPLE_MINIMAL_ISSUE_DRAFT, EXAMPLE_MINIMAL_ISSUE_DRAFT];

      const result = await publishIssueDraftBatch(drafts, '', 'test-repo');

      expect(result.total).toBe(2);
      expect(result.results).toHaveLength(2);
    });
  });

  describe('ERROR_CODES', () => {
    it('should export all required error codes', () => {
      expect(ERROR_CODES.VALIDATION_FAILED).toBe('VALIDATION_FAILED');
      expect(ERROR_CODES.REPO_ACCESS_DENIED).toBe('REPO_ACCESS_DENIED');
      expect(ERROR_CODES.GITHUB_API_ERROR).toBe('GITHUB_API_ERROR');
      expect(ERROR_CODES.ISSUE_CREATE_FAILED).toBe('ISSUE_CREATE_FAILED');
      expect(ERROR_CODES.ISSUE_UPDATE_FAILED).toBe('ISSUE_UPDATE_FAILED');
      expect(ERROR_CODES.MISSING_REPO_INFO).toBe('MISSING_REPO_INFO');
    });
  });
});
