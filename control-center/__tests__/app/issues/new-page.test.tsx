/**
 * Tests for New Issue Page
 * 
 * Tests the /issues/new route functionality
 * 
 * @jest-environment jsdom
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import NewIssuePage from '../../../app/issues/new/page';

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
}));

jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
});

// Mock fetch for API calls
global.fetch = jest.fn();

describe('New Issue Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render loading state initially', () => {
    (global.fetch as jest.Mock).mockImplementation(() =>
      new Promise(() => {}) // Never resolves
    );

    render(<NewIssuePage />);
    
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  test('should fetch draft issue from /api/issues/new', async () => {
    const mockDraftIssue = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      publicId: '123e4567',
      title: '',
      body: '',
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
      updated_at: '2023-12-23T10:00:00Z',
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockDraftIssue,
    });

    render(<NewIssuePage />);

    await waitFor(() => {
      expect(screen.getByText('Create New Issue')).toBeInTheDocument();
    });

    // Verify fetch was called with correct endpoint
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/issues/new',
      expect.objectContaining({
        credentials: 'include',
      })
    );
  });

  test('should display error when draft fetch fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
    });

    render(<NewIssuePage />);

    await waitFor(() => {
      expect(screen.getByText(/Error:/)).toBeInTheDocument();
    });
  });

  test('should render form elements when draft is loaded', async () => {
    const mockDraftIssue = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      publicId: '123e4567',
      title: '',
      body: '',
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
      updated_at: '2023-12-23T10:00:00Z',
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockDraftIssue,
    });

    render(<NewIssuePage />);

    await waitFor(() => {
      expect(screen.getByText('Create New Issue')).toBeInTheDocument();
    });

    // Check form elements
    expect(screen.getByPlaceholderText('Enter issue title...')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter issue description (Markdown supported)...')).toBeInTheDocument();
    expect(screen.getByText('Create Issue')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  test('should have a link back to issues list', async () => {
    const mockDraftIssue = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      publicId: '123e4567',
      title: '',
      body: '',
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
      updated_at: '2023-12-23T10:00:00Z',
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockDraftIssue,
    });

    render(<NewIssuePage />);

    await waitFor(() => {
      expect(screen.getByText('Create New Issue')).toBeInTheDocument();
    });

    // Check for back link
    const backLinks = screen.getAllByText('← Back to Issues');
    expect(backLinks.length).toBeGreaterThan(0);
  });
});
