/**
 * Issue detail page rendering test
 *
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import React from 'react';

import IssueDetailPage from '../../app/issues/[id]/page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
  }),
}));

describe('Issue detail page', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('renders issue title from API response', async () => {
    const issue = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Test Issue Title',
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
      created_at: '2023-12-23T00:00:00Z',
      updated_at: '2023-12-23T00:00:00Z',
    };

    // @ts-expect-error - attach mock fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => issue,
    }));

    render(<IssueDetailPage params={{ id: issue.id }} />);

    expect(await screen.findByText('Test Issue Title')).toBeInTheDocument();
  });

  test('displays retry handoff button when handoff fails', async () => {
    const failedIssue = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      publicId: '123e4567',
      title: 'Failed Handoff Issue',
      body: 'Test body',
      status: 'CREATED' as const,
      labels: [],
      priority: null,
      assignee: null,
      source: 'afu9',
      handoff_state: 'FAILED' as const,
      github_issue_number: null,
      github_url: null,
      last_error: 'GitHub API error: Rate limit exceeded',
      created_at: '2023-12-23T00:00:00Z',
      updated_at: '2023-12-23T00:00:00Z',
      createdAt: '2023-12-23T00:00:00Z',
      updatedAt: '2023-12-23T00:00:00Z',
    };

    // @ts-expect-error - attach mock fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => failedIssue,
    }));

    render(<IssueDetailPage params={{ id: failedIssue.id }} />);

    // Wait for the page to load
    expect(await screen.findByText('Failed Handoff Issue')).toBeInTheDocument();
    
    // Check that error message is displayed
    expect(await screen.findByText('GitHub API error: Rate limit exceeded')).toBeInTheDocument();
    
    // Check that retry button is present
    expect(await screen.findByText('Retry Handoff')).toBeInTheDocument();
  });
});
