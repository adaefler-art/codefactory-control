/**
 * INTENT Agent Tools Tests
 * 
 * Tests for OpenAI Function Calling integration with INTENT Agent
 * 
 * @jest-environment node
 */

import { INTENT_TOOLS } from '../../src/lib/intent-agent-tools';
import { executeIntentTool } from '../../src/lib/intent-agent-tool-executor';
import type { Pool } from 'pg';

// Mock dependencies
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(),
}));

jest.mock('../../src/lib/db/contextPacks', () => ({
  generateContextPack: jest.fn(),
  getContextPack: jest.fn(),
}));

jest.mock('../../src/lib/db/intentCrDrafts', () => ({
  getCrDraft: jest.fn(),
  saveCrDraft: jest.fn(),
  validateAndSaveCrDraft: jest.fn(),
  getLatestCrDraft: jest.fn(),
}));

jest.mock('../../src/lib/github/issue-creator', () => ({
  createOrUpdateFromCR: jest.fn(),
}));

import { getPool } from '../../src/lib/db';
import { generateContextPack } from '../../src/lib/db/contextPacks';
import { getCrDraft, saveCrDraft, validateAndSaveCrDraft, getLatestCrDraft } from '../../src/lib/db/intentCrDrafts';
import { createOrUpdateFromCR } from '../../src/lib/github/issue-creator';

