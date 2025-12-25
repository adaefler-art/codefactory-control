/**
 * Tests for Issue [id] page routing and UUID validation
 * 
 * Tests that invalid UUIDs are rejected with notFound()
 * 
 * @jest-environment jsdom
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import IssueDetailPage from '../../../app/issues/[id]/page';

// Mock Next.js navigation
const mockNotFound = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
  notFound: () => mockNotFound(),
}));

// Mock fetch for API calls
global.fetch = jest.fn();

describe('Issue [id] Routing - UUID Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should call notFound() for invalid UUID (non-UUID string)', () => {
    // Attempt to render with invalid id "new"
    render(<IssueDetailPage params={{ id: 'new' }} />);
    
    // Should have called notFound
    expect(mockNotFound).toHaveBeenCalled();
  });

  test('should call notFound() for invalid UUID (random string)', () => {
    // Attempt to render with invalid id "invalid-id"
    render(<IssueDetailPage params={{ id: 'invalid-id' }} />);
    
    // Should have called notFound
    expect(mockNotFound).toHaveBeenCalled();
  });

  test('should call notFound() for invalid UUID (partial UUID)', () => {
    // Attempt to render with invalid id (partial UUID)
    render(<IssueDetailPage params={{ id: '123e4567' }} />);
    
    // Should have called notFound
    expect(mockNotFound).toHaveBeenCalled();
  });

  test('should NOT call notFound() for valid UUID', () => {
    const validUUID = '123e4567-e89b-12d3-a456-426614174000';
    
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
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
      }),
    });

    // Attempt to render with valid UUID
    render(<IssueDetailPage params={{ id: validUUID }} />);
    
    // Should NOT have called notFound
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  test('should handle uppercase UUIDs correctly', () => {
    const validUUID = '123E4567-E89B-12D3-A456-426614174000';
    
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
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
      }),
    });

    // Attempt to render with valid uppercase UUID
    render(<IssueDetailPage params={{ id: validUUID }} />);
    
    // Should NOT have called notFound
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});
