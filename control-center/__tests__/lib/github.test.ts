/**
 * Tests for GitHub getIssue function
 * 
 * Tests fetching individual issue details via REST API
 * 
 * @jest-environment node
 */

import { getIssue, GitHubIssueDetails } from '../../src/lib/github';

// Mock dependencies
jest.mock('../../src/lib/github/auth-wrapper');

const mockCreateAuthenticatedClient = jest.requireMock('../../src/lib/github/auth-wrapper').createAuthenticatedClient;

// Mock Octokit
const mockGetIssue = jest.fn();

const mockOctokit = {
  rest: {
    issues: {
      get: mockGetIssue,
    },
  },
};

describe('getIssue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateAuthenticatedClient.mockResolvedValue(mockOctokit);
  });

  it('should fetch issue details successfully', async () => {
    const mockIssueData = {
      state: 'open',
      labels: [
        { name: 'status:implementing' },
        { name: 'priority:P0' },
      ],
      updated_at: '2026-01-04T10:00:00Z',
    };

    mockGetIssue.mockResolvedValue({ data: mockIssueData });

    const result = await getIssue('adaefler-art', 'test-repo', 123);

    expect(result).toEqual({
      state: 'open',
      labels: [
        { name: 'status:implementing' },
        { name: 'priority:P0' },
      ],
      updated_at: '2026-01-04T10:00:00Z',
      closed_at: null,
    });

    expect(mockGetIssue).toHaveBeenCalledWith({
      owner: 'adaefler-art',
      repo: 'test-repo',
      issue_number: 123,
    });
  });

  it('should handle closed issues', async () => {
    const mockIssueData = {
      state: 'closed',
      labels: [{ name: 'status:done' }],
      updated_at: '2026-01-04T11:00:00Z',
    };

    mockGetIssue.mockResolvedValue({ data: mockIssueData });

    const result = await getIssue('adaefler-art', 'test-repo', 456);

    expect(result).toEqual({
      state: 'closed',
      labels: [{ name: 'status:done' }],
      updated_at: '2026-01-04T11:00:00Z',
      closed_at: null,
    });
  });

  it('should handle issues with no labels', async () => {
    const mockIssueData = {
      state: 'open',
      labels: null,
      updated_at: '2026-01-04T12:00:00Z',
    };

    mockGetIssue.mockResolvedValue({ data: mockIssueData });

    const result = await getIssue('adaefler-art', 'test-repo', 789);

    expect(result).toEqual({
      state: 'open',
      labels: [],
      updated_at: '2026-01-04T12:00:00Z',
      closed_at: null,
    });
  });

  it('should throw error when authentication fails', async () => {
    mockGetIssue.mockRejectedValue(new Error('Bad credentials'));

    await expect(getIssue('adaefler-art', 'test-repo', 123)).rejects.toThrow(
      'GitHub App authentication failed'
    );
  });

  it('should throw error when issue not found', async () => {
    mockGetIssue.mockRejectedValue(new Error('Not Found'));

    await expect(getIssue('adaefler-art', 'test-repo', 999)).rejects.toThrow(
      'GitHub-Issue #999 nicht gefunden in adaefler-art/test-repo'
    );
  });

  it('should throw error when rate limit exceeded', async () => {
    mockGetIssue.mockRejectedValue(new Error('rate limit exceeded'));

    await expect(getIssue('adaefler-art', 'test-repo', 123)).rejects.toThrow(
      'GitHub API-Limit erreicht'
    );
  });

  it('should throw generic error for unknown errors', async () => {
    mockGetIssue.mockRejectedValue(new Error('Unknown error occurred'));

    await expect(getIssue('adaefler-art', 'test-repo', 123)).rejects.toThrow(
      'GitHub-Fehler: Unknown error occurred'
    );
  });
});