describe('INTENT Agent Tools', () => {
  const mockPool = {} as Pool;
  const testUserId = 'test-user-123';
  const testSessionId = 'test-session-456';

  beforeEach(() => {
    jest.clearAllMocks();
    (getPool as jest.Mock).mockReturnValue(mockPool);
  });

  describe('Tool Definitions', () => {
    test('should export 5 tools', () => {
      expect(INTENT_TOOLS).toHaveLength(5);
    });

    test('should have correct tool names', () => {
      const toolNames = INTENT_TOOLS.map(tool => tool.function.name);
      expect(toolNames).toEqual([
        'get_context_pack',
        'get_change_request',
        'save_change_request',
        'validate_change_request',
        'publish_to_github',
      ]);
    });

    test('should have valid OpenAI tool structure', () => {
      INTENT_TOOLS.forEach(tool => {
        expect(tool.type).toBe('function');
        expect(tool.function.name).toBeTruthy();
        expect(tool.function.description).toBeTruthy();
        expect(tool.function.parameters).toBeTruthy();
        expect(tool.function.parameters.type).toBe('object');
      });
    });
  });

  describe('Tool Executor: get_context_pack', () => {
    test('should successfully generate context pack', async () => {
      const mockPack = {
        id: 'pack-123',
        session_id: testSessionId,
        pack_json: { messages: [] },
        pack_hash: 'hash123',
      };

      (generateContextPack as jest.Mock).mockResolvedValue({
        success: true,
        data: mockPack,
      });

      const result = await executeIntentTool('get_context_pack', { sessionId: testSessionId }, testUserId);
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(parsed.pack).toEqual(mockPack);
      expect(generateContextPack).toHaveBeenCalledWith(mockPool, testSessionId, testUserId);
    });

    test('should return error when context pack generation fails', async () => {
      (generateContextPack as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Session not found',
        code: 'SESSION_NOT_FOUND',
      });

      const result = await executeIntentTool('get_context_pack', { sessionId: testSessionId }, testUserId);
      const parsed = JSON.parse(result);

      expect(parsed.error).toBe('Session not found');
      expect(parsed.code).toBe('SESSION_NOT_FOUND');
    });
  });

  describe('Tool Executor: get_change_request', () => {
    test('should return CR draft when it exists', async () => {
      const mockDraft = {
        id: 'draft-123',
        session_id: testSessionId,
        cr_json: { canonicalId: 'CR-123' },
        status: 'draft',
      };

      (getCrDraft as jest.Mock).mockResolvedValue({
        success: true,
        data: mockDraft,
      });

      const result = await executeIntentTool('get_change_request', { sessionId: testSessionId }, testUserId);
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(parsed.draft).toEqual(mockDraft);
      expect(getCrDraft).toHaveBeenCalledWith(mockPool, testSessionId, testUserId);
    });

    test('should return null when no CR draft exists', async () => {
      (getCrDraft as jest.Mock).mockResolvedValue({
        success: true,
        data: null,
      });

      const result = await executeIntentTool('get_change_request', { sessionId: testSessionId }, testUserId);
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(parsed.draft).toBeNull();
      expect(parsed.message).toBe('No Change Request draft exists yet');
    });

    test('should return error when access denied', async () => {
      (getCrDraft as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Session not found or access denied',
      });

      const result = await executeIntentTool('get_change_request', { sessionId: testSessionId }, testUserId);
      const parsed = JSON.parse(result);

      expect(parsed.error).toBe('Session not found or access denied');
      expect(parsed.code).toBe('CR_ACCESS_DENIED');
    });
  });

  describe('Tool Executor: save_change_request', () => {
    test('should save CR draft successfully', async () => {
      const mockCrJson = { canonicalId: 'CR-123', title: 'Test CR' };
      const mockDraft = {
        id: 'draft-123',
        session_id: testSessionId,
        cr_json: mockCrJson,
        status: 'draft',
      };

      (saveCrDraft as jest.Mock).mockResolvedValue({
        success: true,
        data: mockDraft,
      });

      const result = await executeIntentTool('save_change_request', {
        sessionId: testSessionId,
        crJson: mockCrJson,
      }, testUserId);
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(parsed.draft).toEqual(mockDraft);
      expect(parsed.message).toBe('Change Request draft saved successfully');
      expect(saveCrDraft).toHaveBeenCalledWith(mockPool, testSessionId, testUserId, mockCrJson);
    });

    test('should return error when save fails', async () => {
      (saveCrDraft as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Database error',
      });

      const result = await executeIntentTool('save_change_request', {
        sessionId: testSessionId,
        crJson: {},
      }, testUserId);
      const parsed = JSON.parse(result);

      expect(parsed.error).toBe('Database error');
      expect(parsed.code).toBe('CR_SAVE_FAILED');
    });
  });

  describe('Tool Executor: validate_change_request', () => {
    test('should validate and save CR successfully', async () => {
      const mockCrJson = { canonicalId: 'CR-123' };
      const mockValidation = {
        ok: true,
        errors: [],
        warnings: [],
        meta: { hash: 'hash123' },
      };
      const mockDraft = {
        id: 'draft-123',
        session_id: testSessionId,
        cr_json: mockCrJson,
        status: 'valid',
      };

      (validateAndSaveCrDraft as jest.Mock).mockResolvedValue({
        success: true,
        data: mockDraft,
        validation: mockValidation,
      });

      const result = await executeIntentTool('validate_change_request', {
        sessionId: testSessionId,
        crJson: mockCrJson,
      }, testUserId);
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(parsed.validation).toEqual(mockValidation);
      expect(parsed.draft).toEqual(mockDraft);
      expect(validateAndSaveCrDraft).toHaveBeenCalledWith(mockPool, testSessionId, testUserId, mockCrJson);
    });

    test('should return validation errors when CR is invalid', async () => {
      const mockValidation = {
        ok: false,
        errors: ['Missing canonicalId'],
        warnings: [],
        meta: {},
      };

      (validateAndSaveCrDraft as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Validation failed',
        validation: mockValidation,
      });

      const result = await executeIntentTool('validate_change_request', {
        sessionId: testSessionId,
        crJson: {},
      }, testUserId);
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(false);
      expect(parsed.validation).toEqual(mockValidation);
    });
  });

  describe('Tool Executor: publish_to_github', () => {
    test('should publish CR to GitHub successfully', async () => {
      const mockCrJson = { canonicalId: 'CR-123', targets: { repo: { owner: 'test', repo: 'repo' } } };
      const mockDraft = {
        id: 'draft-123',
        session_id: testSessionId,
        cr_json: mockCrJson,
        status: 'valid',
      };

      (getLatestCrDraft as jest.Mock).mockResolvedValue({
        success: true,
        data: mockDraft,
      });

      (createOrUpdateFromCR as jest.Mock).mockResolvedValue({
        mode: 'created',
        issueNumber: 42,
        url: 'https://github.com/test/repo/issues/42',
      });

      const result = await executeIntentTool('publish_to_github', {
        sessionId: testSessionId,
      }, testUserId);
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(parsed.mode).toBe('created');
      expect(parsed.issueNumber).toBe(42);
      expect(parsed.url).toBe('https://github.com/test/repo/issues/42');
      expect(parsed.message).toBe('GitHub issue created successfully');
      expect(getLatestCrDraft).toHaveBeenCalledWith(mockPool, testSessionId, testUserId);
      expect(createOrUpdateFromCR).toHaveBeenCalledWith(mockCrJson);
    });

    test('should return error when no CR found', async () => {
      (getLatestCrDraft as jest.Mock).mockResolvedValue({
        success: true,
        data: null,
      });

      const result = await executeIntentTool('publish_to_github', {
        sessionId: testSessionId,
      }, testUserId);
      const parsed = JSON.parse(result);

      expect(parsed.error).toBe('No Change Request found to publish');
      expect(parsed.code).toBe('CR_NOT_FOUND');
    });

    test('should handle GitHub publishing errors', async () => {
      const mockDraft = {
        id: 'draft-123',
        session_id: testSessionId,
        cr_json: { canonicalId: 'CR-123' },
        status: 'valid',
      };

      (getLatestCrDraft as jest.Mock).mockResolvedValue({
        success: true,
        data: mockDraft,
      });

      (createOrUpdateFromCR as jest.Mock).mockRejectedValue(new Error('GitHub API error'));

      const result = await executeIntentTool('publish_to_github', {
        sessionId: testSessionId,
      }, testUserId);
      const parsed = JSON.parse(result);

      expect(parsed.error).toBe('GitHub API error');
      expect(parsed.code).toBe('GITHUB_PUBLISH_FAILED');
    });
  });

  describe('Tool Executor: Error Handling', () => {
    test('should return error for unknown tool', async () => {
      const result = await executeIntentTool('unknown_tool', {}, testUserId);
      const parsed = JSON.parse(result);

      expect(parsed.error).toBe('Unknown tool: unknown_tool');
      expect(parsed.code).toBe('UNKNOWN_TOOL');
    });

    test('should handle unexpected errors gracefully', async () => {
      (getCrDraft as jest.Mock).mockRejectedValue(new Error('Unexpected database error'));

      const result = await executeIntentTool('get_change_request', { sessionId: testSessionId }, testUserId);
      const parsed = JSON.parse(result);

      expect(parsed.error).toBe('Unexpected database error');
      expect(parsed.code).toBe('TOOL_EXECUTION_ERROR');
    });
  });
});
