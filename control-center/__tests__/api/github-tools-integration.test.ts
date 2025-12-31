/**
 * Integration tests for GitHub Evidence Tools API Routes
 * 
 * Tests the unified tool response envelope across all three routes:
 * - search-code
 * - list-tree
 * - read-file
 * 
 * Each route is tested for:
 * 1. Success response
 * 2. Policy denial (REPO_NOT_ALLOWED)
 * 3. Validation error (INVALID_PARAMS)
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

// ========================================
// Search Code Route Tests
// ========================================

describe('Search Code Route Integration', () => {
  const mockSearchCode = jest.fn();

  beforeAll(() => {
    jest.mock('../../../src/lib/github/search-code', () => ({
      searchCode: mockSearchCode,
      QueryInvalidError: class extends Error {
        code = 'QUERY_INVALID';
        details: any;
        constructor(msg: string, details: any) {
          super(msg);
          this.details = details;
        }
      },
      RateLimitError: class extends Error {
        code = 'RATE_LIMIT_EXCEEDED';
        details: any;
        constructor(msg: string, details: any) {
          super(msg);
          this.details = details;
        }
      },
      GitHubAPIError: class extends Error {
        code = 'GITHUB_API_ERROR';
        details: any;
        constructor(msg: string, details: any) {
          super(msg);
          this.details = details;
        }
      },
      RepoAccessDeniedError: class extends Error {
        code = 'REPO_NOT_ALLOWED';
        details: any;
        constructor(details: any) {
          super(`Access denied to ${details.owner}/${details.repo}`);
          this.details = details;
        }
      },
    }));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getRoute = () => {
    return require('../../../app/api/integrations/github/search-code/route').GET;
  };

  it('should return success response with unified envelope', async () => {
    const mockResult = {
      items: [{ path: 'test.ts', sha: 'abc', repository: { owner: 'test', repo: 'repo' }, url: null, score: 1, match: { preview: 'test', previewSha256: 'hash', previewHash: 'hash' } }],
      pageInfo: { nextCursor: null },
      meta: { owner: 'test', repo: 'repo', branch: 'main', query: 'test', limit: 20, generatedAt: new Date().toISOString(), ordering: 'path_asc' as const },
    };

    mockSearchCode.mockResolvedValue(mockResult);

    const GET = getRoute();
    const request = new NextRequest(
      new URL('http://localhost/api/integrations/github/search-code?owner=test&repo=repo&query=test')
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('data');
    expect(data.data).toEqual(mockResult);
  });

  it('should return policy denial with unified error envelope', async () => {
    const RepoAccessDeniedError = require('../../../src/lib/github/search-code').RepoAccessDeniedError;
    mockSearchCode.mockRejectedValue(new RepoAccessDeniedError({ owner: 'test', repo: 'forbidden' }));

    const GET = getRoute();
    const request = new NextRequest(
      new URL('http://localhost/api/integrations/github/search-code?owner=test&repo=forbidden&query=test')
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toHaveProperty('success', false);
    expect(data).toHaveProperty('error');
    expect(data.error.code).toBe('REPO_NOT_ALLOWED');
    expect(data.error.message).toContain('Access denied');
  });

  it('should return validation error with unified error envelope', async () => {
    const GET = getRoute();
    const request = new NextRequest(
      new URL('http://localhost/api/integrations/github/search-code?owner=test&repo=repo')
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('success', false);
    expect(data).toHaveProperty('error');
    expect(data.error.code).toBe('INVALID_PARAMS');
    expect(data.error.message).toBe('Invalid query parameters');
    expect(data.error.details).toHaveProperty('errors');
  });
});

// ========================================
// List Tree Route Tests
// ========================================

describe('List Tree Route Integration', () => {
  const mockListTree = jest.fn();

  beforeAll(() => {
    jest.mock('../../../src/lib/github/list-tree', () => ({
      listTree: mockListTree,
      InvalidPathError: class extends Error {
        code = 'INVALID_PATH';
        details: any;
        constructor(path: string, reason: string, details: any) {
          super(`Invalid path '${path}': ${reason}`);
          this.details = details;
        }
      },
      TreeTooLargeError: class extends Error {
        code = 'TREE_TOO_LARGE';
        details: any;
        constructor(msg: string, details: any) {
          super(msg);
          this.details = details;
        }
      },
      GitHubAPIError: class extends Error {
        code = 'GITHUB_API_ERROR';
        details: any;
        constructor(msg: string, details: any) {
          super(msg);
          this.details = details;
        }
      },
      RepoAccessDeniedError: class extends Error {
        code = 'REPO_NOT_ALLOWED';
        details: any;
        constructor(details: any) {
          super(`Access denied to ${details.owner}/${details.repo}`);
          this.details = details;
        }
      },
    }));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getRoute = () => {
    return require('../../../app/api/integrations/github/list-tree/route').GET;
  };

  it('should return success response with unified envelope', async () => {
    const mockResult = {
      items: [{ type: 'file' as const, path: 'test.ts', name: 'test.ts', sha: 'abc', size: 100 }],
      pageInfo: { nextCursor: null, totalEstimate: 1 },
      meta: { owner: 'test', repo: 'repo', branch: 'main', path: '', recursive: false, generatedAt: new Date().toISOString(), toolVersion: '1.0.0', contractVersion: 'E71.2', ordering: 'path_asc' as const },
    };

    mockListTree.mockResolvedValue(mockResult);

    const GET = getRoute();
    const request = new NextRequest(
      new URL('http://localhost/api/integrations/github/list-tree?owner=test&repo=repo')
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('data');
    expect(data.data).toEqual(mockResult);
  });

  it('should return policy denial with unified error envelope', async () => {
    const RepoAccessDeniedError = require('../../../src/lib/github/list-tree').RepoAccessDeniedError;
    mockListTree.mockRejectedValue(new RepoAccessDeniedError({ owner: 'test', repo: 'forbidden' }));

    const GET = getRoute();
    const request = new NextRequest(
      new URL('http://localhost/api/integrations/github/list-tree?owner=test&repo=forbidden')
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toHaveProperty('success', false);
    expect(data).toHaveProperty('error');
    expect(data.error.code).toBe('REPO_NOT_ALLOWED');
    expect(data.error.message).toContain('Access denied');
  });

  it('should return validation error with unified error envelope', async () => {
    const GET = getRoute();
    const request = new NextRequest(
      new URL('http://localhost/api/integrations/github/list-tree?owner=test')
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('success', false);
    expect(data).toHaveProperty('error');
    expect(data.error.code).toBe('INVALID_PARAMS');
    expect(data.error.message).toBe('Invalid query parameters');
    expect(data.error.details).toHaveProperty('errors');
  });
});

// ========================================
// Read File Route Tests
// ========================================

describe('Read File Route Integration', () => {
  const mockReadFile = jest.fn();

  beforeAll(() => {
    jest.mock('../../../src/lib/github/read-file', () => ({
      readFile: mockReadFile,
      InvalidPathError: class extends Error {
        code = 'INVALID_PATH';
        details: any;
        constructor(path: string, reason: string, details: any) {
          super(`Invalid path '${path}': ${reason}`);
          this.details = details;
        }
      },
      NotAFileError: class extends Error {
        code = 'NOT_A_FILE';
        details: any;
        constructor(path: string, details: any) {
          super(`Path '${path}' is not a file`);
          this.details = details;
        }
      },
      FileTooLargeError: class extends Error {
        code = 'FILE_TOO_LARGE';
        details: any;
        constructor(msg: string, details: any) {
          super(msg);
          this.details = details;
        }
      },
      RangeInvalidError: class extends Error {
        code = 'RANGE_INVALID';
        details: any;
        constructor(msg: string, details: any) {
          super(msg);
          this.details = details;
        }
      },
      BinaryOrUnsupportedEncodingError: class extends Error {
        code = 'BINARY_OR_UNSUPPORTED_ENCODING';
        details: any;
        constructor(path: string, details: any) {
          super(`File '${path}' is binary`);
          this.details = details;
        }
      },
      GitHubAPIError: class extends Error {
        code = 'GITHUB_API_ERROR';
        details: any;
        constructor(msg: string, details: any) {
          super(msg);
          this.details = details;
        }
      },
      AuthMisconfiguredError: class extends Error {
        code = 'AUTH_MISCONFIGURED';
        details: any;
        constructor(msg: string, details: any) {
          super(msg);
          this.details = details;
        }
      },
      RepoAccessDeniedError: class extends Error {
        code = 'REPO_NOT_ALLOWED';
        details: any;
        constructor(details: any) {
          super(`Access denied to ${details.owner}/${details.repo}`);
          this.details = details;
        }
      },
    }));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getRoute = () => {
    return require('../../../app/api/integrations/github/read-file/route').GET;
  };

  it('should return success response with unified envelope', async () => {
    const mockResult = {
      meta: { owner: 'test', repo: 'repo', branch: 'main', path: 'test.ts', blobSha: 'abc', commitSha: null, contentSha256: 'hash', snippetHash: 'hash', encoding: 'utf-8' as const, generatedAt: new Date().toISOString(), truncated: false, range: null, totalLines: 10 },
      content: { text: 'test content', lines: [] },
    };

    mockReadFile.mockResolvedValue(mockResult);

    const GET = getRoute();
    const request = new NextRequest(
      new URL('http://localhost/api/integrations/github/read-file?owner=test&repo=repo&path=test.ts')
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('data');
    expect(data.data).toEqual(mockResult);
  });

  it('should return policy denial with unified error envelope', async () => {
    const RepoAccessDeniedError = require('../../../src/lib/github/read-file').RepoAccessDeniedError;
    mockReadFile.mockRejectedValue(new RepoAccessDeniedError({ owner: 'test', repo: 'forbidden' }));

    const GET = getRoute();
    const request = new NextRequest(
      new URL('http://localhost/api/integrations/github/read-file?owner=test&repo=forbidden&path=test.ts')
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toHaveProperty('success', false);
    expect(data).toHaveProperty('error');
    expect(data.error.code).toBe('REPO_NOT_ALLOWED');
    expect(data.error.message).toContain('Access denied');
  });

  it('should return validation error with unified error envelope', async () => {
    const GET = getRoute();
    const request = new NextRequest(
      new URL('http://localhost/api/integrations/github/read-file?owner=test&repo=repo')
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toHaveProperty('success', false);
    expect(data).toHaveProperty('error');
    expect(data.error.code).toBe('INVALID_PARAMS');
    expect(data.error.message).toBe('Invalid query parameters');
    expect(data.error.details).toHaveProperty('errors');
  });
});
