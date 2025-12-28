/**
 * Issue Lifecycle Invariants Tests
 * 
 * Tests server-side enforcement of lifecycle invariants:
 * - SYNCED handoff_state cannot occur with CREATED status
 * - Activation requires non-empty title
 * - Handoff requires non-empty title
 * 
 * Issue AFU9-D: Issue Lifecycle Invariants & System Truth
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as activateIssue } from '../../app/api/issues/[id]/activate/route';
import { POST as handoffIssue } from '../../app/api/issues/[id]/handoff/route';
import { PATCH as updateIssue } from '../../app/api/issues/[id]/route';
import { Afu9IssueStatus, Afu9HandoffState } from '../../src/lib/contracts/afu9Issue';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

// Mock the GitHub module
jest.mock('../../src/lib/github', () => ({
  createIssue: jest.fn(),
}));

// Mock database helpers
jest.mock('../../src/lib/db/afu9Issues', () => ({
  updateAfu9Issue: jest.fn(),
  getActiveIssue: jest.fn(),
}));

// Mock _shared module
jest.mock('../../app/api/issues/_shared', () => ({
  fetchIssueRowByIdentifier: jest.fn(),
  normalizeIssueForApi: jest.fn((row) => ({ ...row, publicId: String(row.id).substring(0, 8) })),
}));

describe('Issue Lifecycle Invariants', () => {
  const mockIssueId = '123e4567-e89b-12d3-a456-426614174000';
  const mockPublicId = '123e4567'; // First 8 chars of UUID

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Activation Invariants', () => {
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

    test('blocks activation of issue with whitespace-only title', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      
      // Mock issue with whitespace-only title
      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: {
          id: mockIssueId,
          title: '   ',
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
    });

    test('allows activation of issue with valid title', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue, getActiveIssue } = require('../../src/lib/db/afu9Issues');
      
      // Mock issue with valid title
      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: {
          id: mockIssueId,
          title: 'Valid Issue Title',
          body: 'Test body',
          status: Afu9IssueStatus.CREATED,
          handoff_state: Afu9HandoffState.NOT_SENT,
        },
      });

      getActiveIssue.mockResolvedValue({
        success: true,
        data: null, // No active issue
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: {
          id: mockIssueId,
          title: 'Valid Issue Title',
          status: Afu9IssueStatus.IMPLEMENTING,
        },
      });

      const request = new NextRequest(`http://localhost/api/issues/${mockPublicId}/activate`, {
        method: 'POST',
      });
      const response = await activateIssue(request, {
        params: Promise.resolve({ id: mockPublicId }),
      });

      expect(response.status).toBe(200);
    });
  });

  describe('Handoff Invariants', () => {
    test('blocks handoff of issue without title', async () => {
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

      const request = new NextRequest(`http://localhost/api/issues/${mockPublicId}/handoff`, {
        method: 'POST',
      });
      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: mockPublicId }),
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('title');
      expect(body.details).toContain('Handoff requires');
    });

    test('blocks handoff if CREATED status with SYNCED handoff_state', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      
      // Mock issue with invalid state combination
      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: {
          id: mockIssueId,
          title: 'Valid Title',
          body: 'Test body',
          status: Afu9IssueStatus.CREATED,
          handoff_state: Afu9HandoffState.SYNCED, // Invalid combination
        },
      });

      const request = new NextRequest(`http://localhost/api/issues/${mockPublicId}/handoff`, {
        method: 'POST',
      });
      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: mockPublicId }),
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid state combination');
      expect(body.details).toContain('invariants');
    });

    test('allows handoff of issue with valid title and state', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue } = require('../../src/lib/github');
      
      // Mock issue with valid state
      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: {
          id: mockIssueId,
          title: 'Valid Issue Title',
          body: 'Test body',
          status: Afu9IssueStatus.CREATED,
          handoff_state: Afu9HandoffState.NOT_SENT,
          labels: [],
        },
      });

      // Mock successful GitHub issue creation
      createIssue.mockResolvedValue({
        number: 123,
        html_url: 'https://github.com/test/repo/issues/123',
      });

      // Mock successful database updates
      updateAfu9Issue.mockResolvedValueOnce({
        success: true,
        data: { handoff_state: Afu9HandoffState.SENT },
      });

      updateAfu9Issue.mockResolvedValueOnce({
        success: true,
        data: {
          id: mockIssueId,
          title: 'Valid Issue Title',
          handoff_state: Afu9HandoffState.SYNCED,
          github_issue_number: 123,
          github_url: 'https://github.com/test/repo/issues/123',
        },
      });

      const request = new NextRequest(`http://localhost/api/issues/${mockPublicId}/handoff`, {
        method: 'POST',
      });
      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: mockPublicId }),
      });

      expect(response.status).toBe(200);
    });
  });

  describe('Update Invariants', () => {
    test('blocks update that would create CREATED + SYNCED combination', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      
      // Mock current issue state
      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: {
          id: mockIssueId,
          title: 'Test Issue',
          status: Afu9IssueStatus.SPEC_READY,
          handoff_state: Afu9HandoffState.SYNCED,
        },
      });

      const request = new NextRequest(`http://localhost/api/issues/${mockPublicId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: Afu9IssueStatus.CREATED, // Would create invalid combination
        }),
      });

      const response = await updateIssue(request, {
        params: Promise.resolve({ id: mockPublicId }),
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid state combination');
    });

    test('allows valid status updates', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      
      // Mock current issue state
      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: {
          id: mockIssueId,
          title: 'Test Issue',
          status: Afu9IssueStatus.CREATED,
          handoff_state: Afu9HandoffState.NOT_SENT,
        },
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: {
          id: mockIssueId,
          title: 'Test Issue',
          status: Afu9IssueStatus.SPEC_READY,
          handoff_state: Afu9HandoffState.NOT_SENT,
        },
      });

      const request = new NextRequest(`http://localhost/api/issues/${mockPublicId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: Afu9IssueStatus.SPEC_READY,
        }),
      });

      const response = await updateIssue(request, {
        params: Promise.resolve({ id: mockPublicId }),
      });

      expect(response.status).toBe(200);
    });
  });
});
