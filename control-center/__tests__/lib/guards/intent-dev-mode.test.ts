/**
 * Intent Dev Mode Guard Tests
 * 
 * Tests for DEV MODE guardrail relaxation:
 * - AFU9_INTENT_DEV_MODE env var
 * - Admin user requirement
 * - Staging/development environment requirement
 * - Production protection
 * - Action allowlist enforcement
 * 
 * @jest-environment node
 */

import {
  isDevModeEnvironment,
  isDevModeActive,
  isActionAllowedInDevMode,
  checkDevModeActionAllowed,
  getDevModeActionForTool,
  DEV_MODE_ALLOWLIST,
} from '../../../src/lib/guards/intent-dev-mode';

// Mock deployment-env
jest.mock('../../../src/lib/utils/deployment-env', () => ({
  getDeploymentEnv: jest.fn(),
}));

import { getDeploymentEnv } from '../../../src/lib/utils/deployment-env';

const mockGetDeploymentEnv = getDeploymentEnv as jest.MockedFunction<typeof getDeploymentEnv>;

describe('Intent Dev Mode Guard', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    // Default to staging
    mockGetDeploymentEnv.mockReturnValue('staging');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isDevModeEnvironment', () => {
    test('returns false when AFU9_INTENT_DEV_MODE is not set', () => {
      delete process.env.AFU9_INTENT_DEV_MODE;
      expect(isDevModeEnvironment()).toBe(false);
    });

    test('returns false when AFU9_INTENT_DEV_MODE is "false"', () => {
      process.env.AFU9_INTENT_DEV_MODE = 'false';
      expect(isDevModeEnvironment()).toBe(false);
    });

    test('returns true when AFU9_INTENT_DEV_MODE=true in staging', () => {
      process.env.AFU9_INTENT_DEV_MODE = 'true';
      mockGetDeploymentEnv.mockReturnValue('staging');
      expect(isDevModeEnvironment()).toBe(true);
    });

    test('returns true when AFU9_INTENT_DEV_MODE=1 in development', () => {
      process.env.AFU9_INTENT_DEV_MODE = '1';
      mockGetDeploymentEnv.mockReturnValue('development');
      expect(isDevModeEnvironment()).toBe(true);
    });

    test('returns false in production even with flag set', () => {
      process.env.AFU9_INTENT_DEV_MODE = 'true';
      mockGetDeploymentEnv.mockReturnValue('production');
      expect(isDevModeEnvironment()).toBe(false);
    });

    test('returns false in unknown environment', () => {
      process.env.AFU9_INTENT_DEV_MODE = 'true';
      mockGetDeploymentEnv.mockReturnValue('unknown');
      expect(isDevModeEnvironment()).toBe(false);
    });
  });

  describe('isDevModeActive', () => {
    test('returns false when env not configured', () => {
      delete process.env.AFU9_INTENT_DEV_MODE;
      delete process.env.AFU9_ADMIN_SUBS;
      expect(isDevModeActive('user-123')).toBe(false);
    });

    test('returns false when user is not admin', () => {
      process.env.AFU9_INTENT_DEV_MODE = 'true';
      process.env.AFU9_ADMIN_SUBS = 'admin-1,admin-2';
      mockGetDeploymentEnv.mockReturnValue('staging');
      expect(isDevModeActive('not-admin')).toBe(false);
    });

    test('returns true when all conditions met', () => {
      process.env.AFU9_INTENT_DEV_MODE = 'true';
      process.env.AFU9_ADMIN_SUBS = 'admin-1,admin-2';
      mockGetDeploymentEnv.mockReturnValue('staging');
      expect(isDevModeActive('admin-1')).toBe(true);
    });

    test('returns false when AFU9_ADMIN_SUBS is empty', () => {
      process.env.AFU9_INTENT_DEV_MODE = 'true';
      process.env.AFU9_ADMIN_SUBS = '';
      mockGetDeploymentEnv.mockReturnValue('staging');
      expect(isDevModeActive('admin-1')).toBe(false);
    });
  });

  describe('isActionAllowedInDevMode', () => {
    test('allows save_issue_draft', () => {
      expect(isActionAllowedInDevMode('save_issue_draft')).toBe(true);
    });

    test('allows validate_issue_draft', () => {
      expect(isActionAllowedInDevMode('validate_issue_draft')).toBe(true);
    });

    test('allows commit_issue_draft', () => {
      expect(isActionAllowedInDevMode('commit_issue_draft')).toBe(true);
    });

    test('allows save_change_request', () => {
      expect(isActionAllowedInDevMode('save_change_request')).toBe(true);
    });

    test('allows validate_change_request', () => {
      expect(isActionAllowedInDevMode('validate_change_request')).toBe(true);
    });

    test('allows publish_to_github', () => {
      expect(isActionAllowedInDevMode('publish_to_github')).toBe(true);
    });

    test('denies unknown actions', () => {
      expect(isActionAllowedInDevMode('unknown_action')).toBe(false);
    });

    test('denies dangerous actions not in allowlist', () => {
      expect(isActionAllowedInDevMode('delete_everything')).toBe(false);
    });
  });

  describe('getDevModeActionForTool', () => {
    test('maps save_issue_draft tool', () => {
      expect(getDevModeActionForTool('save_issue_draft')).toBe('save_issue_draft');
    });

    test('maps validate_issue_draft tool', () => {
      expect(getDevModeActionForTool('validate_issue_draft')).toBe('validate_issue_draft');
    });

    test('maps commit_issue_draft tool', () => {
      expect(getDevModeActionForTool('commit_issue_draft')).toBe('commit_issue_draft');
    });

    test('maps apply_issue_draft_patch to save_issue_draft', () => {
      expect(getDevModeActionForTool('apply_issue_draft_patch')).toBe('save_issue_draft');
    });

    test('returns undefined for unknown tools', () => {
      expect(getDevModeActionForTool('unknown_tool')).toBeUndefined();
    });
  });

  describe('checkDevModeActionAllowed', () => {
    test('allows action when dev mode active and action in allowlist', () => {
      process.env.AFU9_INTENT_DEV_MODE = 'true';
      process.env.AFU9_ADMIN_SUBS = 'admin-user';
      mockGetDeploymentEnv.mockReturnValue('staging');

      const result = checkDevModeActionAllowed('admin-user', 'save_issue_draft', {
        sessionId: 'test-session',
      });

      expect(result.allowed).toBe(true);
      expect(result.devMode).toBe(true);
    });

    test('denies action when dev mode inactive', () => {
      process.env.AFU9_INTENT_DEV_MODE = 'false';
      process.env.AFU9_ADMIN_SUBS = 'admin-user';
      mockGetDeploymentEnv.mockReturnValue('staging');

      const result = checkDevModeActionAllowed('admin-user', 'save_issue_draft');

      expect(result.allowed).toBe(false);
      expect(result.devMode).toBe(false);
    });

    test('denies action when user is not admin', () => {
      process.env.AFU9_INTENT_DEV_MODE = 'true';
      process.env.AFU9_ADMIN_SUBS = 'admin-user';
      mockGetDeploymentEnv.mockReturnValue('staging');

      const result = checkDevModeActionAllowed('regular-user', 'save_issue_draft');

      expect(result.allowed).toBe(false);
      expect(result.devMode).toBe(false);
    });

    test('denies action not in allowlist even with dev mode', () => {
      process.env.AFU9_INTENT_DEV_MODE = 'true';
      process.env.AFU9_ADMIN_SUBS = 'admin-user';
      mockGetDeploymentEnv.mockReturnValue('staging');

      const result = checkDevModeActionAllowed('admin-user', 'dangerous_action');

      expect(result.allowed).toBe(false);
      expect(result.devMode).toBe(true);
    });

    test('denies in production regardless of settings', () => {
      process.env.AFU9_INTENT_DEV_MODE = 'true';
      process.env.AFU9_ADMIN_SUBS = 'admin-user';
      mockGetDeploymentEnv.mockReturnValue('production');

      const result = checkDevModeActionAllowed('admin-user', 'save_issue_draft');

      expect(result.allowed).toBe(false);
      expect(result.devMode).toBe(false);
    });
  });

  describe('DEV_MODE_ALLOWLIST', () => {
    test('contains expected draft tools', () => {
      expect(DEV_MODE_ALLOWLIST).toContain('save_issue_draft');
      expect(DEV_MODE_ALLOWLIST).toContain('validate_issue_draft');
      expect(DEV_MODE_ALLOWLIST).toContain('commit_issue_draft');
    });

    test('contains expected CR tools', () => {
      expect(DEV_MODE_ALLOWLIST).toContain('save_change_request');
      expect(DEV_MODE_ALLOWLIST).toContain('validate_change_request');
      expect(DEV_MODE_ALLOWLIST).toContain('publish_to_github');
    });

    test('contains lifecycle actions', () => {
      expect(DEV_MODE_ALLOWLIST).toContain('issue_publish');
      expect(DEV_MODE_ALLOWLIST).toContain('bind_change_request');
    });
  });
});

