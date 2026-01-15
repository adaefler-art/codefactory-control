/**
 * Unit Tests for Approval Gate Service (E87.1)
 * 
 * Tests:
 * - Phrase validation (exact match required)
 * - Action fingerprint determinism (same inputs → same hash)
 * - Fail-closed behavior (no approval → deny)
 * - Approval validation logic
 */

import {
  ActionType,
  validateSignedPhrase,
  getRequiredPhrase,
  computeActionFingerprint,
  computeHash,
  checkApprovalGate,
  validateApprovalRequest,
  ActionContext,
  ApprovalRequest,
} from '../approval-gate';

describe('Approval Gate - Phrase Validation', () => {
  test('should validate correct merge phrase', () => {
    const result = validateSignedPhrase('YES MERGE', 'merge');
    expect(result.valid).toBe(true);
    expect(result.expectedPhrase).toBe('YES MERGE');
  });

  test('should validate correct prod phrase', () => {
    const result = validateSignedPhrase('YES PROD', 'prod_operation');
    expect(result.valid).toBe(true);
    expect(result.expectedPhrase).toBe('YES PROD');
  });

  test('should validate correct destructive phrase', () => {
    const result = validateSignedPhrase('YES DESTRUCTIVE', 'destructive_operation');
    expect(result.valid).toBe(true);
    expect(result.expectedPhrase).toBe('YES DESTRUCTIVE');
  });

  test('should reject incorrect phrase (case mismatch)', () => {
    const result = validateSignedPhrase('yes merge', 'merge');
    expect(result.valid).toBe(false);
    expect(result.expectedPhrase).toBe('YES MERGE');
  });

  test('should reject incorrect phrase (wrong text)', () => {
    const result = validateSignedPhrase('YES', 'merge');
    expect(result.valid).toBe(false);
  });

  test('should reject empty phrase', () => {
    const result = validateSignedPhrase('', 'merge');
    expect(result.valid).toBe(false);
  });

  test('should get required phrases', () => {
    expect(getRequiredPhrase('merge')).toBe('YES MERGE');
    expect(getRequiredPhrase('prod_operation')).toBe('YES PROD');
    expect(getRequiredPhrase('destructive_operation')).toBe('YES DESTRUCTIVE');
  });
});

describe('Approval Gate - Action Fingerprint Determinism', () => {
  test('should produce same hash for identical contexts', () => {
    const context1: ActionContext = {
      actionType: 'merge',
      targetType: 'pr',
      targetIdentifier: 'owner/repo#123',
      params: { method: 'squash', deleteBranch: true },
    };

    const context2: ActionContext = {
      actionType: 'merge',
      targetType: 'pr',
      targetIdentifier: 'owner/repo#123',
      params: { method: 'squash', deleteBranch: true },
    };

    const hash1 = computeActionFingerprint(context1);
    const hash2 = computeActionFingerprint(context2);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex string
  });

  test('should produce same hash regardless of param order', () => {
    const context1: ActionContext = {
      actionType: 'merge',
      targetType: 'pr',
      targetIdentifier: 'owner/repo#123',
      params: { a: 1, b: 2, c: 3 },
    };

    const context2: ActionContext = {
      actionType: 'merge',
      targetType: 'pr',
      targetIdentifier: 'owner/repo#123',
      params: { c: 3, a: 1, b: 2 },
    };

    const hash1 = computeActionFingerprint(context1);
    const hash2 = computeActionFingerprint(context2);

    expect(hash1).toBe(hash2);
  });

  test('should produce different hash for different action types', () => {
    const context1: ActionContext = {
      actionType: 'merge',
      targetType: 'pr',
      targetIdentifier: 'owner/repo#123',
    };

    const context2: ActionContext = {
      actionType: 'destructive_operation',
      targetType: 'pr',
      targetIdentifier: 'owner/repo#123',
    };

    const hash1 = computeActionFingerprint(context1);
    const hash2 = computeActionFingerprint(context2);

    expect(hash1).not.toBe(hash2);
  });

  test('should produce different hash for different targets', () => {
    const context1: ActionContext = {
      actionType: 'merge',
      targetType: 'pr',
      targetIdentifier: 'owner/repo#123',
    };

    const context2: ActionContext = {
      actionType: 'merge',
      targetType: 'pr',
      targetIdentifier: 'owner/repo#456',
    };

    const hash1 = computeActionFingerprint(context1);
    const hash2 = computeActionFingerprint(context2);

    expect(hash1).not.toBe(hash2);
  });

  test('should handle empty params consistently', () => {
    const context1: ActionContext = {
      actionType: 'merge',
      targetType: 'pr',
      targetIdentifier: 'owner/repo#123',
      params: {},
    };

    const context2: ActionContext = {
      actionType: 'merge',
      targetType: 'pr',
      targetIdentifier: 'owner/repo#123',
    };

    const hash1 = computeActionFingerprint(context1);
    const hash2 = computeActionFingerprint(context2);

    expect(hash1).toBe(hash2);
  });
});

