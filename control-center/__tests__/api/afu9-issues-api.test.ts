/**
 * AFU9 Issues API Tests
 * 
 * Tests all endpoints for the AFU9 Issues API:
 * - GET /api/issues (list)
 * - POST /api/issues (create)
 * - GET /api/issues/[id] (get)
 * - PATCH /api/issues/[id] (update)
 * - POST /api/issues/[id]/activate
 * - POST /api/issues/[id]/handoff
 * - GET /api/issues/[id]/events
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as listIssues, POST as createIssue } from '../../app/api/issues/route';
import { GET as getIssue, PATCH as updateIssue } from '../../app/api/issues/[id]/route';
import { POST as activateIssue } from '../../app/api/issues/[id]/activate/route';
import { POST as handoffIssue } from '../../app/api/issues/[id]/handoff/route';
import { GET as getIssueEventsApi } from '../../app/api/issues/[id]/events/route';
import { Afu9IssueStatus, Afu9HandoffState, Afu9IssuePriority } from '../../src/lib/contracts/afu9Issue';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

// Mock the GitHub module
jest.mock('../../src/lib/github', () => ({
  createIssue: jest.fn(),
  updateIssue: jest.fn(),
}));

// Mock database helpers
jest.mock('../../src/lib/db/afu9Issues', () => ({
  listAfu9Issues: jest.fn(),
  createAfu9Issue: jest.fn(),
  getAfu9IssueById: jest.fn(),
  getAfu9IssueByPublicId: jest.fn(),
  updateAfu9Issue: jest.fn(),
  getActiveIssue: jest.fn(),
  getIssueEvents: jest.fn(),
}));

// Mock _shared module for handoff route
jest.mock('../../app/api/issues/_shared', () => ({
  fetchIssueRowByIdentifier: jest.fn(),
  normalizeIssueForApi: jest.fn((issue) => issue),
}));

describe('AFU9 Issues API', () => {
  const mockIssue = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Test Issue',
    body: 'Test body',
    status: Afu9IssueStatus.CREATED,
    labels: ['bug', 'priority-p1'],
    priority: Afu9IssuePriority.P1,
    assignee: 'test-user',
    source: 'afu9',
    handoff_state: Afu9HandoffState.NOT_SENT,
    github_issue_number: null,
    github_url: null,
    last_error: null,
    created_at: '2023-12-23T00:00:00Z',
    updated_at: '2023-12-23T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/issues (list)', () => {
    test('returns list of issues', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({
        success: true,
        data: [mockIssue],
      });

      const request = new NextRequest('http://localhost/api/issues');
      const response = await listIssues(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.issues).toBeDefined();
      expect(Array.isArray(body.issues)).toBe(true);
      expect(body.issues.length).toBe(1);
      expect(body.total).toBe(1);

      // Normalized fields used by the UI.
      expect(body.issues[0].publicId).toBe('123e4567');
      expect(Number.isNaN(Date.parse(body.issues[0].createdAt))).toBe(false);
      expect(Number.isNaN(Date.parse(body.issues[0].updatedAt))).toBe(false);
    });

    test('filters by status', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({
        success: true,
        data: [mockIssue],
      });

      const request = new NextRequest('http://localhost/api/issues?status=CREATED');
      const response = await listIssues(request);

      expect(response.status).toBe(200);
      expect(listAfu9Issues).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: Afu9IssueStatus.CREATED })
      );
    });

    test('returns 400 for invalid status', async () => {
      const request = new NextRequest('http://localhost/api/issues?status=INVALID');
      const response = await listIssues(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid status');
    });

    test('filters by label', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({
        success: true,
        data: [mockIssue],
      });

      const request = new NextRequest('http://localhost/api/issues?label=bug');
      const response = await listIssues(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.issues.every((i: any) => i.labels.includes('bug'))).toBe(true);
    });

    test('searches by query', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({
        success: true,
        data: [mockIssue],
      });

      const request = new NextRequest('http://localhost/api/issues?q=Test');
      const response = await listIssues(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.issues.length).toBeGreaterThan(0);
    });

    test('handles database errors', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({
        success: false,
        error: 'Database error',
      });

      const request = new NextRequest('http://localhost/api/issues');
      const response = await listIssues(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBeDefined();
    });
  });

  describe('POST /api/issues (create)', () => {
    test('creates a new issue', async () => {
      const { createAfu9Issue } = require('../../src/lib/db/afu9Issues');
      createAfu9Issue.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      const request = new NextRequest('http://localhost/api/issues', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Test Issue',
          body: 'Test body',
          labels: ['bug'],
          priority: 'P1',
        }),
      });

      const response = await createIssue(request);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.id).toBe(mockIssue.id);
      expect(body.title).toBe('Test Issue');
    });

    test('returns 400 for missing title', async () => {
      const request = new NextRequest('http://localhost/api/issues', {
        method: 'POST',
        body: JSON.stringify({
          body: 'Test body',
        }),
      });

      const response = await createIssue(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid input');
      expect(body.details).toBeDefined();
    });

    test('returns 409 for Single-Active constraint violation', async () => {
      const { createAfu9Issue } = require('../../src/lib/db/afu9Issues');
      createAfu9Issue.mockResolvedValue({
        success: false,
        error: 'Single-Active constraint: Issue abc is already IMPLEMENTING',
      });

      const request = new NextRequest('http://localhost/api/issues', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Test Issue',
          status: 'IMPLEMENTING',
        }),
      });

      const response = await createIssue(request);
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toContain('Single-Active');
    });
  });

  describe('GET /api/issues/[id] (get)', () => {
    test('returns issue by ID', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000');
      const response = await getIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.id).toBe(mockIssue.id);
    });

    test('returns issue by publicId (8-hex)', async () => {
      const { getAfu9IssueByPublicId } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueByPublicId.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567');
      const response = await getIssue(request, { params: Promise.resolve({ id: '123e4567' }) });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.id).toBe(mockIssue.id);
      expect(body.publicId).toBe('123e4567');
    });

    test('returns 400 for invalid UUID format', async () => {
      const request = new NextRequest('http://localhost/api/issues/invalid-id');
      const response = await getIssue(request, { params: Promise.resolve({ id: 'invalid-id' }) });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid issue ID format');
    });

    test('returns 404 for non-existent issue', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: false,
        error: 'Issue not found',
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000');
      const response = await getIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toContain('not found');
    });
  });

  describe('PATCH /api/issues/[id] (update)', () => {
    test('updates issue fields', async () => {
      const { getAfu9IssueById, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: mockIssue,
      });
      const updatedIssue = { ...mockIssue, title: 'Updated Title' };
      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: updatedIssue,
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000', {
        method: 'PATCH',
        body: JSON.stringify({
          title: 'Updated Title',
        }),
      });

      const response = await updateIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.title).toBe('Updated Title');
    });

    test('returns 400 for invalid status', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: mockIssue,
      });
      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'INVALID_STATUS',
        }),
      });

      const response = await updateIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid status');
    });

    test('returns 400 for no fields to update', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: mockIssue,
      });
      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000', {
        method: 'PATCH',
        body: JSON.stringify({}),
      });

      const response = await updateIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('No fields to update');
    });

    test('returns 409 for Single-Active constraint violation', async () => {
      const { getAfu9IssueById, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: mockIssue,
      });
      updateAfu9Issue.mockResolvedValue({
        success: false,
        error: 'Single-Active constraint: Issue abc is already IMPLEMENTING',
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'IMPLEMENTING',
        }),
      });

      const response = await updateIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toContain('Single-Active');
    });

    test('accepts new status values SPEC_READY, IMPLEMENTING, and FAILED', async () => {
      const { getAfu9IssueById, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      // Test SPEC_READY
      const specReadyIssue = { ...mockIssue, status: Afu9IssueStatus.SPEC_READY };
      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: specReadyIssue,
      });

      let request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'SPEC_READY',
        }),
      });

      let response = await updateIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      let body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe('SPEC_READY');

      // Test IMPLEMENTING
      const implementingIssue = { ...mockIssue, status: 'IMPLEMENTING' as any };
      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: implementingIssue,
      });

      request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'IMPLEMENTING',
        }),
      });

      response = await updateIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe('IMPLEMENTING');

      // Test FAILED
      const failedIssue = { ...mockIssue, status: 'FAILED' as any };
      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: failedIssue,
      });

      request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'FAILED',
        }),
      });

      response = await updateIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe('FAILED');
    });

    test('updates issue priority', async () => {
      const { getAfu9IssueById, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      // Test updating from P1 to P0
      const updatedIssue = { ...mockIssue, priority: Afu9IssuePriority.P0 };
      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: updatedIssue,
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000', {
        method: 'PATCH',
        body: JSON.stringify({
          priority: 'P0',
        }),
      });

      const response = await updateIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.priority).toBe('P0');
    });

    test('allows setting priority to null', async () => {
      const { getAfu9IssueById, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      const updatedIssue = { ...mockIssue, priority: null };
      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: updatedIssue,
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000', {
        method: 'PATCH',
        body: JSON.stringify({
          priority: null,
        }),
      });

      const response = await updateIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.priority).toBe(null);
    });

    test('returns 400 for invalid priority', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000', {
        method: 'PATCH',
        body: JSON.stringify({
          priority: 'INVALID_PRIORITY',
        }),
      });

      const response = await updateIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid priority');
    });
  });

  describe('POST /api/issues/[id]/activate', () => {
    test('activates an issue with IMPLEMENTING status', async () => {
      const { getAfu9IssueById, getActiveIssue, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      getActiveIssue.mockResolvedValue({
        success: true,
        data: null,
      });

      const activatedIssue = { ...mockIssue, status: Afu9IssueStatus.IMPLEMENTING, activated_at: '2023-12-23T12:00:00Z' };
      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: activatedIssue,
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000/activate', {
        method: 'POST',
      });

      const response = await activateIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.message).toContain('activated successfully');
      expect(body.issue.status).toBe(Afu9IssueStatus.IMPLEMENTING);
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        '123e4567-e89b-12d3-a456-426614174000',
        expect.objectContaining({
          status: Afu9IssueStatus.IMPLEMENTING,
          activated_at: expect.any(String),
        })
      );
    });

    test('deactivates current implementing issue to DONE before activating new one', async () => {
      const { getAfu9IssueById, getActiveIssue, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      
      const currentActiveIssue = {
        ...mockIssue,
        id: 'current-active-id',
        status: Afu9IssueStatus.IMPLEMENTING,
      };

      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      getActiveIssue.mockResolvedValue({
        success: true,
        data: currentActiveIssue,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000/activate', {
        method: 'POST',
      });

      const response = await activateIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(updateAfu9Issue).toHaveBeenCalledTimes(2); // Once to deactivate, once to activate
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        'current-active-id',
        expect.objectContaining({
          status: Afu9IssueStatus.DONE,
        })
      );
      expect(body.deactivated).toBeDefined();
      expect(body.deactivated.id).toBe('current-active-id');
    });

    test('returns success if already implementing', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      
      const implementingIssue = { ...mockIssue, status: Afu9IssueStatus.IMPLEMENTING };
      getAfu9IssueById.mockResolvedValue({
        success: true,
        data: implementingIssue,
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000/activate', {
        method: 'POST',
      });

      const response = await activateIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.message).toContain('already IMPLEMENTING');
    });
  });

  describe('POST /api/issues/[id]/handoff', () => {
    test('hands off issue to GitHub', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue: createGithubIssue } = require('../../src/lib/github');

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: mockIssue,
      });

      createGithubIssue.mockResolvedValue({
        html_url: 'https://github.com/owner/repo/issues/123',
        number: 123,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: {
          ...mockIssue,
          handoff_state: Afu9HandoffState.SYNCED,
          github_issue_number: 123,
          github_url: 'https://github.com/owner/repo/issues/123',
        },
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000/handoff', {
        method: 'POST',
      });

      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.message).toContain('handed off to GitHub successfully');
      expect(body.github_url).toBe('https://github.com/owner/repo/issues/123');
      expect(body.github_issue_number).toBe(123);
    });

    test('returns success if already handed off', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { updateIssue } = require('../../src/lib/github');

      const syncedIssue = {
        ...mockIssue,
        status: Afu9IssueStatus.SPEC_READY, // Changed from CREATED to avoid lifecycle invariant violation
        handoff_state: Afu9HandoffState.SYNCED,
        github_issue_number: 123,
        github_url: 'https://github.com/owner/repo/issues/123',
        github_repo: 'owner/repo',
      };

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: syncedIssue,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: { ...syncedIssue, handoff_state: Afu9HandoffState.SYNCHRONIZED },
      });

      updateIssue.mockResolvedValue({
        number: 123,
        html_url: 'https://github.com/owner/repo/issues/123',
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000/handoff', {
        method: 'POST',
      });

      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      // E61.3: SYNCED issues with github_issue_number can be re-synced via UPDATE
      expect(body.message).toContain('synchronized with GitHub successfully');
      expect(body.handoff_state).toBe(Afu9HandoffState.SYNCHRONIZED);
    });

    test('handles GitHub API errors', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue: createGithubIssue } = require('../../src/lib/github');

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: mockIssue,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      createGithubIssue.mockRejectedValue(new Error('GitHub API rate limit exceeded'));

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000/handoff', {
        method: 'POST',
      });

      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toContain('Failed to create GitHub issue');
      expect(body.handoff_state).toBe(Afu9HandoffState.FAILED);
    });

    test('includes idempotency marker in GitHub issue body', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue: createGithubIssue } = require('../../src/lib/github');

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: mockIssue,
      });

      createGithubIssue.mockResolvedValue({
        html_url: 'https://github.com/owner/repo/issues/123',
        number: 123,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000/handoff', {
        method: 'POST',
      });

      await handoffIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });

      expect(createGithubIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('AFU9-ISSUE:123e4567-e89b-12d3-a456-426614174000'),
        })
      );
    });

    test('includes priority as GitHub label when priority is set', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue: createGithubIssue } = require('../../src/lib/github');

      const issueWithPriority = {
        ...mockIssue,
        priority: Afu9IssuePriority.P0,
        labels: ['bug', 'feature'],
      };

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: issueWithPriority,
      });

      createGithubIssue.mockResolvedValue({
        html_url: 'https://github.com/owner/repo/issues/123',
        number: 123,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: issueWithPriority,
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000/handoff', {
        method: 'POST',
      });

      await handoffIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });

      expect(createGithubIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: expect.arrayContaining(['bug', 'feature', 'priority:P0']),
        })
      );
    });

    test('does not include priority label when priority is null', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue: createGithubIssue } = require('../../src/lib/github');

      const issueWithoutPriority = {
        ...mockIssue,
        priority: null,
        labels: ['bug'],
      };

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: issueWithoutPriority,
      });

      createGithubIssue.mockResolvedValue({
        html_url: 'https://github.com/owner/repo/issues/123',
        number: 123,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: issueWithoutPriority,
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000/handoff', {
        method: 'POST',
      });

      await handoffIssue(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });

      expect(createGithubIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: ['bug'], // No priority label
        })
      );
    });
  });

  describe('GET /api/issues/[id]/events', () => {
    const mockEvents = [
      {
        id: 'event-1',
        issue_id: '123e4567-e89b-12d3-a456-426614174000',
        event_type: 'CREATED',
        event_data: { title: 'Test Issue', priority: 'P1' },
        old_status: null,
        new_status: 'CREATED',
        old_handoff_state: null,
        new_handoff_state: 'NOT_SENT',
        created_at: '2023-12-23T00:00:00Z',
        created_by: null,
      },
      {
        id: 'event-2',
        issue_id: '123e4567-e89b-12d3-a456-426614174000',
        event_type: 'STATUS_CHANGED',
        event_data: {},
        old_status: 'CREATED',
        new_status: 'ACTIVE',
        old_handoff_state: null,
        new_handoff_state: null,
        created_at: '2023-12-23T01:00:00Z',
        created_by: null,
      },
    ];

    test('returns activity events for an issue', async () => {
      const { getIssueEvents: getIssueEventsDb } = require('../../src/lib/db/afu9Issues');
      getIssueEventsDb.mockResolvedValue({
        success: true,
        data: mockEvents,
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000/events');
      const response = await getIssueEventsApi(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.events).toBeDefined();
      expect(Array.isArray(body.events)).toBe(true);
      expect(body.events.length).toBe(2);
      expect(body.total).toBe(2);
      expect(body.limit).toBe(100);
      expect(getIssueEventsDb).toHaveBeenCalledWith(
        expect.anything(),
        '123e4567-e89b-12d3-a456-426614174000',
        100
      );
    });

    test('respects limit parameter', async () => {
      const { getIssueEvents: getIssueEventsDb } = require('../../src/lib/db/afu9Issues');
      getIssueEventsDb.mockResolvedValue({
        success: true,
        data: [mockEvents[0]],
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000/events?limit=1');
      const response = await getIssueEventsApi(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.limit).toBe(1);
      expect(getIssueEventsDb).toHaveBeenCalledWith(
        expect.anything(),
        '123e4567-e89b-12d3-a456-426614174000',
        1
      );
    });

    test('rejects invalid issue ID', async () => {
      const request = new NextRequest('http://localhost/api/issues/invalid-id/events');
      const response = await getIssueEventsApi(request, {
        params: Promise.resolve({ id: 'invalid-id' }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('Invalid issue ID');
    });

    test('handles database errors gracefully', async () => {
      const { getIssueEvents: getIssueEventsDb } = require('../../src/lib/db/afu9Issues');
      getIssueEventsDb.mockResolvedValue({
        success: false,
        error: 'Database connection failed',
      });

      const request = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000/events');
      const response = await getIssueEventsApi(request, {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });
  });
});