describe('AFU9_INTENT_ENABLED flag integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockGetDeploymentEnv.mockReturnValue('staging');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('dev mode does not affect AFU9_INTENT_ENABLED requirement', () => {
    // Dev mode only relaxes DISCUSS guardrails
    // AFU9_INTENT_ENABLED must still be true for INTENT to work at all
    process.env.AFU9_INTENT_DEV_MODE = 'true';
    process.env.AFU9_ADMIN_SUBS = 'admin-user';
    
    // This would need to be checked at route level, not in dev mode guard
    // Dev mode assumes INTENT is already enabled
    const result = checkDevModeActionAllowed('admin-user', 'save_issue_draft');
    expect(result.allowed).toBe(true);
    
    // The AFU9_INTENT_ENABLED check happens at the route handler level
    // before dev mode is even consulted
  });

  test('staging can use dev mode when INTENT enabled', () => {
    process.env.AFU9_INTENT_ENABLED = 'true';
    process.env.AFU9_INTENT_DEV_MODE = 'true';
    process.env.AFU9_ADMIN_SUBS = 'admin-user';
    mockGetDeploymentEnv.mockReturnValue('staging');

    expect(isDevModeActive('admin-user')).toBe(true);
    expect(checkDevModeActionAllowed('admin-user', 'commit_issue_draft').allowed).toBe(true);
  });
});