describe('Approval Gate - Hash Function', () => {
  test('should produce SHA-256 hash', () => {
    const hash = computeHash('test');
    expect(hash).toHaveLength(64);
    expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
  });

  test('should be deterministic', () => {
    const hash1 = computeHash('test');
    const hash2 = computeHash('test');
    expect(hash1).toBe(hash2);
  });

  test('should produce different hashes for different inputs', () => {
    const hash1 = computeHash('test1');
    const hash2 = computeHash('test2');
    expect(hash1).not.toBe(hash2);
  });
});

describe('Approval Gate - Fail-Closed Behavior', () => {
  test('should deny when no approval found', async () => {
    const mockGetApproval = jest.fn().mockResolvedValue(null);

    const result = await checkApprovalGate(
      'test-fingerprint',
      'test-request-id',
      300,
      mockGetApproval
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('No approval found');
    expect(mockGetApproval).toHaveBeenCalledWith('test-fingerprint', 'test-request-id');
  });

  test('should deny when approval is denied', async () => {
    const mockApproval = {
      id: 1,
      decision: 'denied',
      created_at: new Date().toISOString(),
    };

    const mockGetApproval = jest.fn().mockResolvedValue(mockApproval);

    const result = await checkApprovalGate(
      'test-fingerprint',
      'test-request-id',
      300,
      mockGetApproval
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('denied');
    expect(result.approvalId).toBe(1);
  });

  test('should deny when approval is cancelled', async () => {
    const mockApproval = {
      id: 1,
      decision: 'cancelled',
      created_at: new Date().toISOString(),
    };

    const mockGetApproval = jest.fn().mockResolvedValue(mockApproval);

    const result = await checkApprovalGate(
      'test-fingerprint',
      'test-request-id',
      300,
      mockGetApproval
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('cancelled');
  });

  test('should deny when approval is expired', async () => {
    const oldDate = new Date(Date.now() - 400 * 1000); // 400 seconds ago
    const mockApproval = {
      id: 1,
      decision: 'approved',
      created_at: oldDate.toISOString(),
    };

    const mockGetApproval = jest.fn().mockResolvedValue(mockApproval);

    const result = await checkApprovalGate(
      'test-fingerprint',
      'test-request-id',
      300, // 300 second window
      mockGetApproval
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('expired');
  });

  test('should allow when approval is valid and recent', async () => {
    const recentDate = new Date(Date.now() - 100 * 1000); // 100 seconds ago
    const mockApproval = {
      id: 1,
      decision: 'approved',
      created_at: recentDate.toISOString(),
    };

    const mockGetApproval = jest.fn().mockResolvedValue(mockApproval);

    const result = await checkApprovalGate(
      'test-fingerprint',
      'test-request-id',
      300, // 300 second window
      mockGetApproval
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('Valid approval');
    expect(result.approvalId).toBe(1);
  });
});

describe('Approval Gate - Request Validation', () => {
  test('should validate correct approval request', () => {
    const request: ApprovalRequest = {
      actionContext: {
        actionType: 'merge',
        targetType: 'pr',
        targetIdentifier: 'owner/repo#123',
      },
      approvalContext: {
        requestId: 'req-123',
      },
      actor: 'user-123',
      signedPhrase: 'YES MERGE',
    };

    const result = validateApprovalRequest(request);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('should reject invalid action type', () => {
    const request: ApprovalRequest = {
      actionContext: {
        actionType: 'invalid' as ActionType,
        targetType: 'pr',
        targetIdentifier: 'owner/repo#123',
      },
      approvalContext: {
        requestId: 'req-123',
      },
      actor: 'user-123',
      signedPhrase: 'YES MERGE',
    };

    const result = validateApprovalRequest(request);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid action type: invalid');
  });

  test('should reject missing request ID', () => {
    const request: ApprovalRequest = {
      actionContext: {
        actionType: 'merge',
        targetType: 'pr',
        targetIdentifier: 'owner/repo#123',
      },
      approvalContext: {
        requestId: '',
      },
      actor: 'user-123',
      signedPhrase: 'YES MERGE',
    };

    const result = validateApprovalRequest(request);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Request ID'))).toBe(true);
  });

  test('should reject missing actor', () => {
    const request: ApprovalRequest = {
      actionContext: {
        actionType: 'merge',
        targetType: 'pr',
        targetIdentifier: 'owner/repo#123',
      },
      approvalContext: {
        requestId: 'req-123',
      },
      actor: '',
      signedPhrase: 'YES MERGE',
    };

    const result = validateApprovalRequest(request);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Actor'))).toBe(true);
  });

  test('should reject wrong signed phrase', () => {
    const request: ApprovalRequest = {
      actionContext: {
        actionType: 'merge',
        targetType: 'pr',
        targetIdentifier: 'owner/repo#123',
      },
      approvalContext: {
        requestId: 'req-123',
      },
      actor: 'user-123',
      signedPhrase: 'YES PROD', // Wrong phrase for merge
    };

    const result = validateApprovalRequest(request);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid signed phrase'))).toBe(true);
  });

  test('should collect multiple errors', () => {
    const request: ApprovalRequest = {
      actionContext: {
        actionType: 'invalid' as ActionType,
        targetType: 'pr',
        targetIdentifier: 'owner/repo#123',
      },
      approvalContext: {
        requestId: '',
      },
      actor: '',
      signedPhrase: 'wrong',
    };

    const result = validateApprovalRequest(request);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
