/**
 * Lawbook API Tests (E79.1 / I791)
 * 
 * Tests for lawbook versioning:
 * - Creating lawbook versions (idempotency)
 * - Activating versions
 * - Listing versions
 * - Getting active lawbook
 * - Deny-by-default behavior
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getActiveLawbook } from '../../app/api/lawbook/active/route';
import { GET as listVersions, POST as createVersion } from '../../app/api/lawbook/versions/route';
import { POST as activateVersion } from '../../app/api/lawbook/activate/route';
import { createMinimalLawbook, computeLawbookHash } from '../../src/lawbook/schema';

// Mock database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/lawbook', () => ({
  createLawbookVersion: jest.fn(),
  getActiveLawbook: jest.fn(),
  listLawbookVersions: jest.fn(),
  activateLawbookVersion: jest.fn(),
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

describe('POST /api/lawbook/versions - Create Version', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates new lawbook version successfully', async () => {
    const { createLawbookVersion } = require('../../src/lib/db/lawbook');

    createLawbookVersion.mockResolvedValue({
      success: true,
      data: MOCK_VERSION_RECORD_1,
      isExisting: false,
    });

    const request = new NextRequest('http://localhost:3000/api/lawbook/versions', {
      method: 'POST',
      body: JSON.stringify(MOCK_LAWBOOK_1),
    });

    const response = await createVersion(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe(TEST_VERSION_ID_1);
    expect(data.lawbookVersion).toBe(TEST_VERSION_1);
    expect(data.lawbookHash).toBe(computeLawbookHash(MOCK_LAWBOOK_1));
    expect(data.isExisting).toBe(false);
    expect(data.message).toContain('created successfully');
  });

  test('returns existing version when hash matches (idempotent)', async () => {
    const { createLawbookVersion } = require('../../src/lib/db/lawbook');

    createLawbookVersion.mockResolvedValue({
      success: true,
      data: MOCK_VERSION_RECORD_1,
      isExisting: true,
    });

    const request = new NextRequest('http://localhost:3000/api/lawbook/versions', {
      method: 'POST',
      body: JSON.stringify(MOCK_LAWBOOK_1),
    });

    const response = await createVersion(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toBe(TEST_VERSION_ID_1);
    expect(data.isExisting).toBe(true);
    expect(data.message).toContain('already exists');
  });

  test('rejects invalid lawbook schema', async () => {
    const invalidLawbook = {
      version: '0.7.0',
      lawbookId: 'TEST',
      // Missing required fields
    };

    const request = new NextRequest('http://localhost:3000/api/lawbook/versions', {
      method: 'POST',
      body: JSON.stringify(invalidLawbook),
    });

    const response = await createVersion(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Invalid lawbook schema');
  });

  test('same content produces same hash', async () => {
    const lawbook1 = createMinimalLawbook({ lawbookVersion: '2025-12-30.1' });
    const lawbook2 = createMinimalLawbook({ lawbookVersion: '2025-12-30.1' });

    const hash1 = computeLawbookHash(lawbook1);
    const hash2 = computeLawbookHash(lawbook2);

    expect(hash1).toBe(hash2);
  });

  test('different content produces different hash', async () => {
    const lawbook1 = createMinimalLawbook({ lawbookVersion: '2025-12-30.1' });
    const lawbook2 = createMinimalLawbook({ 
      lawbookVersion: '2025-12-30.1',
      remediation: {
        enabled: false,
        allowedPlaybooks: [],
        allowedActions: [],
      },
    });

    const hash1 = computeLawbookHash(lawbook1);
    const hash2 = computeLawbookHash(lawbook2);

    expect(hash1).not.toBe(hash2);
  });
});

describe('GET /api/lawbook/versions - List Versions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('lists versions successfully', async () => {
    const { listLawbookVersions } = require('../../src/lib/db/lawbook');

    listLawbookVersions.mockResolvedValue([
      MOCK_VERSION_RECORD_2, // Newest first
      MOCK_VERSION_RECORD_1,
    ]);

    const request = new NextRequest('http://localhost:3000/api/lawbook/versions');

    const response = await listVersions(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.lawbookId).toBe(TEST_LAWBOOK_ID);
    expect(data.versions).toHaveLength(2);
    expect(data.versions[0].lawbookVersion).toBe(TEST_VERSION_2);
    expect(data.versions[1].lawbookVersion).toBe(TEST_VERSION_1);
  });

  test('respects pagination parameters', async () => {
    const { listLawbookVersions } = require('../../src/lib/db/lawbook');

    listLawbookVersions.mockResolvedValue([MOCK_VERSION_RECORD_1]);

    const request = new NextRequest(
      'http://localhost:3000/api/lawbook/versions?limit=10&offset=5'
    );

    const response = await listVersions(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(listLawbookVersions).toHaveBeenCalledWith(TEST_LAWBOOK_ID, 10, 5);
  });
});

describe('POST /api/lawbook/activate - Activate Version', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('activates version successfully', async () => {
    const { activateLawbookVersion } = require('../../src/lib/db/lawbook');

    activateLawbookVersion.mockResolvedValue({
      success: true,
      data: {
        lawbook_id: TEST_LAWBOOK_ID,
        active_lawbook_version_id: TEST_VERSION_ID_1,
        updated_at: '2025-12-30T12:00:00.000Z',
      },
    });

    const request = new NextRequest('http://localhost:3000/api/lawbook/activate', {
      method: 'POST',
      body: JSON.stringify({
        lawbookVersionId: TEST_VERSION_ID_1,
        activatedBy: 'admin',
      }),
    });

    const response = await activateVersion(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.lawbookId).toBe(TEST_LAWBOOK_ID);
    expect(data.activeLawbookVersionId).toBe(TEST_VERSION_ID_1);
    expect(data.message).toContain('activated successfully');
  });

  test('rejects invalid version ID', async () => {
    const { activateLawbookVersion } = require('../../src/lib/db/lawbook');

    activateLawbookVersion.mockResolvedValue({
      success: false,
      error: 'Lawbook version not found',
    });

    const request = new NextRequest('http://localhost:3000/api/lawbook/activate', {
      method: 'POST',
      body: JSON.stringify({
        lawbookVersionId: 'invalid-id',
      }),
    });

    const response = await activateVersion(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toContain('not found');
  });

  test('requires lawbookVersionId', async () => {
    const request = new NextRequest('http://localhost:3000/api/lawbook/activate', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await activateVersion(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Missing or invalid lawbookVersionId');
  });
});

describe('GET /api/lawbook/active - Get Active Lawbook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns active lawbook successfully', async () => {
    const { getActiveLawbook: mockGetActive } = require('../../src/lib/db/lawbook');

    mockGetActive.mockResolvedValue({
      success: true,
      data: MOCK_VERSION_RECORD_1,
    });

    const request = new NextRequest('http://localhost:3000/api/lawbook/active');

    const response = await getActiveLawbook(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toBe(TEST_VERSION_ID_1);
    expect(data.lawbookVersion).toBe(TEST_VERSION_1);
    expect(data.lawbookHash).toBe(MOCK_VERSION_RECORD_1.lawbook_hash);
    expect(data.lawbook).toEqual(MOCK_LAWBOOK_1);
  });

  test('returns 404 when no active lawbook configured (deny-by-default)', async () => {
    const { getActiveLawbook: mockGetActive } = require('../../src/lib/db/lawbook');

    mockGetActive.mockResolvedValue({
      success: false,
      error: 'No active lawbook configured',
      notConfigured: true,
    });

    const request = new NextRequest('http://localhost:3000/api/lawbook/active');

    const response = await getActiveLawbook(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toContain('No active lawbook configured');
    expect(data.notConfigured).toBe(true);
  });

  test('supports custom lawbookId parameter', async () => {
    const { getActiveLawbook: mockGetActive } = require('../../src/lib/db/lawbook');

    mockGetActive.mockResolvedValue({
      success: true,
      data: MOCK_VERSION_RECORD_1,
    });

    const request = new NextRequest(
      'http://localhost:3000/api/lawbook/active?lawbookId=CUSTOM-LAWBOOK'
    );

    const response = await getActiveLawbook(request);

    expect(mockGetActive).toHaveBeenCalledWith('CUSTOM-LAWBOOK');
    expect(response.status).toBe(200);
  });
});

describe('Lawbook Hash Determinism', () => {
  test('array order normalization produces same hash', () => {
    const lawbook1 = createMinimalLawbook({
      remediation: {
        enabled: true,
        allowedPlaybooks: ['A', 'B', 'C'],
        allowedActions: ['X', 'Y', 'Z'],
      },
    });

    const lawbook2 = createMinimalLawbook({
      remediation: {
        enabled: true,
        allowedPlaybooks: ['C', 'A', 'B'], // Different order
        allowedActions: ['Z', 'X', 'Y'],   // Different order
      },
    });

    const hash1 = computeLawbookHash(lawbook1);
    const hash2 = computeLawbookHash(lawbook2);

    // Should produce same hash because arrays are sorted during canonicalization
    expect(hash1).toBe(hash2);
  });

  test('hash format is valid SHA-256', () => {
    const lawbook = createMinimalLawbook();
    const hash = computeLawbookHash(lawbook);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
