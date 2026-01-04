/**
 * Issue detail page rendering test
 *
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import React from 'react';

import IssueDetailPage from '../../app/issues/[id]/page';

jest.mock('next/navigation', () => ({
  // In these tests we pass `params` directly; keep useParams() empty so the component falls back to props.
  useParams: () => ({}),
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
    const retryButtons = await screen.findAllByText('Retry Handoff');
    expect(retryButtons.length).toBeGreaterThan(0);
  });

  test('displays status as read-only badge (E62.2)', async () => {
    const issue = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      publicId: '123e4567',
      title: 'Test Issue',
      body: 'Test body',
      status: 'SPEC_READY' as const,
      labels: ['bug', 'high-priority'],
      priority: 'P1' as const,
      assignee: null,
      source: 'afu9',
      handoff_state: 'NOT_SENT' as const,
      github_issue_number: null,
      github_url: null,
      last_error: null,
      created_at: '2023-12-23T00:00:00Z',
      updated_at: '2023-12-23T00:00:00Z',
      createdAt: '2023-12-23T00:00:00Z',
      updatedAt: '2023-12-23T00:00:00Z',
      execution_state: 'IDLE' as const,
      execution_started_at: null,
      execution_completed_at: null,
      execution_output: null,
      // I4: State Model v1 fields
      localStatus: 'SPEC_READY',
      githubMirrorStatus: 'UNKNOWN',
      executionState: 'IDLE',
      handoffState: 'UNSYNCED',
      effectiveStatus: 'SPEC_READY',
    };

    // @ts-expect-error - attach mock fetch
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => issue,
    }));

    render(<IssueDetailPage params={{ id: issue.id }} />);

    // Wait for the page to load
    expect(await screen.findByText('Test Issue')).toBeInTheDocument();
    
    // I4: Check that effectiveStatus is displayed prominently
    const effectiveStatusBadges = await screen.findAllByText('SPEC_READY');
    expect(effectiveStatusBadges.length).toBeGreaterThan(0);
    
    // Verify there's no status dropdown (select element with status options)
    const selects = screen.queryAllByRole('combobox');
    const statusSelect = selects.find(select => 
      select.className.includes('status') || 
      (select as HTMLSelectElement).value === 'SPEC_READY'
    );
    expect(statusSelect).toBeUndefined();
    
    // I4: Verify State Model v1 label is present
    expect(await screen.findByText(/State Model v1/i)).toBeInTheDocument();
  });
});
