/**
 * Tests for Issues UI Page
 * 
 * Tests the AFU9 Issues list view component
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import IssuesPage from '../../../app/issues/page';

// Mock Next.js router and navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
});

// Mock fetch for API calls
global.fetch = jest.fn();

describe('Issues List UI Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render loading state initially', () => {
    (global.fetch as jest.Mock).mockImplementation(() =>
      new Promise(() => {}) // Never resolves
    );

    render(<IssuesPage />);
    
    expect(screen.getByText('Loading issues...')).toBeInTheDocument();
  });

  test('should display issues when loaded', async () => {
    const mockIssues = {
      issues: [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Test Issue 1',
          body: 'Test body',
          status: 'ACTIVE',
          labels: ['bug', 'priority-p0'],
          priority: 'P0',
          assignee: 'john.doe',
          source: 'afu9',
          handoff_state: 'NOT_SENT',
          github_issue_number: null,
          github_url: null,
          last_error: null,
          created_at: '2023-12-23T10:00:00Z',
          updated_at: '2023-12-23T12:00:00Z',
        },
      ],
      total: 1,
      filtered: 1,
      limit: 100,
      offset: 0,
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockIssues,
    });

    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText('Test Issue 1')).toBeInTheDocument();
    });

    // Issues list shows canonical status (legacy statuses are mapped)
    expect(screen.getAllByText('SPEC_READY').length).toBeGreaterThan(0);
    expect(screen.getByTitle('Legacy status: ACTIVE → SPEC_READY')).toBeInTheDocument();
    expect(screen.getAllByText('bug').length).toBeGreaterThan(0);
    expect(screen.getAllByText('priority-p0').length).toBeGreaterThan(0);
  });

  test('should display "No issues found" when no issues exist', async () => {
    const mockResponse = {
      issues: [],
      total: 0,
      filtered: 0,
      limit: 100,
      offset: 0,
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText('No issues found')).toBeInTheDocument();
    });
  });

  test('should display error message when API fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
    });

    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText(/Error:\s*HTTP\s*500/i)).toBeInTheDocument();
    });
  });

  test('should render filter controls', async () => {
    const mockResponse = {
      issues: [],
      total: 0,
      filtered: 0,
      limit: 100,
      offset: 0,
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText('No issues found')).toBeInTheDocument();
    });

    // Check filter controls by text
    expect(screen.getByText('Status', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText('Label', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText('Search', { selector: 'label' })).toBeInTheDocument();
  });

  test('should render "New Issue" button', async () => {
    const mockResponse = {
      issues: [],
      total: 0,
      filtered: 0,
      limit: 100,
      offset: 0,
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText('New Issue')).toBeInTheDocument();
    });
  });

  test('should render issues with failed handoff state', async () => {
    const mockIssues = {
      issues: [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Failed Handoff Issue',
          body: 'Test body',
          status: 'ACTIVE',
          labels: [],
          priority: null,
          assignee: null,
          source: 'afu9',
          handoff_state: 'FAILED',
          github_issue_number: null,
          github_url: null,
          last_error: 'GitHub API error',
          created_at: '2023-12-23T10:00:00Z',
          updated_at: '2023-12-23T12:00:00Z',
        },
      ],
      total: 1,
      filtered: 1,
      limit: 100,
      offset: 0,
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockIssues,
    });

    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed Handoff Issue')).toBeInTheDocument();
    });

    // List view shows canonical status + legacy marker; it does not render handoff_state badges.
    expect(screen.getAllByText('SPEC_READY').length).toBeGreaterThan(0);
    expect(screen.getByTitle('Legacy status: ACTIVE → SPEC_READY')).toBeInTheDocument();
    expect(screen.getByText('No labels')).toBeInTheDocument();
  });

  test('should display table headers correctly', async () => {
    const mockResponse = {
      issues: [],
      total: 0,
      filtered: 0,
      limit: 100,
      offset: 0,
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText('No issues found')).toBeInTheDocument();
    });

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading issues...')).not.toBeInTheDocument();
    });
  });
});
