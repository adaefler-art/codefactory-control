/**
 * Admin Lawbook API Tests (E79.2 / I792)
 * 
 * Tests for admin lawbook editor APIs:
 * - Validate endpoint
 * - Publish endpoint  
 * - Diff endpoint
 * - Get version by ID endpoint
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as validateLawbook } from '../../app/api/lawbook/validate/route';
import { POST as publishLawbook } from '../../app/api/lawbook/publish/route';
import { POST as diffLawbooks } from '../../app/api/lawbook/diff/route';
import { GET as getVersionById } from '../../app/api/lawbook/versions/[id]/route';
import { createMinimalLawbook, computeLawbookHash } from '../../src/lawbook/schema';

// Mock database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/lawbook', () => ({
  createLawbookVersion: jest.fn(),
  getLawbookVersionById: jest.fn(),
}));

const TEST_LAWBOOK_ID = 'AFU9-LAWBOOK';
const TEST_VERSION_1 = '2025-12-30.1';
const TEST_VERSION_2 = '2025-12-30.2';
const TEST_VERSION_ID_1 = '123e4567-e89b-12d3-a456-426614174001';
const TEST_VERSION_ID_2 = '123e4567-e89b-12d3-a456-426614174002';

const MOCK_LAWBOOK_1 = createMinimalLawbook({
  lawbookVersion: TEST_VERSION_1,
});

const MOCK_LAWBOOK_2 = createMinimalLawbook({
  lawbookVersion: TEST_VERSION_2,
  remediation: {
    enabled: true,
    allowedPlaybooks: ['SAFE_RETRY_RUNNER'],
    allowedActions: ['runner_dispatch'],
    maxRunsPerIncident: 5,
    cooldownMinutes: 30,
  },
});

const MOCK_VERSION_RECORD_1 = {
  id: TEST_VERSION_ID_1,
  lawbook_id: TEST_LAWBOOK_ID,
  lawbook_version: TEST_VERSION_1,
  created_at: '2025-12-30T10:00:00.000Z',
  created_by: 'system' as const,
  lawbook_json: MOCK_LAWBOOK_1,
  lawbook_hash: computeLawbookHash(MOCK_LAWBOOK_1),
  schema_version: '0.7.0',
};

const MOCK_VERSION_RECORD_2 = {
  id: TEST_VERSION_ID_2,
  lawbook_id: TEST_LAWBOOK_ID,
  lawbook_version: TEST_VERSION_2,
  created_at: '2025-12-30T11:00:00.000Z',
  created_by: 'admin' as const,
  lawbook_json: MOCK_LAWBOOK_2,
  lawbook_hash: computeLawbookHash(MOCK_LAWBOOK_2),
  schema_version: '0.7.0',
};

describe('POST /api/lawbook/validate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('validates lawbook successfully', async () => {
    const request = new NextRequest('http://localhost:3000/api/lawbook/validate', {
      method: 'POST',
      headers: { 
        'x-afu9-sub': 'test-user',
        'content-type': 'application/json',
      },
      body: JSON.stringify(MOCK_LAWBOOK_1),
    });

    const response = await validateLawbook(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.errors).toEqual([]);
    expect(data.hash).toBe(computeLawbookHash(MOCK_LAWBOOK_1));
    expect(data.lawbookId).toBe(TEST_LAWBOOK_ID);
    expect(data.lawbookVersion).toBe(TEST_VERSION_1);
  });

  test('returns validation errors with deterministic ordering', async () => {
    const invalidLawbook = {
      version: '0.7.0',
      // Missing required fields
    };

    const request = new NextRequest('http://localhost:3000/api/lawbook/validate', {
      method: 'POST',
      headers: { 
        'x-afu9-sub': 'test-user',
        'content-type': 'application/json',
      },
      body: JSON.stringify(invalidLawbook),
    });

    const response = await validateLawbook(request);
    const data = await response.json();

    expect(response.status).toBe(200); // Validation endpoint returns 200 with ok: false
    expect(data.ok).toBe(false);
    expect(Array.isArray(data.errors)).toBe(true);
    expect(data.errors.length).toBeGreaterThan(0);
    expect(data.hash).toBeNull();

    // Verify errors are sorted by path
    const paths = data.errors.map((e: any) => e.path);
    const sortedPaths = [...paths].sort();
    expect(paths).toEqual(sortedPaths);
  });

  test('returns error for invalid JSON', async () => {
    const request = new NextRequest('http://localhost:3000/api/lawbook/validate', {
      method: 'POST',
      headers: { 
        'x-afu9-sub': 'test-user',
        'content-type': 'application/json',
      },
      body: 'invalid json{',
    });

    const response = await validateLawbook(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.errors).toHaveLength(1);
    expect(data.errors[0].code).toBe('INVALID_JSON');
  });

  test('requires authentication', async () => {
    const request = new NextRequest('http://localhost:3000/api/lawbook/validate', {
      method: 'POST',
      headers: { 
        'content-type': 'application/json',
      },
      body: JSON.stringify(MOCK_LAWBOOK_1),
    });

    const response = await validateLawbook(request);

    expect(response.status).toBe(401);
  });
});

describe('POST /api/lawbook/publish', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('publishes new lawbook version', async () => {
    const { createLawbookVersion } = require('../../src/lib/db/lawbook');

    createLawbookVersion.mockResolvedValue({
      success: true,
      data: MOCK_VERSION_RECORD_1,
      isExisting: false,
    });

    const request = new NextRequest('http://localhost:3000/api/lawbook/publish', {
      method: 'POST',
      headers: { 
        'x-afu9-sub': 'test-user',
        'content-type': 'application/json',
      },
      body: JSON.stringify(MOCK_LAWBOOK_1),
    });

    const response = await publishLawbook(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe(TEST_VERSION_ID_1);
    expect(data.lawbookVersion).toBe(TEST_VERSION_1);
    expect(data.isExisting).toBe(false);
    expect(data.message).toContain('published successfully');
  });

  test('returns existing version when hash matches (idempotent)', async () => {
    const { createLawbookVersion } = require('../../src/lib/db/lawbook');

    createLawbookVersion.mockResolvedValue({
      success: true,
      data: MOCK_VERSION_RECORD_1,
      isExisting: true,
    });

    const request = new NextRequest('http://localhost:3000/api/lawbook/publish', {
      method: 'POST',
      headers: { 
        'x-afu9-sub': 'test-user',
        'content-type': 'application/json',
      },
      body: JSON.stringify(MOCK_LAWBOOK_1),
    });

    const response = await publishLawbook(request);
    const data = await response.json();

    expect(response.status).toBe(200); // Existing version returns 200, not 201
    expect(data.id).toBe(TEST_VERSION_ID_1);
    expect(data.isExisting).toBe(true);
    expect(data.message).toContain('already exists');
  });

  test('requires authentication', async () => {
    const request = new NextRequest('http://localhost:3000/api/lawbook/publish', {
      method: 'POST',
      headers: { 
        'content-type': 'application/json',
      },
      body: JSON.stringify(MOCK_LAWBOOK_1),
    });

    const response = await publishLawbook(request);

    expect(response.status).toBe(401);
  });
});

describe('GET /api/lawbook/versions/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('gets lawbook version by ID', async () => {
    const { getLawbookVersionById } = require('../../src/lib/db/lawbook');

    getLawbookVersionById.mockResolvedValue(MOCK_VERSION_RECORD_1);

    const request = new NextRequest(
      `http://localhost:3000/api/lawbook/versions/${TEST_VERSION_ID_1}`,
      {
        method: 'GET',
        headers: { 
          'x-afu9-sub': 'test-user',
        },
      }
    );

    const response = await getVersionById(
      request,
      { params: Promise.resolve({ id: TEST_VERSION_ID_1 }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toBe(TEST_VERSION_ID_1);
    expect(data.lawbookVersion).toBe(TEST_VERSION_1);
    expect(data.lawbook).toEqual(MOCK_LAWBOOK_1);
  });

  test('returns 404 for non-existent version', async () => {
    const { getLawbookVersionById } = require('../../src/lib/db/lawbook');

    getLawbookVersionById.mockResolvedValue(null);

    const request = new NextRequest(
      'http://localhost:3000/api/lawbook/versions/nonexistent',
      {
        method: 'GET',
        headers: { 
          'x-afu9-sub': 'test-user',
        },
      }
    );

    const response = await getVersionById(
      request,
      { params: Promise.resolve({ id: 'nonexistent' }) }
    );

    expect(response.status).toBe(404);
  });

  test('requires authentication', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/lawbook/versions/${TEST_VERSION_ID_1}`,
      {
        method: 'GET',
      }
    );

    const response = await getVersionById(
      request,
      { params: Promise.resolve({ id: TEST_VERSION_ID_1 }) }
    );

    expect(response.status).toBe(401);
  });
});

describe('POST /api/lawbook/diff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('computes diff between two versions', async () => {
    const { getLawbookVersionById } = require('../../src/lib/db/lawbook');

    getLawbookVersionById.mockImplementation((id: string) => {
      if (id === TEST_VERSION_ID_1) return Promise.resolve(MOCK_VERSION_RECORD_1);
      if (id === TEST_VERSION_ID_2) return Promise.resolve(MOCK_VERSION_RECORD_2);
      return Promise.resolve(null);
    });

    const request = new NextRequest('http://localhost:3000/api/lawbook/diff', {
      method: 'POST',
      headers: { 
        'x-afu9-sub': 'test-user',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        versionId1: TEST_VERSION_ID_1,
        versionId2: TEST_VERSION_ID_2,
      }),
    });

    const response = await diffLawbooks(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.version1.id).toBe(TEST_VERSION_ID_1);
    expect(data.version2.id).toBe(TEST_VERSION_ID_2);
    expect(Array.isArray(data.changes)).toBe(true);
    expect(data.changeCount).toBe(data.changes.length);

    // Verify changes are sorted by path (deterministic)
    const paths = data.changes.map((c: any) => c.path);
    const sortedPaths = [...paths].sort();
    expect(paths).toEqual(sortedPaths);
  });

  test('returns empty changes when versions are identical', async () => {
    const { getLawbookVersionById } = require('../../src/lib/db/lawbook');

    // Return same version for both IDs
    getLawbookVersionById.mockResolvedValue(MOCK_VERSION_RECORD_1);

    const request = new NextRequest('http://localhost:3000/api/lawbook/diff', {
      method: 'POST',
      headers: { 
        'x-afu9-sub': 'test-user',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        versionId1: TEST_VERSION_ID_1,
        versionId2: TEST_VERSION_ID_1,
      }),
    });

    const response = await diffLawbooks(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.changes).toEqual([]);
    expect(data.changeCount).toBe(0);
  });

  test('returns 404 for non-existent version', async () => {
    const { getLawbookVersionById } = require('../../src/lib/db/lawbook');

    getLawbookVersionById.mockImplementation((id: string) => {
      if (id === TEST_VERSION_ID_1) return Promise.resolve(MOCK_VERSION_RECORD_1);
      return Promise.resolve(null);
    });

    const request = new NextRequest('http://localhost:3000/api/lawbook/diff', {
      method: 'POST',
      headers: { 
        'x-afu9-sub': 'test-user',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        versionId1: TEST_VERSION_ID_1,
        versionId2: 'nonexistent',
      }),
    });

    const response = await diffLawbooks(request);

    expect(response.status).toBe(404);
  });

  test('requires both version IDs', async () => {
    const request = new NextRequest('http://localhost:3000/api/lawbook/diff', {
      method: 'POST',
      headers: { 
        'x-afu9-sub': 'test-user',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        versionId1: TEST_VERSION_ID_1,
        // Missing versionId2
      }),
    });

    const response = await diffLawbooks(request);

    expect(response.status).toBe(400);
  });

  test('requires authentication', async () => {
    const request = new NextRequest('http://localhost:3000/api/lawbook/diff', {
      method: 'POST',
      headers: { 
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        versionId1: TEST_VERSION_ID_1,
        versionId2: TEST_VERSION_ID_2,
      }),
    });

    const response = await diffLawbooks(request);

    expect(response.status).toBe(401);
  });
});
