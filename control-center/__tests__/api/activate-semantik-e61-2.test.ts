/**
 * E61.2: Activate Semantik (maxActive=1) Tests
 * 
 * Tests the activate endpoint with SPEC_READY semantics:
 * - Only one issue can be SPEC_READY (active) at a time
 * - Returns 409 CONFLICT if another issue is already active
 * - Creates issue_event on successful activation
 * - No event on failed activation
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as activateIssue } from '../../app/api/issues/[id]/activate/route';
import { Afu9IssueStatus, Afu9HandoffState } from '../../src/lib/contracts/afu9Issue';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

// Mock database helpers
jest.mock('../../src/lib/db/afu9Issues', () => ({
  updateAfu9Issue: jest.fn(),
  getActiveIssue: jest.fn(),
  transitionIssue: jest.fn(),
}));

// Mock _shared module
jest.mock('../../app/api/issues/_shared', () => ({
  fetchIssueRowByIdentifier: jest.fn(),
  normalizeIssueForApi: jest.fn((row) => ({ 
    ...row, 
    publicId: String(row.id).substring(0, 8),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activatedAt: row.activated_at,
  })),
}));

describe('E61.2: Activate Semantik (maxActive=1)', () => {
  const mockIssueId = '123e4567-e89b-12d3-a456-426614174000';
  const mockPublicId = '123e4567';
  const mockOtherIssueId = '987fcdeb-a456-12d3-e89b-426614174000';
  const mockOtherPublicId = '987fcdeb';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Successful Activation', () => {
    test('activates issue successfully when no other issue is active', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { getActiveIssue, transitionIssue, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');

      // Mock issue to activate
      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: {
          id: mockIssueId,
          title: 'Test Issue',
          body: 'Test body',
          status: Afu9IssueStatus.CREATED,
          handoff_state: Afu9HandoffState.NOT_SENT,
          created_at: '2023-12-29T00:00:00Z',
          updated_at: '2023-12-29T00:00:00Z',
        },
      });

      // No active issue exists
      getActiveIssue.mockResolvedValue({
        success: true,
        data: null,
      });

      // Transition succeeds
      transitionIssue.mockResolvedValue({
        success: true,
        data: {
          id: mockIssueId,
          title: 'Test Issue',
          body: 'Test body',
          status: Afu9IssueStatus.SPEC_READY,
          handoff_state: Afu9HandoffState.NOT_SENT,
          created_at: '2023-12-29T00:00:00Z',
          updated_at: '2023-12-29T00:00:00Z',
        },
      });

      // Update activated_at and activated_by succeeds
      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: {
          id: mockIssueId,
          title: 'Test Issue',
          body: 'Test body',
          status: Afu9IssueStatus.SPEC_READY,
          handoff_state: Afu9HandoffState.NOT_SENT,
          created_at: '2023-12-29T00:00:00Z',
          updated_at: '2023-12-29T00:00:00Z',
          activated_at: '2023-12-29T00:00:00Z',
        },
      });

      const request = new NextRequest(`http://localhost/api/issues/${mockPublicId}/activate`, {
        method: 'POST',
      });
      const response = await activateIssue(request, {
        params: Promise.resolve({ id: mockPublicId }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.message).toBe('Issue activated successfully');
      expect(body.issue).toBeDefined();
      expect(body.issue.status).toBe(Afu9IssueStatus.SPEC_READY);

      // Verify transitionIssue was called with SPEC_READY
      expect(transitionIssue).toHaveBeenCalledWith(
        expect.anything(),
        mockIssueId,
        Afu9IssueStatus.SPEC_READY,
        'api-user',
        { via: 'POST /api/issues/[id]/activate' }
      );

      // Verify activated_at and activated_by were set
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        mockIssueId,
        expect.objectContaining({
          activated_at: expect.any(String),
          activated_by: 'api-user',
        })
      );
    });

    test('returns success when issue is already SPEC_READY', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');

      // Mock issue that is already SPEC_READY
      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: {
          id: mockIssueId,
          title: 'Test Issue',
          body: 'Test body',
          status: Afu9IssueStatus.SPEC_READY,
          handoff_state: Afu9HandoffState.NOT_SENT,
          created_at: '2023-12-29T00:00:00Z',
          updated_at: '2023-12-29T00:00:00Z',
          activated_at: '2023-12-29T00:00:00Z',
        },
      });

      const request = new NextRequest(`http://localhost/api/issues/${mockPublicId}/activate`, {
        method: 'POST',
      });
      const response = await activateIssue(request, {
        params: Promise.resolve({ id: mockPublicId }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.message).toBe('Issue is already active (SPEC_READY)');
    });
  });

  describe('409 CONFLICT when another issue is active', () => {
    test('returns 409 when another issue is already SPEC_READY', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { getActiveIssue } = require('../../src/lib/db/afu9Issues');

      // Mock issue to activate
      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: {
          id: mockIssueId,
          title: 'Test Issue',
          body: 'Test body',
          status: Afu9IssueStatus.CREATED,
          handoff_state: Afu9HandoffState.NOT_SENT,
          created_at: '2023-12-29T00:00:00Z',
          updated_at: '2023-12-29T00:00:00Z',
        },
      });

      // Another issue is already active
      getActiveIssue.mockResolvedValue({
        success: true,
        data: {
          id: mockOtherIssueId,
          title: 'Other Active Issue',
          body: 'Other body',
          status: Afu9IssueStatus.SPEC_READY,
          handoff_state: Afu9HandoffState.NOT_SENT,
          created_at: '2023-12-28T00:00:00Z',
          updated_at: '2023-12-28T00:00:00Z',
          activated_at: '2023-12-28T00:00:00Z',
        },
      });

      const request = new NextRequest(`http://localhost/api/issues/${mockPublicId}/activate`, {
        method: 'POST',
      });
      const response = await activateIssue(request, {
        params: Promise.resolve({ id: mockPublicId }),
      });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toBe('Another issue is already active');
      expect(body.details).toContain('987fcdeb');
      expect(body.details).toContain('Other Active Issue');
      expect(body.activeIssue).toBeDefined();
      expect(body.activeIssue.id).toBe(mockOtherIssueId);
      expect(body.activeIssue.publicId).toBe(mockOtherPublicId);
      expect(body.activeIssue.title).toBe('Other Active Issue');
    });

    test('does not call transitionIssue when another issue is active', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { getActiveIssue, transitionIssue } = require('../../src/lib/db/afu9Issues');

      // Mock issue to activate
      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: {
          id: mockIssueId,
          title: 'Test Issue',
          body: 'Test body',
          status: Afu9IssueStatus.CREATED,
          handoff_state: Afu9HandoffState.NOT_SENT,
        },
      });

      // Another issue is already active
      getActiveIssue.mockResolvedValue({
        success: true,
        data: {
          id: mockOtherIssueId,
          title: 'Other Active Issue',
          status: Afu9IssueStatus.SPEC_READY,
        },
      });

      const request = new NextRequest(`http://localhost/api/issues/${mockPublicId}/activate`, {
        method: 'POST',
      });
      await activateIssue(request, {
        params: Promise.resolve({ id: mockPublicId }),
      });

      // Verify transitionIssue was NOT called
      expect(transitionIssue).not.toHaveBeenCalled();
    });
  });

  describe('Invalid Transition Handling', () => {
    test('returns 400 when transition is invalid', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { getActiveIssue, transitionIssue } = require('../../src/lib/db/afu9Issues');

      // Mock issue to activate
      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: {
          id: mockIssueId,
          title: 'Test Issue',
          body: 'Test body',
          status: Afu9IssueStatus.DONE,
          handoff_state: Afu9HandoffState.NOT_SENT,
        },
      });

      // No active issue exists
      getActiveIssue.mockResolvedValue({
        success: true,
        data: null,
      });

      // Transition fails due to invalid transition
      transitionIssue.mockResolvedValue({
        success: false,
        error: 'Invalid transition: DONE -> SPEC_READY. This transition is not allowed by the state machine.',
      });

      const request = new NextRequest(`http://localhost/api/issues/${mockPublicId}/activate`, {
        method: 'POST',
      });
      const response = await activateIssue(request, {
        params: Promise.resolve({ id: mockPublicId }),
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid transition');
    });
  });

  describe('Title Validation', () => {
    test('blocks activation of issue without title', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');

      // Mock issue with empty title
      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: {
          id: mockIssueId,
          title: '',
          body: 'Test body',
          status: Afu9IssueStatus.CREATED,
          handoff_state: Afu9HandoffState.NOT_SENT,
        },
      });

      const request = new NextRequest(`http://localhost/api/issues/${mockPublicId}/activate`, {
        method: 'POST',
      });
      const response = await activateIssue(request, {
        params: Promise.resolve({ id: mockPublicId }),
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('title');
      expect(body.details).toContain('Activation requires');
    });
  });
});
