/**
 * @jest-environment node
 */

jest.mock('octokit', () => ({
  Octokit: jest.fn(),
}));

describe('fetchGitHubFile status codes', () => {
  it('returns statusCode 500 for GitHub App config errors', async () => {
    const res = await new Promise<any>((resolve, reject) => {
      jest.isolateModules(() => {
        jest.doMock('../../src/lib/github-app-auth', () => {
          const actual = jest.requireActual('../../src/lib/github-app-auth');
          return {
            ...actual,
            getGitHubInstallationToken: jest.fn(async () => {
              throw new actual.GitHubAppConfigError('Missing GITHUB_APP_PRIVATE_KEY_PEM');
            }),
          };
        });

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { fetchGitHubFile } = require('../../src/lib/github/fetch-file');
        fetchGitHubFile({ owner: 'o', repo: 'r', path: 'docs/roadmap.md', ref: 'main' }).then(resolve, reject);
      });
    });

    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(500);
    expect(res.error).toContain('Missing');
  });

  it('returns statusCode 404 when GitHub reports not found', async () => {
    const res = await new Promise<any>((resolve, reject) => {
      jest.isolateModules(() => {
        jest.doMock('../../src/lib/github-app-auth', () => {
          const actual = jest.requireActual('../../src/lib/github-app-auth');
          return {
            ...actual,
            getGitHubInstallationToken: jest.fn(async () => ({ token: 'tok' })),
          };
        });

        const { Octokit } = require('octokit');
        (Octokit as jest.Mock).mockImplementation(() => ({
          rest: {
            repos: {
              getContent: jest.fn().mockRejectedValue({ status: 404 }),
            },
          },
        }));

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { fetchGitHubFile } = require('../../src/lib/github/fetch-file');
        fetchGitHubFile({ owner: 'o', repo: 'r', path: 'missing.md', ref: 'main' }).then(resolve, reject);
      });
    });

    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(404);
  });
});
