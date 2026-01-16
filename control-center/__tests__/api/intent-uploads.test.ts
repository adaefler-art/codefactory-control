/**
 * Tests for INTENT Session Uploads API
 * Issue V09-I06: Upload + Sources Management (Product Memory Basis)
 */

import { NextRequest } from 'next/server';
import { POST, GET } from '@/app/api/intent/sessions/[id]/uploads/route';
import { DELETE } from '@/app/api/intent/sessions/[id]/uploads/[uploadId]/route';
import { getPool } from '@/lib/db';
import { validateUpload, calculateSHA256 } from '@/lib/upload-storage-service';

// Mock dependencies
jest.mock('@/lib/db');
jest.mock('@/lib/upload-storage-service', () => {
  const actual = jest.requireActual('@/lib/upload-storage-service');
  return {
    ...actual,
    storeUpload: jest.fn(),
    deleteUpload: jest.fn(),
  };
});

const mockPool = {
  query: jest.fn(),
};

(getPool as jest.Mock).mockReturnValue(mockPool);

const TEST_SESSION_ID = '123e4567-e89b-12d3-a456-426614174000';
const TEST_USER_ID = 'test-user-123';
const TEST_UPLOAD_ID = '223e4567-e89b-12d3-a456-426614174000';

describe('Upload API - POST /api/intent/sessions/[id]/uploads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 when user is not authenticated', async () => {
    const request = new NextRequest('http://localhost:3000/api/intent/sessions/123/uploads', {
      method: 'POST',
    });

    const response = await POST(request, { 
      params: Promise.resolve({ id: TEST_SESSION_ID }) 
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('should return 403 when session not found or access denied', async () => {
    const formData = new FormData();
    const blob = new Blob(['test content'], { type: 'text/plain' });
    formData.append('file', blob, 'test.txt');

    const request = new NextRequest('http://localhost:3000/api/intent/sessions/123/uploads', {
      method: 'POST',
      headers: {
        'x-afu9-sub': TEST_USER_ID,
      },
      body: formData,
    });

    mockPool.query.mockResolvedValueOnce({ rows: [] }); // Session not found

    const response = await POST(request, { 
      params: Promise.resolve({ id: TEST_SESSION_ID }) 
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Session not found');
  });

  it('should return 400 when no files provided', async () => {
    const formData = new FormData();

    const request = new NextRequest('http://localhost:3000/api/intent/sessions/123/uploads', {
      method: 'POST',
      headers: {
        'x-afu9-sub': TEST_USER_ID,
      },
      body: formData,
    });

    mockPool.query.mockResolvedValueOnce({ rows: [{ id: TEST_SESSION_ID }] }); // Session exists

    const response = await POST(request, { 
      params: Promise.resolve({ id: TEST_SESSION_ID }) 
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('No files provided');
  });
});

describe('Upload API - GET /api/intent/sessions/[id]/uploads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 when user is not authenticated', async () => {
    const request = new NextRequest('http://localhost:3000/api/intent/sessions/123/uploads');

    const response = await GET(request, { 
      params: Promise.resolve({ id: TEST_SESSION_ID }) 
    });

    expect(response.status).toBe(401);
  });

  it('should return uploads list for authenticated user', async () => {
    const request = new NextRequest('http://localhost:3000/api/intent/sessions/123/uploads', {
      headers: {
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const mockUploads = [
      {
        id: TEST_UPLOAD_ID,
        filename: 'test.pdf',
        content_type: 'application/pdf',
        size_bytes: 1024,
        content_sha256: 'abc123',
        created_at: '2026-01-16T10:00:00Z',
      },
    ];

    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: TEST_SESSION_ID }] }) // Session exists
      .mockResolvedValueOnce({ rows: mockUploads }); // Uploads

    const response = await GET(request, { 
      params: Promise.resolve({ id: TEST_SESSION_ID }) 
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.uploads).toHaveLength(1);
    expect(body.uploads[0].filename).toBe('test.pdf');
    expect(body.count).toBe(1);
  });
});

describe('Upload API - DELETE /api/intent/sessions/[id]/uploads/[uploadId]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 when user is not authenticated', async () => {
    const request = new NextRequest('http://localhost:3000/api/intent/sessions/123/uploads/456', {
      method: 'DELETE',
    });

    const response = await DELETE(request, { 
      params: Promise.resolve({ id: TEST_SESSION_ID, uploadId: TEST_UPLOAD_ID }) 
    });

    expect(response.status).toBe(401);
  });

  it('should return 404 when upload not found', async () => {
    const request = new NextRequest('http://localhost:3000/api/intent/sessions/123/uploads/456', {
      method: 'DELETE',
      headers: {
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    mockPool.query.mockResolvedValueOnce({ rows: [] }); // Upload not found

    const response = await DELETE(request, { 
      params: Promise.resolve({ id: TEST_SESSION_ID, uploadId: TEST_UPLOAD_ID }) 
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('Upload not found');
  });

  it('should delete upload successfully', async () => {
    const request = new NextRequest('http://localhost:3000/api/intent/sessions/123/uploads/456', {
      method: 'DELETE',
      headers: {
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const { deleteUpload } = require('@/lib/upload-storage-service');

    mockPool.query
      .mockResolvedValueOnce({ 
        rows: [{ id: TEST_UPLOAD_ID, storage_key: 'session/upload/file.txt' }] 
      }) // Upload exists
      .mockResolvedValueOnce({ rows: [] }); // Delete

    deleteUpload.mockResolvedValueOnce(undefined);

    const response = await DELETE(request, { 
      params: Promise.resolve({ id: TEST_SESSION_ID, uploadId: TEST_UPLOAD_ID }) 
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe(true);
    expect(body.uploadId).toBe(TEST_UPLOAD_ID);
  });
});

describe('Upload validation', () => {
  it('should validate allowed file types', () => {
    const validTypes = [
      { filename: 'test.pdf', mime: 'application/pdf' },
      { filename: 'test.md', mime: 'text/markdown' },
      { filename: 'test.txt', mime: 'text/plain' },
      { filename: 'test.json', mime: 'application/json' },
      { filename: 'test.png', mime: 'image/png' },
      { filename: 'test.jpg', mime: 'image/jpeg' },
    ];

    validTypes.forEach(({ filename, mime }) => {
      const result = validateUpload(filename, 1024, mime);
      expect(result.valid).toBe(true);
      expect(result.contentType).toBe(mime);
    });
  });

  it('should reject disallowed file types', () => {
    const result = validateUpload('test.exe', 1024);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not allowed');
  });

  it('should reject files exceeding size limit', () => {
    const result = validateUpload('test.pdf', 100 * 1024 * 1024); // 100MB
    expect(result.valid).toBe(false);
    expect(result.error).toContain('exceeds maximum');
  });

  it('should validate SHA256 calculation', () => {
    const content = Buffer.from('test content');
    const hash = calculateSHA256(content);
    expect(hash).toHaveLength(64); // SHA256 is 64 hex characters
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });
});
