/**
 * Tests for issue [id] page routing
 * 
 * Tests that invalid ids show AFU-9 error banner instead of Next.js 404
 * 
 * @jest-environment jsdom
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, waitFor, screen } from '@testing-library/react';
import IssueDetailPage from '../../../app/issues/[id]/page';

// Mock Next.js navigation
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}));

// Mock fetch for API calls
global.fetch = jest.fn();

describe('Issue [id] Routing - Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should show AFU-9 error banner for invalid UUID (non-UUID string)', async () => {
    // Mock API 404 response for invalid id "new"
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    });

    render(<IssueDetailPage params={{ id: 'new' }} />);
    
    // Should show error banner with "Issue not found"
    await waitFor(() => {
      expect(screen.getByText(/Issue not found \(new\)/i)).toBeInTheDocument();
    });
  });

  test('should show AFU-9 error banner for invalid UUID (random string)', async () => {
    // Mock API 404 response for invalid id
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    });

    render(<IssueDetailPage params={{ id: 'invalid-id' }} />);
    
    // Should show error banner
    await waitFor(() => {
      expect(screen.getByText(/Issue not found \(invalid-id\)/i)).toBeInTheDocument();
    });
  });

  test('should show AFU-9 error banner for invalid UUID (partial UUID)', async () => {
    // Mock API 400 response for malformed id
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid ID format' }),
    });

    render(<IssueDetailPage params={{ id: '123e4567' }} />);
    
    // Should show error banner
    await waitFor(() => {
      expect(screen.getByText(/Issue not found \(123e4567\)/i)).toBeInTheDocument();
    });
  });

  test('should load and display issue for valid UUID', async () => {
    const validUUID = '123e4567-e89b-12d3-a456-426614174000';
    
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: validUUID,
        publicId: validUUID.substring(0, 8),
        title: 'Test Issue',
        body: null,
        status: 'CREATED',
        labels: [],
        priority: null,
        assignee: null,
        source: 'afu9',
        handoff_state: 'NOT_SENT',
        github_issue_number: null,
        github_url: null,
        last_error: null,
        created_at: '2023-12-23T10:00:00Z',
        updated_at: '2023-12-23T12:00:00Z',
        execution_state: 'IDLE',
        execution_started_at: null,
        execution_completed_at: null,
        execution_output: null,
      }),
    });

    render(<IssueDetailPage params={{ id: validUUID }} />);
    
    // Should display issue title
    await waitFor(() => {
      expect(screen.getByText('Test Issue')).toBeInTheDocument();
    });
  });

  test('should handle uppercase UUIDs correctly', async () => {
    const validUUID = '123E4567-E89B-12D3-A456-426614174000';
    
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: validUUID,
        publicId: validUUID.substring(0, 8),
        title: 'Test Issue',
        body: null,
        status: 'CREATED',
        labels: [],
        priority: null,
        assignee: null,
        source: 'afu9',
        handoff_state: 'NOT_SENT',
        github_issue_number: null,
        github_url: null,
        last_error: null,
        created_at: '2023-12-23T10:00:00Z',
        updated_at: '2023-12-23T12:00:00Z',
        execution_state: 'IDLE',
        execution_started_at: null,
        execution_completed_at: null,
        execution_output: null,
      }),
    });

    render(<IssueDetailPage params={{ id: validUUID }} />);
    
    // Should display issue
    await waitFor(() => {
      expect(screen.getByText('Test Issue')).toBeInTheDocument();
    });
  });
});
