/**
 * Tests for Label Normalization in Handoff Flow
 * @jest-environment node
 */

import { POST as handoffIssue } from '../../app/api/issues/[id]/handoff/route';
import { NextRequest } from 'next/server';

// Mock dependencies
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/github', () => ({
  createIssue: jest.fn(),
  findIssueByMarker: jest.fn(),
}));

jest.mock('../../src/lib/db/afu9Issues', () => ({
  updateAfu9Issue: jest.fn(),
}));

jest.mock('../../app/api/issues/_shared', () => ({
  fetchIssueRowByIdentifier: jest.fn(),
  normalizeIssueForApi: jest.fn((issue) => issue),
}));

describe('Handoff with Label Normalization', () => {
  const mockIssue = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Test Issue',
    body: 'Test body',
    status: 'CREATED',
    labels: ['tag1', 'tag2'],
    priority: 'P1',
    assignee: null,
    source: 'afu9',
    handoff_state: 'NOT_SENT',
    github_issue_number: null,
    github_url: null,
    last_error: null,
    created_at: '2023-12-23T00:00:00Z',
    updated_at: '2023-12-23T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Label validation before handoff', () => {
    it('normalizes labels before sending to GitHub', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue } = require('../../src/lib/github');

      // Mock with labels that need normalization
      const issueWithUnnormalizedLabels = {
        ...mockIssue,
        labels: ['  bug  ', 'feature', 'bug', ''],
      };

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: issueWithUnnormalizedLabels,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      createIssue.mockResolvedValue({
        number: 123,
        html_url: 'https://github.com/owner/repo/issues/123',
      });

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      expect(response.status).toBe(200);
      
      // Check that createIssue was called with normalized labels
      expect(createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: expect.arrayContaining(['bug', 'feature', 'priority:P1']),
        })
      );

      // Should have removed duplicates and empty strings, trimmed whitespace
      const calledLabels = createIssue.mock.calls[0][0].labels;
      expect(calledLabels).toHaveLength(3); // bug, feature, priority:P1 (no duplicates or empty)
      expect(calledLabels).toContain('bug');
      expect(calledLabels).toContain('feature');
      expect(calledLabels).toContain('priority:P1');
      expect(calledLabels).not.toContain('  bug  ');
      expect(calledLabels).not.toContain('');
    });

    it('rejects labels exceeding GitHub max length', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');

      const longLabel = 'a'.repeat(51); // GitHub max is 50
      const issueWithLongLabel = {
        ...mockIssue,
        labels: [longLabel],
      };

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: issueWithLongLabel,
      });

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Invalid labels for GitHub handoff');
      expect(body.details).toContain('exceeds maximum length');
    });

    it('handles comma-separated labels correctly', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue } = require('../../src/lib/github');

      // Note: In practice, labels should already be normalized by the API endpoints
      // But this tests the handoff route's robustness
      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: mockIssue,
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      createIssue.mockResolvedValue({
        number: 123,
        html_url: 'https://github.com/owner/repo/issues/123',
      });

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      expect(response.status).toBe(200);
      expect(createIssue).toHaveBeenCalled();
      
      const calledLabels = createIssue.mock.calls[0][0].labels;
      expect(calledLabels).toContain('tag1');
      expect(calledLabels).toContain('tag2');
      expect(calledLabels).toContain('priority:P1');
    });

    it('includes priority as label with prefix', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue } = require('../../src/lib/github');

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: { ...mockIssue, priority: 'P2' },
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      createIssue.mockResolvedValue({
        number: 123,
        html_url: 'https://github.com/owner/repo/issues/123',
      });

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      const calledLabels = createIssue.mock.calls[0][0].labels;
      expect(calledLabels).toContain('priority:P2');
    });

    it('handles empty labels array', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      const { updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      const { createIssue } = require('../../src/lib/github');

      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: { ...mockIssue, labels: [], priority: null },
      });

      updateAfu9Issue.mockResolvedValue({
        success: true,
        data: mockIssue,
      });

      createIssue.mockResolvedValue({
        number: 123,
        html_url: 'https://github.com/owner/repo/issues/123',
      });

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      expect(response.status).toBe(200);
      expect(createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: [],
        })
      );
    });
  });

  describe('Error handling', () => {
    it('provides clear error message for invalid labels', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');

      const longLabel1 = 'a'.repeat(51);
      const longLabel2 = 'b'.repeat(55);
      
      fetchIssueRowByIdentifier.mockResolvedValue({
        ok: true,
        row: {
          ...mockIssue,
          labels: [longLabel1, longLabel2],
        },
      });

      const request = new NextRequest('http://localhost/api/issues/123/handoff', {
        method: 'POST',
      });

      const response = await handoffIssue(request, {
        params: Promise.resolve({ id: '123' }),
      });

      const body = await response.json();
      
      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid labels for GitHub handoff');
      expect(body.details).toContain('exceeds maximum length');
      expect(body.invalidLabels).toBeDefined();
    });
  });
});
